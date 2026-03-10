import { beforeEach, describe, expect, it, vi } from "vitest";
import { findBundledPluginByNpmSpec, resolveBundledPluginSources } from "./bundled-sources.js";

const discoverOpenClawPluginsMock = vi.fn();
const loadPluginManifestMock = vi.fn();

vi.mock("./discovery.js", () => ({
  discoverOpenClawPlugins: (...args: unknown[]) => discoverOpenClawPluginsMock(...args),
}));

vi.mock("./manifest.js", () => ({
  loadPluginManifest: (...args: unknown[]) => loadPluginManifestMock(...args),
}));

describe("bundled plugin sources", () => {
  beforeEach(() => {
    discoverOpenClawPluginsMock.mockReset();
    loadPluginManifestMock.mockReset();
  });

  it("resolves bundled sources keyed by plugin id", () => {
    discoverOpenClawPluginsMock.mockReturnValue({
      candidates: [
        {
          origin: "global",
          rootDir: "/global/discord",
          packageName: "@openclaw/discord",
          packageManifest: { install: { npmSpec: "@openclaw/discord" } },
        },
        {
          origin: "bundled",
          rootDir: "/app/extensions/discord",
          packageName: "@openclaw/discord",
          packageManifest: { install: { npmSpec: "@openclaw/discord" } },
        },
        {
          origin: "bundled",
          rootDir: "/app/extensions/discord-dup",
          packageName: "@openclaw/discord",
          packageManifest: { install: { npmSpec: "@openclaw/discord" } },
        },
        {
          origin: "bundled",
          rootDir: "/app/extensions/msteams",
          packageName: "@openclaw/msteams",
          packageManifest: { install: { npmSpec: "@openclaw/msteams" } },
        },
      ],
      diagnostics: [],
    });

    loadPluginManifestMock.mockImplementation((rootDir: string) => {
      if (rootDir === "/app/extensions/discord") {
        return { ok: true, manifest: { id: "discord" } };
      }
      if (rootDir === "/app/extensions/msteams") {
        return { ok: true, manifest: { id: "msteams" } };
      }
      return {
        ok: false,
        error: "invalid manifest",
        manifestPath: `${rootDir}/openclaw.plugin.json`,
      };
    });

    const map = resolveBundledPluginSources({});

    expect(Array.from(map.keys())).toEqual(["discord", "msteams"]);
    expect(map.get("discord")).toEqual({
      pluginId: "discord",
      localPath: "/app/extensions/discord",
      npmSpec: "@openclaw/discord",
    });
  });

  it("finds bundled source by npm spec", () => {
    discoverOpenClawPluginsMock.mockReturnValue({
      candidates: [
        {
          origin: "bundled",
          rootDir: "/app/extensions/discord",
          packageName: "@openclaw/discord",
          packageManifest: { install: { npmSpec: "@openclaw/discord" } },
        },
      ],
      diagnostics: [],
    });
    loadPluginManifestMock.mockReturnValue({ ok: true, manifest: { id: "discord" } });

    const resolved = findBundledPluginByNpmSpec({ spec: "@openclaw/discord" });
    const missing = findBundledPluginByNpmSpec({ spec: "@openclaw/not-found" });

    expect(resolved?.pluginId).toBe("discord");
    expect(resolved?.localPath).toBe("/app/extensions/discord");
    expect(missing).toBeUndefined();
  });
});
