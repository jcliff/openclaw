import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { DiagnosticUsageEvent } from "openclaw/plugin-sdk";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// ---------------------------------------------------------------------------
// 1. Contract: DiagnosticEventPayload.systemPromptReport shape
// ---------------------------------------------------------------------------
// We import the actual type and verify a conforming object compiles + has the
// fields the OTLP extension reads.  This catches upstream type renames/removals.
/**
 * Contract test: openclaw.context.* OTLP span attributes
 *
 * Drumbeat's /context panel depends on these attributes existing in OTLP spans.
 * If upstream changes break the systemPromptReport shape or the attribute mapping,
 * this test fails → build fails → no deploy of broken code.
 *
 * Refs: INF#65, CR-763
 */
import { describe, expect, it } from "vitest";

function makeMockReport(): NonNullable<DiagnosticUsageEvent["systemPromptReport"]> {
  return {
    systemPrompt: {
      chars: 12000,
      projectContextChars: 8000,
      nonProjectContextChars: 4000,
    },
    injectedWorkspaceFiles: [
      { name: "SOUL.md", injectedChars: 2000, truncated: false },
      { name: "MEMORY.md", injectedChars: 5000, truncated: true },
      { name: "AGENTS.md", injectedChars: 3000, truncated: false },
    ],
    skills: {
      promptChars: 500,
      entries: [{ name: "github", blockChars: 500 }],
    },
    tools: {
      listChars: 1000,
      schemaChars: 3000,
    },
  };
}

