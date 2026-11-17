# T-600: Spike — arquitectura de plugins, puente WebSocket y audio en WebKitGTK

| Campo         | Valor                                                    |
| ------------- | -------------------------------------------------------- |
| Estado        | lista                                                    |
| Asignado      | —                                                        |
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

- [ ] `docs/adr/0006-plugins-and-local-ws-bridge.md` creado en estado `aceptada` con evidencia medible y enlazado en `docs/ARCHITECTURE.md`.
- [ ] `.agents/rules/plugins.md` creado con invariantes de seguridad, capas y versionado de protocolo.
- [ ] Presupuesto numérico de RAM/CPU y límites (`maxWorkers`, `maxClients`, tope de mensaje/stream) documentados en el ADR.
- [ ] Tarjetas `T-602..T-609` creadas en `docs/tasks/` y marcadas 🟦 en `docs/ROADMAP.md`.
- [ ] `npm run check` y checks de Rust (`cargo fmt --check`, `cargo clippy -- -D warnings`, `cargo test`) en verde.

## Archivos esperados

- `docs/adr/0006-plugins-and-local-ws-bridge.md` — crear
- `docs/ARCHITECTURE.md` — actualizar sección Decisiones
- `.agents/rules/plugins.md` — crear
- `docs/ROADMAP.md` — actualizar estado de `T-600..T-609`
- `docs/tasks/T-602-*.md` .. `T-609-*.md` — crear

## Verificación

```bash
npm run check
(cd src-tauri && cargo fmt --check && cargo clippy -- -D warnings && cargo test)
```

## Handoff

_Lo llena el agente al terminar: qué quedó, decisiones tomadas, deuda, siguientes pasos, entorno probado._
