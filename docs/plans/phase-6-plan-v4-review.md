# Notas de revisión — Plan v4 (Fase 6: Plugins, Puente WebSocket e IA/Voz)

Segunda revisión independiente, hecha sobre el **Plan v4** y contrastada contra el código actual (`feat/gnome-cursor-bridge`, v0.2.1) y contra las fuentes de las dependencias instaladas (`tauri 2.12.5`, `wry 0.57.2`, `tokio 1.54.1`). Complementa a [`phase-6-plan-v3-review.md`](phase-6-plan-v3-review.md); no repite lo que v4 ya incorporó de esa revisión.

Cada hallazgo indica si está **verificado** (leído en código o en las fuentes del crate) o si es una **hipótesis a confirmar en `T-600`**.

---

## Veredicto

El plan v4 está bien encaminado y ya recoge todo lo señalado en la revisión de v3. Aun así, **no conviene crear las tarjetas `T-601..T-607` todavía**: quedan seis huecos que cambian la arquitectura o el contrato (sección 1) y varios datos del plan que no coinciden con el código (sección 2). Todos se pueden resolver ampliando el alcance de `T-600` y ajustando el contrato antes de congelarlo en `ADR-0006`.

---

## 1. Huecos que cambian arquitectura o contrato

### 1.1 Anular globals en el Worker no es una frontera de seguridad

- **Problema:** la decisión 1 basa el aislamiento en anular `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource` e `importScripts` en `self`. Eso deja al menos dos salidas que no se pueden cerrar desde JavaScript:
  - **Workers anidados:** `new Worker(URL.createObjectURL(blob))` desde el plugin crea un global nuevo con todas las APIs de red intactas. Habría que anular también `Worker`, `SharedWorker` y `URL.createObjectURL`.
  - **`import()` dinámico:** es sintaxis, no una propiedad de `self`, así que no se puede anular. `import("http://127.0.0.1:1234/x.js?d=" + datos)` es un canal de salida si la CSP heredada lo permite.
- **Consecuencia:** la frontera real tiene que ser la **CSP efectiva del Worker**, y el parcheo de globals queda solo como defensa adicional. Un Worker `blob:` hereda la CSP del documento, que necesariamente será más laxa que la que queremos para plugins.
- **Propuesta (hipótesis a confirmar en `T-600`):** servir el script del plugin desde un protocolo propio registrado en Rust (`register_uri_scheme_protocol`, p. ej. `plugin://<id>/main.js`) que responda con su propia cabecera `Content-Security-Policy: default-src 'none'`. Un Worker cargado desde una URL que no es `blob:` usa la CSP de su respuesta, no la del documento. De paso, la validación de rutas (sin `..`, sin symlinks) queda en un único punto en Rust y el plugin deja de necesitar `fs:allow-read-file`.
- **Qué debe medir `T-600`:** que WebKitGTK aplica la CSP de la respuesta al Worker en un esquema custom, y que con ella fallan `fetch`, `import()` remoto y un Worker anidado. Si no funciona, la alternativa es un `iframe` con `sandbox="allow-scripts"`, con mayor coste de RAM.

### 1.2 Falta definir el transporte Rust → WebView (y el audio no debería ir en base64)

- **Verificado:** en Tauri 2.12.5, `emit` entrega los eventos con `webview.eval()` del payload serializado como JavaScript (`tauri/src/webview/mod.rs`, `emit_js`). Pasar por ahí chunks de audio en base64 a 10–50 Hz significa parsear y evaluar un script por chunk en el hilo principal, el mismo que renderiza el avatar.
- **Verificado:** `tauri::ipc::Channel` admite cuerpos binarios (`InvokeResponseBody::Raw`) y, por encima de 1024 bytes (8192 en JSON), entrega los datos mediante `fetch` en lugar de `eval` (`tauri/src/ipc/channel.rs`).
- **Propuesta:**
  1. Especificar en el plan que el puente usa un `Channel` abierto por `BridgeClient.ts` para todo el tráfico entrante, y un comando `invoke` para los `AvatarEvent` salientes.
  2. En el WebSocket, enviar el PCM como **tramas binarias** (cabecera corta con `streamId` + muestras) en vez de `pcmBase64` dentro de JSON. Ahorra el 33 % de tamaño y dos conversiones por chunk. `speakStart`/`speakEnd` siguen siendo JSON.
  3. Dejar explícito el reparto: Rust autentica, limita tamaño y tasa, y reenvía; la validación semántica vive en `validateAvatarCommand` (TypeScript).
