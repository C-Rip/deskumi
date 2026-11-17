import { describe, it, expect } from "vitest";
import {
  ConfigManager,
  DEFAULT_BRIDGE_SCOPES,
  DEFAULT_CONFIG,
  migrateAppConfig,
  restoreWindowPosition,
  saveWindowPosition,
  type StoreBackend
} from "./store";

function createMemoryBackend(
  initial: Record<string, unknown> = {}
): StoreBackend {
  const data = new Map<string, unknown>(Object.entries(initial));
  return {
    async get<T>(key: string): Promise<T | undefined> {
      return data.get(key) as T | undefined;
    },
    async set(key: string, value: unknown): Promise<void> {
      data.set(key, value);
    },
    async delete(key: string): Promise<boolean> {
      return data.delete(key);
    },
    async save(): Promise<void> {}
  };
}

describe("ConfigManager", () => {
  it("initializes with defaults in non-Tauri / test environment", async () => {
    const configManager = new ConfigManager();
    const config = await configManager.load();

    expect(config).toEqual(DEFAULT_CONFIG);
    expect(config.bridgeEnabled).toBe(false);
    expect(config.bridgeScopes).toEqual(DEFAULT_BRIDGE_SCOPES);
    expect(config.bridgeScopes).not.toContain("desktop:events");
    expect(config.bridgeScopes).not.toContain("desktop:windowTitle");
    expect(config.enabledPlugins).toEqual([]);
    expect(config.pluginPermissions).toEqual({});
    expect(config.registeredAnimations).toEqual([]);
    expect(configManager.get()).toEqual(DEFAULT_CONFIG);
  });

  it("updates and retrieves configuration keys in memory", async () => {
    const configManager = new ConfigManager();

    await configManager.set("fpsCap", 60);
    await configManager.set("windowX", 250);
    await configManager.set("windowY", 400);
    await configManager.set("vrmaPath", "/path/to/animation.vrma");
    await configManager.set("avatarScale", 1.5);
    await configManager.set("bridgeEnabled", true);
    await configManager.set("enabledPlugins", ["hello-companion"]);
    await configManager.set("pluginPermissions", {
      "hello-companion": ["avatar:expression"]
    });
    await configManager.set("registeredAnimations", [
      { id: "wave", path: "/tmp/wave.vrma", label: "Saludo" }
    ]);

    const config = configManager.get();
    expect(config.fpsCap).toBe(60);
    expect(config.windowX).toBe(250);
    expect(config.windowY).toBe(400);
    expect(config.vrmaPath).toBe("/path/to/animation.vrma");
    expect(config.avatarScale).toBe(1.5);
    expect(config.bridgeEnabled).toBe(true);
    expect(config.enabledPlugins).toEqual(["hello-companion"]);
    expect(config.pluginPermissions).toEqual({
      "hello-companion": ["avatar:expression"]
    });
    expect(config.registeredAnimations).toEqual([
      { id: "wave", path: "/tmp/wave.vrma", label: "Saludo" }
    ]);
  });

  it("migrates legacy settings.json cleanly when Phase 6 keys are absent", async () => {
    const backend = createMemoryBackend({
      fpsCap: 60,
      avatarPath: "/home/user/model.vrm",
      avatarScale: 1.25,
      frameWidth: 500,
      frameHeight: 700,
      autostart: true
    });
    const configManager = new ConfigManager("settings.json", backend);
    const loaded = await configManager.load();

    expect(loaded.fpsCap).toBe(60);
    expect(loaded.avatarPath).toBe("/home/user/model.vrm");
    expect(loaded.avatarScale).toBe(1.25);
    expect(loaded.frameWidth).toBe(500);
    expect(loaded.frameHeight).toBe(700);
    expect(loaded.autostart).toBe(true);
    expect(loaded.bridgeEnabled).toBe(false);
    expect(loaded.bridgeScopes).toEqual(DEFAULT_BRIDGE_SCOPES);
    expect(loaded.enabledPlugins).toEqual([]);
    expect(loaded.pluginPermissions).toEqual({});
    expect(loaded.registeredAnimations).toEqual([]);
  });

  it("sanitizes malformed Phase 6 values and preserves explicit empty bridgeScopes", () => {
    const migrated = migrateAppConfig({
      bridgeEnabled: "invalid",
      bridgeScopes: [],
      enabledPlugins: ["p1", 42, "p1", ""],
      pluginPermissions: {
        p1: ["avatar:speak", 99, "avatar:speak"],
        bad: "not-an-array"
      },
      registeredAnimations: [
        { id: "wave", path: "/a/wave.vrma", label: "Wave" },
        { id: "", path: "/bad.vrma" },
        "corrupt"
      ]
    });

    expect(migrated.bridgeEnabled).toBe(false);
    expect(migrated.bridgeScopes).toEqual([]);
    expect(migrated.enabledPlugins).toEqual(["p1"]);
    expect(migrated.pluginPermissions).toEqual({ p1: ["avatar:speak"] });
    expect(migrated.registeredAnimations).toEqual([
      { id: "wave", path: "/a/wave.vrma", label: "Wave" }
    ]);
  });

  it("returns deep-cloned configs so caller mutations do not mutate defaults", async () => {
    const configManager = new ConfigManager();
    const first = configManager.get();
    first.bridgeScopes.push("desktop:windowTitle");
    first.enabledPlugins.push("x");

    const second = configManager.get();
    expect(second.bridgeScopes).toEqual(DEFAULT_BRIDGE_SCOPES);
    expect(second.enabledPlugins).toEqual([]);
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
