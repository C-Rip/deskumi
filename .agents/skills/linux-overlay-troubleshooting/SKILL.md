---
name: linux-overlay-troubleshooting
description: >-
  Diagnóstico y soluciones para ventanas overlay en Linux con Tauri v2/WebKitGTK:
  fondo negro o blanco en ventanas transparentes, always-on-top que no funciona,
  click-through, posición/cursor global en Wayland vs X11/XWayland, NVIDIA, HiDPI.
  Usar cuando se trabaje en la ventana, transparencia o entrada en Linux, o ante
  cualquier bug visual de la ventana del personaje.
---

# Linux overlay troubleshooting

## 1. Identifica el entorno primero (siempre anótalo en el PR)

```bash
echo "session=$XDG_SESSION_TYPE desktop=$XDG_CURRENT_DESKTOP wayland=$WAYLAND_DISPLAY gdk=$GDK_BACKEND"
lspci | grep -iE 'vga|3d'
```

Dentro de la app: `get_platform_caps` → `displayServer`.

## 2. Modelo mental

| Capacidad                            | X11/XWayland | Wayland nativo                           |
| ------------------------------------ | ------------ | ---------------------------------------- |
| Always-on-top desde la app           | sí           | **no** (GNOME); KDE solo con reglas KWin |
| Mover ventana por código             | sí           | **no** → usar `startDragging()`          |
| Cursor global                        | sí           | **no**                                   |
| Input region / click-through parcial | sí (XShape)  | sí (input region)                        |

Por eso el default es XWayland ([ADR-0003](../../../docs/adr/0003-xwayland-default-on-linux.md)).
Matriz validada: [ARCHITECTURE.md](../../../docs/ARCHITECTURE.md#matriz-de-capacidades-esperada-validar-en-t-103).

## 3. Fondo negro / blanco en la ventana transparente

Ve en orden; prueba cada uno exportando la variable antes de `npm run tauri dev`:

1. CSS: `html, body { background: transparent !important; }` y nada opaco en `#app`.
2. Renderer: `alpha: true` + `setClearColor(0x000000, 0)`.
3. `tauri.conf.json`: `"transparent": true`, `"decorations": false`, `"shadow": false`.
4. `WEBKIT_DISABLE_DMABUF_RENDERER=1` (default en nuestro `main.rs`).
5. NVIDIA: `__NV_DISABLE_EXPLICIT_SYNC=1`.
6. Último recurso (rompe WebGL acelerado, evitar): `WEBKIT_DISABLE_COMPOSITING_MODE=1`.
7. X11 puro sin compositor (XFCE sin compositing): no hay transparencia posible →
   documentar como no soportado o pedir activar el compositor.

## 4. Always-on-top no funciona

- ¿Estás en Wayland nativo? → esperado. Usa modo XWayland (default) o en GNOME
  clic derecho en la ventana (Alt+Espacio) → "Siempre encima".
- KDE Wayland: Ajustes → Reglas de ventana → "Mantener encima".

## 5. Click-through

- `set_ignore_cursor_events(true)` = toda la ventana ignora entrada y **no** llegan
  `mousemove` → no se puede "volver" sin cursor global.
- Estrategia del proyecto: input region ([ADR-0002](../../../docs/adr/0002-click-through-strategy.md)).
- Acceso GTK en Linux: `webview_window.gtk_window()` → `gtk::ApplicationWindow`;
  ejecutar en el hilo principal (`app.run_on_main_thread`).
- Región en **píxeles lógicos de GTK** (no físicos): divide por `scale_factor()`.

## 6. HiDPI / escalado fraccional

- XWayland con escala fraccional puede verse borroso. En GNOME:
  `gsettings get org.gnome.mutter experimental-features` (`xwayland-native-scaling`).
- En el renderer usa `Math.min(devicePixelRatio, 2)`.

## 7. Cómo reportar un hallazgo nuevo

Agrega una fila en la sección relevante de esta skill y, si cambia la estrategia,
un ADR. Incluye entorno exacto y versión de WebKitGTK (`rpm -q webkit2gtk4.1` /
`dpkg -l libwebkit2gtk-4.1-0`).
