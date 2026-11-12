import { emit } from "@tauri-apps/api/event";
import { isTauri } from "@tauri-apps/api/core";
import {
  type AppConfig,
  type ConfigManager,
  defaultConfigManager,
  DEFAULT_CONFIG
} from "../platform/store";
import { pickVRMFile } from "../platform/avatar-picker";

export interface SettingsPanelOptions {
  container: HTMLElement;
  configManager?: ConfigManager;
  onEmit?: (event: string, payload: AppConfig) => Promise<void> | void;
  pickFile?: () => Promise<string | null>;
}

export class SettingsPanel {
  private container: HTMLElement;
  private configManager: ConfigManager;
  private onEmit: (event: string, payload: AppConfig) => Promise<void> | void;
  private pickFile: () => Promise<string | null>;

  private config: AppConfig = { ...DEFAULT_CONFIG };

  // DOM element references
  private avatarPathEl: HTMLElement | null = null;
  private clearAvatarBtn: HTMLButtonElement | null = null;
  private scaleSlider: HTMLInputElement | null = null;
  private scaleValueEl: HTMLElement | null = null;
  private fpsButtons: HTMLButtonElement[] = [];
  private toastEl: HTMLElement | null = null;
  private toastTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(options: SettingsPanelOptions) {
    this.container = options.container;
    this.configManager = options.configManager ?? defaultConfigManager;
    this.onEmit =
      options.onEmit ??
      (async (event: string, payload: AppConfig) => {
        if (isTauri()) {
          try {
            await emit(event, payload);
          } catch (err) {
            console.warn(
              `[deskumi-settings] Failed to emit ${event} event:`,
              err
            );
          }
        }
      });
    this.pickFile = options.pickFile ?? pickVRMFile;
  }

  public async init(): Promise<void> {
    this.config = await this.configManager.load();
    this.render();
  }

  public getConfig(): AppConfig {
    return { ...this.config };
  }

  public render(): void {
    this.container.innerHTML = `
      <header class="settings-header">
        <h1>Ajustes de Deskumi</h1>
        <span class="badge">v0.1</span>
      </header>

      <!-- Avatar Section -->
      <section class="settings-card" data-section="avatar">
        <h2 class="settings-card-title">Avatar (.vrm)</h2>
        <p class="settings-card-description">Selecciona el modelo 3D VRM que aparecerá en tu escritorio.</p>
        <div class="avatar-info-row">
          <div class="avatar-path-display" id="avatar-path-text"></div>
          <div class="button-group">
            <button type="button" class="btn-primary" id="btn-pick-avatar">
              Cambiar avatar (.vrm)...
            </button>
            <button type="button" class="btn-secondary btn-danger" id="btn-clear-avatar">
              Quitar avatar
            </button>
          </div>
        </div>
      </section>

      <!-- Avatar Scale Section -->
      <section class="settings-card" data-section="scale">
        <h2 class="settings-card-title">Escala del avatar</h2>
        <p class="settings-card-description">Ajusta el tamaño visual del avatar en pantalla (0.5x a 2.0x).</p>
        <div class="slider-container">
          <input
            type="range"
            id="slider-avatar-scale"
            min="0.5"
            max="2.0"
            step="0.05"
            value="${(this.config.avatarScale ?? 1.0).toFixed(2)}"
          />
          <span class="slider-value" id="avatar-scale-value">${(this.config.avatarScale ?? 1.0).toFixed(2)}x</span>
        </div>
      </section>

      <!-- FPS Cap Section -->
      <section class="settings-card" data-section="fps">
        <h2 class="settings-card-title">Límite de FPS</h2>
        <p class="settings-card-description">Controla la tasa de refresco para balancear fluidez y consumo de GPU/batería.</p>
        <div class="fps-options">
          <button type="button" class="fps-btn" data-fps="15">15 FPS</button>
          <button type="button" class="fps-btn" data-fps="30">30 FPS</button>
          <button type="button" class="fps-btn" data-fps="60">60 FPS</button>
        </div>
      </section>

      <!-- Window Position Section -->
      <section class="settings-card" data-section="position">
        <h2 class="settings-card-title">Posición de ventana</h2>
        <p class="settings-card-description">Restaura la mascota al centro de tu pantalla si quedó fuera del área visible.</p>
        <div>
          <button type="button" class="btn-secondary" id="btn-reset-position">
            Restablecer posición en pantalla
          </button>
        </div>
      </section>

      <div class="status-toast" id="settings-status-toast"></div>
    `;

    this.bindElements();
    this.updateAvatarUI();
    this.updateScaleUI();
    this.updateFpsUI();
  }

