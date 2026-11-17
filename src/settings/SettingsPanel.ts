import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  type AppConfig,
  type ConfigManager,
  defaultConfigManager,
  DEFAULT_CONFIG
} from "../platform/store";
import { pickVRMFile } from "../platform/avatar-picker";
import { emitTauriEvent } from "../platform/ipc";
import {
  applyFeatureToggleDom,
  bindSettingsDomEvents,
  querySettingsDomRefs,
  syncAvatarDom,
  syncFpsDom,
  syncFrameDom,
  syncSettingsDom,
  type FeatureToggleKey,
  type SettingsDomRefs
} from "./SettingsDom";
import { SettingsPreviewController } from "./SettingsPreviewController";
import { buildSettingsHtml } from "./SettingsTemplate";

export type SettingsEmitPayload = AppConfig | boolean | unknown;

export interface SettingsPanelOptions {
  container: HTMLElement;
  configManager?: ConfigManager;
  onEmit?: (
    event: string,
    payload: SettingsEmitPayload
  ) => Promise<void> | void;
  pickFile?: () => Promise<string | null>;
}

async function emitTauriSettingsEvent(
  event: string,
  payload?: unknown
): Promise<void> {
  try {
    await emitTauriEvent(event, payload);
  } catch (err) {
    console.warn(`[deskumi-settings] Failed to emit ${event} event:`, err);
  }
}

export class SettingsPanel {
  private readonly container: HTMLElement;
  private readonly configManager: ConfigManager;
  private readonly onEmit: (
    event: string,
    payload: SettingsEmitPayload
  ) => Promise<void> | void;
  private readonly pickFile: () => Promise<string | null>;

  private config: AppConfig = { ...DEFAULT_CONFIG };
  private refs: SettingsDomRefs | null = null;
  private toastTimeout: ReturnType<typeof setTimeout> | null = null;
  private scaleDebounceTimeout: ReturnType<typeof setTimeout> | null = null;
  private frameDebounceTimeout: ReturnType<typeof setTimeout> | null = null;
  private readonly previewController: SettingsPreviewController;

  constructor(options: SettingsPanelOptions) {
    this.container = options.container;
    this.configManager = options.configManager ?? defaultConfigManager;
    this.onEmit = options.onEmit ?? emitTauriSettingsEvent;
    this.pickFile = options.pickFile ?? pickVRMFile;
    this.previewController = new SettingsPreviewController({
      onShowToast: (msg) => this.showToast(msg),
      onOffsetYChange: (offsetY) => {
        this.config.avatarOffsetX = 0;
        this.config.avatarOffsetY = offsetY;
        void this.emitUpdate();
      },
      onOffsetYCommit: (offsetY) => {
        void this.configManager.set("avatarOffsetX", 0);
        void this.configManager.set("avatarOffsetY", offsetY);
      }
    });
  }

  public async init(): Promise<void> {
    try {
      this.config = await this.configManager.load();
    } catch (err) {
      console.warn(
        "[deskumi-settings] Failed to load store, using defaults:",
        err
      );
    }
    this.render();
  }

  public getConfig(): AppConfig {
    return { ...this.config };
  }

  public render(): void {
    this.container.innerHTML = buildSettingsHtml(this.config);
    this.refs = querySettingsDomRefs(this.container);
    bindSettingsDomEvents(this.refs, {
      onPickAvatar: () => void this.handlePickAvatar(),
      onClearAvatar: () => void this.handleClearAvatar(),
      onScaleChange: (scale) => void this.handleScaleChange(scale),
      onFrameWidthChange: (w) => void this.handleFrameWidthChange(w),
      onFrameHeightChange: (h) => void this.handleFrameHeightChange(h),
      onFramePreset: (w, h) => void this.applyFramePreset(w, h),
      onFpsCapChange: (fps) => void this.handleFpsCapChange(fps),
      onToggleFeature: (key, btn) => void this.handleToggleFeature(key, btn),
      onResetDefaults: () => void this.handleResetDefaults(),
      onCancel: () => void this.closeWindow(),
      onSaveClose: () => void this.handleSaveAndClose()
    });
    this.syncUI();
    this.previewController.mount(
      this.container,
      this.config,
      () => this.config.avatarOffsetY ?? 0
    );
  }

  private async handleToggleFeature(
    key: FeatureToggleKey,
    btn: HTMLButtonElement
  ): Promise<void> {
    const nextState = !this.config[key];
    this.config[key] = nextState;
    const toastMsg = applyFeatureToggleDom(btn, key, nextState);
    await this.configManager.set(key, nextState);
    await this.emitUpdate();
    this.showToast(toastMsg);
  }

  public async handlePickAvatar(): Promise<void> {
    try {
      const selected = await this.pickFile();
      if (!selected) return;
      await this.applyAvatarPathChange(selected, "Avatar actualizado");
    } catch (err) {
      console.error("[deskumi-settings] Failed to pick avatar:", err);
    }
  }