- **Impacto en documentación:** la tabla "Contrato IPC" de [`docs/ARCHITECTURE.md`](../ARCHITECTURE.md) necesita los comandos nuevos (arrancar/parar puente, estado, regenerar token, enviar evento, listar plugins). El plan no los enumera.

### 1.3 `audio: { url }` es frágil y abre una petición arbitraria a loopback

- **Problema 1 (hipótesis a confirmar):** en producción el origen del WebView es `tauri://localhost`. Un `fetch` a `http://127.0.0.1:50021` es _cross-origin_ y depende de que el motor de voz devuelva cabeceras CORS para ese origen. Los motores locales suelen permitir solo sus propios orígenes.
- **Problema 2:** cualquier cliente autenticado puede hacer que Deskumi emita un `GET` a cualquier puerto local. El filtro "solo `127.0.0.1`" no evita tocar servicios locales con efectos secundarios.
- **Propuesta:** quitar la variante `{ url }` de la v1. El cliente ya tiene los bytes y puede enviarlos (binario, ver 1.2). Además simplifica la CSP: `connect-src` no necesita `http://127.0.0.1:*`, que era justo lo que heredaban los Workers.

### 1.4 El protocolo no tiene sobre, respuestas de error ni negociación

El contrato define comandos y eventos, pero no cómo sabe un cliente que algo falló (expresión inexistente en el modelo, stream rechazado por `policy: "drop"`, límite excedido, ventana oculta). Propuesta mínima para v1:

- **Sobre:** `{ v: 1, id?: string, cmd: AvatarCommand }`.
- **Respuestas:** `{ type: "ack", ref }` y `{ type: "error", ref, code, message }` con códigos cerrados (`invalid`, `rate_limited`, `too_large`, `forbidden`, `busy`, `hidden`, `unknown_expression`, `unknown_animation`).
- **Respuesta a `hello`:** versión de protocolo, scopes concedidos, límites vigentes y lista de expresiones del avatar cargado.
- **Evento `avatarChange`:** al cambiar de modelo, con la nueva lista de expresiones. Sin esto `ExpressionName` no es resoluble desde fuera.
- **`speechEnd`:** añadir `reason` (`"finished" | "interrupted" | "timeout" | "hidden" | "cancelled"`) junto al booleano.

### 1.5 El presupuesto de RAM tiene ~40 MB de margen y el plan no lo reparte

- **Verificado:** [`docs/ROADMAP.md`](../ROADMAP.md) registra **~160 MB** en reposo frente al límite de 200 MB.
- **Problema:** `AudioContext`, buffers de audio, la cola de habla y un Worker por plugin (cada uno con su propia VM de JavaScript) salen de esos 40 MB. El plan solo dice "medir RAM/worker".
- **Propuesta:** fijar en `T-600` criterios de salida numéricos y trasladarlos a `ADR-0006`:
  - Con puente desactivado y cero plugins, el reposo no cambia respecto a hoy.
  - Coste medido por Worker y un máximo de plugins activos derivado de esa medida.
  - `AudioContext` creado al primer `speak` y suspendido (`suspend()`) tras unos segundos sin habla. Un contexto en ejecución mantiene despierto el hilo de audio y un stream abierto en PipeWire, lo que compromete el objetivo de < 3 % de CPU en reposo.
  - Topes de memoria: tamaño máximo de mensaje WS, de audio por `speak`, de cola (`queue`) y de audio en buffer por stream.

### 1.6 Con un único token, los scopes no son una frontera

