import { emitTauriEvent } from "../platform/ipc";
import type { AppConfig } from "../platform/store";
import { FRAME_PRESETS } from "./SettingsTemplate";

export async function emitTauriSettingsEvent(
  event: string,
  payload?: unknown
): Promise<void> {
  try {
    await emitTauriEvent(event, payload);
  } catch (err) {
    console.warn(`[deskumi-settings] Failed to emit ${event} event:`, err);
  }
}

export type FeatureToggleKey = "debugOverlay" | "windowInteraction";

const FEATURE_TOGGLE_COPY: Record<
  FeatureToggleKey,
  { active: string; inactive: string; toastOn: string; toastOff: string }
> = {
  debugOverlay: {
    active: "✓ Overlay de depuración ACTIVO",
    inactive: "Activar Overlay en el Personaje",
    toastOn: "Debug Overlay activado en ventana",
    toastOff: "Debug Overlay desactivado"
  },
  windowInteraction: {
    active: "✓ Posarse sobre ventana ACTIVO",
    inactive: "Activar Posado en Ventanas",
    toastOn: "Interacción con ventanas activada",
    toastOff: "Interacción con ventanas desactivada"
  }
};

export interface SettingsDomRefs {
  avatarPathEl: HTMLElement | null;
  footerModelNameEl: HTMLElement | null;
  pickAvatarBtn: HTMLButtonElement | null;
  clearAvatarBtn: HTMLButtonElement | null;
  scaleSlider: HTMLInputElement | null;
  scaleValueEl: HTMLElement | null;
  frameWidthSlider: HTMLInputElement | null;
  frameHeightSlider: HTMLInputElement | null;
  frameWidthValEl: HTMLElement | null;
  frameHeightValEl: HTMLElement | null;
  presetButtons: HTMLButtonElement[];
  fpsButtons: HTMLButtonElement[];
  devOverlayBtn: HTMLButtonElement | null;
  windowInteractionBtn: HTMLButtonElement | null;
  resetDefaultsBtn: HTMLButtonElement | null;
  cancelBtn: HTMLButtonElement | null;
  saveCloseBtn: HTMLButtonElement | null;
  toastEl: HTMLElement | null;
  bridgeSectionEl: HTMLElement | null;
  pluginsSectionEl: HTMLElement | null;
}

export interface SettingsDomHandlers {
  onPickAvatar: () => void;
  onClearAvatar: () => void;
  onScaleChange: (scale: number) => void;
  onFrameWidthChange: (width: number) => void;
  onFrameHeightChange: (height: number) => void;
  onFramePreset: (width: number, height: number) => void;
  onFpsCapChange: (fps: number) => void;
  onToggleFeature: (key: FeatureToggleKey, btn: HTMLButtonElement) => void;
  onResetDefaults: () => void;
  onCancel: () => void;
  onSaveClose: () => void;
}

/**
 * Queries all control and status DOM elements rendered inside the settings container.
 */
export function querySettingsDomRefs(container: HTMLElement): SettingsDomRefs {
  const q = <T extends Element>(sel: string) => container.querySelector<T>(sel);
  const qa = <T extends Element>(sel: string) =>
    Array.from(container.querySelectorAll<T>(sel));
  return {
    avatarPathEl: q("#avatar-path-text"),
    footerModelNameEl: q("#footer-model-name"),
    pickAvatarBtn: q<HTMLButtonElement>("#btn-pick-avatar"),
    clearAvatarBtn: q<HTMLButtonElement>("#btn-clear-avatar"),
    scaleSlider: q<HTMLInputElement>("#slider-avatar-scale"),
    scaleValueEl: q("#avatar-scale-value"),
    frameWidthSlider: q<HTMLInputElement>("#slider-frame-width"),
    frameHeightSlider: q<HTMLInputElement>("#slider-frame-height"),
    frameWidthValEl: q("#frame-width-val"),
    frameHeightValEl: q("#frame-height-val"),
    presetButtons: qa<HTMLButtonElement>(".preset-btn"),
    fpsButtons: qa<HTMLButtonElement>(".fps-btn"),
    devOverlayBtn: q<HTMLButtonElement>("#btn-toggle-dev-overlay"),
    windowInteractionBtn: q<HTMLButtonElement>(
      "#btn-toggle-window-interaction"
    ),
    resetDefaultsBtn: q<HTMLButtonElement>("#btn-reset-defaults"),
    cancelBtn: q<HTMLButtonElement>("#btn-cancel"),
    saveCloseBtn: q<HTMLButtonElement>("#btn-save-close"),
    toastEl: q("#settings-status-toast"),
    bridgeSectionEl: q<HTMLElement>("#bridge-settings-section"),
    pluginsSectionEl: q<HTMLElement>("#plugins-settings-section")
  };
}

/**
 * Attaches DOM event listeners to queried settings control elements.
 */
