---
trigger: model_decision
description: Convenciones y guardrails de seguridad para plugins aislados y puente WebSocket local. Aplicar al crear o editar archivos en src/platform/plugins/**, src/platform/bridge/**, src-tauri/src/plugins.rs o src-tauri/src/local_bridge.rs.
---

# Reglas: Plugins y Puente WebSocket Local

> Complementa a [`.agents/rules/frontend-threejs.md`](frontend-threejs.md) y [`.agents/rules/rust-tauri.md`](rust-tauri.md). Decisión arquitectónica en [`docs/adr/0006-plugins-and-local-ws-bridge.md`](../../docs/adr/0006-plugins-and-local-ws-bridge.md).

## Alcance

Aplica a `src/platform/plugins/**`, `src/platform/bridge/**`, `src-tauri/src/plugins.rs`, `src-tauri/src/local_bridge.rs` y cualquier adaptador que conecte comandos externos con `AvatarController`.

## Aislamiento de plugins (`plugin://` + `<iframe sandbox="allow-scripts">`)

- **Prohibido ejecutar código de plugins en `blob:` Workers creados desde `tauri://localhost`** (o `http://localhost:1420` en dev): en WebKitGTK heredan `connect-src ipc:` del documento creador y alcanzan `ipc://localhost/...`.
- Todo plugin se sirve desde el esquema propio `plugin://<pluginId>/...` registrado en `src-tauri/src/plugins.rs` con cabecera explícita:
  `Content-Security-Policy: default-src 'none'; script-src plugin://<pluginId>; worker-src 'none'; connect-src 'none'`
  y se monta dentro de `<iframe sandbox="allow-scripts" src="plugin://<pluginId>/...">` (sin `allow-same-origin`).
- Validar y canonicalizar toda ruta en Rust (`canonicalize` + comprobación estricta de prefijo dentro del directorio raíz del plugin), rechazando `..`, bytes nulos y symlinks que escapen del directorio del plugin.
- **Cero APIs privilegiadas en plugins:** nunca exponer `@tauri-apps/*`, `window.__TAURI__`, `window.__TAURI_INTERNALS__`, `plugin-fs` ni `invoke` directo al sandbox del plugin. Toda interacción pasa por `postMessage` hacia `PluginHost`, que verifica los permisos declarados en `manifest.json` y aprobados por el usuario.

## Puente WebSocket local (`src-tauri/src/local_bridge.rs`)

- **Solo loopback (`127.0.0.1:0`):** prohibido escuchar en `0.0.0.0`, `::` o interfaces externas. Sin TLS (`tokio-tungstenite` con `default-features = false, features = ["handshake"]`).
- **Anti-CSWSH obligatorio:** rechazar durante el handshake HTTP cualquier solicitud que incluya cabecera `Origin` (los navegadores la envían siempre; clientes CLI/Python/Rust no).
- **Autenticación y timeouts:** token CSPRNG de 256 bits (`getrandom`), comparado en tiempo constante (`hello` dentro de ≤ 2 s, además de timeout en handshake HTTP).
- **Archivo `bridge.json` seguro:** escritura atómica (`create_new` con modo `0600` en Unix + `rename`) en `$XDG_RUNTIME_DIR/deskumi/bridge.json` (fallback `$APPDATA/deskumi/bridge.json`), incluyendo `{ "version": 1, "pid", "port", "token" }`. Eliminarlo en `RunEvent::Exit`.
- **Transporte Rust → WebView sin `eval()` de audio:** usar `tauri::ipc::Channel<InvokeResponseBody>` con `InvokeResponseBody::Raw` para tramas PCM binarias (evita base64 y `eval()` en el hilo de render) e `invoke` solo para `AvatarEvent` salientes.
- **Limpieza de propiedad por cliente:** cada `streamId` pertenece al cliente que lo abrió; desconectar un cliente o superar el timeout de inactividad (5 s) cancela sus streams y libera locks en `PowerSaveController`.

## Protocolo versionado y validación estricta

- Todo sobre entrante incluye versión explícita `v: 1` (e `id?: string` opcional de correlación); responder siempre `ack` o `error` con código cerrado (`invalid`, `rate_limited`, `too_large`, `forbidden`, `busy`, `hidden`, `unknown_expression`, `unknown_animation`).
- **Validación estricta obligatoria:** todo comando procedente de plugins o WS pasa por `validateAvatarCommand` antes de tocar `AvatarController`. Rechazar fuera de rango o no permitido; **nunca recortar en silencio**.
- **Sin rutas arbitrarias ni fetches externos:** `animation.vrma` acepta solo IDs registrados en el registro de animaciones; `audio: { url }` no existe en v1.
- Respetar los topes numéricos de ADR-0006 (máx. 3 plugins activos, máx. 4 clientes WS, máx. 5 MB por mensaje WS, máx. 8 ítems en cola de habla, máx. 10 MB por buffer de stream, 30 cmd/s de control y tope de bytes/s para PCM).
