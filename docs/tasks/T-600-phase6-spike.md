# T-600: Spike — arquitectura de plugins, puente WebSocket y audio en WebKitGTK

| Campo         | Valor                                                    |
| ------------- | -------------------------------------------------------- |
| Estado        | hecha                                                    |
| Asignado      | @crivera + antigravity                                   |
| Fase          | F6                                                       |
| Rama          | `spike/T-600-phase6-risks`                               |
| Depende de    | —                                                        |
| Estimación    | M (≤ 1 día)                                              |
| Skills útiles | `task-workflow`, `adr`, `rust-tauri`, `frontend-threejs` |

## Objetivo

Validar empíricamente las incógnitas técnicas que condicionan el diseño de Fase 6 y cerrar [ADR-0006](../adr/0006-plugins-and-local-ws-bridge.md) + [`.agents/rules/plugins.md`](../../.agents/rules/plugins.md) antes de implementar `T-602..T-609`.

## Contexto

Revisiones técnicas [phase-6-plan-v3-review.md](../plans/phase-6-plan-v3-review.md) y [phase-6-plan-v4-review.md](../plans/phase-6-plan-v4-review.md).

## Alcance

- Incluye:
  - Verificar registro y CSP de esquema propio `plugin://` (`register_uri_scheme_protocol`) en WebKitGTK (¿el Worker respeta `Content-Security-Policy: default-src 'none'` y bloquea `fetch`, `import()` remoto y `new Worker`?).
  - Verificar firma y funcionamiento de `tauri::ipc::Channel` con cuerpo binario (`InvokeResponseBody::Raw`) en `tauri 2.12.5`.
  - Verificar `AudioContext` en frío (22050 Hz / 48000 Hz, política de autoplay con `wry 0.57.2`, y `suspend()` tras inactividad).
  - Definir `csp` y `devCsp` candidatas para `src-tauri/tauri.conf.json` sin romper `loadAvatarModel` (`blob:`), `PreviewStage` ni HMR (`ws://localhost:1420`).
  - Evaluar impacto en binario y `Cargo.toml` de añadir `tokio` (`net`, `time`, `rt`, `sync`, `macros`), `tokio-tungstenite` (`default-features = false`) y `getrandom`.
  - Fijar reparto numérico del margen de ~40 MB RAM (máx. workers activos, límites de cola/stream).
  - Redactar `docs/adr/0006-plugins-and-local-ws-bridge.md` (estado `aceptada`), `.agents/rules/plugins.md`, y crear las tarjetas `T-602..T-609` en `docs/tasks/` + marcar 🟦 en `docs/ROADMAP.md`.
- **No incluye:** implementación productiva del servidor WS (`T-605`), del `PluginHost` (`T-606`) ni del refactor de `main.ts` (`T-601`). El código exploratorio del spike no debe quedar en `dev` salvo documentación/ADR/reglas/tarjetas.

## Pasos sugeridos

1. Inspeccionar APIs instaladas en `~/.cargo/registry/src/` (`tauri 2.12.5`, `wry 0.57.2`, `tokio`) para `register_uri_scheme_protocol` y `tauri::ipc::Channel`.
2. Probar temporalmente (y medir) `tokio-tungstenite` (`default-features = false`) y el delta de tamaño de binario en release/debug y dependencias Linux.
3. Verificar en E1 (Fedora 44 GNOME) comportamiento de CSP en Worker `plugin://` vs `iframe sandbox`, `AudioContext` a 22050 Hz y coste de RAM por Worker.
4. Documentar hallazgos y decisiones en `docs/adr/0006-plugins-and-local-ws-bridge.md` y enlazar desde `docs/ARCHITECTURE.md`.
5. Crear `.agents/rules/plugins.md` y las tarjetas `T-602..T-609` con sus criterios verificables.

## Criterios de aceptación

- [x] `docs/adr/0006-plugins-and-local-ws-bridge.md` creado en estado `aceptada` con evidencia medible y enlazado en `docs/ARCHITECTURE.md`.
- [x] `.agents/rules/plugins.md` creado con invariantes de seguridad, capas y versionado de protocolo.
- [x] Presupuesto numérico de RAM/CPU y límites (`maxWorkers`, `maxClients`, tope de mensaje/stream) documentados en el ADR.
- [x] Tarjetas `T-602..T-609` creadas en `docs/tasks/` y marcadas 🟦 en `docs/ROADMAP.md`.
- [x] `npm run check` y checks de Rust (`cargo fmt --check`, `cargo clippy -- -D warnings`, `cargo test`) en verde.

