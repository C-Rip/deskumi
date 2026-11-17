---
name: plugin-authoring
description: >-
  Guía rápida y verificable para agentes que creen plugins aislados (plugin://)
  o clientes WebSocket externos (127.0.0.1) para Deskumi. Usar al escribir
  ejemplos, integraciones TTS/IA o nuevos plugins bajo el contrato v: 1.
---

# Plugin & Local Bridge Authoring

> Referencia completa: [`docs/PLUGINS.md`](../../../docs/PLUGINS.md) ·
> Reglas de seguridad: [`.agents/rules/plugins.md`](../../../.agents/rules/plugins.md) ·
> Esquemas formales: [`docs/schemas/`](../../../docs/schemas/).

## 1. Elegir vía de integración

| Necesidad                                           | Vía recomendada              | Ejemplo MIT                                                                         |
| --------------------------------------------------- | ---------------------------- | ----------------------------------------------------------------------------------- |
| Comportamiento ligero sin red ni procesos externos  | Plugin aislado `plugin://`   | [`examples/plugins/hello-companion/`](../../../examples/plugins/hello-companion/)   |
| Motor TTS, RVC, LLM, CLI Python/Rust/Node o con red | Puente WebSocket `127.0.0.1` | [`examples/bridge/echo_tts_bridge.py`](../../../examples/bridge/echo_tts_bridge.py) |

**Licencias:** el núcleo de Deskumi es GPL-3.0; los ejemplos bajo `examples/`
son **MIT** ([`examples/LICENSE`](../../../examples/LICENSE)). No copies código
GPL del núcleo dentro de `examples/`.

## 2. Crear un plugin aislado (`plugin://`)

1. Carpeta: `"${XDG_DATA_HOME:-$HOME/.local/share}/dev.crivera.deskumi/plugins/<id>/"`
   (el nombre de la carpeta debe coincidir exactamente con `manifest.json` `"id"`).
2. `manifest.json` (validar contra
   [`plugin-manifest.schema.json`](../../../docs/schemas/plugin-manifest.schema.json)):
   - `id`: `^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$` sin `..`.
   - `entry`: ruta relativa `.html`/`.htm` (sin `..`, `?`, `#`, `/` inicial).
   - `permissions`: subconjunto de `avatar:speak`, `avatar:interrupt`,
     `avatar:expression`, `avatar:animation`, `avatar:lookAt`, `avatar:events`,
     `desktop:events`, `desktop:windowTitle`.
   - `animations`: opcional `[{ id, path, label? }]` apuntando a `.vrma` dentro
     del propio plugin (máx. 32 MiB por archivo, máx. 64 por plugin).
3. HTML y JS **compatibles con CSP estricta**:
   - `Content-Security-Policy: default-src 'none'; script-src plugin://<id>; worker-src 'none'; connect-src 'none'`.
   - **Prohibido** `<script>` inline, `onclick=...`, `<style>` inline, `fetch`,
     `WebSocket`, `import()` remoto, `new Worker(blob)` y `window.__TAURI__`.
   - Carga únicamente `<script src="./main.js"></script>`.
4. Contrato `postMessage` (`channel: "deskumi:plugin"`, `v: 1`):
   - Valida `event.source === window.parent && event.data?.channel === "deskumi:plugin" && event.data?.v === 1`.
   - Al recibir `type === "init"`, lee `scopes`, `expressions`, `animations` y
     envía `hello` con `events: [...]` deseados.
   - Escucha `type === "permissionsChanged"` para actualizar `scopes` en vivo.
   - Envía comandos como `{ channel: "deskumi:plugin", pluginId, v: 1, id, cmd }`
     respetando [`avatar-command.schema.json`](../../../docs/schemas/avatar-command.schema.json).

## 3. Crear un cliente WebSocket local (`127.0.0.1`)

1. Lee `$XDG_RUNTIME_DIR/deskumi/bridge.json` (fallback `$APPDATA` /
   `$XDG_DATA_HOME` / `$HOME/.local/share`) → `{ version: 1, pid, port, token }`.
2. Abre `ws://127.0.0.1:<port>` **sin cabecera `Origin`** (los navegadores la
   envían siempre y son rechazados con `403`).
3. En **≤ 2 s**, envía el primer frame JSON:
   `{ "v": 1, "id": "h1", "cmd": { "type": "hello", "token": "<token>", "events": [...] } }`.
4. Para audio PCM en tiempo real, envía `speakStart` (JSON) → chunks binarios
   `DSK1` (`>4sBBHI` Big-Endian: `b"DSK1"`, `kind=1`, `flags=0`,
   `len(streamId)`, `sampleRate` `0` o `8000..48000`, `streamId`, `pcm`) →
   `speakEnd` (JSON). Nunca uses `audio.url` (rechazado en v1).
5. Respeta los topes y maneja errores (`rate_limited`, `too_large`, `busy`,
   `hidden`, `forbidden`, `unknown_expression`, `unknown_animation`):
   - `30 cmd/s` control · `~512 KB/s` PCM binario · `5 MB` máx. por mensaje WS ·
     `10 MB` buffer por stream (timeout `5 s`) · `8` ítems en cola de habla ·
     `500` chars en `text` · `256` keyframes en `visemes`.
6. Para `windowFocus`, recuerda que `desktop:events` entrega solo `appId`;
   `title` solo llega si el usuario habilitó explícitamente `desktop:windowTitle`.
