import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { PlatformCaps } from "../platform/caps";
import type { BridgeSectionDeps } from "./BridgeSettingsSection";
import type { PluginsSectionDeps } from "./PluginsSettingsSection";
import { BridgeSettingsSection } from "./BridgeSettingsSection";
import { PluginsSettingsSection } from "./PluginsSettingsSection";
import type { AppConfig, ConfigManager } from "../platform/store";
import type { SettingsDomRefs } from "./SettingsDom";

export type SettingsEmitPayload = AppConfig | boolean | unknown;

export interface SettingsPanelOptions {
  container: HTMLElement;
  configManager?: ConfigManager;
  onEmit?: (
    event: string,
    payload: SettingsEmitPayload
  ) => Promise<void> | void;
  pickFile?: () => Promise<string | null>;
  getCaps?: () => Promise<PlatformCaps>;
  bridgeDeps?: BridgeSectionDeps;
  pluginsDeps?: PluginsSectionDeps;
}

export const FALLBACK_SETTINGS_CAPS: PlatformCaps = {
  os: "linux",
  displayServer: "x11",
  globalCursor: false,
  inputRegion: false,
  alwaysOnTop: false,
  setPosition: false,
  localBridge: false,
  plugins: false
};

export interface MountSubsectionsParams {
  refs: SettingsDomRefs;
  caps: PlatformCaps;
  getConfig: () => AppConfig;
  updateConfig: (patch: Partial<AppConfig>) => Promise<void>;
  showToast: (msg: string) => void;
  autoRefresh: boolean;
  bridgeDeps?: BridgeSectionDeps;
  pluginsDeps?: PluginsSectionDeps;
}

export function mountSettingsSubsections(params: MountSubsectionsParams): {
  bridgeSection: BridgeSettingsSection | null;
  pluginsSection: PluginsSettingsSection | null;
} {
  let bridgeSection: BridgeSettingsSection | null = null;
  let pluginsSection: PluginsSettingsSection | null = null;

  if (params.refs.bridgeSectionEl) {
    bridgeSection = new BridgeSettingsSection({
      container: params.refs.bridgeSectionEl,
      caps: params.caps,
      getConfig: params.getConfig,
      updateConfig: params.updateConfig,
      showToast: params.showToast,
      deps: params.bridgeDeps
    });
    if (params.autoRefresh) void bridgeSection.mount();
    else bridgeSection.render();
  }

  if (params.refs.pluginsSectionEl) {
    pluginsSection = new PluginsSettingsSection({
      container: params.refs.pluginsSectionEl,
      caps: params.caps,
      getConfig: params.getConfig,
      updateConfig: params.updateConfig,
      showToast: params.showToast,
      deps: params.pluginsDeps
    });
    if (params.autoRefresh) void pluginsSection.mount();
    else pluginsSection.render();
  }

  return { bridgeSection, pluginsSection };
}

export async function closeSettingsWindow(
  onEmit: (event: string, payload: unknown) => Promise<void> | void
): Promise<void> {
  if (!isTauri()) return;
  try {
    await onEmit("settings-window-visibility", false);
    await getCurrentWindow().close();
  } catch (err) {
    console.warn("[deskumi-settings] Failed to close window:", err);
  }
}

export class ToastController {
  private timer: ReturnType<typeof setTimeout> | null = null;

  public show(toastEl: HTMLElement | null | undefined, msg: string): void {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      toastEl.classList.remove("show");
    }, 2000);
  }

  public dispose(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}

export class DebouncedPersister {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  public schedule(
    id: string,
    configManager: ConfigManager,
    write: (cm: ConfigManager) => Promise<void>
  ): void {
    const prev = this.timers.get(id);
    if (prev !== undefined) clearTimeout(prev);
    const next = setTimeout(() => {
      this.timers.delete(id);
      void write(configManager);
    }, 200);
    this.timers.set(id, next);
  }

  public dispose(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }
}