## Archivos esperados

- `docs/adr/0006-plugins-and-local-ws-bridge.md` — crear
- `docs/ARCHITECTURE.md` — actualizar sección Decisiones
- `.agents/rules/plugins.md` — crear
- `docs/LIMITATIONS.md` — añadir `L-05` y `L-06`
- `docs/ROADMAP.md` — actualizar estado de `T-600..T-609`
- `docs/tasks/T-602-*.md` .. `T-609-*.md` — crear

## Verificación

```bash
npm run check
(cd src-tauri && cargo fmt --check && cargo clippy -- -D warnings && cargo test)
```

## Handoff

- **Hallazgos empíricos clave (E1 — Fedora 44 Workstation, GNOME Wayland + XWayland, WebKitGTK 2.54.2, Tauri 2.12.5, wry 0.57.2):**
  - **Aislamiento de plugins:** `new Worker("plugin://...")` desde `tauri://localhost` falla por Same-Origin Policy en WebKitGTK 2.54.2 antes de invocar el protocolo en Rust, y los `blob:` Workers del documento principal heredan `connect-src ipc:` (`fetch("ipc://localhost/...")` alcanzó el handler IPC). Se adopta `<iframe sandbox="allow-scripts" src="plugin://<id>/sandbox.html">` con `Content-Security-Policy: default-src 'none'; script-src plugin://<id>; worker-src 'none'; connect-src 'none'` (verificado: origen `"null"`, `fetch`/`WebSocket`/`import()`/`Worker` anidado/acceso a `__TAURI__` bloqueados con 0 hits TCP y ~5.4 MB RSS total para 3 iframes).
  - **`Channel` binario:** `tauri::ipc::Channel<InvokeResponseBody>` entrega `InvokeResponseBody::Raw` (`4410` bytes y `512` bytes) como `ArrayBuffer` ordenado en ~13 ms sin `eval()` de arrays base64 ni JSON para audio.
  - **`AudioContext` en frío:** aunque `wry 0.57.2` usa `autoplay: true`, `new AudioContext()` arranca en `"suspended"` en WebKitGTK 2.54.2 sin gesto previo, pero `await ctx.resume()` transiciona a `"running"` y reproduce `AudioBuffer` a 22050 Hz (`onended` a 0.16–0.19 s). `AudioOutput` usará creación perezosa, `resume()` explícito y `suspend()` tras inactividad.
  - **CSP / devCsp:** validadas sobre `index.html` (`VRM1_Constraint_Twist_Sample.vrm`) y `settings.html` (`SettingsPanel` + `PreviewStage`) sin regresiones.
  - **Delta de binario Rust (release LTO stripped):** `7,613,064` → `7,762,960` bytes (**+149,896 bytes / ~146.4 KiB**) añadiendo `tokio` (`net`, `time`, `rt`, `sync`, `macros`), `tokio-tungstenite 0.30` (`default-features = false, features = ["handshake"]`, requerido por `accept_hdr_async`) y `getrandom 0.4`.
- **Entregables creados/actualizados:**
  - `docs/adr/0006-plugins-and-local-ws-bridge.md` (estado `aceptada`).
  - `docs/ARCHITECTURE.md` (enlace a ADR-0006 en Decisiones).
  - `.agents/rules/plugins.md` (guardrails de seguridad y capas para `src/platform/plugins/**`, `src/platform/bridge/**`, `src-tauri/src/plugins.rs`, `src-tauri/src/local_bridge.rs`).
  - `docs/LIMITATIONS.md` (`L-05` alcance `$HOME/**` en `capabilities/default.json` y `L-06` alcance Linux-first F6).
  - `docs/tasks/T-602-avatar-controller.md` .. `T-609-cursor-bridge-window-focus.md` + actualización de `docs/ROADMAP.md` (`T-600` ✅, `T-602..T-609` 🟦).
- **Siguientes pasos:** Una vez mergeados `T-600` y `T-601`, iniciar `T-602` (`feat/T-602-avatar-controller`) y luego paralelizar `T-603`, `T-604`, `T-605` y `T-606`.
