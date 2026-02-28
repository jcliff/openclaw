import { readFileSync } from "node:fs";
import { join } from "node:path";
/**
 * Integration test: verify the diagnostics-otel extension loads correctly.
 * Catches manifest/import issues that broke extension loading after deploy.
 *
 * Refs: INF#65
 */
import { describe, expect, it } from "vitest";

describe("extension loading", () => {
  const EXT_DIR = join(__dirname, "..");

  it("manifest points to .ts entry (jiti requirement)", () => {
    const pkg = JSON.parse(readFileSync(join(EXT_DIR, "package.json"), "utf-8"));
    const entries: string[] = pkg?.openclaw?.extensions ?? [];

    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      expect(entry, `Extension entry must be .ts for jiti: ${entry}`).toMatch(/\.ts$/);
    }
  });

  it("entry file exists and exports a default plugin", async () => {
    const pkg = JSON.parse(readFileSync(join(EXT_DIR, "package.json"), "utf-8"));
    const entry = pkg.openclaw.extensions[0];
    const entryPath = join(EXT_DIR, entry);

    const mod = await import(entryPath);
    expect(mod.default).toBeDefined();
    expect(mod.default.id).toBe("diagnostics-otel");
    expect(typeof mod.default.register).toBe("function");
  });

  it("openclaw.plugin.json manifest matches package entry", () => {
    const pluginManifest = JSON.parse(readFileSync(join(EXT_DIR, "openclaw.plugin.json"), "utf-8"));
    expect(pluginManifest.id).toBe("diagnostics-otel");
    expect(pluginManifest.configSchema).toBeDefined();
  });

  it("service module imports resolve", async () => {
    // This catches missing @opentelemetry deps
    const service = await import(join(EXT_DIR, "src", "service.ts"));
    expect(typeof service.createDiagnosticsOtelService).toBe("function");
  });
});
