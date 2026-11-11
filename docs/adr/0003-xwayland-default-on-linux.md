# ADR-0003: XWayland por defecto en Linux

- **Estado:** aceptada
- **Fecha:** 2026-11-11
- **Autor(es):** crivera + agente (worker-102)
- **Tarea relacionada:** T-102

## Contexto

Los entornos objetivo (Fedora GNOME, Nobara KDE, Debian GNOME) usan Wayland por defecto.
En Wayland nativo una app **no puede**: ponerse always-on-top (GNOME lo ignora),
posicionarse por código, ni leer el cursor global. Todo eso es central para un
"desktop pet". En XWayland (X11 dentro de Wayland) sí funciona, y GNOME/KDE traen
XWayland activo.

## Opciones consideradas

1. **Forzar `GDK_BACKEND=x11` en `main.rs` (Linux)** salvo que el usuario defina
   `DESKUMI_WAYLAND=1`.
2. **Wayland nativo siempre** y aceptar limitaciones (el usuario fija "siempre encima"
   desde el menú del compositor).
3. **Wayland + `wlr-layer-shell`** (capa overlay) — ideal en Sway/Hyprland/KDE, pero
   GNOME no lo soporta y requiere `gtk-layer-shell`, que choca con cómo Tauri crea ventanas.

## Decisión (provisional)

**Opción 1.** Por defecto XWayland; opción de entorno para Wayland nativo.
Revisar layer-shell en F6 para KDE/wlroots.

## Consecuencias

- `main.rs` setea variables de entorno **antes** de inicializar Tauri (ver skill
  `linux-overlay-troubleshooting`).
- Escalado HiDPI fraccional puede verse borroso en XWayland → documentar en QA.
- Si XWayland no está disponible, caer a Wayland nativo con `caps` reducidas.

## Evidencia

Validado en T-102 en el entorno E1 (Fedora 44 Workstation, GNOME Wayland `wayland-0`, Intel HD 630, WebKitGTK 2.54.2):

- En modo por defecto (`GDK_BACKEND=x11`, `WEBKIT_DISABLE_DMABUF_RENDERER=1` inyectados en `main.rs`): la ventana inicia con 100% de transparencia, sin bordes ni sombras, el render Three.js funciona sin fondo negro y always-on-top se respeta al enfocar otras ventanas.
- En modo `DESKUMI_WAYLAND=1`: WebKitGTK corre de forma nativa en Wayland; `get_platform_caps` reporta `displayServer: "wayland"` y refleja las limitaciones de la plataforma (`alwaysOnTop: false`, `globalCursor: false`, `setPosition: false`).
- Decisión: Aceptada formalmente. XWayland es el backend por defecto en Linux para garantizar soporte completo de overlay.
