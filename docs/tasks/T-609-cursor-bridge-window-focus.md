# T-609: Evento `windowFocus` (`appId` + `title` por scope) en `CursorBridge`, KWin y GNOME Shell

| Campo         | Valor                                                                          |
| ------------- | ------------------------------------------------------------------------------ |
| Estado        | hecha                                                                          |
| Asignado      | T-609 WindowFocus Bridge Engineer                                              |
| Fase          | F6                                                                             |
| Rama          | `feat/T-609-cursor-bridge-window-focus`                                        |
| Depende de    | T-605                                                                          |
| Estimación    | M (≤ 1 día)                                                                    |
| Skills útiles | `task-workflow`, `git-workflow`, `rust-tauri`, `linux-overlay-troubleshooting` |

## Objetivo

Ampliar el puente D-Bus `org.deskumi.CursorBridge` ([ADR-0005](../adr/0005-wayland-global-cursor-bridge.md)), el script automático de KWin y la extensión de GNOME Shell para emitir el evento `windowFocus` (`appId` y `title` gobernados por scopes separados), enviando metadatos por D-Bus únicamente cuando los permisos correspondientes estén activos.

## Contexto

- [ADR-0005](../adr/0005-wayland-global-cursor-bridge.md) y [ADR-0006](../adr/0006-plugins-and-local-ws-bridge.md).
- [phase-6-plan-v3-review.md](../plans/phase-6-plan-v3-review.md) (§3.1) y [phase-6-plan-v4-review.md](../plans/phase-6-plan-v4-review.md) (§1.6, §2, §5):
  - En sesiones Wayland, ningún proceso no privilegiado puede leer el título de la ventana activa. Exponerlo en el puente exige separar `appId` (scope `desktop:events`) de `title` (scope `desktop:windowTitle`, desactivado por defecto).
  - Filtrar solo en Rust dejaría títulos sensibles circulando por D-Bus en todo momento; por ello `org.deskumi.CursorBridge` debe exponer el modo de reporte hacia el script KWin y la extensión GNOME Shell para que no emitan `appId`/`title` cuando el permiso está apagado.

## Alcance

- Incluye:
  - `src-tauri/src/cursor_bridge.rs`:
    - Ampliar la interfaz XML de `org.deskumi.CursorBridge` con método `ReportWindowFocus(ss)` (`appId`, `title`) y señal/propiedad de control (`FocusMetadataMode`: `0 = off`, `1 = appId`, `2 = appId + title`).
    - Emitir cambio de modo cuando cambian los scopes de puente/plugins y limpiar/no almacenar `title` si el modo no lo permite.
    - Sanitización y límite de longitud (p. ej. 256 chars) antes de emitir el evento hacia el frontend/puente.
  - Actualizar el script KWin embebido en `cursor_bridge.rs` (`resourceClass` / `desktopFileName` → `appId`, `caption` → `title` solo si el modo lo habilita).
  - Actualizar la extensión de GNOME Shell ([`integrations/gnome-shell/deskumi-cursor-bridge@deskumi.org/extension.js`](../../integrations/gnome-shell/deskumi-cursor-bridge@deskumi.org/extension.js)) para observar el modo de metadatos en `org.deskumi.CursorBridge` y reportar `win.get_wm_class()` / `appId` y (solo si está habilitado) `win.get_title()`.
  - Conectar `windowFocus { appId?, title? }` hacia `BridgeClient` y `PluginHost` respetando las suscripciones de eventos y los scopes `desktop:events` y `desktop:windowTitle`.
  - Tests unitarios en Rust (modos de foco, truncado/sanitización, filtrado de `title` en modo `appId` o `off`) y verificación manual en E1 (GNOME) y E2 (KDE Plasma / Nobara).
- **No incluye:** compositores `wlroots` (Sway/Hyprland) ni implementación Win32 `GetForegroundWindow` (backlog futuro / `L-04`).

## Pasos sugeridos

1. Diseñar e implementar la extensión D-Bus (`ReportWindowFocus` + propiedad/señal de modo) en `src-tauri/src/cursor_bridge.rs` con tests unitarios.
2. Actualizar el script KWin en `cursor_bridge.rs` y la extensión GNOME Shell en `integrations/gnome-shell/deskumi-cursor-bridge@deskumi.org/extension.js` (pasando `npm run lint`, que incluye `integrations/gnome-shell/**/*.js`).
3. Conectar la actualización de modo desde la configuración/scopes (`T-605` / `T-607`) y emitir `AvatarEvent` `windowFocus` filtrado por permisos.
4. Probar manualmente con `dbus-monitor` / `busctl` en E1 (GNOME) y E2 (KDE) confirmando que `title` no viaja por D-Bus cuando `desktop:windowTitle` está apagado.

