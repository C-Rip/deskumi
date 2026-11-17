import { pickVRMFile } from "../platform/avatar-picker";
import { getPlatformCaps, type PlatformCaps } from "../platform/caps";
import {
  cloneAppConfig,
  DEFAULT_CONFIG,
  defaultConfigManager,
  type AppConfig,
  type ConfigManager
} from "../platform/store";
import type { BridgeSettingsSection } from "./BridgeSettingsSection";
import type { PluginsSettingsSection } from "./PluginsSettingsSection";
import {
  applyFeatureToggleDom,
  bindSettingsDomEvents,
  emitTauriSettingsEvent,
  querySettingsDomRefs,
  syncAvatarDom,
  syncFpsDom,
  syncFrameDom,
  syncSettingsDom,
  type FeatureToggleKey,
  type SettingsDomRefs
} from "./SettingsDom";
import { SettingsPreviewController } from "./SettingsPreviewController";
import {
  closeSettingsWindow,
  DebouncedPersister,
  FALLBACK_SETTINGS_CAPS,
  mountSettingsSubsections,
  ToastController,
  type SettingsEmitPayload,
  type SettingsPanelOptions
} from "./SettingsSubsections";
import { buildSettingsHtml } from "./SettingsTemplate";

export type { SettingsEmitPayload, SettingsPanelOptions };

export class SettingsPanel {
  private readonly opts: SettingsPanelOptions;
  private readonly configManager: ConfigManager;
  private readonly onEmit: (
    event: string,
    payload: SettingsEmitPayload
  ) => Promise<void> | void;
  private config: AppConfig = cloneAppConfig(DEFAULT_CONFIG);
  private caps: PlatformCaps = { ...FALLBACK_SETTINGS_CAPS };
  private refs: SettingsDomRefs | null = null;
  private readonly toast = new ToastController();
  private readonly debouncer = new DebouncedPersister();
  private readonly previewController: SettingsPreviewController;
  private bridgeSection: BridgeSettingsSection | null = null;
  private pluginsSection: PluginsSettingsSection | null = null;

