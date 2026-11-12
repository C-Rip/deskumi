import { describe, it, expect } from "vitest";
import {
  ConfigManager,
  DEFAULT_CONFIG,
  restoreWindowPosition,
  saveWindowPosition
} from "./store";

describe("ConfigManager", () => {
  it("initializes with defaults in non-Tauri / test environment", async () => {
    const configManager = new ConfigManager();
    const config = await configManager.load();

    expect(config).toEqual(DEFAULT_CONFIG);
    expect(configManager.get()).toEqual(DEFAULT_CONFIG);
  });

  it("updates and retrieves configuration keys in memory", async () => {
    const configManager = new ConfigManager();

    await configManager.set("fpsCap", 60);
    await configManager.set("windowX", 250);
    await configManager.set("windowY", 400);
    await configManager.set("avatarScale", 1.5);

    const config = configManager.get();
    expect(config.fpsCap).toBe(60);
    expect(config.windowX).toBe(250);
    expect(config.windowY).toBe(400);
    expect(config.avatarScale).toBe(1.5);
  });

  it("safely handles restoreWindowPosition in test/web environment without errors", async () => {
    const configManager = new ConfigManager();
    await configManager.set("windowX", 100);
    await configManager.set("windowY", 200);

    await expect(restoreWindowPosition(configManager)).resolves.not.toThrow();
  });

  it("safely handles saveWindowPosition in test/web environment without errors", async () => {
    const configManager = new ConfigManager();
    await expect(saveWindowPosition(configManager)).resolves.not.toThrow();
  });
});
