/**
 * Contract tests for context-snapshot.ts (OC#3 Slice 1)
 *
 * Verifies:
 * - No POST when enabled=false
 * - No POST when sessionKey is absent
 * - POST fires with correct payload shape when enabled
 * - Files are read from workspaceDir + name
 * - Payload is bounded by maxFileSizeBytes / maxTotalBytes
 * - Non-fatal on fetch error
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DiagnosticEventPayload, OpenClawPluginServiceContext } from "openclaw/plugin-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendContextSnapshot } from "./context-snapshot.js";

type DiagnosticUsageEvent = Extract<DiagnosticEventPayload, { type: "model.usage" }>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEvt(overrides: Partial<DiagnosticUsageEvent> = {}): DiagnosticUsageEvent {
  const base: DiagnosticUsageEvent = {
    type: "model.usage",
    sessionKey: "discord:channel:1234",
    usage: { input: 100, output: 50 },
    systemPromptReport: {
      systemPrompt: { chars: 200, projectContextChars: 100, nonProjectContextChars: 100 },
      injectedWorkspaceFiles: [],
      skills: { promptChars: 0, entries: [] },
      tools: { listChars: 0, schemaChars: 0 },
    },
    // DiagnosticBaseEvent fields (required)
    ts: Date.now(),
    seq: 0,
  };

  return {
    ...base,
    ...overrides,
    // Ensure required base fields are never undefined (Partial can override them).
    ts: overrides.ts ?? base.ts,
    seq: overrides.seq ?? base.seq,
  };
}

function makeCtx(workspaceDir?: string): OpenClawPluginServiceContext {
  return {
    config: { commands: {} } as never,
    workspaceDir,
    stateDir: "/tmp/test-state",
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    } as never,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("sendContextSnapshot", () => {
  let tmpDir: string;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "oc3-test-"));
    fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, statusText: "OK" });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("does not POST when enabled=false", async () => {
    await sendContextSnapshot(makeEvt(), makeCtx(), "alux", { enabled: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not POST when enabled is undefined", async () => {
    await sendContextSnapshot(makeEvt(), makeCtx(), "alux", {});
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not POST when sessionKey is missing", async () => {
    const evt = makeEvt({ sessionKey: undefined });
    await sendContextSnapshot(evt, makeCtx(), "alux", { enabled: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("POSTs to endpoint/context/snapshot when enabled", async () => {
    await sendContextSnapshot(makeEvt(), makeCtx(), "alux", {
      enabled: true,
      endpoint: "http://127.0.0.1:18800",
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:18800/context/snapshot");
    expect(opts.method).toBe("POST");
    const body = JSON.parse(opts.body as string);
    expect(body).toMatchObject({
      agent: "alux",
      session_key: "discord:channel:1234",
      files: {},
    });
    expect(typeof body.ts).toBe("string");
  });

  it("uses default endpoint when not specified", async () => {
    await sendContextSnapshot(makeEvt(), makeCtx(), "alux", { enabled: true });
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe("http://127.0.0.1:18800/context/snapshot");
  });

  it("includes full system prompt text as system_prompt_text", async () => {
    const systemPromptText = "line 1\nline 2\ntrailing spaces   \n";
    await sendContextSnapshot(makeEvt({ systemPromptText }), makeCtx(), "alux", { enabled: true });
    const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body.system_prompt_text).toBe(systemPromptText);
  });

  it("reads workspace files listed in systemPromptReport", async () => {
    fs.writeFileSync(path.join(tmpDir, "MEMORY.md"), "# Memory content");
    fs.writeFileSync(path.join(tmpDir, "SOUL.md"), "# Soul content");

    const evt = makeEvt({
      systemPromptReport: {
        systemPrompt: { chars: 200, projectContextChars: 100, nonProjectContextChars: 100 },
        injectedWorkspaceFiles: [
          { name: "MEMORY.md", injectedChars: 16, truncated: false },
          { name: "SOUL.md", injectedChars: 13, truncated: false },
        ],
        skills: { promptChars: 0, entries: [] },
        tools: { listChars: 0, schemaChars: 0 },
      },
    });

    await sendContextSnapshot(evt, makeCtx(tmpDir), "alux", { enabled: true });
    const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body.files["MEMORY.md"]).toBe("# Memory content");
    expect(body.files["SOUL.md"]).toBe("# Soul content");
  });

  it("skips unreadable files gracefully", async () => {
    const evt = makeEvt({
      systemPromptReport: {
        systemPrompt: { chars: 0, projectContextChars: 0, nonProjectContextChars: 0 },
        injectedWorkspaceFiles: [{ name: "MISSING.md", injectedChars: 0, truncated: false }],
        skills: { promptChars: 0, entries: [] },
        tools: { listChars: 0, schemaChars: 0 },
      },
    });
    await sendContextSnapshot(evt, makeCtx(tmpDir), "alux", { enabled: true });
    const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body.files).toEqual({});
  });

  it("truncates files exceeding maxFileSizeBytes", async () => {
    fs.writeFileSync(path.join(tmpDir, "big.md"), "A".repeat(1000));
    const evt = makeEvt({
      systemPromptReport: {
        systemPrompt: { chars: 0, projectContextChars: 0, nonProjectContextChars: 0 },
        injectedWorkspaceFiles: [{ name: "big.md", injectedChars: 1000, truncated: false }],
        skills: { promptChars: 0, entries: [] },
        tools: { listChars: 0, schemaChars: 0 },
      },
    });
    await sendContextSnapshot(evt, makeCtx(tmpDir), "alux", {
      enabled: true,
      maxFileSizeBytes: 100,
    });
    const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body.files["big.md"]).toContain("[truncated:");
    expect(body.files["big.md"].length).toBeLessThan(200);
  });

  it("is non-fatal on fetch errors", async () => {
    fetchMock.mockRejectedValue(new Error("connection refused"));
    // Should not throw
    await expect(
      sendContextSnapshot(makeEvt(), makeCtx(), "alux", { enabled: true }),
    ).resolves.toBeUndefined();
  });

  it("logs warning on non-2xx response", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503, statusText: "Service Unavailable" });
    const ctx = makeCtx();
    await sendContextSnapshot(makeEvt(), ctx, "alux", { enabled: true });
    expect(ctx.logger.warn).toHaveBeenCalledWith(expect.stringContaining("503"));
  });
});
