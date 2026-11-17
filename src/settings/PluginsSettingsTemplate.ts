import type { PlatformCaps } from "../platform/caps";
import type { PluginInfo, RegisteredAnimation } from "../platform/ipc";
import { MAX_ACTIVE_PLUGINS } from "../platform/plugins/PluginHostTypes";
import type { AppConfig } from "../platform/store-schema";
import { escapeHtml, getScopeMetadata } from "./section-utils";

export interface AnimationDraftState {
  id: string;
  label: string;
  path: string;
}

export interface PluginsTemplateModel {
  caps: PlatformCaps;
  config: AppConfig;
  plugins: readonly PluginInfo[];
  discoveredAnimations: readonly RegisteredAnimation[];
  draft: AnimationDraftState;
  loadError: string | null;
}

function renderPluginCard(
  plugin: PluginInfo,
  enabledSet: ReadonlySet<string>,
  grantedMap: Readonly<Record<string, string[]>>,
  atActiveLimit: boolean
): string {
  const isEnabled = enabledSet.has(plugin.id);
  const disableToggle = !isEnabled && atActiveLimit;
  const grantedPerms = new Set(grantedMap[plugin.id] ?? []);
  const pidEsc = escapeHtml(plugin.id);

  const permsHtml =
    plugin.permissions.length === 0
      ? `<div class="plugin-no-perms">Este plugin no solicita permisos de avatar ni escritorio.</div>`
      : plugin.permissions
          .map((perm) => {
            const meta = getScopeMetadata(perm);
            const checked = grantedPerms.has(perm) ? "checked" : "";
            const warning = meta.privacyWarning
              ? `<div class="privacy-warning-text">${escapeHtml(meta.privacyWarning)}</div>`
              : "";
            return `
              <label class="scope-toggle-row plugin-perm-row">
                <input type="checkbox" class="plugin-perm-checkbox" data-plugin-id="${pidEsc}" data-permission="${escapeHtml(perm)}" ${checked} />
                <div class="scope-toggle-copy">
                  <span class="scope-toggle-title">${escapeHtml(meta.label)}</span>
                  <span class="scope-toggle-desc">${escapeHtml(meta.description)}</span>
                  ${warning}
                </div>
              </label>`;
          })
          .join("");

  const grantedCount = plugin.permissions.filter((p) =>
    grantedPerms.has(p)
  ).length;
  const consentHint =
    plugin.permissions.length > 0 && grantedCount === 0
      ? `<div class="plugin-consent-hint">Consentimiento explícito requerido: marca los permisos que deseas aprobar antes de usar sus funciones.</div>`
      : "";

  const descHtml = plugin.description
    ? `<p class="plugin-item-desc">${escapeHtml(plugin.description)}</p>`
    : "";

  return `
    <div class="plugin-item-card" data-plugin-card="${pidEsc}">
      <div class="plugin-item-header">
        <div class="plugin-item-meta">
          <span class="plugin-item-name">${escapeHtml(plugin.name)}</span>
          <span class="version-pill">v${escapeHtml(plugin.version)}</span>
          <code class="plugin-item-id">${pidEsc}</code>
        </div>
        <button type="button" class="btn-secondary plugin-toggle-btn ${isEnabled ? "btn-toggle-active" : ""}" data-plugin-id="${pidEsc}" aria-pressed="${String(isEnabled)}" ${disableToggle ? "disabled" : ""}>
          ${isEnabled ? "✓ Activo" : "Activar"}
        </button>
      </div>
      ${descHtml}
      ${consentHint}
      <div class="plugin-perms-list">${permsHtml}</div>
    </div>`;
}

