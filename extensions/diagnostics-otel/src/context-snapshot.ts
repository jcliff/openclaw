/**
 * context-snapshot.ts — OC#3 Slice 1
 *
 * After each completed turn (model.usage event), POST a context snapshot to
 * Drumbeat's /context/snapshot endpoint. Drumbeat commits the snapshot to a
 * per-agent git repo, per-session branch, per-turn commit.
 *
 * Opt-in via config:
 *   diagnostics.contextSnapshot.enabled: true
 *   diagnostics.contextSnapshot.endpoint: "http://127.0.0.1:18800"  (default)
 *   diagnostics.contextSnapshot.maxFileSizeBytes: 65536              (default 64 KiB)
 *   diagnostics.contextSnapshot.maxTotalBytes: 8388608               (default 8 MiB)
 *
 * File content is read from disk using ctx.workspaceDir + file name.
 * The full system prompt text is attached as system_prompt_text when present.
 */

import fs from "node:fs";
import path from "node:path";
import type { DiagnosticEventPayload, OpenClawPluginServiceContext } from "openclaw/plugin-sdk";

type DiagnosticUsageEvent = Extract<DiagnosticEventPayload, { type: "model.usage" }> & {
  turnBundleJson?: string;
  systemPromptBaseText?: string;
  systemPromptReport?: unknown;
};

export type ContextSnapshotConfig = {
  enabled?: boolean;
  /** Drumbeat base URL (without path). Default: http://127.0.0.1:18800 */
  endpoint?: string;
  /** Max bytes per file. Default: 64 KiB */
  maxFileSizeBytes?: number;
  /** Max total payload bytes across all files. Default: 8 MiB */
  maxTotalBytes?: number;
};

type SnapshotPayload = {
  agent: string;
  session_key: string;
  ts: string;
  files: Record<string, string>;
  system_prompt_text?: string;
};

/**
 * Read a workspace file, capping at maxBytes. Returns null if unreadable.
 */
function readFile(filePath: string, maxBytes: number): string | null {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return null;
    const size = Math.min(stat.size, maxBytes);
    const buf = Buffer.alloc(size);
    const fd = fs.openSync(filePath, "r");
    try {
      fs.readSync(fd, buf, 0, size, 0);
    } finally {
      fs.closeSync(fd);
    }
    const text = buf.toString("utf8");
    return stat.size > maxBytes ? text + `\n[truncated: ${stat.size} bytes total]` : text;
  } catch {
    return null;
  }
}

/**
 * Send a context snapshot to Drumbeat. Fire-and-forget — never throws.
 */
