# Limitaciones técnicas y decisiones de workaround

> Registro vivo de limitaciones de plataforma, compositor o API encontradas durante el desarrollo de Deskumi, el porqué de las decisiones/workarounds adoptados y qué queda pendiente por resolver en el futuro.

## Formato de registro

Cada entrada documenta:

- **Contexto / Limitación:** qué impide el comportamiento ideal.
- **Acción / Workaround actual:** qué se implementó y en qué archivos.
- **Pendiente por resolver:** qué se requiere para una solución definitiva.

---

## L-01: Seguimiento global del cursor (`LookAt`) vs. click-through en Linux (XWayland / Wayland)

- **Estado:** Parcialmente mitigado (funciona en X11/XWayland; degradado en Wayland nativo)
- **Contexto / Limitación:**
  - Al usar `set_input_region` con la silueta del avatar, las zonas transparentes pasan los clics al escritorio, pero tampoco reciben eventos DOM `mousemove`.
  - Si se fuerza `fullWindowPointer: true` para capturar `mousemove` en todo el recuadro de la ventana, el usuario recupera `LookAt` en toda el área pero **pierde el click-through** en el espacio vacío.
  - En **Wayland nativo**, el protocolo prohíbe a clientes no privilegiados consultar la posición global del cursor fuera de su superficie enfocada (`tao` retorna `(0, 0)`).
  - En **XWayland** (modo por defecto en Linux según [ADR-0003](adr/0003-xwayland-default-on-linux.md)), `GDK Seat pointer.position()` sí expone el cursor global sobre ventanas X11/XWayland y el escritorio, aunque algunos compositores Wayland (GNOME/KDE) pueden pausar la actualización de coordenadas X11 mientras el puntero está sobre otra aplicación Wayland nativa.
- **Acción / Workaround actual:**
  - Se restauró `fullWindowPointer: false` en [`src/platform/avatar-picker.ts`](../src/platform/avatar-picker.ts) para preservar el click-through por silueta.
  - Se conectó [`GlobalCursorLookAtSystem`](../src/platform/global-cursor.ts) haciendo polling a 15 Hz al comando IPC `get_window_cursor_position` ([`src-tauri/src/platform.rs`](../src-tauri/src/platform.rs)) únicamente cuando `caps.globalCursor === true` y solo actualizando `LookAtSystem` cuando la coordenada cambia (para no bloquear `idleTimeout`).
  - Se implementó el puente D-Bus [`org.deskumi.CursorBridge`](../src-tauri/src/cursor_bridge.rs) ([ADR-0005](adr/0005-wayland-global-cursor-bridge.md)): en **KDE Plasma Wayland** carga automáticamente un KWin Script (`/Scripting`) que reporta `workspace.cursorPos` normalizado respecto a la ventana `"Deskumi"`, resolviendo también el escalado fraccionario; `get_window_cursor_position` prioriza el puente D-Bus y hace fallback transparente a `gdk::Device::position()`.
- **Pendiente por resolver:**
  - En **GNOME Shell (Wayland)** ya se incluye la extensión compañera [`deskumi-cursor-bridge@deskumi.org`](../integrations/gnome-shell/deskumi-cursor-bridge@deskumi.org/extension.js) (empaquetada en `.deb`/`.rpm` bajo `/usr/share/gnome-shell/extensions/`), aunque por políticas de GNOME el usuario debe habilitarla una vez (`gnome-extensions enable deskumi-cursor-bridge@deskumi.org`).

---

## L-02: Always-on-top, tamaño y posicionamiento de ventana en Linux (Mutter / Wayland / X11)

- **Estado:** Mitigado en XWayland; limitado en Wayland nativo
- **Contexto / Limitación:**
  - Wayland nativo no permite que una aplicación se marque como _always-on-top_ ni que mueva su propia ventana por coordenadas absolutas.
  - En Linux X11/XWayland, `win.setSize()` / `win.setPosition()` de Tauri pueden ser ignorados o recentrados por Mutter cuando la ventana no es redimensionable (`resizable: false`).
- **Acción / Workaround actual:**
  - `GDK_BACKEND=x11` por defecto en Linux ([`src-tauri/src/main.rs`](../src-tauri/src/main.rs), [ADR-0003](adr/0003-xwayland-default-on-linux.md)).
  - Comandos nativos GTK `set_window_desktop_size` (alternando temporalmente `win.set_resizable(true)` → `resize` → `set_size_request` → `set_resizable(false)`) y `set_window_desktop_position` (`win.move_`) en [`src-tauri/src/platform.rs`](../src-tauri/src/platform.rs).
- **Pendiente por resolver:**
  - Soporte declarativo de reglas de ventana (KWin / Wayland layer-shell si aplica) para entornos Wayland puros.
  - En KDE Plasma / KWin (XWayland), el tamaño real reportado por el WebView (`window.innerWidth × window.innerHeight`) puede diferir ligeramente del tamaño solicitado por `set_window_desktop_size` si KWin aplica restricciones o escalado fraccionario; por ello `main.ts` sincroniza `sceneManager.resize()` con `window.innerWidth/innerHeight` tras el resize nativo y fuerza `position.x = 0` para evitar desfase horizontal.

---

## L-03: Fondo negro y ghosting WebGL en WebKitGTK

- **Estado:** Mitigado
- **Contexto / Limitación:**
  - Con aceleración DMABUF activa en WebKitGTK, las ventanas transparentes pueden renderizar un fondo negro sólido en ciertas GPUs/drivers (Intel/NVIDIA).
  - Durante animaciones procedurales sobre canvas transparente, `premultipliedAlpha: true` sin limpieza explícita puede dejar estelas (_ghosting_) de frames anteriores.
- **Acción / Workaround actual:**
  - `WEBKIT_DISABLE_DMABUF_RENDERER=1` al arranque en [`src-tauri/src/main.rs`](../src-tauri/src/main.rs).
  - `premultipliedAlpha: false`, `autoClear: true` y `renderer.clear()` explícito en [`src/engine/SceneManager.ts`](../src/engine/SceneManager.ts).
- **Pendiente por resolver:**
  - Reevaluar `WEBKIT_DISABLE_DMABUF_RENDERER=1` en versiones futuras de WebKitGTK/Mesa para recuperar aceleración DMABUF si se corrige la composición alfa.

---

## L-04: Paridad de comandos nativos en Windows

- **Estado:** Pendiente
- **Contexto / Limitación:**
  - `set_input_region`, `get_window_cursor_position`, `set_window_desktop_size` y `set_window_desktop_position` tienen implementación nativa completa con GTK/Cairo en Linux (`#[cfg(target_os = "linux")]`), pero en otros SO (`#[cfg(not(target_os = "linux"))]`) actualmente son _no-op_ o retornan `None`.
- **Acción / Workaround actual:**
  - `PlatformCaps` reporta capacidades reales por plataforma para degradar de forma segura sin romper el arranque en Windows.
- **Pendiente por resolver:**
  - Implementar `set_input_region` (Win32 `SetWindowRgn` / `WS_EX_LAYERED`) y `get_window_cursor_position` (`GetCursorPos` + `ScreenToClient`) para Windows en [`src-tauri/src/platform.rs`](../src-tauri/src/platform.rs) y [`src-tauri/src/input_region.rs`](../src-tauri/src/input_region.rs).