## Criterios de aceptación

- [ ] Cuando `desktop:events` y `desktop:windowTitle` están apagados, ni KWin ni GNOME Shell envían `appId`/`title` por D-Bus. _(Lógica implementada y verificada en tests unitarios Rust/TS; pendiente verificación en vivo con `dbus-monitor` tras cableado Wave 4 en `runtime-integrations.ts` / reinstalación de extensión GNOME.)_
- [ ] Con `desktop:events` activo y `desktop:windowTitle` apagado, se emite `{ type: "windowFocus", appId }` sin `title`. _(Verificado en tests unitarios Rust y `WindowFocusBridge`; pendiente verificación en vivo Wave 4.)_
- [ ] Con `desktop:windowTitle` explícitamente habilitado, se incluye `title` sanitizado/acotado. _(Verificado en tests unitarios Rust y `WindowFocusBridge`; pendiente verificación en vivo Wave 4.)_
- [x] ESLint (`integrations/gnome-shell/**/*.js`), `npm run check` y checks de Rust (`cargo fmt --check`, `cargo clippy -- -D warnings`, `cargo test`) pasan en verde.
- [ ] Probado en E1 (GNOME) y anotado estado de E2 (KDE) en el Handoff. _(Host actual: E1 GNOME Shell 50.6 Wayland; verificado offline GJS/D-Bus `Variant` y `DBusNodeInfo`. Pendiente prueba en vivo E1 y E2 KDE Plasma tras integración Wave 4.)_

## Archivos esperados

- `src-tauri/src/cursor_bridge.rs` — ampliar interfaz D-Bus, estado de foco y script KWin
- `src-tauri/src/lib.rs` / `src-tauri/src/local_bridge.rs` — conectar evento y modo de metadatos
- `integrations/gnome-shell/deskumi-cursor-bridge@deskumi.org/extension.js` — reportar `appId`/`title` condicionado por modo D-Bus
- `src/platform/ipc.ts`, `src/platform/bridge/BridgeClient.ts`, `src/platform/plugins/PluginHost.ts` — despachar `windowFocus` filtrado por scope

## Verificación

```bash
npm run check
(cd src-tauri && cargo fmt --check && cargo clippy -- -D warnings && cargo test)
```

## Handoff

- **Qué se hizo:**
  - [`src-tauri/src/cursor_bridge.rs`](../../src-tauri/src/cursor_bridge.rs):
    - Ampliado `INTROSPECTION_XML` de `org.deskumi.CursorBridge` con método `ReportWindowFocus(ss)` (`appId`, `title`), propiedad de solo lectura `FocusMetadataMode` (`u`: `0 = off`, `1 = appId`, `2 = appId + title`) y señal `FocusMetadataModeChanged(u)`.
    - Añadidos `FocusMetadataMode`, `WindowFocusMetadata`, `sanitize_focus_field` (elimina caracteres de control, hace `trim` y trunca a 256 `char` UTF-8), `filter_window_focus`, `update_window_focus` (emite evento Tauri `"cursor-bridge-window-focus"` únicamente cuando cambia el foco sanitizado y `mode > 0`), `set_focus_metadata_mode_state` (limpia caché si `mode == 0` y elimina `title` si `mode == 1`) y comandos IPC `set_focus_metadata_mode(mode: u8)` + `get_window_focus_metadata()`.
    - Actualizado el script KWin embebido (`build_kwin_script`) para leer `FocusMetadataMode` vía `org.freedesktop.DBus.Properties.Get` al iniciar y antes de emitir `ReportWindowFocus` cuando `mode > 0`, extraer `appId` desde `desktopFileName` / `resourceClass` y `caption` solo cuando `focusMetadataMode >= 2` (conectando `captionChanged` únicamente en modo 2), además de recargar el script KWin en segundo plano si cambia el modo.
    - Añadidos 5 tests unitarios nuevos en Rust (`focus_metadata_mode_validates_bounds`, `sanitize_focus_field_strips_control_chars_and_truncates_256_utf8_chars`, `filter_window_focus_enforces_mode_0_1_2`, `window_focus_state_respects_mode_transitions_and_deduplication`, `kwin_script_checks_focus_metadata_mode_before_sending_title`, `dbus_introspection_xml_declares_window_focus_contract` — 6 tests nuevos, 11 totales en `cursor_bridge::tests`).
  - [`src-tauri/src/lib.rs`](../../src-tauri/src/lib.rs):
    - Llamada a `cursor_bridge::attach_app_handle(app.handle().clone())` en `.setup(...)` y registro de `cursor_bridge::set_focus_metadata_mode` y `cursor_bridge::get_window_focus_metadata` en `invoke_handler`.
  - [`integrations/gnome-shell/deskumi-cursor-bridge@deskumi.org/extension.js`](../../integrations/gnome-shell/deskumi-cursor-bridge@deskumi.org/extension.js):
    - Suscripción a `FocusMetadataModeChanged` y lectura inicial de `org.freedesktop.DBus.Properties.Get(..., "FocusMetadataMode")` al aparecer el puente.
    - En modo `> 0`, reporta `ReportWindowFocus(appId, title)` usando `get_gtk_application_id` / `get_sandboxed_app_id` / `Shell.WindowTracker` / `get_wm_class`, y lee `win.get_title()` + `notify::title` únicamente cuando `mode === 2` (pasando `""` en modo `1`, y sin enviar nada en modo `0`).
  - [`src/platform/window-focus-bridge.ts`](../../src/platform/window-focus-bridge.ts) (219 líneas) y [`src/platform/window-focus-bridge.test.ts`](../../src/platform/window-focus-bridge.test.ts) (157 líneas):
    - Módulo independiente que expone `computeFocusMetadataMode` (`desktop:events` → `1`, `desktop:events` + `desktop:windowTitle` → `2`, sin `desktop:events` → `0`), wrappers IPC (`setFocusMetadataMode`, `getWindowFocusMetadata`, `listenWindowFocusMetadata`) y la clase `WindowFocusBridge` que reenvía `{ type: "windowFocus", appId?, title? }` a `AvatarController.emitEvent(...)` con deduplicación y redacción defensiva.
