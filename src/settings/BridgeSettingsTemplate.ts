import type { PlatformCaps } from "../platform/caps";
import type { BridgeStatus } from "../platform/ipc";
import { ALL_AVATAR_SCOPES, type AppConfig } from "../platform/store-schema";
import { escapeHtml, getScopeMetadata } from "./section-utils";

export function maskBridgeToken(token: string | null): string {
  if (!token) return "Sin token activo";
  const tail = token.slice(-6);
  return `Token activo (••••••${tail})`;
}

export function buildBridgeSectionHtml(
  caps: PlatformCaps,
  config: AppConfig,
  status: BridgeStatus
): string {
  if (!caps.localBridge) {
    return `
      <div class="card-header-row">
        <div class="card-title-group">
          <span class="card-title-icon">🔌</span>
          <h2 class="settings-card-title">Puente WebSocket local</h2>
        </div>
        <span class="status-indicator-tag status-tag-muted" id="bridge-status-badge">No disponible</span>
      </div>
      <div class="platform-unavailable-notice" id="bridge-unavailable-notice">
        El puente WebSocket local (127.0.0.1) solo está disponible en Linux en esta versión (L-06). Los controles permanecen deshabilitados en esta plataforma.
      </div>`;
  }

  const isRunning = status.running;
  const statusLabel = isRunning ? "Activo" : "Inactivo";
  const statusClass = isRunning
    ? "status-indicator-tag"
    : "status-indicator-tag status-tag-muted";
  const endpointText =
    isRunning && status.port !== null
      ? `127.0.0.1:${status.port}`
      : "Inactivo (sin puerto)";
  const pathText =
    status.bridgeFilePath ?? "No generado hasta activar el puente";
  const clientsText = `${status.connectedClients} / ${status.maxClients} clientes`;
  const grantedSet = new Set(config.bridgeScopes);

  const scopesMarkup = ALL_AVATAR_SCOPES.map((scope) => {
    const meta = getScopeMetadata(scope);
    const checked = grantedSet.has(scope) ? "checked" : "";
    const privacyNotice = meta.privacyWarning
      ? `<div class="privacy-warning-text">${escapeHtml(meta.privacyWarning)}</div>`
      : "";
    return `
      <label class="scope-toggle-row" data-scope-row="${escapeHtml(scope)}">
        <input type="checkbox" class="bridge-scope-checkbox" data-scope="${escapeHtml(scope)}" ${checked} />
        <div class="scope-toggle-copy">
          <span class="scope-toggle-title">${escapeHtml(meta.label)}</span>
          <span class="scope-toggle-desc">${escapeHtml(meta.description)}</span>
          ${privacyNotice}
        </div>
      </label>`;
  }).join("");

  return `
    <div class="card-header-row">
      <div class="card-title-group">
        <span class="card-title-icon">🔌</span>
        <h2 class="settings-card-title">Puente WebSocket local</h2>
      </div>
      <span class="${statusClass}" id="bridge-status-badge">${statusLabel}</span>
    </div>
    <p class="settings-card-description">Servidor loopback local (127.0.0.1) para conectar agentes externos y bancos de voz TTS sin TLS ni exposición en red.</p>

    <div class="button-group">
      <button type="button" class="btn-secondary ${config.bridgeEnabled ? "btn-toggle-active" : ""}" id="btn-toggle-bridge" aria-pressed="${String(config.bridgeEnabled)}">
        ${config.bridgeEnabled ? "✓ Puente WebSocket ACTIVO" : "Activar Puente WebSocket"}
      </button>
      <button type="button" class="btn-secondary" id="btn-bridge-refresh">↻ Actualizar</button>
    </div>

    <div class="bridge-status-grid">
      <div class="bridge-stat-item">
        <span class="bridge-stat-label">Dirección</span>
        <span class="bridge-stat-value" id="bridge-endpoint-text">${escapeHtml(endpointText)}</span>
      </div>
      <div class="bridge-stat-item">
        <span class="bridge-stat-label">Clientes conectados</span>
        <span class="bridge-stat-value" id="bridge-clients-text">${escapeHtml(clientsText)}</span>
      </div>
    </div>

    <div class="avatar-path-box" title="${escapeHtml(pathText)}">
      <span class="avatar-path-text" id="bridge-path-text">${escapeHtml(pathText)}</span>
      <span class="avatar-filesize">bridge.json</span>
    </div>

    <div class="avatar-path-box">
      <span class="avatar-path-text" id="bridge-token-preview">${escapeHtml(maskBridgeToken(status.token))}</span>
      <span class="avatar-filesize">256-bit</span>
    </div>

    <div class="button-group">
      <button type="button" class="btn-secondary" id="btn-bridge-copy-token" ${!isRunning || !status.token ? "disabled" : ""}>📋 Copiar token</button>
      <button type="button" class="btn-secondary" id="btn-bridge-copy-path" ${!status.bridgeFilePath ? "disabled" : ""}>📋 Copiar ruta</button>
      <button type="button" class="btn-secondary btn-danger" id="btn-bridge-regenerate-token" ${!isRunning ? "disabled" : ""}>🔄 Regenerar token</button>
    </div>

    <div class="security-warning-banner" id="bridge-token-warning">
      ⚠ Token único de usuario local: cualquier proceso del mismo usuario que lea <code>bridge.json</code> obtiene los scopes activos aquí (son interruptores globales, no permisos por cliente).
    </div>

    <div class="preset-section-label">Scopes globales permitidos</div>
    <div class="scopes-list">${scopesMarkup}</div>`;
}

export function applyBridgeStatusToDom(
  container: HTMLElement,
  status: BridgeStatus
): void {
  const q = <T extends Element>(sel: string) => container.querySelector<T>(sel);
  const badge = q("#bridge-status-badge");
  const endpoint = q("#bridge-endpoint-text");
  const clients = q("#bridge-clients-text");
  const pathEl = q("#bridge-path-text");
  const tokenEl = q("#bridge-token-preview");
  const copyTokenBtn = q<HTMLButtonElement>("#btn-bridge-copy-token");
  const copyPathBtn = q<HTMLButtonElement>("#btn-bridge-copy-path");
  const regenBtn = q<HTMLButtonElement>("#btn-bridge-regenerate-token");

  if (badge) {
    badge.textContent = status.running ? "Activo" : "Inactivo";
    badge.classList.toggle("status-tag-muted", !status.running);
  }
  if (endpoint) {
    endpoint.textContent =
      status.running && status.port !== null
        ? `127.0.0.1:${status.port}`
        : "Inactivo (sin puerto)";
  }
  if (clients) {
    clients.textContent = `${status.connectedClients} / ${status.maxClients} clientes`;
  }
  if (pathEl) {
    pathEl.textContent =
      status.bridgeFilePath ?? "No generado hasta activar el puente";
  }
  if (tokenEl) {
    tokenEl.textContent = maskBridgeToken(status.token);
  }
  if (copyTokenBtn) {
    copyTokenBtn.disabled = !status.running || !status.token;
  }
  if (copyPathBtn) {
    copyPathBtn.disabled = !status.bridgeFilePath;
  }
  if (regenBtn) {
    regenBtn.disabled = !status.running;
  }
}
