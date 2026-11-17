# T-605: Puente WebSocket local (`local_bridge.rs`, `BridgeClient.ts` y ejemplo Python)

| Campo         | Valor                                                |
| ------------- | ---------------------------------------------------- |
| Estado        | lista                                                |
| Asignado      | —                                                    |
| Fase          | F6                                                   |
| Rama          | `feat/T-605-local-ws-bridge`                         |
| Depende de    | T-602                                                |
| Estimación    | L (≤ 2.5 días)                                       |
| Skills útiles | `task-workflow`, `git-workflow`, `rust-tauri`, `adr` |

## Objetivo

Implementar el servidor WebSocket local en Rust (`src-tauri/src/local_bridge.rs`) y su cliente en el WebView (`src/platform/bridge/BridgeClient.ts`) usando `tauri::ipc::Channel` con frames binarios para audio PCM, habilitando integraciones locales de IA/LLM y motores TTS/VC externos bajo el modelo de seguridad de ADR-0006.

## Contexto

- [ADR-0006](../adr/0006-plugins-and-local-ws-bridge.md): Evidencia de dependencias (`tokio` `net/time/rt/sync/macros`, `tokio-tungstenite` `default-features = false, features = ["handshake"]`, `getrandom`), transporte `Channel<InvokeResponseBody>` (`Raw` vs `Json`), política anti-CSWSH (`Origin`), `bridge.json` atómico `0600` y modelo de amenazas de token único.
- [`.agents/rules/plugins.md`](../../.agents/rules/plugins.md) y [`.agents/rules/rust-tauri.md`](../../.agents/rules/rust-tauri.md).
- [docs/ARCHITECTURE.md](../ARCHITECTURE.md#contrato-ipc): Contrato IPC a ampliar en el mismo PR.

## Alcance

- Incluye:
  - Añadir a `src-tauri/Cargo.toml`: `tokio = { version = "1", features = ["net", "time", "rt", "sync", "macros"] }`, `tokio-tungstenite = { version = "0.30", default-features = false, features = ["handshake"] }`, `getrandom = "0.4"`.
  - `src-tauri/src/local_bridge.rs`:
    - Listener exclusivo en `127.0.0.1:0` controlado por toggle (apagado = 0 tareas, 0 sockets, 0 MB overhead).
    - Rechazo estricto en `accept_hdr_async` de cualquier handshake HTTP que contenga cabecera `Origin` (protección anti-CSWSH).
    - Timeouts cortos para handshake HTTP (≤ 2 s) y primer mensaje `hello` con `token` (≤ 2 s); comparación de token en tiempo constante; token de 256 bits vía `getrandom::fill`.
    - Archivo `bridge.json` escrito de forma atómica (`create_new` + modo `0600` Unix + `rename`) en `$XDG_RUNTIME_DIR/deskumi/bridge.json` (fallback `$APPDATA/deskumi/bridge.json`) con `{ "version": 1, "pid", "port", "token" }`; borrado limpio en `RunEvent::Exit`.
    - Límites de ADR-0006: `maxClients = 4`, mensaje máximo `5 MB`, rate limit por cliente (`30 cmd/s` para control JSON + tope de bytes/s para tramas binarias PCM), y asignación de `clientId` para aislar propiedad de `streamId` y cancelar streams activos al desconectarse.
    - Protocolo binario WS para `speakChunk` (cabecera corta binaria con `streamId` + PCM) reenviado al WebView mediante `Channel<InvokeResponseBody>` (`InvokeResponseBody::Raw`), y mensajes JSON de control mediante `InvokeResponseBody::Json`.
  - Comandos IPC en `src-tauri/src/lib.rs`, `src/platform/ipc.ts` y tabla de `docs/ARCHITECTURE.md`: `start_local_bridge`, `stop_local_bridge`, `get_bridge_status`, `regenerate_bridge_token`, `subscribe_bridge_inbound`, `send_bridge_event`.
  - `src/platform/bridge/BridgeClient.ts`: valida mensajes entrantes con `validateAvatarCommand`, filtra por scopes activos, despacha hacia `AvatarController` y devuelve `ack` / `error` y `AvatarEvent` filtrados por suscripción de cada cliente.
  - Tests unitarios e integración en Rust (handshake con `Origin` rechazado, token inválido, timeout de `hello`, exceso de conexiones, trama > 5 MB, JSON malformado, desconexión a mitad de stream) y Vitest (`BridgeClient.test.ts`).
  - Cliente de ejemplo mínimo en Python (`examples/bridge/echo_tts_bridge.py`) + `examples/LICENSE` (MIT) si no existe aún.
- **No incluye:** UI en Ajustes (`T-607`), extensión D-Bus de `windowFocus` (`T-609`), ni TLS (solo loopback `127.0.0.1`).

## Pasos sugeridos

1. Añadir las dependencias en `src-tauri/Cargo.toml` y justificar en el PR citando ADR-0006.
2. Implementar `src-tauri/src/local_bridge.rs` con pruebas TCP/WebSocket reales sobre `127.0.0.1:0` cubriendo todos los casos adversos.
3. Registrar comandos IPC en `src-tauri/src/lib.rs`, envolver en `src/platform/ipc.ts` y actualizar `docs/ARCHITECTURE.md`.
4. Implementar `src/platform/bridge/BridgeClient.ts` y conectarlo en `src/main.ts`.
5. Añadir `examples/bridge/echo_tts_bridge.py` leyendo `$XDG_RUNTIME_DIR/deskumi/bridge.json` y enviando `hello` + `say` / `speakStart` + chunks binarios + `speakEnd`.

## Criterios de aceptación

- [ ] Con puente desactivado, no se abre socket ni se lanzan tareas Tokio de escucha (0 overhead).
- [ ] Handshake con cabecera `Origin` es rechazado; token incorrecto o `hello` expirado (> 2 s) cierra la conexión; comparación en tiempo constante.
- [ ] `bridge.json` se crea atómicamente con modo `0600` en `$XDG_RUNTIME_DIR/deskumi/bridge.json` y se elimina en `RunEvent::Exit`.
- [ ] Chunks binarios PCM viajan por `tauri::ipc::Channel` (`InvokeResponseBody::Raw`) sin `eval()` ni codificación base64.
- [ ] Desconectar un cliente WS limpia sus streams en curso y libera locks.
- [ ] `npm run check` y `(cd src-tauri && cargo fmt --check && cargo clippy -- -D warnings && cargo test)` pasan en verde.

## Archivos esperados

- `src-tauri/Cargo.toml` y `src-tauri/Cargo.lock` — modificar
- `src-tauri/src/local_bridge.rs` — crear
- `src-tauri/src/lib.rs` — registrar estado, comandos IPC y limpieza en `RunEvent::Exit`
- `src/platform/ipc.ts` — añadir wrappers IPC y `Channel` del puente
- `src/platform/bridge/BridgeClient.ts` — crear
- `src/platform/bridge/BridgeClient.test.ts` — crear
- `src/main.ts` — conectar `BridgeClient`
- `docs/ARCHITECTURE.md` — actualizar tabla Contrato IPC
- `examples/bridge/echo_tts_bridge.py` (y `examples/LICENSE` MIT) — crear

## Verificación

```bash
npm run check
(cd src-tauri && cargo fmt --check && cargo clippy -- -D warnings && cargo test)
```

## Handoff

_Lo llena el agente al terminar: qué quedó, decisiones tomadas, deuda, siguientes pasos, entorno probado._
