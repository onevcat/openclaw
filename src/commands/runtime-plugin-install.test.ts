import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  enablePluginInConfig: vi.fn(),
  loadInstalledPluginIndexInstallRecords: vi.fn(),
  resolveBundledPluginSources: vi.fn(),
}));

vi.mock("../plugins/enable.js", () => ({
  enablePluginInConfig: mocks.enablePluginInConfig,
}));

vi.mock("../plugins/bundled-sources.js", () => ({
  resolveBundledPluginSources: mocks.resolveBundledPluginSources,
}));

vi.mock("../plugins/installed-plugin-index-records.js", () => ({
  loadInstalledPluginIndexInstallRecords: mocks.loadInstalledPluginIndexInstallRecords,
}));

describe("runtime plugin installation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveBundledPluginSources.mockReturnValue(new Map());
    mocks.enablePluginInConfig.mockImplementation((cfg: unknown) => ({
      enabled: true,
      config: cfg,
    }));
  });

  it("uses a preferred bundled runtime before consulting managed npm installs", async () => {
    mocks.resolveBundledPluginSources.mockReturnValue(
      new Map([["codex", { pluginId: "codex", localPath: "/host/extensions/codex" }]]),
    );

    const { createRuntimePluginModelSelectionHelpers } =
      await import("./runtime-plugin-install.js");
    const helpers = createRuntimePluginModelSelectionHelpers({
      descriptor: {
        pluginId: "codex",
        label: "Codex",
        npmSpec: "@openclaw/codex",
        warningLabel: "Codex",
        preferBundled: true,
      },
      shouldEnsure: () => true,
    });

    const cfg = {};
    const result = await helpers.ensure({
      cfg,
      model: "openai/gpt-5.6",
      prompter: {} as never,
      runtime: {} as never,
      workspaceDir: "/workspace",
    });

    expect(result).toEqual({
      cfg,
      required: true,
      installed: true,
      status: "installed",
    });
    expect(mocks.resolveBundledPluginSources).toHaveBeenCalledWith({ workspaceDir: "/workspace" });
    expect(mocks.enablePluginInConfig).toHaveBeenCalledWith(cfg, "codex");
    expect(mocks.loadInstalledPluginIndexInstallRecords).not.toHaveBeenCalled();
  });

  it("does not claim a bundled runtime is installed when policy blocks enablement", async () => {
    mocks.resolveBundledPluginSources.mockReturnValue(
      new Map([["codex", { pluginId: "codex", localPath: "/host/extensions/codex" }]]),
    );
    mocks.enablePluginInConfig.mockImplementation((cfg: unknown) => ({
      enabled: false,
      config: cfg,
      reason: "blocked by allowlist",
    }));

    const { createRuntimePluginModelSelectionHelpers } =
      await import("./runtime-plugin-install.js");
    const helpers = createRuntimePluginModelSelectionHelpers({
      descriptor: {
        pluginId: "codex",
        label: "Codex",
        npmSpec: "@openclaw/codex",
        warningLabel: "Codex",
        preferBundled: true,
      },
      shouldEnsure: () => true,
    });

    const cfg = {};
    const log = vi.fn();
    const result = await helpers.ensure({
      cfg,
      model: "openai/gpt-5.6",
      prompter: {} as never,
      runtime: { log } as never,
      workspaceDir: "/workspace",
    });

    expect(result).toEqual({
      cfg,
      required: true,
      installed: false,
      status: "failed",
    });
    expect(log).toHaveBeenCalledWith(
      "Codex bundled runtime is available but could not be enabled: blocked by allowlist.",
    );
    expect(mocks.loadInstalledPluginIndexInstallRecords).not.toHaveBeenCalled();
  });

  it("does not let a repair recreate an npm runtime when a preferred bundled one exists", async () => {
    mocks.resolveBundledPluginSources.mockReturnValue(
      new Map([["codex", { pluginId: "codex", localPath: "/host/extensions/codex" }]]),
    );

    const { createRuntimePluginModelSelectionHelpers } =
      await import("./runtime-plugin-install.js");
    const helpers = createRuntimePluginModelSelectionHelpers({
      descriptor: {
        pluginId: "codex",
        label: "Codex",
        npmSpec: "@openclaw/codex",
        warningLabel: "Codex",
        preferBundled: true,
      },
      shouldEnsure: () => true,
    });

    const result = await helpers.repair({
      cfg: {},
      model: "openai/gpt-5.6",
      env: {},
    });

    expect(result).toEqual({ required: true, changes: [], warnings: [] });
    expect(mocks.resolveBundledPluginSources).toHaveBeenCalledWith({ env: {} });
  });
});
