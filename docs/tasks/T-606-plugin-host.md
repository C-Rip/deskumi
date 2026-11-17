# T-606: Host de plugins (`plugins.rs` `plugin://`, `PluginHost`, registro `.vrma` y `csp`/`devCsp`)

| Campo         | Valor                                                                    |
| ------------- | ------------------------------------------------------------------------ |
| Estado        | lista                                                                    |
| Asignado      | —                                                                        |
| Fase          | F6                                                                       |
| Rama          | `feat/T-606-plugin-host`                                                 |
| Depende de    | T-602                                                                    |
| Estimación    | L (≤ 2.5 días)                                                           |
| Skills útiles | `task-workflow`, `git-workflow`, `rust-tauri`, `frontend-threejs`, `adr` |

## Objetivo

Implementar el subsistema seguro de plugins en Rust (`src-tauri/src/plugins.rs` con protocolo propio `plugin://`) y frontend (`src/platform/plugins/PluginHost.ts`), incorporar el registro seguro de animaciones `.vrma` por ID, y activar `csp` y `devCsp` en `src-tauri/tauri.conf.json` sin regresar la carga de avatares ni la ventana de Ajustes.

## Contexto

- [ADR-0006](../adr/0006-plugins-and-local-ws-bridge.md): Evidencia empírica de `T-600` sobre WebKitGTK 2.54.2 (`new Worker("plugin://...")` bloqueado por Same-Origin Policy desde `tauri://localhost`; `blob:` Worker hereda `connect-src ipc:`; `<iframe sandbox="allow-scripts" src="plugin://<id>/...">` con `Content-Security-Policy: default-src 'none'; script-src plugin://<id>; worker-src 'none'; connect-src 'none'` bloquea `fetch`, `WebSocket`, `import()`, `Worker` anidado y acceso a `__TAURI__` / `parent.document`).
- [`.agents/rules/plugins.md`](../../.agents/rules/plugins.md) y [`.agents/rules/rust-tauri.md`](../../.agents/rules/rust-tauri.md).
- [phase-6-plan-v4-review.md](../plans/phase-6-plan-v4-review.md) (§1.1, §2 sobre registro de animaciones `.vrma`, §2 sobre `csp` / `devCsp`).

## Alcance

- Incluye:
  - `src-tauri/src/plugins.rs`:
    - Descubrimiento de manifiestos en `$APPDATA/plugins/<pluginId>/manifest.json` y validación de metadatos (`id`, `name`, `version`, `entry`, `permissions[]`, `animations[]`).
    - Registro del esquema `plugin://` mediante `tauri::Builder::register_uri_scheme_protocol("plugin", ...)` sirviendo archivos exclusivamente dentro de `$APPDATA/plugins/<pluginId>/` (con `canonicalize()` + verificación de prefijo estricto rechazando `..`, bytes nulos y symlinks salientes).
    - Inyección de `Content-Security-Policy: default-src 'none'; script-src plugin://<pluginId>; worker-src 'none'; connect-src 'none'` en documentos HTML/JS del esquema `plugin://`.
    - Registro seguro de animaciones `.vrma`: asocia IDs lógicos (animaciones registradas por el usuario o declaradas en el manifiesto del plugin) a rutas validadas en Rust; comando IPC para leer bytes o servir `.vrma` registradas sin exponer rutas arbitrarias de disco a comandos externos.
    - Comandos IPC en `src-tauri/src/lib.rs`, `src/platform/ipc.ts` y `docs/ARCHITECTURE.md`: `list_plugins`, `list_registered_animations`, `register_animation`, `unregister_animation`, `read_registered_animation_bytes` (nombres exactos documentados en la tabla IPC).
  - `src/platform/plugins/PluginHost.ts`:
    - Carga hasta `maxWorkers = 3` plugins habilitados en `<iframe sandbox="allow-scripts" src="plugin://<id>/...">` ocultos (sin `allow-same-origin` ni acceso a `@tauri-apps/*`).
    - Puente `postMessage` con verificación de canal/plugin, `validateAvatarCommand`, filtrado estricto de permisos concedidos por el usuario y desmontaje limpio al desactivar/recargar (cancelando streams/locks asociados).
  - Activar `csp` y `devCsp` en `src-tauri/tauri.conf.json` según los strings validados en [ADR-0006](../adr/0006-plugins-and-local-ws-bridge.md) (`blob:`, `data:`, `ipc:`, `http://ipc.localhost`, `plugin:`, `'unsafe-inline'` para estilos actuales, y en `devCsp` `http://localhost:1420` + `ws://localhost:1420`).
  - Tests unitarios en Rust (path traversal, escape por symlink, manifest inválido, IDs de animación) y Vitest (`PluginHost.test.ts`: máximo 3 plugins activos, filtrado por permisos, limpieza al desactivar, resolución de animación por ID).
- **No incluye:** secciones de configuración UI en Ajustes (`T-607`), plugin de ejemplo completo (`T-608`), ni acceso `plugin-fs` desde plugins.

## Pasos sugeridos

1. Implementar `src-tauri/src/plugins.rs` con canonicalización de rutas, protocolo `plugin://` con CSP estricta, descubrimiento de manifiestos y registro de animaciones `.vrma`.
2. Registrar el esquema y comandos IPC en `src-tauri/src/lib.rs`, `src/platform/ipc.ts` y `docs/ARCHITECTURE.md`.
3. Implementar `src/platform/plugins/PluginHost.ts` + registro de animaciones en frontend conectado con `VRMAPlayer` / `AvatarController`.
4. Activar `csp` y `devCsp` en `src-tauri/tauri.conf.json` y probar manualmente con `npm run tauri dev` y `npm run tauri build -- --no-bundle` que la ventana principal (`loadAvatarModel`), `DebugOverlay`, `SettingsPanel` y `PreviewStage` funcionan sin bloqueos CSP.

## Criterios de aceptación

- [ ] Intentos de path traversal (`..`) o symlinks fuera del directorio del plugin fallan en `plugin://` y registro de animaciones.
- [ ] `PluginHost` respeta el límite de 3 plugins activos, aplica permisos por plugin y pasa todo comando por `validateAvatarCommand`.
- [ ] `{ type: "animation", vrma: "<id>" }` solo ejecuta animaciones registradas en el registro validado (rechaza rutas libres con `unknown_animation`).
- [ ] `csp` y `devCsp` activos en `src-tauri/tauri.conf.json` sin romper `loadAvatarModel` (`blob:`), `VRMAPlayer`, `PreviewStage` ni HMR (`ws://localhost:1420`).
- [ ] `npm run check` y `(cd src-tauri && cargo fmt --check && cargo clippy -- -D warnings && cargo test)` pasan en verde.

## Archivos esperados

- `src-tauri/src/plugins.rs` — crear
- `src-tauri/src/lib.rs` — registrar `register_uri_scheme_protocol("plugin", ...)` y comandos IPC
- `src-tauri/tauri.conf.json` — activar `csp` y `devCsp`
- `src/platform/ipc.ts` — wrappers IPC para plugins y registro `.vrma`
- `src/platform/plugins/PluginHost.ts` — crear
- `src/platform/plugins/PluginHost.test.ts` — crear
- `src/main.ts` — conectar `PluginHost` y resolvedor de animaciones registradas
- `docs/ARCHITECTURE.md` — actualizar tabla Contrato IPC

## Verificación

```bash
npm run check
(cd src-tauri && cargo fmt --check && cargo clippy -- -D warnings && cargo test)
```

## Handoff

_Lo llena el agente al terminar: qué quedó, decisiones tomadas, deuda, siguientes pasos, entorno probado._
