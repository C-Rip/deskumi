import { isTauri } from "@tauri-apps/api/core";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { defaultConfigManager, type ConfigManager } from "./store";

/**
 * Checks whether application autostart on login is currently enabled in the OS.
 * Gracefully returns `false` when running outside Tauri.
 */
export async function isAutostartEnabled(): Promise<boolean> {
  if (!isTauri()) {
    return false;
  }

  try {
    return await isEnabled();
  } catch (err: unknown) {
    console.warn("[deskumi] Failed to query autostart status:", err);
    return false;
  }
}

/**
 * Enables or disables OS autostart and persists the final state in `ConfigManager`.
 * Gracefully no-ops and returns `false` when running outside Tauri.
 */
export async function setAutostartEnabled(
  enabled: boolean,
  configManager: ConfigManager = defaultConfigManager
): Promise<boolean> {
  if (!isTauri()) {
    await configManager.set("autostart", enabled);
    return false;
  }

  try {
    if (enabled) {
      await enable();
    } else {
      await disable();
    }
    const actualState = await isEnabled();
    await configManager.set("autostart", actualState);
    return actualState;
  } catch (err: unknown) {
    console.warn(
      `[deskumi] Failed to set autostart to ${String(enabled)}:`,
      err
    );
    const fallbackState = await isAutostartEnabled();
    await configManager.set("autostart", fallbackState);
    return fallbackState;
  }
}

/**
 * Toggles current OS autostart state and persists the result in `ConfigManager`.
 * Gracefully no-ops and returns `false` when running outside Tauri.
 */
export async function toggleAutostart(
  configManager: ConfigManager = defaultConfigManager
): Promise<boolean> {
  if (!isTauri()) {
    return false;
  }

  const current = await isAutostartEnabled();
  return setAutostartEnabled(!current, configManager);
}

/**
 * Synchronizes OS autostart status with the persisted configuration on startup.
 * Gracefully no-ops when running outside Tauri.
 */
export async function syncAutostartWithConfig(
  configManager: ConfigManager = defaultConfigManager
): Promise<void> {
  if (!isTauri()) {
    return;
  }

  try {
    const config = await configManager.load();
    const osEnabled = await isAutostartEnabled();

    if (config.autostart !== osEnabled) {
      await setAutostartEnabled(config.autostart, configManager);
    }
  } catch (err: unknown) {
    console.warn("[deskumi] Failed to synchronize autostart with config:", err);
  }
}
