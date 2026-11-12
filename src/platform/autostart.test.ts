import { describe, it, expect, vi, beforeEach } from "vitest";
import * as core from "@tauri-apps/api/core";
import * as autostartPlugin from "@tauri-apps/plugin-autostart";
import {
  isAutostartEnabled,
  setAutostartEnabled,
  toggleAutostart,
  syncAutostartWithConfig
} from "./autostart";
import { ConfigManager } from "./store";

vi.mock("@tauri-apps/api/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tauri-apps/api/core")>();
  return {
    ...actual,
    isTauri: vi.fn(() => false)
  };
});

vi.mock("@tauri-apps/plugin-autostart", () => ({
  isEnabled: vi.fn(),
  enable: vi.fn(),
  disable: vi.fn()
}));

vi.mock("@tauri-apps/plugin-store", () => ({
  LazyStore: class {
    get = vi.fn().mockResolvedValue(null);
    set = vi.fn().mockResolvedValue(undefined);
    save = vi.fn().mockResolvedValue(undefined);
    delete = vi.fn().mockResolvedValue(undefined);
  }
}));

describe("autostart platform module", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(core.isTauri).mockReturnValue(false);
  });

  it("gracefully no-ops when !isTauri()", async () => {
    const configManager = new ConfigManager();

    expect(await isAutostartEnabled()).toBe(false);
    expect(await setAutostartEnabled(true, configManager)).toBe(false);
    expect(configManager.get().autostart).toBe(true);
    expect(await toggleAutostart(configManager)).toBe(false);
    await expect(
      syncAutostartWithConfig(configManager)
    ).resolves.toBeUndefined();

    expect(autostartPlugin.isEnabled).not.toHaveBeenCalled();
    expect(autostartPlugin.enable).not.toHaveBeenCalled();
    expect(autostartPlugin.disable).not.toHaveBeenCalled();
  });

  it("queries and updates autostart when running in Tauri", async () => {
    vi.mocked(core.isTauri).mockReturnValue(true);
    const configManager = new ConfigManager();

    let pluginEnabledState = false;
    vi.mocked(autostartPlugin.isEnabled).mockImplementation(
      async () => pluginEnabledState
    );
    vi.mocked(autostartPlugin.enable).mockImplementation(async () => {
      pluginEnabledState = true;
    });
    vi.mocked(autostartPlugin.disable).mockImplementation(async () => {
      pluginEnabledState = false;
    });

    expect(await isAutostartEnabled()).toBe(false);

    const enabledResult = await setAutostartEnabled(true, configManager);
    expect(enabledResult).toBe(true);
    expect(autostartPlugin.enable).toHaveBeenCalledTimes(1);
    expect(configManager.get().autostart).toBe(true);

    const toggledResult = await toggleAutostart(configManager);
    expect(toggledResult).toBe(false);
    expect(autostartPlugin.disable).toHaveBeenCalledTimes(1);
    expect(configManager.get().autostart).toBe(false);
  });

  it("synchronizes OS autostart state with saved config when out of sync", async () => {
    const configManager = new ConfigManager();
    await configManager.set("autostart", true);

    vi.mocked(core.isTauri).mockReturnValue(true);
    let pluginEnabledState = false;
    vi.mocked(autostartPlugin.isEnabled).mockImplementation(
      async () => pluginEnabledState
    );
    vi.mocked(autostartPlugin.enable).mockImplementation(async () => {
      pluginEnabledState = true;
    });

    await syncAutostartWithConfig(configManager);

    expect(autostartPlugin.enable).toHaveBeenCalledTimes(1);
    expect(configManager.get().autostart).toBe(true);
  });
});
