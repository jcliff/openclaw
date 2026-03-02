import { describe, expect, it } from "vitest";
import { parseContextSnapshotBoolean, resolveSnapshotBaseUrl } from "./context-snapshot-client.js";

describe("context snapshot env parsing", () => {
  it("enables only strict true values", () => {
    expect(parseContextSnapshotBoolean("1")).toBe(true);
    expect(parseContextSnapshotBoolean("true")).toBe(true);
    expect(parseContextSnapshotBoolean("TRUE")).toBe(true);
    expect(parseContextSnapshotBoolean(" true ")).toBe(true);

    expect(parseContextSnapshotBoolean("0")).toBe(false);
    expect(parseContextSnapshotBoolean("false")).toBe(false);
    expect(parseContextSnapshotBoolean("yes")).toBe(false);
    expect(parseContextSnapshotBoolean("")).toBe(false);
    expect(parseContextSnapshotBoolean(undefined)).toBe(false);
  });
});

describe("context snapshot url resolution", () => {
  it("defaults to loopback endpoint", () => {
    expect(resolveSnapshotBaseUrl({})).toBe("http://127.0.0.1:18800");
  });

  it("accepts loopback http url", () => {
    expect(
      resolveSnapshotBaseUrl({
        OPENCLAW_CONTEXT_SNAPSHOT_URL: "http://localhost:18800/",
      }),
    ).toBe("http://localhost:18800");
  });

  it("rejects invalid or unsupported urls", () => {
    expect(resolveSnapshotBaseUrl({ OPENCLAW_CONTEXT_SNAPSHOT_URL: "notaurl" })).toBeNull();
    expect(
      resolveSnapshotBaseUrl({ OPENCLAW_CONTEXT_SNAPSHOT_URL: "file:///tmp/snapshot" }),
    ).toBeNull();
  });

  it("rejects remote urls unless explicitly allowed", () => {
    expect(
      resolveSnapshotBaseUrl({
        OPENCLAW_CONTEXT_SNAPSHOT_URL: "https://example.com/snapshots",
      }),
    ).toBeNull();
  });

  it("requires https when remote urls are allowed", () => {
    expect(
      resolveSnapshotBaseUrl({
        OPENCLAW_CONTEXT_SNAPSHOT_URL: "http://example.com/snapshots",
        OPENCLAW_CONTEXT_SNAPSHOT_ALLOW_REMOTE: "true",
      }),
    ).toBeNull();
    expect(
      resolveSnapshotBaseUrl({
        OPENCLAW_CONTEXT_SNAPSHOT_URL: "https://example.com/snapshots",
        OPENCLAW_CONTEXT_SNAPSHOT_ALLOW_REMOTE: "true",
      }),
    ).toBe("https://example.com/snapshots");
  });
});
