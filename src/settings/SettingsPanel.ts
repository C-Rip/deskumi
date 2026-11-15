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
import { PreviewStage } from "./PreviewStage";

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

export class SettingsPanel {
  private container: HTMLElement;
  private configManager: ConfigManager;
  private onEmit: (
    event: string,
    payload: SettingsEmitPayload
  ) => Promise<void> | void;
  private pickFile: () => Promise<string | null>;

  private config: AppConfig = { ...DEFAULT_CONFIG };

  // DOM element references
  private avatarPathEl: HTMLElement | null = null;
  private clearAvatarBtn: HTMLButtonElement | null = null;
  private scaleSlider: HTMLInputElement | null = null;
  private scaleValueEl: HTMLElement | null = null;
  private frameWidthSlider: HTMLInputElement | null = null;
  private frameHeightSlider: HTMLInputElement | null = null;
  private frameWidthValEl: HTMLElement | null = null;
  private frameHeightValEl: HTMLElement | null = null;
  private presetButtons: HTMLButtonElement[] = [];
  private fpsButtons: HTMLButtonElement[] = [];
  private toastEl: HTMLElement | null = null;
  private toastTimeout: ReturnType<typeof setTimeout> | null = null;
  private scaleDebounceTimeout: ReturnType<typeof setTimeout> | null = null;
  private frameDebounceTimeout: ReturnType<typeof setTimeout> | null = null;

  // Preview elements
  private previewGuide: HTMLElement | null = null;
  private previewGuideDimText: HTMLElement | null = null;
  private previewCanvas: HTMLCanvasElement | null = null;
  private guidesToggleBtn: HTMLButtonElement | null = null;
  private sightSvgEl: SVGSVGElement | null = null;
  private sightLineEl: SVGLineElement | null = null;
  private sightReticleCircleEl: SVGCircleElement | null = null;
  private sightReticleRingEl: SVGCircleElement | null = null;
  private guideLineVEl: HTMLElement | null = null;
  private guideLineHEl: HTMLElement | null = null;
  private showGuides = true;

  // Real 3D Preview Engine
  private readonly previewStage = new PreviewStage();
  private isPoseTesting = false;

