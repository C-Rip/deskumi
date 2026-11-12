import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow, LogicalPosition } from "@tauri-apps/api/window";
import { LazyStore } from "@tauri-apps/plugin-store";

/**
 * Persisted application configuration schema.
 */
export interface AppConfig {
  /** Window X coordinate on desktop */
  windowX: number | null;
  /** Window Y coordinate on desktop */
  windowY: number | null;
  /** Target framerate limit */
  fpsCap: number;
  /** Active VRM avatar identifier or path */
  avatarPath: string | null;
  /** Active VRMA animation file path */
  vrmaPath: string | null;
  /** Launch application automatically on system startup */
  autostart: boolean;
}

/**
 * Default fallback configuration.
 */
export const DEFAULT_CONFIG: AppConfig = {
  windowX: null,
  windowY: null,
  fpsCap: 30,
  avatarPath: null,
  avatarPath: null,
  vrmaPath: null,
  autostart: false
};

export const SETTINGS_FILE = "settings.json";

/**
 * Typed wrapper around Tauri Store plugin.
 */
export class ConfigManager {
  private store: LazyStore | null = null;
  private memoryConfig: AppConfig = { ...DEFAULT_CONFIG };

  constructor(private readonly storeFile = SETTINGS_FILE) {
    if (isTauri()) {
      this.store = new LazyStore(this.storeFile);
    }
  }

  /**
   * Loads config from persistent store, merging with defaults.
   */
  async load(): Promise<AppConfig> {
    if (!this.store) {
      return { ...this.memoryConfig };
    }

    try {
      const keys = Object.keys(DEFAULT_CONFIG) as Array<keyof AppConfig>;
      const loaded: Partial<AppConfig> = {};

      for (const key of keys) {
        const val = await this.store.get<AppConfig[typeof key]>(key);
        if (val !== undefined && val !== null) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (loaded as any)[key] = val;
        }
      }

      this.memoryConfig = {
        ...DEFAULT_CONFIG,
        ...loaded
      };
    } catch (err: unknown) {
      console.warn(
        "[deskumi] Failed to load settings from store, using defaults:",
        err
      );
      this.memoryConfig = { ...DEFAULT_CONFIG };
    }

    return { ...this.memoryConfig };
  }

  /**
   * Sets and saves a single configuration key.
   */
  async set<K extends keyof AppConfig>(
    key: K,
    value: AppConfig[K]
  ): Promise<void> {
    this.memoryConfig[key] = value;
    if (!this.store) {
      return;
    }
    try {
      await this.store.set(key, value);
      await this.store.save();
    } catch (err: unknown) {
      console.warn(`[deskumi] Failed to persist setting ${String(key)}:`, err);
    }
  }

  /**
   * Deletes a configuration key from persistent store.
   */
  async delete<K extends keyof AppConfig>(key: K): Promise<void> {
    this.memoryConfig[key] = DEFAULT_CONFIG[key];
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
   * Returns current cached configuration.
   */
  get(): AppConfig {
    return { ...this.memoryConfig };
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
      // First try native GTK move (bypasses Mutter auto-centering/elevation)
      await invoke("set_window_desktop_position", {
        x: Math.round(config.windowX),
        y: Math.round(config.windowY)
      });
      console.log(
        `[deskumi] Restored window position via native GTK to (${config.windowX}, ${config.windowY})`
      );
    } catch {
      // Fallback to Tauri standard setPosition
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
    // Use innerPosition() to align with setPosition() coordinate space,
    // avoiding top frame extent offsets (like GNOME panel 37px offset).
    const pos = await win.innerPosition();
    await configManager.set("windowX", pos.x);
    await configManager.set("windowY", pos.y);
    console.log(`[deskumi] Saved window position: (${pos.x}, ${pos.y})`);
  } catch (err: unknown) {
    console.warn("[deskumi] Failed to query and save window position:", err);
  }
}