  public async handleClearAvatar(): Promise<void> {
    try {
      await this.applyAvatarPathChange(null, "Avatar quitado (usando muestra)");
    } catch (err) {
      console.error("[deskumi-settings] Failed to clear avatar:", err);
    }
  }

  private async applyAvatarPathChange(
    avatarPath: string | null,
    toastMsg: string
  ): Promise<void> {
    this.config.avatarPath = avatarPath;
    await this.configManager.set("avatarPath", avatarPath);
    if (this.refs) syncAvatarDom(this.refs, this.config);
    await this.previewController.loadModel(this.config);
    await this.emitUpdate();
    this.showToast(toastMsg);
  }

  public async handleScaleChange(scale: number): Promise<void> {
    const clamped = Math.max(0.5, Math.min(2.0, scale));
    this.config.avatarScale = clamped;
    if (this.refs?.scaleValueEl) {
      this.refs.scaleValueEl.textContent = `${clamped.toFixed(2)}x`;
    }
    this.previewController.setScale(clamped);
    void this.emitUpdate();

    if (this.scaleDebounceTimeout !== null) {
      clearTimeout(this.scaleDebounceTimeout);
    }
    this.scaleDebounceTimeout = setTimeout(() => {
      void this.configManager.set("avatarScale", clamped);
    }, 200);
  }

  public async handleFrameWidthChange(w: number): Promise<void> {
    this.updateFrameAxis("frameWidth", this.refs?.frameWidthValEl, w);
  }

  public async handleFrameHeightChange(h: number): Promise<void> {
    this.updateFrameAxis("frameHeight", this.refs?.frameHeightValEl, h);
  }

  private updateFrameAxis(
    axis: "frameWidth" | "frameHeight",
    el: HTMLElement | null | undefined,
    value: number
  ): void {
    this.config[axis] = value;
    if (el) el.textContent = `${value} px`;
    this.previewController.updateGuide(this.config);
    this.debounceFrameSave();
  }

  public async applyFramePreset(w: number, h: number): Promise<void> {
    this.config.frameWidth = w;
    this.config.frameHeight = h;
    if (this.refs) syncFrameDom(this.refs, this.config);
    this.previewController.updateGuide(this.config);
    this.debounceFrameSave();
  }

  private debounceFrameSave(): void {
    void this.emitUpdate();
    if (this.frameDebounceTimeout !== null) {
      clearTimeout(this.frameDebounceTimeout);
    }
    this.frameDebounceTimeout = setTimeout(async () => {
      await this.configManager.set("frameWidth", this.config.frameWidth);
      await this.configManager.set("frameHeight", this.config.frameHeight);
    }, 200);
  }

  public async handleFpsCapChange(fps: number): Promise<void> {
    this.config.fpsCap = fps;
    if (this.refs) syncFpsDom(this.refs, this.config);
    await this.configManager.set("fpsCap", fps);
    await this.emitUpdate();
    this.showToast(`FPS limitado a ${fps}`);
  }

  public async handleResetPosition(): Promise<void> {
    try {
      this.config.windowX = null;
      this.config.windowY = null;
      await this.configManager.set("windowX", null);
      await this.configManager.set("windowY", null);
      await this.emitUpdate();
      this.showToast("Posición restablecida al centro");
    } catch (err) {
      console.error("[deskumi-settings] Failed to reset position:", err);
    }
  }

  public async handleResetDefaults(): Promise<void> {
    try {
      this.config = { ...DEFAULT_CONFIG };
      await this.configManager.saveConfig(this.config);
      this.syncUI();
      this.previewController.updateGuide(this.config);
      await this.emitUpdate();
      this.showToast("Valores predeterminados restaurados");
    } catch (err) {
      console.error("[deskumi-settings] Failed to reset defaults:", err);
    }
  }

  public async handleSaveAndClose(): Promise<void> {
    try {
      await this.configManager.saveConfig(this.config);
      await this.emitUpdate();
      await this.closeWindow();
    } catch (err) {
      console.error("[deskumi-settings] Failed to save:", err);
    }
  }

  public dispose(): void {
    this.previewController.dispose();
  }

  private async closeWindow(): Promise<void> {
    if (!isTauri()) return;
    try {
      await this.onEmit("settings-window-visibility", false);
      const win = getCurrentWindow();
      await win.close();
    } catch (err) {
      console.warn("[deskumi-settings] Failed to close window:", err);
    }
  }

  private syncUI(): void {
    if (this.refs) syncSettingsDom(this.refs, this.config);
    this.previewController.setScale(this.config.avatarScale ?? 1.0);
  }

  private async emitUpdate(): Promise<void> {
    await this.onEmit("settings-updated", { ...this.config });
  }

  private showToast(msg: string): void {
    const toast = this.refs?.toastEl;
    if (!toast) return;
    toast.textContent = msg;
    toast.classList.add("show");
    if (this.toastTimeout !== null) clearTimeout(this.toastTimeout);
    this.toastTimeout = setTimeout(() => {
      this.refs?.toastEl?.classList.remove("show");
    }, 2000);
  }
}