  // Preview Pan / Drag state (locked vertically)
  private isPreviewDragging = false;
  private previewDragStartY = 0;
  private initialOffsetY = 0;
  private offsetDebounceTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(options: SettingsPanelOptions) {
    this.container = options.container;
    this.configManager = options.configManager ?? defaultConfigManager;
    this.onEmit =
      options.onEmit ??
      (async (event: string, payload?: unknown) => {
        try {
          await emitTauriEvent(event, payload);
        } catch (err) {
          console.warn(
            `[deskumi-settings] Failed to emit ${event} event:`,
            err
          );
        }
      });
    this.pickFile = options.pickFile ?? pickVRMFile;
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
    const scale = this.config.avatarScale ?? 1.0;
    const fWidth = this.config.frameWidth ?? 400;
    const fHeight = this.config.frameHeight ?? 600;

    this.container.innerHTML = `
      <!-- Title bar -->
      <header class="settings-window-bar">
        <div class="window-title-group">
          <span class="window-icon">⚙</span>
          <span class="window-title">Ajustes de Deskumi</span>
          <span class="version-pill">v0.2</span>
        </div>
      </header>

      <!-- Two-column Body -->
      <main class="settings-main-layout">
        <!-- Left Column: Controls -->
        <div class="settings-left-col">
          <!-- 1. Avatar Section -->
          <section class="settings-card" data-section="avatar">
            <div class="card-header-row">
              <div class="card-title-group">
                <span class="card-title-icon">👤</span>
                <h2 class="settings-card-title">Avatar (.vrm)</h2>
              </div>
              <span class="status-indicator-tag">Cargado OK</span>
            </div>
            <p class="settings-card-description">Selecciona el modelo 3D VRM que aparecerá flotando en tu escritorio.</p>
            <div class="avatar-path-box">
              <span class="avatar-path-text" id="avatar-path-text"></span>
              <span class="avatar-filesize">VRM</span>
            </div>
            <div class="button-group">
              <button type="button" class="btn-primary" id="btn-pick-avatar">
                📁 Cambiar avatar (.vrm)...
              </button>
              <button type="button" class="btn-secondary btn-danger" id="btn-clear-avatar">
                🗑 Quitar avatar
              </button>
            </div>
          </section>

          <!-- 2. Scale Section -->
          <section class="settings-card" data-section="scale">
            <div class="card-header-row">
              <div class="card-title-group">
                <span class="card-title-icon">⤢</span>
                <h2 class="settings-card-title">Escala del avatar</h2>
              </div>
              <span class="slider-value-pill" id="avatar-scale-value">${scale.toFixed(2)}x</span>
            </div>
            <p class="settings-card-description">Ajusta el tamaño visual del avatar en pantalla (0.50x a 2.00x).</p>
            <div class="slider-container">
              <input
                type="range"
                id="slider-avatar-scale"
                min="0.5"
                max="2.0"
                step="0.05"
                value="${scale.toFixed(2)}"
              />
            </div>
          </section>

          <!-- 3. Frame Dimensions Section -->
          <section class="settings-card" data-section="frame">
            <div class="card-header-row">
              <div class="card-title-group">
                <span class="card-title-icon">⬚</span>
                <h2 class="settings-card-title">Área visible / Marco del avatar</h2>
              </div>
              <span class="badge-tag">NUEVO</span>
            </div>
            <p class="settings-card-description">Expande el contenedor transparente para evitar que extremidades o cabello queden cortados al gesticular.</p>
            
            <div class="preset-section-label">Preajustes de marco</div>
            <div class="preset-buttons-row">
              <button type="button" class="preset-btn" data-preset="compact">Compacto</button>
              <button type="button" class="preset-btn" data-preset="standard">Estándar</button>
              <button type="button" class="preset-btn" data-preset="wide">Amplio (+Bailes)</button>
            </div>

            <div class="frame-sliders-grid">
              <div class="frame-slider-item">
                <div class="frame-slider-label-row">
                  <span>Ancho marco</span>
                  <span class="frame-slider-val" id="frame-width-val">${fWidth} px</span>
                </div>
                <input type="range" id="slider-frame-width" min="250" max="800" step="10" value="${fWidth}" />
              </div>

              <div class="frame-slider-item">
                <div class="frame-slider-label-row">
                  <span>Alto marco</span>
                  <span class="frame-slider-val" id="frame-height-val">${fHeight} px</span>
                </div>
                <input type="range" id="slider-frame-height" min="300" max="1000" step="10" value="${fHeight}" />
              </div>
            </div>
          </section>

          <!-- 4. FPS Cap Section -->
          <section class="settings-card" data-section="fps">
            <div class="card-header-row">
              <div class="card-title-group">
                <span class="card-title-icon">⚡</span>
                <h2 class="settings-card-title">Límite de FPS</h2>
              </div>
              <span class="status-indicator-tag" style="background: rgba(85,88,230,0.15); color: #818cf8;">Modo balanceado</span>
            </div>
            <p class="settings-card-description">Controla la tasa de refresco para balancear fluidez y consumo de GPU/batería.</p>
            <div class="fps-options">
              <button type="button" class="fps-btn" data-fps="15">15 FPS</button>
              <button type="button" class="fps-btn" data-fps="30">30 FPS</button>
              <button type="button" class="fps-btn" data-fps="60">60 FPS</button>
              <button type="button" class="fps-btn" data-fps="120">120 FPS</button>
            </div>
          </section>

          <!-- 5. Window Interaction / Posarse sobre ventanas -->
          <section class="settings-card" data-section="window-interaction">
            <div class="card-header-row">
              <div class="card-title-group">
                <span class="card-title-icon">🪟</span>
                <h2 class="settings-card-title">Interacción con Ventanas</h2>
              </div>
              <span class="badge-tag">Experimental</span>
            </div>
            <p class="settings-card-description">Posiciona automáticamente al avatar sobre la barra de título de la ventana activa (Wayland KWin / X11).</p>
            <div style="margin-top: 8px;">
              <button type="button" class="btn-secondary" id="btn-toggle-window-interaction" style="width: 100%; justify-content: center; font-size: 12px; padding: 8px; ${this.config.windowInteraction ? "color: #10b981; border-color: #10b981;" : ""}">
                ${this.config.windowInteraction ? "✓ Posarse sobre ventana ACTIVO" : "Activar Posado en Ventanas"}
              </button>
            </div>
          </section>

          <!-- 6. Developer Mode / Herramientas de Desarrollador -->
          <section class="settings-card" data-section="dev-tools">
            <div class="card-header-row">
              <div class="card-title-group">
                <span class="card-title-icon">🛠️</span>
                <h2 class="settings-card-title">Herramientas de Desarrollador</h2>
              </div>
              <span class="status-indicator-tag" style="background: rgba(244,63,94,0.15); color: #f43f5e;">Depuración</span>
            </div>
            <p class="settings-card-description">Muestra en la ventana del personaje: contorno del marco, ejes de 4 cuadrantes, láser/retícula de mirada y hitboxes en verde.</p>
            <div style="margin-top: 10px;">
              <button type="button" class="btn-secondary" id="btn-toggle-dev-overlay" style="width: 100%; justify-content: center; font-size: 12px; padding: 8px;">
                ${this.config.debugOverlay ? "✓ Overlay de depuración ACTIVO" : "Activar Overlay en el Personaje"}
              </button>
            </div>
          </section>
        </div>

        <!-- Right Column: Live Simulation Stage -->
        <div class="settings-right-col">
          <div class="preview-header">
            <div class="preview-title-group">
              <div class="preview-title-row">
                <span class="live-dot"></span>
                <span>Vista Previa en Vivo</span>
              </div>
              <span class="preview-subtitle">Simulación del contenedor flotante en pantalla</span>
            </div>
            <div class="preview-actions">
              <button type="button" class="preview-action-btn active" id="btn-toggle-guides">Guías ON</button>
              <button type="button" class="preview-action-btn" id="btn-pose-test">Pose Test</button>
            </div>
          </div>

          <div class="preview-status-strip">
            <span class="fps-counter-badge">FPS Render: ${(this.config.fpsCap ?? 30).toFixed(1)}</span>
            <span class="preview-dim-badge" id="preview-dim-text">${fWidth} × ${fHeight} px</span>
          </div>

          <div class="preview-stage-container" id="preview-stage">
            <div class="preview-overlay-guide" id="preview-guide">
              <canvas class="preview-stage-canvas" id="preview-canvas"></canvas>
              <div class="quadrant-line-v" id="guide-line-v"></div>
              <div class="quadrant-line-h" id="guide-line-h"></div>
              <svg class="lookat-sight-line" id="guide-sight-svg" style="display: none;">
                <!-- Sight laser line from character eyes to pointer -->
                <line id="sight-laser-line" x1="0" y1="0" x2="0" y2="0" stroke="#38bdf8" stroke-width="2" stroke-dasharray="4 3" opacity="0.85" />
                <!-- Center pointer / eye target reticle -->
                <circle id="sight-reticle-circle" cx="0" cy="0" r="5" fill="#38bdf8" opacity="0.9" />
                <circle id="sight-reticle-ring" cx="0" cy="0" r="9" fill="none" stroke="#38bdf8" stroke-width="1.5" opacity="0.6" />
              </svg>
            </div>
          </div>
        </div>
      </main>

      <!-- Footer / Status Bar -->
      <footer class="settings-footer">
        <div class="footer-model-info">
          <span class="model-name-text" id="footer-model-name">Avatar</span>
          <span class="model-meta-text">Rigged Humanoid • Shaders: MToon</span>
        </div>

        <div class="footer-actions">
          <button type="button" class="btn-secondary" id="btn-reset-defaults" style="font-size: 11px;">
            Restaurar valores predeterminados
          </button>
          <div class="status-toast" id="settings-status-toast"></div>
          <button type="button" class="btn-secondary" id="btn-cancel">
            Cancelar
          </button>
          <button type="button" class="btn-primary" id="btn-save-close">
            ✓ Guardar cambios
          </button>
        </div>
      </footer>
    `;

    this.bindElements();
    this.updateAvatarUI();
    this.updateScaleUI();
    this.updateFpsUI();
    this.updateFrameUI();
    this.updatePreviewGuide();
    void this.previewStage.init(
      this.previewCanvas,
      this.previewGuide,
      this.previewGuideDimText,
      this.getPreviewStageConfig()
    );
  }

