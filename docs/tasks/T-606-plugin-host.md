# T-606: Host de plugins (`plugins.rs` `plugin://`, `PluginHost`, registro `.vrma` y `csp`/`devCsp`)

| Campo         | Valor                                                                    |
| ------------- | ------------------------------------------------------------------------ |
| Estado        | en revisión                                                              |
| Asignado      | subagent-T-606                                                           |
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

- [x] Intentos de path traversal (`..`) o symlinks fuera del directorio del plugin fallan en `plugin://` y registro de animaciones.
- [x] `PluginHost` respeta el límite de 3 plugins activos, aplica permisos por plugin y pasa todo comando por `validateAvatarCommand`.
- [x] `{ type: "animation", vrma: "<id>" }` solo ejecuta animaciones registradas en el registro validado (rechaza rutas libres con `unknown_animation`).
- [ ] `csp` y `devCsp` activos en `src-tauri/tauri.conf.json` sin romper `loadAvatarModel` (`blob:`), `VRMAPlayer`, `PreviewStage` ni HMR (`ws://localhost:1420`). _(Strings exactos de ADR-0006 activados y `npm run build` verde; pendiente verificación visual en `npm run tauri dev` junto con la integración en `src/main.ts` en Wave 3.)_
- [x] `npm run check` y `(cd src-tauri && cargo fmt --check && cargo clippy -- -D warnings && cargo test)` pasan en verde.

## Archivos esperados

- `src-tauri/src/plugins.rs` — creado
- `src-tauri/src/error.rs` — variante `AppError::Plugin`
- `src-tauri/src/lib.rs` — registrado `register_uri_scheme_protocol("plugin", ...)`, `PluginState` y comandos IPC
- `src-tauri/tauri.conf.json` — activados `csp` y `devCsp`
- `src/platform/ipc.ts` — wrappers IPC para plugins y registro `.vrma`
- `src/platform/plugins/PluginHost.ts` — creado (+ `PluginHostTypes.ts`, `PluginHostBridge.ts`, `RegisteredAnimationResolver.ts`)
- `src/platform/plugins/PluginHost.test.ts` — creado (+ `PluginHostBridge.test.ts`, `RegisteredAnimationResolver.test.ts`)
- `src/main.ts` — _(fuera de este PR; se conecta en Wave 3)_
- `docs/ARCHITECTURE.md` — actualizada tabla Contrato IPC

## Verificación

```bash
npm run check
(cd src-tauri && cargo fmt --check && cargo clippy -- -D warnings && cargo test)
```

## Handoff

- **Qué se hizo:**
  - `src-tauri/src/plugins.rs` y `src-tauri/src/error.rs`: descubrimiento/validación de manifiestos en `$APPDATA/plugins/<pluginId>/manifest.json`, esquema custom `plugin://<pluginId>/<path>` con `canonicalize()` + verificación estricta de prefijo (bloquea `..`, `%2e%2e`, `%00`, `\\`, `:` y symlinks salientes), cabecera `Content-Security-Policy: default-src 'none'; script-src plugin://<pluginId>; worker-src 'none'; connect-src 'none'` + `X-Content-Type-Options: nosniff` + `Cache-Control: no-store`, registro seguro `.vrma` sin exponer rutas de disco (`list_plugins`, `list_registered_animations`, `register_animation`, `unregister_animation`, `read_registered_animation_bytes` vía `tauri::ipc::Response` binario) y 7 tests unitarios en Rust.
  - `src-tauri/src/lib.rs`, `src/platform/ipc.ts` y `docs/ARCHITECTURE.md`: registro de `PluginState`, `register_uri_scheme_protocol("plugin", ...)`, los 5 comandos IPC, sus wrappers TS y documentación en Contrato IPC.
  - `src-tauri/tauri.conf.json`: activados `csp` y `devCsp` literales validados en ADR-0006.
  - `src/platform/plugins/`: `PluginHost.ts`, `PluginHostTypes.ts`, `PluginHostBridge.ts` y `RegisteredAnimationResolver.ts` (todos ≤ 276 líneas), montando hasta `maxWorkers = 3` plugins en `<iframe sandbox="allow-scripts">` ocultos, verificando `origin === "null"` / `event.source` / canal `deskumi:plugin` / `pluginId`, rate limit (30 cmd/s), `validateAvatarCommand`, filtrado estricto de permisos (`manifest ∩ user`), redacción de `windowFocus.title` sin `desktop:windowTitle`, limpieza de streams/locks vía `AvatarController.cancelByOwner` al desmontar/recargar y resolución de `.vrma` registradas hacia `AvatarController` y `VRMAPlayer`.
  - Tests Vitest en `PluginHost.test.ts`, `PluginHostBridge.test.ts` y `RegisteredAnimationResolver.test.ts`.
- **Decisiones tomadas:**
  - `read_registered_animation_bytes` devuelve `tauri::ipc::Response::new(bytes)` (`ArrayBuffer` directo en IPC) para evitar overhead JSON en binarios `.vrma`, y re-canonicaliza/re-valida el archivo en cada lectura contra escapes por symlink.
  - El código de `PluginHost` se dividió en `PluginHostTypes.ts`, `PluginHostBridge.ts`, `RegisteredAnimationResolver.ts` y `PluginHost.ts` para mantener todos los archivos TS ≤ ~290 líneas.
- **Entorno probado / verificación automática:**
  - `npm run check` (`tsc --noEmit`, `eslint .`, `prettier --check .`, `vitest run`) y `npm run build` en verde; `(cd src-tauri && cargo fmt --check && cargo clippy -- -D warnings && cargo test)` en verde.
- **Siguientes pasos (Wave 3 / T-607):**
  - Conectar `PluginHost` y `RegisteredAnimationResolver` en `src/main.ts` junto con `store.ts` y el flujo de ajustes (`T-607`), y ejecutar la pasada manual en `npm run tauri dev` para marcar el criterio de `csp`/`devCsp` sobre la app integrada.
