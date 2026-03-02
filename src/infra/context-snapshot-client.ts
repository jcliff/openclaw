import { setTimeout as delay } from "node:timers/promises";

export type ContextSnapshotPayload = {
  agent: string;
  session_key: string;
  ts: string;
  system_prompt_text?: string;
  context_report?: unknown;
  files?: Record<string, string>;
};

export function parseContextSnapshotBoolean(raw: string | undefined): boolean {
  if (!raw) {
    return false;
  }
  const normalized = raw.trim().toLowerCase();
  return normalized === "1" || normalized === "true";
}

function isLoopbackHost(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();
  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized === "[::1]"
  );
}

export function resolveSnapshotBaseUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  const configured = (env.OPENCLAW_CONTEXT_SNAPSHOT_URL || "").trim();
  const allowRemote = parseContextSnapshotBoolean(env.OPENCLAW_CONTEXT_SNAPSHOT_ALLOW_REMOTE);
  const candidate = configured || "http://127.0.0.1:18800";
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return null;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return null;
  }
  const loopback = isLoopbackHost(parsed.hostname);
  if (!loopback && !allowRemote) {
    return null;
  }
  if (!loopback && parsed.protocol !== "https:") {
    return null;
  }

  return parsed.toString().replace(/\/+$/, "");
}

function resolveAgentName(): string {
  return (
    process.env.OPENCLAW_AGENT || process.env.OPENCLAW_AGENT_NAME || process.env.USER || "unknown"
  );
}

function resolveSnapshotTimeoutMs(): number {
  const raw = process.env.OPENCLAW_CONTEXT_SNAPSHOT_TIMEOUT_MS;
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  if (Number.isFinite(parsed) && parsed > 0) {
    return Math.min(parsed, 30_000);
  }
  return 1_500;
}

export async function sendContextSnapshot(params: {
  sessionKey: string;
  systemPromptText?: string;
  files?: Record<string, string>;
  contextReport?: unknown;
  // Best-effort: caller can disable
  enabled: boolean;
}): Promise<void> {
  if (!params.enabled) {
    return;
  }

  const base = resolveSnapshotBaseUrl();
  if (!base) {
    return;
  }

  const payload: ContextSnapshotPayload = {
    agent: resolveAgentName(),
    session_key: params.sessionKey,
    ts: new Date().toISOString(),
    system_prompt_text: params.systemPromptText,
    context_report: params.contextReport,
    files: params.files,
  };

  const url = `${base}/context/snapshot`;

  // Best-effort, low-latency. Tiny retry to smooth transient connection races at startup.
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), resolveSnapshotTimeoutMs());
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      if (!res.ok) {
        // Don't throw on non-2xx; snapshots are best-effort.
        return;
      }
      return;
    } catch {
      if (attempt === 0) {
        await delay(150);
        continue;
      }
      return;
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function sendContextSnapshotDetached(params: {
  sessionKey: string;
  systemPromptText?: string;
  files?: Record<string, string>;
  contextReport?: unknown;
  enabled: boolean;
}): void {
  void sendContextSnapshot(params);
}
