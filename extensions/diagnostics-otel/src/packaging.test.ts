import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

// This extension is shipped inside the main `openclaw` package.
// At runtime (production installs), extensions do NOT have their own `node_modules/`.
// Their dependencies must be resolvable from the parent `openclaw/node_modules/`.
//
// Regression: oc15-test builds shipped `extensions/diagnostics-otel` without any
// `@opentelemetry/*` packages installed, so the plugin failed to load.

describe("diagnostics-otel packaging", () => {
  test("openclaw package.json includes required @opentelemetry/* runtime deps", () => {
    // __dirname: <repo>/extensions/diagnostics-otel/src
    // repo root:  <repo>
    const repoRoot = path.resolve(__dirname, "..", "..", "..");
    const pkgPath = path.join(repoRoot, "package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as {
      dependencies?: Record<string, string>;
    };

    const deps = pkg.dependencies ?? {};

    const required = [
      "@opentelemetry/api",
      "@opentelemetry/api-logs",
      "@opentelemetry/exporter-logs-otlp-proto",
      "@opentelemetry/exporter-metrics-otlp-proto",
      "@opentelemetry/exporter-trace-otlp-proto",
      "@opentelemetry/resources",
      "@opentelemetry/sdk-logs",
      "@opentelemetry/sdk-metrics",
      "@opentelemetry/sdk-node",
      "@opentelemetry/sdk-trace-base",
      "@opentelemetry/semantic-conventions",
    ];

    const missing = required.filter((name) => !deps[name]);
    expect(missing, `Missing deps: ${missing.join(", ")}`).toEqual([]);
  });
});
