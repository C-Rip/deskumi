# T-605: Puente WebSocket local (`local_bridge.rs`, `BridgeClient.ts` y ejemplo Python)

| Campo         | Valor                                                |
| ------------- | ---------------------------------------------------- |
| Estado        | hecha                                                |
| Asignado      | subagent-T-605                                       |
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

- [x] Con puente desactivado, no se abre socket ni se lanzan tareas Tokio de escucha (0 overhead).
- [x] Handshake con cabecera `Origin` es rechazado; token incorrecto o `hello` expirado (> 2 s) cierra la conexión; comparación en tiempo constante.
- [x] `bridge.json` se crea atómicamente con modo `0600` en `$XDG_RUNTIME_DIR/deskumi/bridge.json` y se elimina en `RunEvent::Exit`.
- [x] Chunks binarios PCM viajan por `tauri::ipc::Channel` (`InvokeResponseBody::Raw`) sin `eval()` ni codificación base64.
- [x] Desconectar un cliente WS limpia sus streams en curso y libera locks.
- [x] `npm run check` y `(cd src-tauri && cargo fmt --check && cargo clippy -- -D warnings && cargo test)` pasan en verde.

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

- **Qué se hizo:**
  - Dependencias añadidas en [`src-tauri/Cargo.toml`](../../src-tauri/Cargo.toml) (`tokio` `net/time/rt/sync/macros`, `tokio-tungstenite` `0.30` sin TLS con `handshake`, `getrandom` `0.4`, y `futures-util` `0.3` con `default-features = false, features = ["sink", "std"]` — ya presente en `Cargo.lock` vía `tokio-tungstenite`, necesario para `StreamExt`/`SinkExt` sobre `WebSocketStream`).
  - Servidor WebSocket loopback en [`src-tauri/src/local_bridge.rs`](../../src-tauri/src/local_bridge.rs) (`127.0.0.1:0`, apagado por defecto con 0 tareas/sockets, rechazo HTTP `403` ante cabecera `Origin` en `accept_hdr_async_with_config`, timeouts ≤ 2 s para handshake HTTP y `hello`, token de 256 bits vía `getrandom::fill` comparado en tiempo constante, `bridge.json` atómico `0600` en directorio `0700`, límites `maxClients = 4`, 5 MB por mensaje, token buckets de `30 cmd/s` + `~512 KB/s` PCM binario, reenvío binario `DSK1` por `tauri::ipc::Channel<InvokeResponseBody>` y limpieza en `RunEvent::Exit` en [`src-tauri/src/lib.rs`](../../src-tauri/src/lib.rs)).
  - Wrappers IPC en [`src/platform/ipc.ts`](../../src/platform/ipc.ts), tabla actualizada en [`docs/ARCHITECTURE.md`](../ARCHITECTURE.md#contrato-ipc), decodificador/filtros en [`src/platform/bridge/BridgeProtocol.ts`](../../src/platform/bridge/BridgeProtocol.ts), cliente [`src/platform/bridge/BridgeClient.ts`](../../src/platform/bridge/BridgeClient.ts) y tests en [`src/platform/bridge/BridgeClient.test.ts`](../../src/platform/bridge/BridgeClient.test.ts).
  - Cliente Python mínimo sin dependencias externas en [`examples/bridge/echo_tts_bridge.py`](../../examples/bridge/echo_tts_bridge.py) bajo [`examples/LICENSE`](../../examples/LICENSE) (MIT).
- **Decisiones tomadas:**
  - Se usó cabecera binaria `DSK1` de 12 bytes en WS (`streamId` + `sampleRate` + PCM) transformada en Rust a cabecera de 14 bytes con `clientId` asignado por el servidor para `InvokeResponseBody::Raw`, evitando spoofing de `clientId` y sin `ack` por cada chunk binario exitoso (solo `error` si falla).
  - `regenerate_bridge_token` rota el token atómicamente en `bridge.json` y desconecta clientes autenticados con el token anterior para que la revocación sea efectiva.
  - `src/main.ts` y `src-tauri/tauri.conf.json` se dejaron intactos para la integración de Ola 3 (`T-607`/coordinador).
- **Siguientes pasos:**
  - En Ola 3 (`T-607` / integración `main.ts`), instanciar `BridgeClient`, suscribirlo al arranque y sincronizar `startLocalBridge`/`stopLocalBridge` y `setGrantedScopes` con `AppConfig`.
- **Entorno y verificación:**
  - Verificado en Linux mediante `npm run check` y `(cd src-tauri && cargo fmt --check && cargo clippy -- -D warnings && cargo test)` (todos los tests Rust TCP/WS y Vitest en verde). No se ejecutó prueba interactiva GUI (`npm run tauri dev`) en esta sesión headless de subagente.