- **Decisiones tomadas:**
  - `FocusMetadataMode` usa tipo D-Bus `u` (`u32`) en XML, `get_property` y `FocusMetadataModeChanged(u)` para consistencia estricta en GDBus y GJS `recursiveUnpack()`.
  - `WindowFocusBridge` se dejó desacoplado de `src/main.ts`, `src/platform/runtime-integrations.ts`, `src/platform/ipc.ts` y `docs/ARCHITECTURE.md` para mantener conflicto cero con `T-607` hasta la integración de Wave 4.
  - En KWin JS (que no posee suscripción nativa de señales D-Bus en `callDBus`), Rust recarga el script KWin cuando cambia `FocusMetadataMode` y el script revalida `FocusMetadataMode` antes de emitir `ReportWindowFocus` en modo `> 0` (y hace cero llamadas D-Bus cuando `mode === 0`).
- **Entorno probado y verificación:**
  - Host: Linux Wayland con GNOME Shell 50.6 (`XDG_CURRENT_DESKTOP=GNOME`, `XDG_SESSION_TYPE=wayland`; KWin no instalado en este host). No se sobrescribió la extensión GNOME instalada en el host ni se ejecutó `npm run tauri dev` para no interferir con la sesión activa de Deskumi en `org.deskumi.CursorBridge`.
  - Verificación automática ejecutada tras la última edición:
    - `npm run check`: `tsc --noEmit`, `eslint .` (incluyendo `integrations/gnome-shell/**/*.js`), `prettier --check .`, `vitest run` (31 archivos, 248 tests en verde).
    - `(cd src-tauri && cargo fmt --check && cargo clippy -- -D warnings && cargo test)`: `fmt` limpio, `clippy` 0 warnings, 43 tests Rust en verde.
    - `/usr/bin/gjs`: verificada la construcción `GLib.Variant("(ss)", ...)` y `recursiveUnpack()` para `(v)` con `u` y `(u)`.
- **Siguientes pasos (Wave 4 / verificación E1 y E2):**
  1. Cablear `WindowFocusBridge` en `src/platform/runtime-integrations.ts` / `src/main.ts` pasándole la unión de scopes efectivos (`BridgeClient` + `PluginHost`).
  2. Documentar `set_focus_metadata_mode` y `get_window_focus_metadata` en `docs/ARCHITECTURE.md` y actualizar `docs/ROADMAP.md`.
  3. Instalar la extensión actualizada en E1 (GNOME) y probar con `dbus-monitor` / `busctl` en E1 (GNOME) y E2 (KDE Plasma / Nobara) en los modos `0`, `1` y `2` antes de marcar los criterios manuales restantes.
