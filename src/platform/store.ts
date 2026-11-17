import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow, LogicalPosition } from "@tauri-apps/api/window";
import { LazyStore } from "@tauri-apps/plugin-store";
import { setWindowDesktopPosition } from "./ipc";
import {
  cloneAppConfig,
  DEFAULT_BRIDGE_SCOPES,
  DEFAULT_CONFIG,
  migrateAppConfig,
  type AppConfig,
  type RegisteredAnimationConfig
} from "./store-schema";

export {
  cloneAppConfig,
  DEFAULT_BRIDGE_SCOPES,
  DEFAULT_CONFIG,
  migrateAppConfig,
  type AppConfig,
  type RegisteredAnimationConfig
};

export interface StoreBackend {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<boolean>;
  save(): Promise<void>;
}

export const SETTINGS_FILE = "settings.json";

/**
 * Typed wrapper around Tauri Store plugin.
 */
export class ConfigManager {
  private store: StoreBackend | null = null;
  private memoryConfig: AppConfig = cloneAppConfig(DEFAULT_CONFIG);

  constructor(
    private readonly storeFile = SETTINGS_FILE,
    storeBackend?: StoreBackend
  ) {
    if (storeBackend) {
      this.store = storeBackend;
    } else if (isTauri()) {
      this.store = new LazyStore(this.storeFile);
    }
  }

  /**
   * Loads config from persistent store, migrating legacy settings onto defaults.
   */
  async load(): Promise<AppConfig> {
    if (!this.store) {
      return cloneAppConfig(this.memoryConfig);
    }

    try {
      const keys = Object.keys(DEFAULT_CONFIG) as Array<keyof AppConfig>;
      const loaded: Record<string, unknown> = {};

      for (const key of keys) {
        const val = await this.store.get<unknown>(key);
        if (val !== undefined && val !== null) {
          loaded[key] = val;
        }
      }

      this.memoryConfig = migrateAppConfig(loaded);
    } catch (err: unknown) {
      console.warn(
        "[deskumi] Failed to load settings from store, using defaults:",
        err
      );
      this.memoryConfig = cloneAppConfig(DEFAULT_CONFIG);
    }

    return cloneAppConfig(this.memoryConfig);
  }

  /**
   * Sets and saves a single configuration key.
   */
  async set<K extends keyof AppConfig>(
    key: K,
    value: AppConfig[K]
  ): Promise<void> {
    this.memoryConfig = cloneAppConfig({
      ...this.memoryConfig,
      [key]: value
    });
    if (!this.store) {
      return;
    }
    try {
      await this.store.set(key, this.memoryConfig[key]);
      await this.store.save();
    } catch (err: unknown) {
      console.warn(`[deskumi] Failed to persist setting ${String(key)}:`, err);
    }
  }

  /**
   * Deletes a configuration key from persistent store.
   */
  async delete<K extends keyof AppConfig>(key: K): Promise<void> {
    const fallback = cloneAppConfig(DEFAULT_CONFIG)[key];
    this.memoryConfig = cloneAppConfig({
      ...this.memoryConfig,
      [key]: fallback
    });
    if (!this.store) {
      return;
    }
    try {
      await this.store.delete(key);
      await this.store.save();
    } catch (err: unknown) {
      console.warn(`[deskumi] Failed to delete setting ${String(key)}:`, err);
    }
  }

  /**
   * Saves an entire AppConfig object to store.
   */
  async saveConfig(config: AppConfig): Promise<void> {
    this.memoryConfig = cloneAppConfig(config);
    if (!this.store) return;
    try {
      const keys = Object.keys(this.memoryConfig) as Array<keyof AppConfig>;
      for (const key of keys) {
        await this.store.set(key, this.memoryConfig[key]);
      }
      await this.store.save();
    } catch (err: unknown) {
      console.warn("[deskumi] Failed to save full config to store:", err);
    }
  }

  /**
   * Returns current cached configuration.
   */
  get(): AppConfig {
    return cloneAppConfig(this.memoryConfig);
  }
}

export const defaultConfigManager = new ConfigManager();

/**
 * Restores the window position from the saved configuration if available.
 */
export async function restoreWindowPosition(
  configManager = defaultConfigManager
): Promise<void> {
  if (!isTauri()) {
    return;
  }

  const config = await configManager.load();
  if (config.windowX !== null && config.windowY !== null) {
    try {
      await setWindowDesktopPosition(
        Math.round(config.windowX),
        Math.round(config.windowY)
      );
      console.log(
        `[deskumi] Restored window position via native GTK to (${config.windowX}, ${config.windowY})`
      );
    } catch {
      try {
        const win = getCurrentWindow();
        await win.setPosition(
          new LogicalPosition(config.windowX, config.windowY)
        );
        console.log(
          `[deskumi] Restored window position to (${config.windowX}, ${config.windowY})`
        );
      } catch (err: unknown) {
        console.warn("[deskumi] Failed to restore window position:", err);
      }
    }
  }
}

/**
 * Saves the current window position to persistent store.
 */
export async function saveWindowPosition(
  configManager = defaultConfigManager
): Promise<void> {
  if (!isTauri()) {
    return;
  }

  try {
    const win = getCurrentWindow();
    const pos = await win.innerPosition();
    await configManager.set("windowX", pos.x);
    await configManager.set("windowY", pos.y);
    console.log(`[deskumi] Saved window position: (${pos.x}, ${pos.y})`);
  } catch (err: unknown) {
    console.warn("[deskumi] Failed to query and save window position:", err);
  }
}