- **Problema:** `bridge.json` contiene un solo token. Todo proceso que pueda leerlo obtiene todos los scopes activos, así que los scopes funcionan como interruptores globales del usuario, no como permisos por cliente. El plan los presenta junto a "clientes" en Ajustes como si fueran por cliente.
- **Propuesta:** escribir el modelo de amenazas en `ADR-0006` con esta redacción o similar: el puente protege frente a **navegadores** (rechazo de `Origin`) y frente a **procesos sin acceso al archivo** (otros usuarios, apps en sandbox con red pero sin acceso al directorio de datos); **no** protege frente a procesos del mismo usuario sin sandbox. Los tokens por cliente quedan fuera de v1.
- **Caso sensible, `windowFocus`:** en Wayland ningún proceso normal puede leer el título de la ventana activa. Con `desktop:events` activo, el puente pasa a ser la vía para obtenerlo. Recomiendo separar `appId` (scope `desktop:events`) de `title` (scope aparte, desactivado por defecto y con aviso en Ajustes).
- **Detalles de implementación a fijar:**
  - Crear el temporal ya con modo `0600` (`create_new` + `mode`), no con `chmod` posterior.
  - En Linux, preferir `$XDG_RUNTIME_DIR/deskumi/bridge.json` (tmpfs, `0700`, se borra al cerrar sesión) y dejar `$APPDATA` como alternativa en Windows.
  - Borrar el archivo en `RunEvent::Exit`. Con `panic = "abort"` no hay limpieza en un pánico, de ahí la utilidad del `pid`.
  - Comparar el token en tiempo constante; tiempo límite también para el _handshake_ HTTP, no solo para `hello`; máximo de conexiones simultáneas.

---

## 2. Datos del plan que no coinciden con el código

| Punto del plan                                                                | Lo que hay                                                                                                                                                                                                                     | Ajuste                                                                                                                                                                                                         |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `T-600` investiga `set_media_playback_requires_user_gesture` para el autoplay | **Verificado:** `wry 0.57.2` ya crea el WebView con `autoplay: true` por defecto, que aplica `AutoplayPolicy::Allow` en WebKitGTK y `--autoplay-policy=no-user-gesture-required` en WebView2. `tauri-runtime-wry` no lo cambia | El spike se reduce a confirmar que `AudioContext` arranca en `running` en frío. Solo si falla hace falta tocar `WebKitSettings` (y declarar `webkit2gtk` como dependencia directa)                             |
| "Reutilizando `tauri::async_runtime::spawn`" basta para `tokio-tungstenite`   | **Verificado:** Tauri declara `tokio` con `rt`, `rt-multi-thread`, `sync`, `fs`, `io-util`. No incluye `net` ni `time`                                                                                                         | Hay que declarar `tokio` como dependencia directa con `net` y `time`, además de `tokio-tungstenite` y un generador aleatorio seguro para el token (`getrandom` ya está en `Cargo.lock`). Justificarlo en el PR |
| `T-606` añade secciones Puente y Plugins a Ajustes                            | **Verificado:** [`SettingsPanel.ts`](../../src/settings/SettingsPanel.ts) tiene 886 líneas, casi el triple de la guía de ~300                                                                                                  | Dividir `SettingsPanel.ts` por secciones antes o dentro de `T-606`; el plan solo contempla dividir `main.ts`                                                                                                   |
| `animation.vrma`: "solo ID registrado"                                        | **Verificado:** no existe ningún registro de animaciones. `AppConfig` guarda un único `vrmaPath` elegido con el selector de archivos, y `loadAvatarModel`/`loadVRMAFromPathOrUrl` aceptan también `http(s)://`                 | Definir el registro: quién registra (usuario en Ajustes, manifiesto del plugin), dónde persiste y cómo lo consulta un cliente WS. Sin eso un cliente WS no puede reproducir ninguna animación                  |
| CursorBridge reporta metadatos "solo cuando el permiso esté activo"           | **Verificado:** `ReportActiveWindow` solo lleva geometría. El script de KWin y la extensión de GNOME son procesos externos que no conocen la configuración de Deskumi                                                          | Exponer en `org.deskumi.CursorBridge` una propiedad o señal que indique si deben enviar metadatos; filtrar solo en Rust dejaría los títulos circulando por D-Bus                                               |
| Flujo "spike → ADR → tarjetas"                                                | F6 figura en `ROADMAP.md` como "ideas, sin compromiso", sin tabla de tareas                                                                                                                                                    | El primer PR (el de `T-600`) debe convertir F6 en fase con tabla y dejar el resto de ideas en una fase posterior                                                                                               |
| CSP "en `tauri.conf.json`"                                                    | `csp` es `null` y el desarrollo usa `http://localhost:1420` con HMR                                                                                                                                                            | Definir también `devCsp` (necesita `ws://localhost:1420`), o el modo desarrollo dejará de recargar                                                                                                             |

