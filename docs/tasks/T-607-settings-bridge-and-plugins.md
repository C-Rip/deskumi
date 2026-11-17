# T-607: Ajustes de Puente WebSocket y Plugins (`BridgeSettingsSection`, `PluginsSettingsSection`, `store.ts`, `PlatformCaps`)

| Campo         | Valor                                                             |
| ------------- | ----------------------------------------------------------------- |
| Estado        | en revisión                                                       |
| Asignado      | subagent-T-607                                                    |
| Fase          | F6                                                                |
| Rama          | `feat/T-607-settings-bridge-and-plugins`                          |
| Depende de    | T-605, T-606                                                      |
| Estimación    | M (≤ 1 día)                                                       |
| Skills útiles | `task-workflow`, `git-workflow`, `frontend-threejs`, `rust-tauri` |

## Objetivo

Exponer en la ventana de Ajustes la configuración del Puente WebSocket local (`BridgeSettingsSection`) y del gestor de Plugins y animaciones registradas (`PluginsSettingsSection`), persistiendo preferencias y consentimiento de permisos en `store.ts` y adaptando la visibilidad por plataforma vía `PlatformCaps`.

## Contexto

- [ADR-0004](../adr/0004-vanilla-ts-settings-window.md): Ventana de ajustes en TypeScript vanilla sin frameworks de UI.
- [ADR-0006](../adr/0006-plugins-and-local-ws-bridge.md) y [LIMITATIONS.md](../LIMITATIONS.md) (`L-06`): Fase 6 es Linux-first; el modelo de token único en `bridge.json` aplica scopes globales del usuario (no por cliente), y `desktop:windowTitle` debe ir separado y apagado por defecto con advertencia de privacidad.
- [T-601](T-601-refactor-main-and-settings.md): Refactor de `SettingsPanel.ts` en módulos ≤ 300 líneas.

## Alcance

- Incluye:
  - Ampliar `PlatformCaps` (`src-tauri/src/platform.rs`, `src/platform/caps.ts`) con capacidades de F6 (p. ej. `localBridge: boolean`, `plugins: boolean` — activas en Linux y ocultando/deshabilitando controles en plataformas no validadas).
  - Ampliar `AppConfig` en `src/platform/store.ts`: `bridgeEnabled`, `bridgeScopes` (separando `desktop:events` para `appId` y `desktop:windowTitle` desactivado por defecto), `enabledPlugins`, `pluginPermissions` (consentimiento granular por plugin) y `registeredAnimations`.
  - Crear `src/settings/BridgeSettingsSection.ts`:
    - Toggle activar/desactivar puente WebSocket local.
    - Estado actual (activo/inactivo, puerto `127.0.0.1:<port>`, ruta de `bridge.json`, clientes conectados).
    - Botón para copiar token/ruta y botón para regenerar token (`regenerate_bridge_token`).
    - Switches de scopes con aviso explícito de que el token es compartido a nivel de usuario local y advertencia de privacidad para `desktop:windowTitle`.
  - Crear `src/settings/PluginsSettingsSection.ts`:
    - Lista de plugins detectados (`list_plugins`) con descripción y permisos solicitados.
    - Toggle activar/desactivar respetando el máximo de 3 plugins activos simultáneos.
    - Toggles/consentimiento explícito de permisos por plugin.
    - Selector para registrar/eliminar animaciones `.vrma` locales por ID lógico.
  - Conectar las nuevas secciones en `src/settings/SettingsPanel.ts` y `src/styles/settings.css`, y sincronizar cambios en vivo en `src/platform/app-listeners.ts` / `src/main.ts` mediante `"settings-updated"`.
  - Mantener todos los archivos modificados/creados ≤ 300 líneas y añadir tests en Vitest + Rust (`platform.rs`).
- **No incluye:** implementación del servidor WebSocket (`T-605`), runtime del `PluginHost` (`T-606`) ni soporte D-Bus de `windowFocus` (`T-609`).

## Pasos sugeridos

1. Ampliar `PlatformCaps` en `src-tauri/src/platform.rs` y `src/platform/caps.ts` y actualizar `docs/ARCHITECTURE.md`.
2. Extender `AppConfig` / `DEFAULT_CONFIG` en `src/platform/store.ts` y sus tests en `store.test.ts`.
3. Implementar `src/settings/BridgeSettingsSection.ts` y `src/settings/PluginsSettingsSection.ts` integrándolos en `SettingsPanel.ts`.
4. Conectar sincronización en vivo en `src/platform/app-listeners.ts` y probar manualmente con `npm run tauri dev`.

## Criterios de aceptación