export function bindSettingsDomEvents(
  refs: SettingsDomRefs,
  handlers: SettingsDomHandlers
): void {
  const onClick = (el: HTMLElement | null, fn: () => void) =>
    el?.addEventListener("click", fn);

  onClick(refs.pickAvatarBtn, handlers.onPickAvatar);
  onClick(refs.clearAvatarBtn, handlers.onClearAvatar);
  onClick(refs.resetDefaultsBtn, handlers.onResetDefaults);
  onClick(refs.cancelBtn, handlers.onCancel);
  onClick(refs.saveCloseBtn, handlers.onSaveClose);

  refs.scaleSlider?.addEventListener("input", (e) => {
    handlers.onScaleChange(parseFloat((e.target as HTMLInputElement).value));
  });
  refs.frameWidthSlider?.addEventListener("input", (e) => {
    handlers.onFrameWidthChange(
      parseInt((e.target as HTMLInputElement).value, 10)
    );
  });
  refs.frameHeightSlider?.addEventListener("input", (e) => {
    handlers.onFrameHeightChange(
      parseInt((e.target as HTMLInputElement).value, 10)
    );
  });

  refs.presetButtons.forEach((btn) => {
    onClick(btn, () => {
      const size = FRAME_PRESETS[btn.getAttribute("data-preset") ?? ""];
      if (size) handlers.onFramePreset(size[0], size[1]);
    });
  });

  refs.fpsButtons.forEach((btn) => {
    onClick(btn, () => {
      handlers.onFpsCapChange(
        parseInt(btn.getAttribute("data-fps") || "30", 10)
      );
    });
  });

  if (refs.devOverlayBtn) {
    const btn = refs.devOverlayBtn;
    onClick(btn, () => handlers.onToggleFeature("debugOverlay", btn));
  }
  if (refs.windowInteractionBtn) {
    const btn = refs.windowInteractionBtn;
    onClick(btn, () => handlers.onToggleFeature("windowInteraction", btn));
  }
}

export function applyFeatureToggleDom(
  btn: HTMLButtonElement,
  key: FeatureToggleKey,
  enabled: boolean
): string {
  const copy = FEATURE_TOGGLE_COPY[key];
  btn.textContent = enabled ? copy.active : copy.inactive;
  btn.style.color = enabled ? "#10b981" : "";
  btn.style.borderColor = enabled ? "#10b981" : "";
  return enabled ? copy.toastOn : copy.toastOff;
}

export function syncAvatarDom(refs: SettingsDomRefs, config: AppConfig): void {
  const filename = config.avatarPath
    ? config.avatarPath.split("/").pop() || "Avatar"
    : "Sample Robot (Twist)";
  if (refs.avatarPathEl) {
    refs.avatarPathEl.textContent =
      config.avatarPath || "Avatar de muestra por defecto";
    refs.avatarPathEl.title = config.avatarPath || "";
  }
  if (refs.footerModelNameEl) refs.footerModelNameEl.textContent = filename;
  if (refs.clearAvatarBtn) refs.clearAvatarBtn.disabled = !config.avatarPath;
}

export function syncScaleDom(refs: SettingsDomRefs, config: AppConfig): void {
  const scale = config.avatarScale ?? 1.0;
  if (refs.scaleSlider) refs.scaleSlider.value = scale.toFixed(2);
  if (refs.scaleValueEl) refs.scaleValueEl.textContent = `${scale.toFixed(2)}x`;
}

export function syncFrameDom(refs: SettingsDomRefs, config: AppConfig): void {
  const w = config.frameWidth ?? 400;
  const h = config.frameHeight ?? 600;
  if (refs.frameWidthSlider) refs.frameWidthSlider.value = String(w);
  if (refs.frameHeightSlider) refs.frameHeightSlider.value = String(h);
  if (refs.frameWidthValEl) refs.frameWidthValEl.textContent = `${w} px`;
  if (refs.frameHeightValEl) refs.frameHeightValEl.textContent = `${h} px`;

  refs.presetButtons.forEach((btn) => {
    const size = FRAME_PRESETS[btn.getAttribute("data-preset") ?? ""];
    btn.classList.toggle(
      "active",
      Boolean(size && size[0] === w && size[1] === h)
    );
  });
}

export function syncFpsDom(refs: SettingsDomRefs, config: AppConfig): void {
  refs.fpsButtons.forEach((btn) => {
    const fps = parseInt(btn.getAttribute("data-fps") || "30", 10);
    btn.classList.toggle("selected", fps === config.fpsCap);
  });
}

export function syncSettingsDom(
  refs: SettingsDomRefs,
  config: AppConfig
): void {
  syncAvatarDom(refs, config);
  syncScaleDom(refs, config);
  syncFpsDom(refs, config);
  syncFrameDom(refs, config);
}