Nota para Windows (**verificado** en `wry/src/webview2/mod.rs`): si se define `additionalBrowserArgs`, se sustituyen los argumentos por defecto de wry, incluido el de autoplay. Quien toque esa opción debe volver a añadir `--autoplay-policy=no-user-gesture-required` a mano.

---

## 3. Ajustes al contrato `AvatarCommand` / `AvatarEvent`

1. **`say` frente a `speak.text`:** hoy se solapan. Definir `say` como "burbuja sin audio" que entra en la **misma cola** que `speak`, con `id` y `policy`, y que emite `speechStart`/`speechEnd`. Si no, un `say` y un `speak` simultáneos no tienen arbitraje.
2. **Límites en el esquema:** longitud máxima de `text`, número máximo de visemas, `sampleRate` permitido (8000–48000), rango de `intensity` y `w` (0..1), `durationMs` máximo. `validateAvatarCommand` debe rechazar, no recortar en silencio.
3. **`lookAt`:** especificar respecto a qué se normaliza `-1..1` (propongo el viewport de la ventana, con el origen en el centro) y el valor por defecto y máximo del _lease_.
4. **Propiedad de los streams:** `streamId` vive en el espacio de nombres de cada cliente. Un cliente no puede enviar `speakChunk` ni `speakCancel` sobre el stream de otro. `stopSpeaking` global requiere un scope propio.
5. **Varios clientes a la vez:** la tabla de canales arbitra entre tipos de dueño, no entre dos clientes WS o dos plugins. Definir la regla (propongo: la `policy` del comando entrante decide, independientemente de quién posea el canal).
6. **Suscripción a eventos:** que el cliente declare en `hello` qué eventos quiere. Evita enviar `idleChange` o `windowFocus` a un cliente que solo sintetiza voz.
7. **Ventana oculta:** definir el comportamiento para **todos** los comandos, no solo `speak`. `SceneManager` se pausa al ocultarse, así que `expression` o `animation` tampoco se aplican. Responder `error: hidden`.
8. **Visema `neutral`:** documentar que significa "boca cerrada" y no se envía a `expressionManager`, ya que no es un preset de boca de VRM.

---

## 4. Habla y lip-sync (`T-602`)

- **Reloj único:** programar los visemas contra `AudioContext.currentTime`, no acumulando `dt` del render. A 30 FPS con tirones, el `dt` acumulado se desvía del audio.
- **Reproducción continua de PCM:** encadenar `AudioBufferSourceNode` con una hora de inicio acumulada y un pre-buffer de ~100–150 ms. Definir qué pasa en un _underrun_ (propongo: silencio, boca cerrada, y reanudar sin reordenar).
- **Remuestreo:** crear cada `AudioBuffer` con el `sampleRate` del stream y dejar que el contexto remuestree. Confirmar en `T-600` que WebKitGTK acepta 22050 Hz.
- **Respaldo por amplitud:** calcularlo sobre los propios samples PCM recibidos (RMS por ventana), que ya están en memoria, en lugar de un `AnalyserNode`. Es determinista, testeable sin audio y no asigna memoria en `update()`.
- **_Wake lock_:** soltarlo también en `timeout`, `speakCancel` y desconexión del cliente. Añadir un test que compruebe que ningún camino de error deja el FPS en `activeFps`.

---

## 5. Desglose de tareas: cambios propuestos