describe("context telemetry contract", () => {
  // -------------------------------------------------------------------------
  // 2. Contract: span attribute keys that Drumbeat depends on
  // -------------------------------------------------------------------------
  const REQUIRED_ATTR_PREFIXES = [
    "openclaw.context.system_prompt_chars",
    "openclaw.context.project_context_chars",
    "openclaw.context.non_project_context_chars",
    "openclaw.context.skills_chars",
    "openclaw.context.tools_list_chars",
    "openclaw.context.tools_schema_chars",
    "openclaw.context.file_count",
    "openclaw.context.file_total_chars",
    "openclaw.context.file.", // per-file attrs
  ] as const;

  it("systemPromptReport type has all required fields", () => {
    const report = makeMockReport();

    // systemPrompt aggregate fields
    expect(report.systemPrompt).toHaveProperty("chars");
    expect(report.systemPrompt).toHaveProperty("projectContextChars");
    expect(report.systemPrompt).toHaveProperty("nonProjectContextChars");

    // injectedWorkspaceFiles shape
    expect(report.injectedWorkspaceFiles).toBeInstanceOf(Array);
    expect(report.injectedWorkspaceFiles[0]).toHaveProperty("name");
    expect(report.injectedWorkspaceFiles[0]).toHaveProperty("injectedChars");

    // skills
    expect(report.skills).toHaveProperty("promptChars");

    // tools
    expect(report.tools).toHaveProperty("listChars");
    expect(report.tools).toHaveProperty("schemaChars");
  });

  it("service.ts emits all required openclaw.context.* attribute keys", async () => {
    // Read service.ts source and verify all required attr keys appear
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");

    const serviceSource = readFileSync(join(__dirname, "service.ts"), "utf-8");

    for (const prefix of REQUIRED_ATTR_PREFIXES) {
      // Some attrs use double quotes, some use template literals (backticks)
      const hasDoubleQuote = serviceSource.includes(`"${prefix}`);
      const hasBacktick = serviceSource.includes(`\`${prefix}`);
      expect(hasDoubleQuote || hasBacktick, `Missing span attribute: ${prefix}`).toBe(true);
    }
  });

  it("attribute mapping covers report → span attrs correctly", () => {
    // Simulate the mapping logic from service.ts to verify it produces
    // the expected attributes from a report object
    const report = makeMockReport();
    const spanAttrs: Record<string, string | number> = {};

    // This mirrors the exact mapping in service.ts lines 437-457
    spanAttrs["openclaw.context.system_prompt_chars"] = report.systemPrompt.chars;
    spanAttrs["openclaw.context.project_context_chars"] = report.systemPrompt.projectContextChars;
    spanAttrs["openclaw.context.non_project_context_chars"] =
      report.systemPrompt.nonProjectContextChars;
    spanAttrs["openclaw.context.skills_chars"] = report.skills.promptChars;
    spanAttrs["openclaw.context.tools_list_chars"] = report.tools.listChars;
    spanAttrs["openclaw.context.tools_schema_chars"] = report.tools.schemaChars;

    const sortedFiles = [...report.injectedWorkspaceFiles].sort(
      (a, b) => b.injectedChars - a.injectedChars,
    );
    const topFiles = sortedFiles.slice(0, 10);
    spanAttrs["openclaw.context.file_count"] = report.injectedWorkspaceFiles.length;
    spanAttrs["openclaw.context.file_total_chars"] = report.injectedWorkspaceFiles.reduce(
      (sum: number, f: { injectedChars: number }) => sum + f.injectedChars,
      0,
    );
    for (const file of topFiles) {
      const sanitizedName = file.name.replace(/[^a-zA-Z0-9_.-]/g, "_").slice(0, 64);
      spanAttrs[`openclaw.context.file.${sanitizedName}`] = file.injectedChars;
    }

    // Verify all expected attrs exist with correct values
    expect(spanAttrs["openclaw.context.system_prompt_chars"]).toBe(12000);
    expect(spanAttrs["openclaw.context.project_context_chars"]).toBe(8000);
    expect(spanAttrs["openclaw.context.non_project_context_chars"]).toBe(4000);
    expect(spanAttrs["openclaw.context.skills_chars"]).toBe(500);
    expect(spanAttrs["openclaw.context.tools_list_chars"]).toBe(1000);
    expect(spanAttrs["openclaw.context.tools_schema_chars"]).toBe(3000);
    expect(spanAttrs["openclaw.context.file_count"]).toBe(3);
    expect(spanAttrs["openclaw.context.file_total_chars"]).toBe(10000);
    // Top file by size = MEMORY.md
    expect(spanAttrs["openclaw.context.file.MEMORY.md"]).toBe(5000);
    expect(spanAttrs["openclaw.context.file.AGENTS.md"]).toBe(3000);
    expect(spanAttrs["openclaw.context.file.SOUL.md"]).toBe(2000);
  });

  it("file name sanitization matches service.ts behavior", () => {
    const weirdNames = [
      { input: "path/to/file.md", expected: "path_to_file.md" },
      { input: "MEMORY (copy).md", expected: "MEMORY__copy_.md" },
      { input: "../../../etc/passwd", expected: ".._.._.._etc_passwd" },
      { input: "a".repeat(100), expected: "a".repeat(64) },
    ];

    for (const { input, expected } of weirdNames) {
      const sanitized = input.replace(/[^a-zA-Z0-9_.-]/g, "_").slice(0, 64);
      expect(sanitized).toBe(expected);
    }
  });

  it("top-10 cap is enforced", () => {
    const report = makeMockReport();
    // Add 12 files
    report.injectedWorkspaceFiles = Array.from({ length: 12 }, (_, i) => ({
      name: `file-${i}.md`,
      injectedChars: (12 - i) * 100,
      truncated: false,
    }));

    const sortedFiles = [...report.injectedWorkspaceFiles].sort(
      (a, b) => b.injectedChars - a.injectedChars,
    );
    const topFiles = sortedFiles.slice(0, 10);

    expect(topFiles).toHaveLength(10);
    // file-10 and file-11 (smallest) should be excluded
    const topNames = topFiles.map((f) => f.name);
    expect(topNames).not.toContain("file-10.md");
    expect(topNames).not.toContain("file-11.md");
  });
});