function renderAnimationsSubsection(
  config: AppConfig,
  discoveredAnimations: readonly RegisteredAnimation[],
  draft: AnimationDraftState
): string {
  const userAnimsHtml =
    config.registeredAnimations.length === 0
      ? `<div class="empty-list-hint">Sin animaciones .vrma registradas por el usuario.</div>`
      : config.registeredAnimations
          .map((anim) => {
            const idEsc = escapeHtml(anim.id);
            const labelPart = anim.label
              ? `<span class="anim-item-label">${escapeHtml(anim.label)}</span>`
              : "";
            return `
              <div class="anim-item-row" data-user-anim="${idEsc}">
                <div class="anim-item-info">
                  <div class="anim-item-title-row">
                    <code class="anim-item-id">${idEsc}</code>
                    ${labelPart}
                  </div>
                  <span class="anim-item-path" title="${escapeHtml(anim.path)}">${escapeHtml(anim.path)}</span>
                </div>
                <button type="button" class="btn-secondary btn-danger btn-unregister-anim" data-anim-id="${idEsc}">Eliminar</button>
              </div>`;
          })
          .join("");

  const pluginAnims = discoveredAnimations.filter((a) => a.source === "plugin");
  const pluginAnimsHtml =
    pluginAnims.length === 0
      ? ""
      : `<div class="plugin-anims-list">${pluginAnims
          .map((anim) => {
            const owner = anim.pluginId
              ? `Plugin: ${escapeHtml(anim.pluginId)}`
              : "Plugin";
            return `
              <div class="anim-item-row anim-item-readonly">
                <div class="anim-item-info">
                  <div class="anim-item-title-row">
                    <code class="anim-item-id">${escapeHtml(anim.id)}</code>
                    ${anim.label ? `<span class="anim-item-label">${escapeHtml(anim.label)}</span>` : ""}
                  </div>
                </div>
                <span class="version-pill">${owner}</span>
              </div>`;
          })
          .join("")}</div>`;

  const pickedText = draft.path || "Ningún archivo .vrma seleccionado";
  const canRegister =
    draft.id.trim().length > 0 && draft.path.trim().length > 0;

  return `
    <div class="preset-section-label">Animaciones .vrma registradas por ID lógico</div>
    <p class="settings-card-description">Asocia archivos .vrma locales a un ID lógico para que plugins y puente los invoquen sin exponer rutas de disco.</p>
    <div class="anim-register-form">
      <div class="anim-form-inputs">
        <input type="text" id="input-anim-id" class="settings-text-input" placeholder="ID lógico (ej. wave)" value="${escapeHtml(draft.id)}" />
        <input type="text" id="input-anim-label" class="settings-text-input" placeholder="Etiqueta opcional" value="${escapeHtml(draft.label)}" />
      </div>
      <div class="avatar-path-box" title="${escapeHtml(pickedText)}">
        <span class="avatar-path-text" id="anim-picked-path">${escapeHtml(pickedText)}</span>
        <span class="avatar-filesize">VRMA</span>
      </div>
      <div class="button-group">
        <button type="button" class="btn-secondary" id="btn-pick-anim-vrma">📁 Elegir .vrma...</button>
        <button type="button" class="btn-primary" id="btn-register-anim" ${canRegister ? "" : "disabled"}>+ Registrar animación</button>
      </div>
    </div>
    <div class="registered-anims-list" id="registered-anims-list">
      ${userAnimsHtml}
      ${pluginAnimsHtml}
    </div>`;
}

export function buildPluginsSectionHtml(model: PluginsTemplateModel): string {
  const { caps, config, plugins, discoveredAnimations, draft, loadError } =
    model;

  if (!caps.plugins) {
    return `
      <div class="card-header-row">
        <div class="card-title-group">
          <span class="card-title-icon">🧩</span>
          <h2 class="settings-card-title">Plugins aislados y animaciones</h2>
        </div>
        <span class="status-indicator-tag status-tag-muted" id="plugins-status-badge">No disponible</span>
      </div>
      <div class="platform-unavailable-notice" id="plugins-unavailable-notice">
        El runtime de plugins aislados (<code>plugin://</code>) solo está disponible en Linux en esta versión (L-06). Los controles permanecen deshabilitados en esta plataforma.
      </div>`;
  }

  const enabledSet = new Set(config.enabledPlugins);
  const enabledCount = config.enabledPlugins.length;
  const atActiveLimit = enabledCount >= MAX_ACTIVE_PLUGINS;

  const limitBanner = atActiveLimit
    ? `<div class="security-warning-banner" id="plugins-limit-banner">Límite de seguridad alcanzado: máximo ${MAX_ACTIVE_PLUGINS} plugins activos simultáneamente (ADR-0006). Desactiva uno para habilitar otro.</div>`
    : "";

  const errorBanner = loadError
    ? `<div class="security-warning-banner" id="plugins-error-banner">${escapeHtml(loadError)}</div>`
    : "";

  const pluginsListHtml =
    plugins.length === 0
      ? `<div class="empty-list-hint" id="plugins-empty-hint">No se detectaron plugins en <code>$APPDATA/plugins/&lt;id&gt;/manifest.json</code>.</div>`
      : plugins
          .map((p) =>
            renderPluginCard(
              p,
              enabledSet,
              config.pluginPermissions,
              atActiveLimit
            )
          )
          .join("");

  return `
    <div class="card-header-row">
      <div class="card-title-group">
        <span class="card-title-icon">🧩</span>
        <h2 class="settings-card-title">Plugins aislados y animaciones</h2>
      </div>
      <span class="status-indicator-tag" id="plugins-active-count">${enabledCount} / ${MAX_ACTIVE_PLUGINS} activos</span>
    </div>
    <p class="settings-card-description">Los plugins se ejecutan en iframes sandbox sin acceso a Tauri ni red. Aprueba explícitamente cada permiso antes de otorgarlo.</p>
    <div class="button-group">
      <button type="button" class="btn-secondary" id="btn-plugins-refresh">↻ Recargar plugins</button>
    </div>
    ${limitBanner}
    ${errorBanner}
    <div class="plugins-list" id="plugins-list">${pluginsListHtml}</div>
    ${renderAnimationsSubsection(config, discoveredAnimations, draft)}`;
}
