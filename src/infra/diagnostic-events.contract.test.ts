import { describe, expect, expectTypeOf, it } from "vitest";
import type { DiagnosticSystemPromptReport, DiagnosticUsageEvent } from "./diagnostic-events.js";

describe("DiagnosticUsageEvent systemPromptReport contract", () => {
  it("matches the stable Drumbeat summary shape", () => {
    const report: DiagnosticSystemPromptReport = {
      systemPrompt: {
        chars: 12_000,
        projectContextChars: 8_000,
        nonProjectContextChars: 4_000,
      },
      injectedWorkspaceFiles: [{ name: "MEMORY.md", injectedChars: 5_000, truncated: true }],
      skills: {
        promptChars: 500,
      },
      tools: {
        listChars: 1_000,
        schemaChars: 3_000,
      },
    };

    expect(report.systemPrompt.chars).toBe(12_000);
    expect(report.injectedWorkspaceFiles[0]?.name).toBe("MEMORY.md");
    expect(report.skills.promptChars).toBe(500);
    expect(report.tools.schemaChars).toBe(3_000);
  });

  it("keeps fields used by diagnostics-otel snapshot sender", () => {
    const usageEvent: DiagnosticUsageEvent = {
      type: "model.usage",
      ts: Date.now(),
      seq: 1,
      sessionKey: "discord:channel:123",
      usage: {},
      systemPromptText: "full prompt",
      systemPromptBaseText: "base prompt",
      systemPromptReport: {
        systemPrompt: {
          chars: 100,
          projectContextChars: 60,
          nonProjectContextChars: 40,
        },
        injectedWorkspaceFiles: [{ name: "SOUL.md", injectedChars: 40, truncated: false }],
        skills: { promptChars: 10 },
        tools: { listChars: 10, schemaChars: 20 },
      },
    };

    expect(usageEvent.systemPromptText).toBe("full prompt");
    expect(usageEvent.systemPromptBaseText).toBe("base prompt");
    expect(usageEvent.systemPromptReport?.injectedWorkspaceFiles[0]?.name).toBe("SOUL.md");

    expectTypeOf(usageEvent.systemPromptReport?.injectedWorkspaceFiles).toEqualTypeOf<
      Array<{ name: string; injectedChars: number; truncated: boolean }> | undefined
    >();
  });
});
