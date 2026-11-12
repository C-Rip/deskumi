# T-406: Autostart Opcional (tauri-plugin-autostart)

| Campo         | Valor                         |
| ------------- | ----------------------------- |
| Estado        | completada                    |
| Asignado      | @crivera + antigravity        |
| Fase          | F4                            |
| Rama          | `feat/T-406-autostart`        |
| Depende de    | T-401, T-402                  |
| Estimación    | S (≤ 0.5 días)                |
| Skills útiles | `rust-tauri`, `task-workflow` |

## Objetivo

Permitir al usuario configurar el inicio automático de Deskumi al iniciar sesión en el sistema operativo mediante el plugin oficial `tauri-plugin-autostart`. El estado debe poder consultarse y alternarse tanto desde la capa de plataforma (`src/platform/autostart.ts`) como desde el System Tray nativo (`src-tauri/src/tray.rs`), sincronizándose con la configuración persistente en `settings.json`.

## Contexto

- [docs/ROADMAP.md](../ROADMAP.md): Fase 4 (T-406).
- Los desktop companions se ejecutan habitualmente al inicio de sesión del sistema para acompañar al usuario sin requerir lanzamiento manual.
- La opción debe ser completamente opcional y estar desactivada por defecto (`autostart: false`).
- Puede activarse/desactivarse desde el menú del System Tray con un `CheckMenuItem` ("Iniciar con el sistema") y en el futuro desde la ventana de Ajustes (T-407).
- En Linux (GNOME/KDE/XDG), `tauri-plugin-autostart` genera un archivo `.desktop` en `~/.config/autostart/`.

## Alcance

- Incluye:
  - Instalación y registro de `tauri-plugin-autostart` en Tauri v2 (`Cargo.toml`, `capabilities/default.json`, `src-tauri/src/lib.rs`) y frontend (`@tauri-apps/plugin-autostart` en `package.json`).
  - Configuración del permiso `"autostart:default"` en `src-tauri/capabilities/default.json`.
  - Campo `autostart: boolean` en `AppConfig` y `DEFAULT_CONFIG` (`false`) en `src/platform/store.ts`.
  - Módulo `src/platform/autostart.ts` y tests `src/platform/autostart.test.ts` con `isAutostartEnabled()`, `setAutostartEnabled()`, `toggleAutostart()` y `syncAutostartWithConfig()`.
  - CheckMenuItem en `src-tauri/src/tray.rs` con identificador `tray_toggle_autostart` ("Iniciar con el sistema"), sincronizando el estado con el SO y emitiendo `"tray-autostart-changed"`.
  - Listener en `src/main.ts` para persistir cambios del Tray y sincronización inicial al arranque.
  - Tests unitarios y comprobación completa de formato y linter (`cargo clippy`, `cargo fmt`, `npm run check`).
- **No incluye:**
  - Opciones de retraso de inicio o flags avanzados de línea de comandos.

## Criterios de aceptación

- [x] `tauri-plugin-autostart` registrado en backend y frontend.
- [x] Item "Iniciar con el sistema" en el System Tray con checkbox reflejando el estado real del SO.
- [x] Alternar el item del Tray cambia el estado de autostart del SO y emite el evento hacia el frontend.
- [x] Frontend sincroniza el estado en `settings.json` persistente.
- [x] Funciones en `src/platform/autostart.ts` hacen no-op seguro cuando `!isTauri()`.
- [x] Tests unitarios pasando al 100% y `npm run check` + `cargo clippy` limpios.

## Archivos esperados

- `src-tauri/Cargo.toml` — dependencia `tauri-plugin-autostart`
- `src-tauri/capabilities/default.json` — capacidad `autostart:default`
- `src-tauri/src/lib.rs` — registro del plugin
- `src-tauri/src/tray.rs` — elemento de menú `CheckMenuItem` y manejador de evento
- `src/platform/store.ts` — campo `autostart` en `AppConfig`
- `src/platform/autostart.ts` — API TypeScript de autostart
- `src/platform/autostart.test.ts` — tests de autostart
- `src/main.ts` — sincronización y listener de eventos del Tray
- `docs/tasks/T-406-autostart.md` — tarjeta de tarea

## Handoff

- **Implementación finalizada:**
  - Integrado plugin `tauri-plugin-autostart` versión 2 en backend y `@tauri-apps/plugin-autostart` versión 2.7.0 en frontend.
  - Agregada capacidad `"autostart:default"` en `src-tauri/capabilities/default.json`.
  - Agregado `autostart: boolean` en `AppConfig` con valor inicial `false` en `src/platform/store.ts`.
  - Implementado `src/platform/autostart.ts` con funciones de consulta, asignación, alternancia y sincronización segura con fallback si no está en Tauri.
  - Agregado `CheckMenuItem` en `src-tauri/src/tray.rs` para alternar inicio en el sistema y notificar vía `"tray-autostart-changed"`.
  - Conectado listener en `src/main.ts` y sincronización `syncAutostartWithConfig()`.
  - Todos los tests unitarios pasando y código formateado.
- **Siguiente tarea recomendada:** T-404 (Animaciones .vrma) o T-405 (Ahorro de energía en reposo).