  constructor(options: SettingsPanelOptions) {
    this.opts = options;
    this.configManager = options.configManager ?? defaultConfigManager;
    this.onEmit = options.onEmit ?? emitTauriSettingsEvent;
    this.previewController = new SettingsPreviewController({
      onShowToast: (msg) => this.toast.show(this.refs?.toastEl, msg),
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
      console.warn("[deskumi-settings] Failed to load store:", err);
    }
    try {
      this.caps = await (this.opts.getCaps ?? getPlatformCaps)();
    } catch (err) {
      console.warn("[deskumi-settings] Failed to query platform caps:", err);
    }
    this.render(false);
    await Promise.all([
      this.caps.localBridge ? this.bridgeSection?.refreshStatus() : undefined,
      this.caps.plugins ? this.pluginsSection?.refresh() : undefined
    ]);
  }

  public getConfig(): AppConfig {
    return cloneAppConfig(this.config);
  }

  public getBridgeSection(): BridgeSettingsSection | null {
    return this.bridgeSection;
  }

  public getPluginsSection(): PluginsSettingsSection | null {
    return this.pluginsSection;
  }

  public render(autoRefreshSections = true): void {
    this.bridgeSection?.dispose();
    this.pluginsSection?.dispose();
    this.opts.container.innerHTML = buildSettingsHtml(this.config);
    this.refs = querySettingsDomRefs(this.opts.container);
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
      onCancel: () => void closeSettingsWindow(this.onEmit),
      onSaveClose: () => void this.handleSaveAndClose()
    });
    const mounted = mountSettingsSubsections({
      refs: this.refs,
      caps: this.caps,
      getConfig: () => this.config,
      updateConfig: (patch) => this.updateSectionConfig(patch),
      showToast: (msg) => this.toast.show(this.refs?.toastEl, msg),
      autoRefresh: autoRefreshSections,
      bridgeDeps: this.opts.bridgeDeps,
      pluginsDeps: this.opts.pluginsDeps
    });
    this.bridgeSection = mounted.bridgeSection;
    this.pluginsSection = mounted.pluginsSection;
    this.syncUI();
    this.previewController.mount(
      this.opts.container,
      this.config,
      () => this.config.avatarOffsetY ?? 0
    );
  }

  private async updateSectionConfig(patch: Partial<AppConfig>): Promise<void> {
    this.config = cloneAppConfig({ ...this.config, ...patch });
    for (const key of Object.keys(patch) as Array<keyof AppConfig>) {
      await this.configManager.set(key, this.config[key]);
    }
    await this.emitUpdate();
  }

  private async handleToggleFeature(
    key: FeatureToggleKey,
    btn: HTMLButtonElement
  ): Promise<void> {
    const nextState = !this.config[key];
    const msg = applyFeatureToggleDom(btn, key, nextState);
    await this.updateSectionConfig({ [key]: nextState });
    this.toast.show(this.refs?.toastEl, msg);
  }

  public async handlePickAvatar(): Promise<void> {
    try {
      const selected = await (this.opts.pickFile ?? pickVRMFile)();
      if (selected)
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
    this.toast.show(this.refs?.toastEl, toastMsg);
  }

  public async handleScaleChange(scale: number): Promise<void> {
    const clamped = Math.max(0.5, Math.min(2.0, scale));
    this.config.avatarScale = clamped;
    if (this.refs?.scaleValueEl) {
      this.refs.scaleValueEl.textContent = `${clamped.toFixed(2)}x`;
    }
    this.previewController.setScale(clamped);
    void this.emitUpdate();
    this.debouncer.schedule("scale", this.configManager, (cm) =>
      cm.set("avatarScale", clamped)
    );
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
    void this.emitUpdate();
    this.debouncer.schedule("frame", this.configManager, async (cm) => {
      await cm.set("frameWidth", this.config.frameWidth);
      await cm.set("frameHeight", this.config.frameHeight);
    });
  }

  public async applyFramePreset(w: number, h: number): Promise<void> {
    this.config.frameWidth = w;
    this.config.frameHeight = h;
    if (this.refs) syncFrameDom(this.refs, this.config);
    this.previewController.updateGuide(this.config);
    void this.emitUpdate();
    this.debouncer.schedule("frame", this.configManager, async (cm) => {
      await cm.set("frameWidth", w);
      await cm.set("frameHeight", h);
    });
  }

  public async handleFpsCapChange(fps: number): Promise<void> {
    await this.updateSectionConfig({ fpsCap: fps });
    if (this.refs) syncFpsDom(this.refs, this.config);
    this.toast.show(this.refs?.toastEl, `FPS limitado a ${fps}`);
  }

  public async handleResetPosition(): Promise<void> {
    await this.updateSectionConfig({ windowX: null, windowY: null });
    this.toast.show(this.refs?.toastEl, "Posición restablecida al centro");
  }

  public async handleResetDefaults(): Promise<void> {
    try {
      const prevAnimations = this.config.registeredAnimations;
      this.config = cloneAppConfig(DEFAULT_CONFIG);
      await this.configManager.saveConfig(this.config);
      this.syncUI();
      this.previewController.updateGuide(this.config);
      await this.bridgeSection?.resetToDefaults();
      await this.pluginsSection?.resetToDefaults(prevAnimations);
      await this.emitUpdate();
      this.toast.show(
        this.refs?.toastEl,
        "Valores predeterminados restaurados"
      );
    } catch (err) {
      console.error("[deskumi-settings] Failed to reset defaults:", err);
    }
  }

  public async handleSaveAndClose(): Promise<void> {
    try {
      await this.configManager.saveConfig(this.config);
      await this.emitUpdate();
      await closeSettingsWindow(this.onEmit);
    } catch (err) {
      console.error("[deskumi-settings] Failed to save:", err);
    }
  }

  public dispose(): void {
    this.previewController.dispose();
    this.bridgeSection?.dispose();
    this.pluginsSection?.dispose();
    this.toast.dispose();
    this.debouncer.dispose();
  }

  private syncUI(): void {
    if (this.refs) syncSettingsDom(this.refs, this.config);
    this.previewController.setScale(this.config.avatarScale ?? 1.0);
  }

  private async emitUpdate(): Promise<void> {
    await this.onEmit("settings-updated", cloneAppConfig(this.config));
  }
}
