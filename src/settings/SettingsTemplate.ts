import type { AppConfig } from "../platform/store";

export const FRAME_PRESETS: Record<string, readonly [number, number]> = {
  compact: [300, 480],
  standard: [400, 600],
  wide: [600, 800]
};

/**
 * Builds the complete HTML markup for the Settings window panel from the current config.
 */
export function buildSettingsHtml(config: AppConfig): string {
  const scale = config.avatarScale ?? 1.0;
  const fWidth = config.frameWidth ?? 400;
  const fHeight = config.frameHeight ?? 600;

  return `
<header class="settings-window-bar">
  <div class="window-title-group">
    <span class="window-icon">⚙</span>
    <span class="window-title">Ajustes de Deskumi</span>
    <span class="version-pill">v0.2</span>
  </div>
</header>

<main class="settings-main-layout">
  <div class="settings-left-col">
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
        <button type="button" class="btn-primary" id="btn-pick-avatar">📁 Cambiar avatar (.vrm)...</button>
        <button type="button" class="btn-secondary btn-danger" id="btn-clear-avatar">🗑 Quitar avatar</button>
      </div>
    </section>

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
        <input type="range" id="slider-avatar-scale" min="0.5" max="2.0" step="0.05" value="${scale.toFixed(2)}" />
      </div>
    </section>

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
        <button type="button" class="btn-secondary" id="btn-toggle-window-interaction" style="width: 100%; justify-content: center; font-size: 12px; padding: 8px; ${config.windowInteraction ? "color: #10b981; border-color: #10b981;" : ""}">
          ${config.windowInteraction ? "✓ Posarse sobre ventana ACTIVO" : "Activar Posado en Ventanas"}
        </button>
      </div>
    </section>

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
          ${config.debugOverlay ? "✓ Overlay de depuración ACTIVO" : "Activar Overlay en el Personaje"}
        </button>
      </div>
    </section>
  </div>

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
      <span class="fps-counter-badge">FPS Render: ${(config.fpsCap ?? 30).toFixed(1)}</span>
      <span class="preview-dim-badge" id="preview-dim-text">${fWidth} × ${fHeight} px</span>
    </div>
    <div class="preview-stage-container" id="preview-stage">
      <div class="preview-overlay-guide" id="preview-guide">
        <canvas class="preview-stage-canvas" id="preview-canvas"></canvas>
        <div class="quadrant-line-v" id="guide-line-v"></div>
        <div class="quadrant-line-h" id="guide-line-h"></div>
        <svg class="lookat-sight-line" id="guide-sight-svg" style="display: none;">
          <line id="sight-laser-line" x1="0" y1="0" x2="0" y2="0" stroke="#38bdf8" stroke-width="2" stroke-dasharray="4 3" opacity="0.85" />
          <circle id="sight-reticle-circle" cx="0" cy="0" r="5" fill="#38bdf8" opacity="0.9" />
          <circle id="sight-reticle-ring" cx="0" cy="0" r="9" fill="none" stroke="#38bdf8" stroke-width="1.5" opacity="0.6" />
        </svg>
      </div>
    </div>
  </div>
</main>

<footer class="settings-footer">
  <div class="footer-model-info">
    <span class="model-name-text" id="footer-model-name">Avatar</span>
    <span class="model-meta-text">Rigged Humanoid • Shaders: MToon</span>
  </div>
  <div class="footer-actions">
    <button type="button" class="btn-secondary" id="btn-reset-defaults" style="font-size: 11px;">Restaurar valores predeterminados</button>
    <div class="status-toast" id="settings-status-toast"></div>
    <button type="button" class="btn-secondary" id="btn-cancel">Cancelar</button>
    <button type="button" class="btn-primary" id="btn-save-close">✓ Guardar cambios</button>
  </div>
</footer>`;
}
