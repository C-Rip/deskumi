# ADR-0005: Puente D-Bus multi-compositor para cursor global en Wayland

- **Estado:** aceptada
- **Fecha:** 2026-11-14
- **Autor(es):** crivera, Antigravity
- **Tarea relacionada:** Seguimiento global del cursor (`LookAt`) con click-through por silueta en Wayland

## Contexto

En sesiones Wayland (verificado en Nobara Linux 44, KDE Plasma 6.7.5 / KWin Wayland con XWayland por defecto según [ADR-0003](0003-xwayland-default-on-linux.md)), el aislamiento de puntero del compositor impide que `gdk::Device::position()` (`get_window_cursor_position`) reciba actualizaciones cuando el cursor se encuentra sobre:

- Áreas transparentes (_click-through_) de la ventana de Deskumi que el compositor enruta al escritorio Wayland (`plasmashell`).
- Otras ventanas Wayland nativas.

Adicionalmente, las APIs D-Bus estándar inspeccionadas en el sistema (`org.kde.KWin /KWin`, `org.freedesktop.portal.Desktop`) no ofrecen lectura pasiva global del cursor (`/dev/input/event*` requiere permisos `root:input` y solo entrega deltas relativos; `org.freedesktop.portal.InputCapture` secuestra el puntero en bordes).

Sin embargo:

- **KDE Plasma (KWin 6)** expone `org.kde.kwin.Scripting` en `/Scripting` y `workspace.cursorPos` / `workspace.cursorPosChanged` + `callDBus` dentro de scripts KWin.
- **GNOME Shell (Mutter)** no permite inyectar scripts al vuelo por D-Bus (por seguridad), pero una extensión opcional de GNOME Shell tiene acceso a `global.get_pointer()`.

## Opciones consideradas

1. **Forzar `fullWindowPointer: true` siempre en Linux**
   - _Pros:_ No depende del compositor.
   - _Contras:_ Rompe el _click-through_ alrededor del personaje; el usuario no puede hacer clic en iconos o ventanas detrás del recuadro transparente.
2. **Contrato D-Bus único en Deskumi (`org.deskumi.CursorBridge`) + adaptadores por compositor**
   - _Pros:_ Preserva el _click-through_ por silueta (`fullWindowPointer: false`), es independiente de la escala HiDPI/fraccionaria (el script envía coordenadas normalizadas relativas a la ventana), no requiere nuevas dependencias Rust (usa `gtk::gio` ya enlazado), y permite que tanto el KWin Script automático (KDE) como una futura GNOME Shell Extension (GNOME) hablen exactamente el mismo protocolo con fallback silencioso al comportamiento nativo actual.
   - _Contras:_ En KDE carga un script temporal en KWin (`/Scripting`); en GNOME requiere que el usuario instale la extensión compañera (si no está instalada, cae limpiamente al modo actual).

## Decisión

Adoptar el contrato D-Bus `org.deskumi.CursorBridge` (`/org/deskumi/CursorBridge`, método `ReportNormalizedCursor(dd)` con coordenadas normalizadas relativas a la ventana `"Deskumi"`) implementado en Rust con `gtk::gio`, iniciando con el puente automático para **KDE Plasma (KWin Scripting)** y dejando el mismo endpoint listo para una extensión opcional de **GNOME Shell**. `get_window_cursor_position` prioriza el puente D-Bus cuando tiene datos recientes y hace fallback transparente a `gdk::Device::position()`.

## Consecuencias

- **Positivas:**
  - `LookAt` sigue el puntero por todo el escritorio y zonas _click-through_ en KDE Wayland sin perder _click-through_ ni sufrir desfases de escala fraccionaria (`1.75x`).
  - Cero crates nuevos en `src-tauri/Cargo.toml` (usa `gtk::gio`).
  - Contrato IPC frontend (`get_window_cursor_position`) intacto.
- **Negativas / deuda aceptada:**
  - Específico de compositores soportados; GNOME Wayland requerirá una extensión de GNOME Shell opcional que invoque `org.deskumi.CursorBridge.ReportNormalizedCursor`.
- **Qué hay que actualizar:**
  - `src-tauri/src/cursor_bridge.rs` (servidor D-Bus + cargador de KWin Script).
  - `src-tauri/src/platform.rs` y `src-tauri/src/lib.rs`.
  - `docs/ARCHITECTURE.md` y `docs/LIMITATIONS.md` (`L-01`).

## Evidencia

- Inspección D-Bus en Nobara 44 / KDE Plasma 6.7.5: `busctl --user introspect org.kde.KWin /Scripting` confirma `loadScript`, `start`, `unloadScript`.
- Símbolos verificados en `/usr/lib64/libkwin.so*`: `cursorPos`, `cursorPosChanged`, `callDBus`, `windowList`, `frameGeometry`, `caption`.