  private bindElements(): void {
    this.avatarPathEl = this.container.querySelector("#avatar-path-text");
    this.clearAvatarBtn = this.container.querySelector("#btn-clear-avatar");
    this.scaleSlider = this.container.querySelector("#slider-avatar-scale");
    this.scaleValueEl = this.container.querySelector("#avatar-scale-value");
    this.frameWidthSlider = this.container.querySelector("#slider-frame-width");
    this.frameHeightSlider = this.container.querySelector(
      "#slider-frame-height"
    );
    this.frameWidthValEl = this.container.querySelector("#frame-width-val");
    this.frameHeightValEl = this.container.querySelector("#frame-height-val");
    this.previewGuide = this.container.querySelector("#preview-guide");
    this.previewGuideDimText =
      this.container.querySelector("#preview-dim-text");
    this.previewCanvas = this.container.querySelector("#preview-canvas");
    this.sightSvgEl = this.container.querySelector("#guide-sight-svg");
    this.sightLineEl = this.container.querySelector("#sight-laser-line");
    this.sightReticleCircleEl = this.container.querySelector(
      "#sight-reticle-circle"
    );
    this.sightReticleRingEl = this.container.querySelector(
      "#sight-reticle-ring"
    );
    this.guideLineVEl = this.container.querySelector("#guide-line-v");
    this.guideLineHEl = this.container.querySelector("#guide-line-h");
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

    if (this.frameWidthSlider) {
      this.frameWidthSlider.addEventListener("input", (event) => {
        const val = parseInt((event.target as HTMLInputElement).value, 10);
        void this.handleFrameWidthChange(val);
      });
    }

    if (this.frameHeightSlider) {
      this.frameHeightSlider.addEventListener("input", (event) => {
        const val = parseInt((event.target as HTMLInputElement).value, 10);
        void this.handleFrameHeightChange(val);
      });
    }

    const presetBtns =
      this.container.querySelectorAll<HTMLButtonElement>(".preset-btn");
    this.presetButtons = Array.from(presetBtns);
    this.presetButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        const preset = btn.getAttribute("data-preset");
        if (preset === "compact") {
          void this.applyFramePreset(300, 480);
        } else if (preset === "standard") {
          void this.applyFramePreset(400, 600);
        } else if (preset === "wide") {
          void this.applyFramePreset(600, 800);
        }
      });
    });

    const fpsBtns =
      this.container.querySelectorAll<HTMLButtonElement>(".fps-btn");
    this.fpsButtons = Array.from(fpsBtns);
    this.fpsButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        const fps = parseInt(btn.getAttribute("data-fps") || "30", 10);
        void this.handleFpsCapChange(fps);
      });
    });

    this.guidesToggleBtn =
      this.container.querySelector<HTMLButtonElement>("#btn-toggle-guides");
    if (this.guidesToggleBtn) {
      this.guidesToggleBtn.addEventListener("click", () => {
        this.showGuides = !this.showGuides;
        if (this.guidesToggleBtn) {
          this.guidesToggleBtn.textContent = this.showGuides
            ? "Guías ON"
            : "Guías OFF";
          this.guidesToggleBtn.classList.toggle("active", this.showGuides);
        }
        if (this.previewGuide) {
          this.previewGuide.style.display = this.showGuides ? "flex" : "none";
        }
        if (this.guideLineVEl) {
          this.guideLineVEl.style.display = this.showGuides ? "block" : "none";
        }
        if (this.guideLineHEl) {
          this.guideLineHEl.style.display = this.showGuides ? "block" : "none";
        }
        if (this.sightSvgEl && !this.showGuides) {
          this.sightSvgEl.style.display = "none";
        }
      });
    }

    const poseTestBtn =
      this.container.querySelector<HTMLButtonElement>("#btn-pose-test");
    if (poseTestBtn) {
      poseTestBtn.addEventListener("click", () => {
        this.isPoseTesting = !this.isPoseTesting;
        poseTestBtn.classList.toggle("active", this.isPoseTesting);
        this.previewStage.applyPoseTest(this.isPoseTesting);
        this.showToast(
          this.isPoseTesting
            ? "Pose Test (Brazos extendidos)"
            : "Pose Test OFF (Reposo)"
        );
      });
    }

    const devOverlayBtn = this.container.querySelector<HTMLButtonElement>(
      "#btn-toggle-dev-overlay"
    );
    if (devOverlayBtn) {
      devOverlayBtn.addEventListener("click", async () => {
        const nextState = !this.config.debugOverlay;
        this.config.debugOverlay = nextState;
        devOverlayBtn.textContent = nextState
          ? "✓ Overlay de depuración ACTIVO"
          : "Activar Overlay en el Personaje";
        devOverlayBtn.style.color = nextState ? "#10b981" : "";
        devOverlayBtn.style.borderColor = nextState ? "#10b981" : "";
        await this.configManager.set("debugOverlay", nextState);
        await this.emitUpdate();
        this.showToast(
          nextState
            ? "Debug Overlay activado en ventana"
            : "Debug Overlay desactivado"
        );
      });
    }

    const windowInteractionBtn =
      this.container.querySelector<HTMLButtonElement>(
        "#btn-toggle-window-interaction"
      );
    if (windowInteractionBtn) {
      windowInteractionBtn.addEventListener("click", async () => {
        const nextState = !this.config.windowInteraction;
        this.config.windowInteraction = nextState;
        windowInteractionBtn.textContent = nextState
          ? "✓ Posarse sobre ventana ACTIVO"
          : "Activar Posado en Ventanas";
        windowInteractionBtn.style.color = nextState ? "#10b981" : "";
        windowInteractionBtn.style.borderColor = nextState ? "#10b981" : "";
        await this.configManager.set("windowInteraction", nextState);
        await this.emitUpdate();
        this.showToast(
          nextState
            ? "Interacción con ventanas activada"
            : "Interacción con ventanas desactivada"
        );
      });
    }

    const resetDefaultsBtn = this.container.querySelector<HTMLButtonElement>(
      "#btn-reset-defaults"
    );
    if (resetDefaultsBtn) {
      resetDefaultsBtn.addEventListener("click", () => {
        void this.handleResetDefaults();
      });
    }

    const cancelBtn =
      this.container.querySelector<HTMLButtonElement>("#btn-cancel");
    if (cancelBtn) {
      cancelBtn.addEventListener("click", () => {
        void this.closeWindow();
      });
    }

    const saveCloseBtn =
      this.container.querySelector<HTMLButtonElement>("#btn-save-close");
    if (saveCloseBtn) {
      saveCloseBtn.addEventListener("click", () => {
        void this.handleSaveAndClose();
      });
    }

    // Bind preview canvas mouse pan / drag (locked vertically)
    if (this.previewCanvas) {
      this.previewCanvas.style.cursor = "ns-resize";

      this.previewCanvas.addEventListener("mousedown", (e: MouseEvent) => {
        if (e.button !== 0) return;
        this.isPreviewDragging = true;
        this.previewDragStartY = e.clientY;
        this.initialOffsetY = this.config.avatarOffsetY ?? 0;
        if (this.previewCanvas) {
          this.previewCanvas.style.cursor = "ns-resize";
        }
      });

      window.addEventListener("mousemove", (e: MouseEvent) => {
        if (!this.isPreviewDragging) return;
        const dy = e.clientY - this.previewDragStartY;

        // Lock horizontal axis to 0 (always centered horizontally / vertical-only drag)
        const newOffsetY = this.initialOffsetY - dy * 0.005;

        this.config.avatarOffsetX = 0;
        this.config.avatarOffsetY = newOffsetY;

        this.previewStage.setOffsetY(newOffsetY);

        void this.emitUpdate();

        if (this.offsetDebounceTimeout !== null) {
          clearTimeout(this.offsetDebounceTimeout);
        }
        this.offsetDebounceTimeout = setTimeout(() => {
          void this.configManager.set("avatarOffsetX", 0);
          void this.configManager.set("avatarOffsetY", newOffsetY);
        }, 200);
      });

      window.addEventListener("mouseup", () => {
        if (this.isPreviewDragging) {
          this.isPreviewDragging = false;
          if (this.previewCanvas) {
            this.previewCanvas.style.cursor = "ns-resize";
          }
        }
      });

      // Visual LookAt interactive tracking & ray casting in preview stage
      this.previewCanvas.addEventListener("mousemove", (e: MouseEvent) => {
        if (this.isPreviewDragging || !this.showGuides || !this.previewCanvas) {
          return;
        }

        const rect = this.previewCanvas.getBoundingClientRect();
        const mouseCanvasX = e.clientX - rect.left;
        const mouseCanvasY = e.clientY - rect.top;

        // Drive real 3D LookAt tracking in preview model
        if (rect.width > 0 && rect.height > 0) {
          const ndcX = (mouseCanvasX / rect.width) * 2 - 1;
          const ndcY = -(mouseCanvasY / rect.height) * 2 + 1;
          this.previewStage.setCursorNdc(ndcX, ndcY);
        }

        // Update Sight SVG Laser & Reticle
        if (this.sightSvgEl) {
          this.sightSvgEl.style.display = "block";
        }
        if (this.sightReticleCircleEl && this.sightReticleRingEl) {
          this.sightReticleCircleEl.setAttribute("cx", String(mouseCanvasX));
          this.sightReticleCircleEl.setAttribute("cy", String(mouseCanvasY));
          this.sightReticleRingEl.setAttribute("cx", String(mouseCanvasX));
          this.sightReticleRingEl.setAttribute("cy", String(mouseCanvasY));
        }

        // Project avatar eyes / head to 2D canvas coordinates
        if (this.sightLineEl) {
          const headCanvas = this.previewStage.projectHeadToCanvas(
            rect.width,
            rect.height
          );
          if (headCanvas) {
            this.sightLineEl.setAttribute("x1", String(headCanvas.x));
            this.sightLineEl.setAttribute("y1", String(headCanvas.y));
            this.sightLineEl.setAttribute("x2", String(mouseCanvasX));
            this.sightLineEl.setAttribute("y2", String(mouseCanvasY));
          }
        }
      });

      this.previewCanvas.addEventListener("mouseleave", () => {
        this.previewStage.setMouseOutside(true);
        if (this.sightSvgEl) {
          this.sightSvgEl.style.display = "none";
        }
      });
    }
  }

  public async handlePickAvatar(): Promise<void> {
    try {
      const selected = await this.pickFile();
      if (!selected) return;
      this.config.avatarPath = selected;
      await this.configManager.set("avatarPath", selected);
      this.updateAvatarUI();
      await this.previewStage.loadModel(this.getPreviewStageConfig());
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
      await this.previewStage.loadModel(this.getPreviewStageConfig());
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
    this.previewStage.setScale(clamped);

    void this.emitUpdate();

    if (this.scaleDebounceTimeout !== null) {
      clearTimeout(this.scaleDebounceTimeout);
    }
    this.scaleDebounceTimeout = setTimeout(() => {
      void this.configManager.set("avatarScale", clamped);
    }, 200);
  }

  public async handleFrameWidthChange(w: number): Promise<void> {
    this.config.frameWidth = w;
    if (this.frameWidthValEl) {
      this.frameWidthValEl.textContent = `${w} px`;
    }
    this.updatePreviewGuide();
    this.debounceFrameSave();
  }

  public async handleFrameHeightChange(h: number): Promise<void> {
    this.config.frameHeight = h;
    if (this.frameHeightValEl) {
      this.frameHeightValEl.textContent = `${h} px`;
    }
    this.updatePreviewGuide();
    this.debounceFrameSave();
  }

  public async applyFramePreset(w: number, h: number): Promise<void> {
    this.config.frameWidth = w;
    this.config.frameHeight = h;
    if (this.frameWidthSlider) this.frameWidthSlider.value = String(w);
    if (this.frameHeightSlider) this.frameHeightSlider.value = String(h);
    if (this.frameWidthValEl) this.frameWidthValEl.textContent = `${w} px`;
    if (this.frameHeightValEl) this.frameHeightValEl.textContent = `${h} px`;

    this.updateFramePresetButtons();
    this.updatePreviewGuide();
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

  public async handleResetDefaults(): Promise<void> {
    try {
      this.config = { ...DEFAULT_CONFIG };
      await this.configManager.saveConfig(this.config);
      this.updateAvatarUI();
      this.updateScaleUI();
      this.updateFpsUI();
      this.updateFrameUI();
      this.updatePreviewGuide();
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
    this.previewStage.dispose();
  }

  private async closeWindow(): Promise<void> {
    if (isTauri()) {
      try {
        await this.onEmit("settings-window-visibility", false);
        const win = getCurrentWindow();
        await win.close();
      } catch (err) {
        console.warn("[deskumi-settings] Failed to close window:", err);
      }
    }
  }

  private updateAvatarUI(): void {
    const filename = this.config.avatarPath
      ? this.config.avatarPath.split("/").pop() || "Avatar"
      : "Sample Robot (Twist)";

    if (this.avatarPathEl) {
      this.avatarPathEl.textContent =
        this.config.avatarPath || "Avatar de muestra por defecto";
      this.avatarPathEl.title = this.config.avatarPath || "";
    }

    const footerName =
      this.container.querySelector<HTMLElement>("#footer-model-name");
    if (footerName) {
      footerName.textContent = filename;
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
    this.previewStage.setScale(scale);
  }

  private updateFrameUI(): void {
    const w = this.config.frameWidth ?? 400;
    const h = this.config.frameHeight ?? 600;
    if (this.frameWidthSlider) this.frameWidthSlider.value = String(w);
    if (this.frameHeightSlider) this.frameHeightSlider.value = String(h);
    if (this.frameWidthValEl) this.frameWidthValEl.textContent = `${w} px`;
    if (this.frameHeightValEl) this.frameHeightValEl.textContent = `${h} px`;
    this.updateFramePresetButtons();
  }

  private updateFramePresetButtons(): void {
    const w = this.config.frameWidth ?? 400;
    const h = this.config.frameHeight ?? 600;
    this.presetButtons.forEach((btn) => {
      const preset = btn.getAttribute("data-preset");
      const isMatch =
        (preset === "compact" && w === 300 && h === 480) ||
        (preset === "standard" && w === 400 && h === 600) ||
        (preset === "wide" && w === 600 && h === 800);
      btn.classList.toggle("active", isMatch);
    });
  }

  private updateFpsUI(): void {
    const current = this.config.fpsCap;
    this.fpsButtons.forEach((btn) => {
      const fps = parseInt(btn.getAttribute("data-fps") || "30", 10);
      btn.classList.toggle("selected", fps === current);
    });
  }

  private getPreviewStageConfig() {
    return {
      avatarPath: this.config.avatarPath ?? null,
      avatarScale: this.config.avatarScale ?? 1.0,
      avatarOffsetY: this.config.avatarOffsetY ?? 0,
      frameWidth: this.config.frameWidth ?? 400,
      frameHeight: this.config.frameHeight ?? 600,
      isPoseTesting: this.isPoseTesting
    };
  }

  private updatePreviewGuide(): void {
    this.previewStage.updateGuide(
      this.config.frameWidth ?? 400,
      this.config.frameHeight ?? 600
    );
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