- [x] `PlatformCaps` refleja soporte F6 por plataforma y la UI se adapta limpiamente cuando no está disponible.
- [x] Ajustes del Puente muestran estado, puerto, regeneración de token y advertencias claras sobre token único y `desktop:windowTitle` (apagado por defecto).
- [x] Ajustes de Plugins exigen consentimiento explícito de permisos y bloquean activar un 4.º plugin simultáneo.
- [x] Cada archivo TS modificado o nuevo mantiene ≤ 300 líneas y `npm run check` + checks Rust pasan al 100%.

## Archivos esperados

- `src-tauri/src/platform.rs` y `src/platform/caps.ts` — ampliar `PlatformCaps`
- `src/platform/store.ts` y `src/platform/store.test.ts` — ampliar `AppConfig`
- `src/settings/BridgeSettingsSection.ts` — crear
- `src/settings/PluginsSettingsSection.ts` — crear
- `src/settings/SettingsPanel.ts`, `src/settings/SettingsTemplate.ts` y `src/styles/settings.css` — integrar secciones
- `src/settings/SettingsPanel.test.ts` — ampliar tests
- `src/platform/app-listeners.ts` / `src/main.ts` — sincronización en vivo
- `docs/ARCHITECTURE.md` — actualizar tipo `PlatformCaps`

## Verificación

```bash
npm run check
(cd src-tauri && cargo fmt --check && cargo clippy -- -D warnings && cargo test)
```

## Handoff

- **Qué se hizo:**
  - `PlatformCaps` ampliado con `localBridge: boolean` y `plugins: boolean` (`true` en Linux, `false` en Windows/macOS y fuera de Tauri) en `src-tauri/src/platform.rs`, `src/platform/caps.ts`, `src/platform/ipc.ts`, `src/platform/caps.test.ts` y `docs/ARCHITECTURE.md`.
  - Esquema `AppConfig` y migración limpia en `src/platform/store-schema.ts` / `src/platform/store.ts` (`bridgeEnabled`, `bridgeScopes`, `enabledPlugins`, `pluginPermissions`, `registeredAnimations`) con tests de migración y clonado defensivo en `src/platform/store.test.ts`.
  - Sección de Puente WebSocket local (`src/settings/BridgeSettingsSection.ts`, `src/settings/BridgeSettingsTemplate.ts`) con adaptación por `caps.localBridge`, toggle activar/detener, estado en vivo (`127.0.0.1:<port>`, ruta `bridge.json`, clientes conectados, token enmascarado), botones copiar token/ruta, regeneración de token, aviso de token único de usuario local y scopes con `desktop:windowTitle` apagado por defecto y advertencia de privacidad.
  - Sección de Plugins y animaciones `.vrma` (`src/settings/PluginsSettingsSection.ts`, `src/settings/PluginsSettingsTemplate.ts`, `src/settings/PluginsDomBinder.ts`) con adaptación por `caps.plugins`, listado de plugins descubiertos (escapando HTML), tope estricto de 3 plugins activos simultáneos (`MAX_ACTIVE_PLUGINS`), checkboxes de consentimiento explícito de permisos por plugin y registro/eliminación de animaciones `.vrma` por ID lógico.
  - Integración en `SettingsPanel.ts`, `SettingsSubsections.ts`, `SettingsTemplate.ts`, `SettingsDom.ts` y `src/styles/settings.css`, más sincronización en vivo serializada en `src/platform/runtime-integrations.ts`, `src/platform/app-listeners.ts` y `src/main.ts`.
- **Decisiones tomadas:**
  - Se extrajeron `src/platform/store-schema.ts`, `src/settings/section-utils.ts`, `src/settings/BridgeSettingsTemplate.ts`, `src/settings/PluginsSettingsTemplate.ts`, `src/settings/PluginsDomBinder.ts` y `src/settings/SettingsSubsections.ts` para respetar estrictamente el límite de ≤ 300 líneas por archivo TS y evitar duplicación de escaping/scopes.
  - `runtime-integrations.ts` serializa `syncConfig` mediante cola coalescente para evitar condiciones de carrera si `"settings-updated"` se emite rápidamente y sincroniza las animaciones registradas del usuario en `PluginState` tanto al arrancar (`initAvatar`) como al actualizar ajustes.
- **Entorno probado / Verificación:**
  - Verificado con `npm run check`, `npm run build`, `cargo fmt --check`, `cargo clippy -- -D warnings` y `cargo test` en Linux.
  - Validación visual interactiva con `npm run tauri dev` pendiente de prueba manual en escritorio.
- **Deuda / siguientes pasos:**
  - Integrar los eventos D-Bus reales de `windowFocus` en `T-609` (fuera de alcance aquí) para alimentar el scope `desktop:events` / `desktop:windowTitle` en vivo.