`T-601` y `T-604` mezclan trabajos independientes y de riesgo distinto. Propuesta:

| ID     | Cambio                                                                                                                                                                                                             | Motivo                                                                                                                                                         |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T-600  | Añadir al spike: CSP del Worker por protocolo propio (1.1), `Channel` binario con medición de coste por chunk (1.2), criterios numéricos de RAM (1.5). Quitar la investigación de `WebKitSettings` salvo que falle | Son las tres incógnitas que deciden la arquitectura                                                                                                            |
| T-601a | **Nueva.** Refactor puro: dividir `main.ts` y `SettingsPanel.ts`, sin cambio de comportamiento                                                                                                                     | No depende del spike, puede ir en paralelo con `T-600`, y deja PRs posteriores revisables                                                                      |
| T-601b | Contrato + `AvatarController` + _wake locks_ (lo que queda de `T-601`)                                                                                                                                             | Depende de `T-600` y `T-601a`                                                                                                                                  |
| T-604  | Solo el puente: `local_bridge.rs`, `BridgeClient.ts`, cliente de ejemplo                                                                                                                                           | Entregable y verificable por sí solo                                                                                                                           |
| T-608  | **Nueva.** `windowFocus`: interfaz D-Bus, script de KWin, extensión de GNOME, scopes. Depende de `T-604`                                                                                                           | Toca tres integraciones y dos escritorios. La rama actual `feat/gnome-cursor-bridge` modifica los mismos archivos; conviene que esté mergeada antes de empezar |
| T-605  | Añadir el registro de animaciones (sección 2) o crear una tarjeta propia si crece                                                                                                                                  | Sin registro, `animation` no es utilizable                                                                                                                     |

Con este corte, `T-601a` arranca ya, y `T-602`, `T-603`, `T-604` y `T-605` siguen siendo paralelizables tras `T-601b`.

---

## 6. Verificación: lo que falta

- **El aislamiento del Worker no se puede probar en Vitest.** `PluginHost.test.ts` puede verificar el enrutado de permisos con un Worker simulado, pero no que la red esté cerrada. Añadir a [`docs/QA.md`](../QA.md) un plugin de prueba hostil (intenta `fetch`, `import()` remoto, Worker anidado, `WebSocket`) que debe fallar en WebKitGTK real.
- **Robustez del puente (tests en Rust):** JSON mal formado, trama mayor que el límite, _handshake_ que nunca termina, token incorrecto, exceso de conexiones, cliente que desaparece a mitad de stream.
- **Medición de presupuesto en tres estados**, no solo en reposo: puente desactivado; puente activo con un cliente y un plugin en reposo; durante un stream de 10 minutos (para detectar fugas) y un minuto después de terminarlo (para confirmar que vuelve a 10 FPS y que el `AudioContext` queda suspendido).
- **Entornos:** el plan solo cita Fedora GNOME (E1). `windowFocus` necesita además KDE (Nobara), porque el script de KWin es otra implementación.
- **Alcance en Windows:** el instalador NSIS se sigue generando. Decidir si la Fase 6 es solo Linux (y entonces exponer la capacidad en `PlatformCaps` y ocultar la sección en Ajustes) o si el puente se valida también allí.

---

## 7. Decisiones que quedan para el autor del plan

1. **¿Se elimina `audio: { url }` de v1?** (1.3). Recomiendo que sí.
2. **¿PCM en tramas binarias o base64?** (1.2). Recomiendo binario; cambia el contrato, así que debe decidirse antes de `ADR-0006`.
3. **Licencia del cliente Python y del plugin de ejemplo.** El repo es GPL-3.0-or-later. Si el cliente de ejemplo hereda esa licencia, quien lo copie en su script queda sujeto a ella. Si se busca adopción, conviene publicarlos bajo una licencia permisiva y decirlo en `docs/PLUGINS.md`.
4. **Ubicación de `bridge.json`** (`$XDG_RUNTIME_DIR` frente a `$APPDATA`) (1.6).
5. **Alcance en Windows para esta fase** (sección 6).