  private bindElements(): void {
    this.avatarPathEl = this.container.querySelector("#avatar-path-text");
    this.clearAvatarBtn = this.container.querySelector("#btn-clear-avatar");
    this.scaleSlider = this.container.querySelector("#slider-avatar-scale");
    this.scaleValueEl = this.container.querySelector("#avatar-scale-value");
    this.toastEl = this.container.querySelector("#settings-status-toast");

    const pickBtn =
      this.container.querySelector<HTMLButtonElement>("#btn-pick-avatar");
    if (pickBtn) {
      pickBtn.addEventListener("click", () => {
        void this.handlePickAvatar();
      });
    }

    if (this.clearAvatarBtn) {
      this.clearAvatarBtn.addEventListener("click", () => {
        void this.handleClearAvatar();
      });
    }

    if (this.scaleSlider) {
      this.scaleSlider.addEventListener("input", (event) => {
        const val = parseFloat((event.target as HTMLInputElement).value);
        void this.handleScaleChange(val);
      });
    }

    const fpsBtns =
      this.container.querySelectorAll<HTMLButtonElement>(".fps-btn");
    this.fpsButtons = Array.from(fpsBtns);
    this.fpsButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        const fps = parseInt(btn.getAttribute("data-fps") || "30", 10);
        void this.handleFpsCapChange(fps);
      });
    });

    const resetPosBtn = this.container.querySelector<HTMLButtonElement>(
      "#btn-reset-position"
    );
    if (resetPosBtn) {
      resetPosBtn.addEventListener("click", () => {
        void this.handleResetPosition();
      });
    }
  }

  public async handlePickAvatar(): Promise<void> {
    try {
      const selected = await this.pickFile();
      if (!selected) {
        return;
      }
      this.config.avatarPath = selected;
      await this.configManager.set("avatarPath", selected);
      this.updateAvatarUI();
      await this.emitUpdate();
      this.showToast("Avatar actualizado");
    } catch (err) {
      console.error("[deskumi-settings] Failed to pick avatar:", err);
    }
  }

  public async handleClearAvatar(): Promise<void> {
    try {
      this.config.avatarPath = null;
      await this.configManager.set("avatarPath", null);
      this.updateAvatarUI();
      await this.emitUpdate();
      this.showToast("Avatar quitado (usando muestra)");
    } catch (err) {
      console.error("[deskumi-settings] Failed to clear avatar:", err);
    }
  }

  public async handleScaleChange(scale: number): Promise<void> {
    const clamped = Math.max(0.5, Math.min(2.0, scale));
    this.config.avatarScale = clamped;
    if (this.scaleValueEl) {
      this.scaleValueEl.textContent = `${clamped.toFixed(2)}x`;
    }
    await this.configManager.set("avatarScale", clamped);
    await this.emitUpdate();
  }

  public async handleFpsCapChange(fps: number): Promise<void> {
    this.config.fpsCap = fps;
    this.updateFpsUI();
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

  private updateAvatarUI(): void {
    if (this.avatarPathEl) {
      if (this.config.avatarPath) {
        this.avatarPathEl.textContent = this.config.avatarPath;
        this.avatarPathEl.title = this.config.avatarPath;
      } else {
        this.avatarPathEl.textContent = "Avatar de muestra por defecto";
        this.avatarPathEl.title = "";
      }
    }

    if (this.clearAvatarBtn) {
      this.clearAvatarBtn.disabled = !this.config.avatarPath;
    }
  }

  private updateScaleUI(): void {
    const scale = this.config.avatarScale ?? 1.0;
    if (this.scaleSlider) {
      this.scaleSlider.value = scale.toFixed(2);
    }
    if (this.scaleValueEl) {
      this.scaleValueEl.textContent = `${scale.toFixed(2)}x`;
    }
  }

  private updateFpsUI(): void {
    const current = this.config.fpsCap;
    this.fpsButtons.forEach((btn) => {
      const fps = parseInt(btn.getAttribute("data-fps") || "30", 10);
      if (fps === current) {
        btn.classList.add("selected");
      } else {
        btn.classList.remove("selected");
      }
    });
  }

  private async emitUpdate(): Promise<void> {
    await this.onEmit("settings-updated", { ...this.config });
  }

  private showToast(msg: string): void {
    if (!this.toastEl) return;
    this.toastEl.textContent = msg;
    this.toastEl.classList.add("show");
    if (this.toastTimeout !== null) {
      clearTimeout(this.toastTimeout);
    }
    this.toastTimeout = setTimeout(() => {
      if (this.toastEl) {
        this.toastEl.classList.remove("show");
      }
    }, 2000);
  }
}
