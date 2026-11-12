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
2. Ejecutar la secuencia de casos Q-01 a Q-17 anotando cualquier desviación visual o de rendimiento.
3. Medir el consumo de RAM y CPU en reposo durante al menos 60 segundos.
4. Actualizar las columnas correspondientes en la matriz anterior.
