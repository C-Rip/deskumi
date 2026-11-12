# T-407: Ventana de Ajustes (Segunda Ventana + Vanilla TS UI)

| Campo         | Valor                         |
| ------------- | ----------------------------- |
| Estado        | completada                    |
| Asignado      | @crivera + antigravity        |
| Fase          | F4                            |
| Rama          | `feat/T-407-settings-window`  |
| Depende de    | T-401, T-402, T-403           |
| Estimación    | M (≤ 1 día)                   |
| Skills útiles | `rust-tauri`, `task-workflow` |

## Objetivo

Implementar la ventana secundaria de ajustes de Deskumi (`label: "settings"`), abrible desde el System Tray ("Ajustes...") y mediante el comando Tauri IPC `open_settings_window`. La interfaz gráfica se implementa en Vanilla TypeScript + CSS Custom Properties bajo una configuración multi-página en Vite (`settings.html` + `src/settings/main.ts`), manteniendo un peso mínimo de RAM y binario (< 15 MB).

## Contexto

- [docs/ROADMAP.md](../ROADMAP.md): Fase 4 (T-407).
- [docs/adr/0004-vanilla-ts-settings-window.md](../adr/0004-vanilla-ts-settings-window.md): Decisión de interfaz en Vanilla TS sin dependencias extra de UI.
- Opciones de configuración ofrecidas al usuario:
  1. **Avatar (.vrm):** Muestra ruta actual, botón "Cambiar avatar (.vrm)..." para seleccionar modelo con diálogo nativo y botón "Quitar avatar".
  2. **Escala del avatar (`avatarScale`):** Slider `0.5x` a `2.0x` (default `1.0`).
  3. **Límite de FPS (`fpsCap`):** Selector de `15 FPS`, `30 FPS` y `60 FPS`.
  4. **Posición de ventana:** Botón "Restablecer posición en pantalla".
- Cuando se actualizan los ajustes en la ventana secundaria, se persisten en `defaultConfigManager` y se emite el evento Tauri `"settings-updated"` con el payload `AppConfig` para sincronizar en tiempo real la ventana principal (`"main"`).

## Alcance

- Incluye:
  - Creación y gestión de la segunda ventana en Rust (`src-tauri/src/settings_window.rs`, `src-tauri/src/tray.rs`, `src-tauri/src/lib.rs`).
  - Configuración de capabilities de Tauri (`src-tauri/capabilities/default.json` con `windows: ["main", "settings"]`).
  - Configuración multi-página en `vite.config.ts` (`rollupOptions.input`).
  - Extensión del esquema `AppConfig` en `src/platform/store.ts` con `avatarScale: number`.
  - Página HTML `settings.html`, estilos `src/styles/settings.css`, componente `src/settings/SettingsPanel.ts`, tests `src/settings/SettingsPanel.test.ts`, y entrypoint `src/settings/main.ts`.
  - Escucha reactiva en `src/main.ts` al evento `"settings-updated"` para aplicar FPS, escala, cambio de avatar y centrado de ventana en vivo.
- No incluye:
  - Frameworks pesados de UI (React/Vue/etc.).

## Criterios de aceptación

- [x] Ítem "Ajustes..." en el menú del System Tray y comando IPC `open_settings_window`.
- [x] Ventana `"settings"` abre bajo demanda con título "Ajustes de Deskumi" (460x540 px, no redimensionable, con decoraciones, fondo opaco, centrada).
- [x] Si ya está abierta, `open_settings_window` la enfoca y muestra.
- [x] Configuración de avatar (.vrm), escala (0.5x - 2.0x), límite de FPS (15/30/60) y botón para restablecer posición.
- [x] Sincronización en vivo con la ventana principal mediante evento Tauri `"settings-updated"`.
- [x] Tests unitarios en Vitest para `SettingsPanel` y `store`.
- [x] `npm run check` y `cargo clippy / cargo test` pasan sin advertencias ni errores.

## Archivos modificados o creados

- `docs/adr/0004-vanilla-ts-settings-window.md` — ADR sobre arquitectura de la ventana de ajustes
- `docs/tasks/T-407-settings-window.md` — Tarjeta de tarea
- `src-tauri/src/settings_window.rs` — Creación y visualización de la ventana de ajustes
- `src-tauri/src/tray.rs` — Ítem de menú "Ajustes..." en el tray
- `src-tauri/src/lib.rs` — Registro del comando `open_settings_window`
- `src-tauri/capabilities/default.json` — Permisos ampliados para `["main", "settings"]`
- `vite.config.ts` — Rollup multi-página (`main` y `settings`)
- `settings.html` — Documento HTML de la ventana de ajustes
- `src/styles/settings.css` — Estilos nativos en CSS Custom Properties
- `src/platform/store.ts` — Soporte para `avatarScale` en `AppConfig`
- `src/platform/store.test.ts` — Tests unitarios para `avatarScale`
- `src/platform/avatar-picker.ts` — Aplicación de `avatarScale` en nuevos avatares
- `src/settings/SettingsPanel.ts` — Lógica y bindings del panel de configuración
- `src/settings/SettingsPanel.test.ts` — Tests unitarios del panel
- `src/settings/main.ts` — Entrypoint de la ventana de ajustes
- `src/main.ts` — Receptor del evento `"settings-updated"`

## Handoff

La ventana secundaria de ajustes queda completamente implementada, testeada y acoplada mediante eventos IPC con la ventana principal. Lista para verificación por `@verifier`.
