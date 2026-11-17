# Notas de revisión — Plan v3 (Fase 6: Plugins, Puente WebSocket e IA/Voz)

Revisión técnica del **Plan v3** contrastada contra la arquitectura y el código actual de Deskumi.

---

## Resumen general

El Plan v3 tiene una base sólida:

- Empieza con un _spike_ (`T-600`) para despejar los mayores riesgos de plataforma antes de comprometer arquitectura.
- Respeta la separación de capas entre `src/engine/` (lógica pura y Three.js sin red ni DOM/Tauri) y `src/platform/`.
- Evita problemas legales con licencias de bancos de voz (Piapro / Twin Drill) delegando los motores TTS/VC a procesos externos conectados por loopback.
- Modela adecuadamente la realidad de los motores de voz locales combinando audio completo + streaming PCM y pista explícita de visemas + fallback por amplitud.

A continuación se detallan los ajustes recomendados antes de pasar a las tarjetas `T-6xx`.

---

## 1. Riesgos críticos frente al código actual (`T-600`, `T-601`, `T-605`)

### 1.1 CSP en `tauri.conf.json`, carga de `.vrm` y herencia en Workers

- **Estado actual:** `csp` está en `null` en [`src-tauri/tauri.conf.json`](../../src-tauri/tauri.conf.json), y [`loadAvatarModel`](../../src/platform/avatar-picker.ts) carga avatares locales leyendo bytes vía `plugin-fs`, creando un `URL.createObjectURL(blob)` y pasando esa URL `blob:` a `GLTFLoader`.
- **Riesgo 1 (regresión de carga):** Una CSP restrictiva que olvide `blob:` y `data:` en `connect-src` e `img-src` (para texturas embebidas de GLTF/VRM), o los orígenes internos de IPC de Tauri v2 (`ipc:` / `http://ipc.localhost`), romperá la carga de avatares tanto en la ventana principal como en `PreviewStage` de Ajustes.
- **Riesgo 2 (fuga de red en `Blob` Workers):** Un `Worker` creado desde `blob:` hereda la CSP del documento creador. Como la ventana principal necesitará `connect-src http://127.0.0.1:*` para reproducir URLs locales en `speak`, cualquier Worker heredaría ese permiso y podría hacer `fetch("http://127.0.0.1:...")` ignorando los permisos de su `manifest.json`.
- **Recomendación:**
  1. En el _bootstrap_ del Worker (antes de evaluar el script del plugin), anular y congelar en `self` las APIs de red directas (`fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `importScripts`), forzando que toda comunicación pase por `postMessage` hacia `PluginHost`, donde se valida el manifiesto.
  2. Incluir en `T-600` la verificación explícita de que la CSP propuesta no rompe `loadAvatarModel` ni la ventana de Ajustes.

### 1.2 Política de Autoplay de `AudioContext` en ventana _click-through_

- **Estado actual:** La ventana principal es transparente y _click-through_ fuera de la silueta; cuando arranca con `autostart`, puede pasar largo tiempo sin recibir ningún gesto de usuario en el DOM.
- **Riesgo:** Si llega un `speak` o `speakStart` por WebSocket en frío (sin clic previo sobre el avatar), WebKitGTK y WebView2 suelen mantener `AudioContext.state === "suspended"` y el audio no se reproducirá.
- **Recomendación:** Probar en `T-600` la reproducción de audio recién iniciada la aplicación sin interactuar con la ventana. Contemplar desactivar el requisito de gesto de usuario en el WebView (`WebKitSettings::set_media_playback_requires_user_gesture(false)` en Linux/GTK y `--autoplay-policy=no-user-gesture-required` en Windows/WebView2).

### 1.3 `PowerSaveController` reducirá el render a 10 FPS a mitad del habla

- **Estado actual:** [`PowerSaveController`](../../src/engine/PowerSaveController.ts) baja `sceneManager.fpsCap` a `idleFps = 10` tras `15_000 ms` sin eventos DOM locales (`mousemove`, `mousedown`, `keydown`, `touchstart`, `wheel`).
- **Riesgo:** Si el usuario conversa o trabaja en otra ventana, Deskumi estará a 10 FPS (1 frame cada 100 ms). Las moras/visemas de VOICEVOX o sherpa-onnx duran ~50–90 ms, por lo que el lip-sync perderá sílabas enteras y se verá entrecortado.
- **Recomendación:**
  1. Añadir en `PowerSaveController` un mecanismo de _wake lock_ por actividad externa (p. ej. `acquireActiveLock(token)` / `releaseActiveLock(token)`) para sostener `activeFps` mientras exista habla en curso, animaciones comandadas o reacciones activas, regresando a `10 FPS` (`< 3 % CPU`) en cuanto terminen.
  2. Definir el comportamiento cuando la ventana está oculta desde el tray (`!powerSaveController.isWindowVisible`): descartar (`drop`) o cancelar el habla para evitar reproducir audio "fantasma" sin avatar visible.

---

## 2. Mejoras al contrato `AvatarCommand` / `AvatarEvent` y animación VRM

### 2.1 Rate limit (30 cmd/s) frente a frecuencia real de `speakChunk`

- **Problema:** Motores en streaming como Piper (`--output-raw`) o RVC suelen emitir tramas cada 20 ms (**50 chunks/s**). Un _rate limit_ uniforme de 30 comandos/s cortará el stream de voz.
- **Recomendación:**
  - Documentar un tamaño mínimo recomendado de chunk en cliente (p. ej. 80–100 ms, ~10–12 chunks/s), **y/o**
  - Separar el _rate limit_: 30 cmd/s para comandos de control y un límite por bytes/segundo para `speakChunk` (o tramas binarias en el WebSocket asociadas a `streamId`).

### 2.2 Correlación de IDs, tiempos de visemas y limpieza de streams colgados

- **`id` opcional en `speak`:** Permitir `id?: string` en `speak` para que el cliente externo pueda correlacionar `speechStart { id }` y `speechEnd { id, interrupted }` con la oración enviada (clave para la cola por oraciones en Kokoro).
- **Referencia temporal de `visemes` en `speakChunk`:** Especificar en el esquema si `t` es relativo al inicio global del `streamId` o al **inicio del chunk actual**. Hacer `t` relativo al inicio del chunk evita que los adaptadores por frases acumulen errores de redondeo de _samples_.
- **Cancelación y _timeout_ de stream:** Añadir un _timeout_ de inactividad por stream (p. ej. 5 s sin recibir `speakChunk` ni `speakEnd`) y limpieza automática al desconectarse el cliente WS (además de un comando `{ type: "speakCancel"; streamId: string }` opcional), para que un fallo en un script Python no deje bloqueada la cola `queue` ni el canal `Boca`.

### 2.3 Seguridad de rutas en `{ type: "animation"; vrma: string }`

- **Estado actual:** [`src-tauri/capabilities/default.json`](../../src-tauri/capabilities/default.json) permite `fs:allow-read-file` en `$HOME/**`.
- **Riesgo:** Si `vrma` en `AvatarCommand` se pasa directamente al cargador local, un cliente WS o plugin podría referenciar rutas arbitrarias del usuario.
- **Recomendación:** Restringir `vrma` exclusivamente a **identificadores de animaciones registradas** o rutas relativas internas del propio plugin previamente validadas en Rust sin `..` ni enlaces simbólicos fuera de su directorio.

### 2.4 Escritura centralizada en `vrm.expressionManager`

- **Estado actual:** [`AnimationSystem`](../../src/engine/AnimationSystem.ts) escribe `blink` directamente en cada `update(dt)` y [`ReactionSystem`](../../src/engine/ReactionSystem.ts) escribe presets emocionales de forma independiente.
- **Riesgo:** En muchos modelos VRM, expresiones como `happy` o `surprised` abren la boca en su _morph target_ con `overrideMouth = "none"`. Sumar `happy = 1.0` + visema `aa = 1.0` deforma la malla bucal. Igualmente, `blink` procedural puede pisar expresiones con ojos cerrados (`wink` / `blinkLeft` / `happy`).
- **Recomendación:** En `T-601`, hacer que `AvatarController` sea el **único escritor** sobre `vrm.expressionManager` antes de invocar `vrm.update(dt)`, respetando `overrideBlink` y `overrideMouth` (o atenuando el peso de la emoción o del canal vocal cuando ambos modifican la boca).

### 2.5 Cálculo ligero de `region: "head" | "body"` en eventos `click`

- **Estado actual:** El hit-test de clic usa la máscara 2D de silueta (`isPointOnAvatar(clientX, clientY)`), sin raycast 3D contra mallas.
- **Recomendación:** Para emitir `{ type: "click", region: "head" | "body" }` sin añadir raycasting costoso contra `SkinnedMesh`, proyectar en el instante del clic la posición en pantalla del hueso `neck` (misma técnica que `getBoneScreenBottomFraction` en [`src/engine/AvatarLoader.ts`](../../src/engine/AvatarLoader.ts)): si `clientY` queda por encima de `neck` es `"head"`, en caso contrario `"body"`.

---

## 3. Plataforma, seguridad y ventana (`T-603`, `T-604`)

### 3.1 `windowFocus` en Linux Wayland requiere ampliar `CursorBridge`

- **Estado actual:** En [`src-tauri/src/cursor_bridge.rs`](../../src-tauri/src/cursor_bridge.rs) y en la extensión de GNOME Shell ([`extension.js`](../../integrations/gnome-shell/deskumi-cursor-bridge@deskumi.org/extension.js)), `ReportActiveWindow` solo transmite geometría `(x, y, width, height, deskumiWidth)`. En sesiones Wayland (como Fedora 44 GNOME, entorno `E1`), XWayland no puede consultar títulos de ventanas Wayland nativas.
- **Recomendación:**
  1. Contemplar en `T-604` la actualización de la interfaz D-Bus `org.deskumi.CursorBridge`, el script de KWin y la extensión de GNOME Shell para reportar metadatos de ventana activa (solo cuando el permiso `desktop:events` esté habilitado o filtrando antes de emitir al puente).
  2. Incluir `appId?: string` (`wm_class` / `resourceClass`) además de `title?: string` en el evento:
     ```ts
     | { type: "windowFocus"; appId?: string; title?: string }
     ```
     `appId` es mucho más estable para reglas de plugins (p. ej. reaccionar al abrir el editor o navegador) y expone menos datos sensibles que el título completo de la ventana.

### 3.2 Endurecimiento de `$APPDATA/bridge.json` y validación de `Origin`

- **Política exacta de `Origin`:** Los clientes de escritorio/CLI (Python, Node, Rust) no envían cabecera `Origin` por defecto, mientras que los navegadores siempre la incluyen en WebSockets. `local_bridge.rs` debe **rechazar cualquier handshake que contenga cabecera `Origin`** (salvo lista blanca explícita si alguna vez hiciera falta) para neutralizar Cross-Site WebSocket Hijacking desde páginas web abiertas.
- **Autenticación del token:** Enviar el token en el primer mensaje tras abrir el socket (con _timeout_ corto de ~2 s antes de desconectar) o en cabecera HTTP `Authorization`, evitando query params en la URL.
- **Escritura segura y detección de sesiones muertas en `bridge.json`:**
  - Crear el archivo de forma atómica (`bridge.json.tmp` -> `rename`) con permisos `0600` en sistemas Unix.
  - Guardar `{ "version": 1, "pid": <pid>, "port": <port>, "token": "<token>" }` para que los clientes externos detecten archivos obsoletos si el proceso terminó abruptamente (`SIGKILL`).

### 3.3 `SpeechBubbleOverlay` (`T-603`) sin redimensionar la ventana en vivo

- **Estado actual:** Al entrar en modo `perched` ([`src/main.ts`](../../src/main.ts)), la altura del marco se reduce al `84 %` de `configuredFrameSize.height`.
- **Riesgo:** Redimensionar la ventana GTK (`set_window_desktop_size`) cada vez que aparece o desaparece una burbuja provoca recálculos de cámara/frustum en XWayland, Mutter y KWin, generando saltos visuales en el personaje.
- **Recomendación:** No redimensionar la ventana al hablar. Mantener la burbuja dentro del viewport existente anclándola a la proyección 2D del hueso `head`, con reposicionamiento automático dentro de los bordes del marco (arriba de la cabeza cuando hay margen o a un costado estilo cómic cuando está sentado cerca del borde superior del monitor) y coordinando `minTopRoomPx` en [`src/platform/window-perch.ts`](../../src/platform/window-perch.ts).

---

## 4. Gobernanza del repositorio y presupuesto

1. **Cerrar `T-600` con un ADR formal (`ADR-0006`):** Dado que Fase 6 introduce nuevas dependencias en `Cargo.toml`, activa CSP, amplía el Contrato IPC de [`docs/ARCHITECTURE.md`](../ARCHITECTURE.md) y define el modelo de seguridad de plugins/WS, el entregable documental de `T-600` debe ser `docs/adr/0006-plugins-and-local-ws-bridge.md` (siguiendo el precedente de `T-103` -> `ADR-0002`).
2. **Impacto mínimo en el binario Rust:** En `Cargo.toml`, reutilizar el runtime Tokio interno de Tauri (`tauri::async_runtime::spawn`) y declarar `tokio-tungstenite` con `default-features = false` (sin TLS, al ser exclusivamente `ws://127.0.0.1`). Esto mantiene el incremento del binario en unos cientos de KB dentro del límite de `< 15 MB` de instalador.
3. **División de `src/main.ts` en `T-601`:** [`src/main.ts`](../../src/main.ts) tiene actualmente ~500 líneas (superando la guía de ~300 líneas de [`AGENTS.md`](../../AGENTS.md)). Aprovechar el refactor planeado en `T-601` para extraer la sincronización de configuración y listeners del tray a módulos dedicados en `src/platform/`.