export async function sendContextSnapshot(
  evt: DiagnosticUsageEvent,
  ctx: OpenClawPluginServiceContext,
  serviceName: string,
  snapshotCfg: ContextSnapshotConfig,
): Promise<void> {
  if (!snapshotCfg.enabled) return;
  if (!evt.sessionKey) return;

  const endpoint = snapshotCfg.endpoint ?? "http://127.0.0.1:18800";
  const maxFileBytes = snapshotCfg.maxFileSizeBytes ?? 64 * 1024;
  const maxTotalBytes = snapshotCfg.maxTotalBytes ?? 8 * 1024 * 1024;
  const workspaceDir = ctx.workspaceDir ?? "";

  const files: Record<string, string> = {};
  let totalBytes = 0;

  const systemPromptText =
    typeof evt.systemPromptText === "string" && evt.systemPromptText.length > 0
      ? evt.systemPromptText
      : undefined;

  if (workspaceDir && evt.systemPromptReport?.injectedWorkspaceFiles) {
    for (const { name } of evt.systemPromptReport.injectedWorkspaceFiles) {
      if (totalBytes >= maxTotalBytes) break;
      const filePath = path.isAbsolute(name) ? name : path.join(workspaceDir, name);
      const content = readFile(filePath, Math.min(maxFileBytes, maxTotalBytes - totalBytes));
      if (content !== null) {
        files[name] = content;
        totalBytes += Buffer.byteLength(content, "utf8");
      }
    }
  }

  if (typeof evt.systemPromptBaseText === "string" && evt.systemPromptBaseText.length > 0) {
    if (totalBytes < maxTotalBytes) {
      const remaining = maxTotalBytes - totalBytes;
      const raw = evt.systemPromptBaseText;
      const rawBytes = Buffer.byteLength(raw, "utf8");
      const content =
        rawBytes > remaining
          ? raw.slice(0, remaining) + `\n[truncated: ${rawBytes} bytes total]`
          : raw;
      files["system-prompt.base.txt"] = content;
      totalBytes += Buffer.byteLength(content, "utf8");
    }
  }

  // Only attach the report JSON if we're already attaching at least one other file.
  // This keeps "missing/unreadable workspace" snapshots from emitting a noisy report-only payload.
  if (evt.systemPromptReport && Object.keys(files).length > 0) {
    if (totalBytes < maxTotalBytes) {
      const remaining = maxTotalBytes - totalBytes;
      const raw = JSON.stringify(evt.systemPromptReport, null, 2);
      const rawBytes = Buffer.byteLength(raw, "utf8");
      const content =
        rawBytes > remaining
          ? raw.slice(0, remaining) + `\n[truncated: ${rawBytes} bytes total]`
          : raw;
      files["system-prompt.report.json"] = content;
      totalBytes += Buffer.byteLength(content, "utf8");
    }
  }

  if (typeof evt.turnBundleJson === "string" && evt.turnBundleJson.length > 0) {
    // Always include the per-turn bundle when present; it is the v0 replay primitive.
    // Bypass maxFileBytes (64 KiB) and instead respect remaining total budget.
    if (totalBytes < maxTotalBytes) {
      const remaining = maxTotalBytes - totalBytes;
      const raw = evt.turnBundleJson;
      const rawBytes = Buffer.byteLength(raw, "utf8");
      const content =
        rawBytes > remaining
          ? raw.slice(0, remaining) + `\n[truncated: ${rawBytes} bytes total]`
          : raw;
      files["turn-bundle.json"] = content;
      totalBytes += Buffer.byteLength(content, "utf8");
    }
  }

  const payload: SnapshotPayload = {
    agent: serviceName,
    session_key: evt.sessionKey,
    ts: new Date().toISOString(),
    files,
    ...(systemPromptText ? { system_prompt_text: systemPromptText } : {}),
  };

  const url = `${endpoint}/context/snapshot`;

  try {
    const body = JSON.stringify(payload);
    const bodyBytes = Buffer.byteLength(body, "utf8");

    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Avoid stale keep-alive sockets when Drumbeat restarts.
        // POST is non-idempotent, so undici may not retry on reset connections.
        Connection: "close",
      },
      body,
      signal: AbortSignal.timeout(10_000),
    });

    if (!resp.ok) {
      let respBody = "";
      try {
        respBody = (await resp.text()).slice(0, 512);
      } catch {
        // ignore
      }
      ctx.logger.warn(
        `diagnostics-otel: context snapshot failed: ${resp.status} ${resp.statusText} url=${url} bytes=${bodyBytes}` +
          (respBody ? ` body=${JSON.stringify(respBody)}` : ""),
      );
    }
  } catch (err) {
    // Non-fatal — snapshot is best-effort
    const e = err as any;
    const msg = err instanceof Error ? err.message : String(err);
    const cause = e?.cause;

    let causeInfo = "";
    if (cause) {
      const cmsg = cause instanceof Error ? cause.message : String(cause);
      const ccode = (cause as any)?.code;
      causeInfo = ` cause=${ccode ? `${ccode}:` : ""}${cmsg}`;
    }

    ctx.logger.warn(`diagnostics-otel: context snapshot error: ${msg} url=${url}${causeInfo}`);
  }
}
