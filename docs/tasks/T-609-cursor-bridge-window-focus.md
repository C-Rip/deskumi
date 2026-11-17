# T-609: Evento `windowFocus` (`appId` + `title` por scope) en `CursorBridge`, KWin y GNOME Shell

| Campo         | Valor                                                                          |
| ------------- | ------------------------------------------------------------------------------ |
| Estado        | lista                                                                          |
| Asignado      | —                                                                              |
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

- [ ] Cuando `desktop:events` y `desktop:windowTitle` están apagados, ni KWin ni GNOME Shell envían `appId`/`title` por D-Bus.
- [ ] Con `desktop:events` activo y `desktop:windowTitle` apagado, se emite `{ type: "windowFocus", appId }` sin `title`.
- [ ] Con `desktop:windowTitle` explícitamente habilitado, se incluye `title` sanitizado/acotado.
- [ ] ESLint (`integrations/gnome-shell/**/*.js`), `npm run check` y checks de Rust (`cargo fmt --check`, `cargo clippy -- -D warnings`, `cargo test`) pasan en verde.
- [ ] Probado en E1 (GNOME) y anotado estado de E2 (KDE) en el Handoff.

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

_Lo llena el agente al terminar: qué quedó, decisiones tomadas, deuda, siguientes pasos, entorno probado._
