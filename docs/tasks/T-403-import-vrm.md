# T-403: Importar .vrm Propio (Dialog + Scope de FS Seguro)

| Campo         | Valor                                              |
| ------------- | -------------------------------------------------- |
| Estado        | completada                                         |
| Asignado      | @crivera + antigravity                             |
| Fase          | F4                                                 |
| Rama          | `feat/T-403-import-vrm`                            |
| Depende de    | T-402                                              |
| Estimación    | M (≤ 1 día)                                        |
| Skills útiles | `rust-tauri`, `three-vrm-recipes`, `task-workflow` |

## Objetivo

Permitir al usuario cargar e importar su propio modelo 3D `.vrm` desde su disco local de forma segura utilizando el diálogo nativo de archivos (`tauri-plugin-dialog`) y copiándolo o cargándolo en memoria para el loader de WebKitGTK. El modelo seleccionado debe persistirse en `settings.json` (T-402) para cargarse automáticamente en arranques posteriores.

## Contexto

- [docs/ROADMAP.md](../ROADMAP.md): Fase 4 (T-403).
- Deskumi actualmente carga el avatar de muestra `sampleAvatarUrl` (`assets/avatars/VRM1_Constraint_Twist_Sample.vrm`).
- Los usuarios de VTubing y desktop companions quieren usar sus propios avatares exportados de VRoid Studio o Blender.
- La opción de "Cambiar / Cargar avatar..." puede activarse desde el menú del System Tray (T-401) y en el futuro desde la ventana de Ajustes (T-407).

## Alcance

- Incluye:
  - Instalación y registro de `tauri-plugin-dialog` y `tauri-plugin-fs` en Tauri v2.
  - Opción "Cargar avatar (.vrm)..." en el menú contextual del System Tray.
  - Diálogo nativo filtrando por extensiones `*.vrm`.
  - Lectura binaria segura de archivos locales en WebKitGTK convertidos a Blob URLs para `three-vrm`.
  - Persistencia del path en la configuración (`defaultConfigManager.set("avatarPath", path)`).
  - Recarga dinámica en caliente del nuevo avatar en `SceneManager` sin reiniciar el proceso.
  - Tests unitarios y `npm run check`.
- **No incluye:**
  - Selector de animaciones `.vrma` externas (pertenece a T-404).

## Criterios de aceptación

- [x] Opción "Cargar avatar (.vrm)..." disponible en el System Tray.
- [x] Abre selector de archivos nativo con filtro `.vrm`.
- [x] Al seleccionar un archivo válido, reemplaza el avatar en pantalla en vivo y ajusta el encuadre Snug Framing.
- [x] El avatar seleccionado persiste entre reinicios de la aplicación.
- [x] Tests pasando al 100% y `npm run check` limpio.

## Archivos esperados

- `src-tauri/Cargo.toml` — dependencias de plugins
- `src-tauri/src/tray.rs` — elemento de menú para cargar avatar
- `src/platform/avatar-picker.ts` — lógica de apertura y recarga
- `docs/tasks/T-403-import-vrm.md` — tarjeta de tarea

## Handoff

- **Implementación finalizada:**
  - Configurados plugins `@tauri-apps/plugin-dialog` y `@tauri-apps/plugin-fs` en frontend y backend Tauri v2 (`Cargo.toml`, `capabilities/default.json`, `src-tauri/src/lib.rs`).
  - Añadido item de menú contextual en System Tray `"Cargar avatar (.vrm)..."` emitiendo `"tray-request-load-avatar"`.
  - Creado módulo `src/platform/avatar-picker.ts` con gestión completa de ciclo de vida (`loadAvatarModel`, `setupAvatarInScene`, `teardownAvatarContext`, `pickVRMFile`, `pickAndSwitchAvatar`).
  - Conectado evento del System Tray y carga inicial desde configuración persistida en `src/main.ts`.
  - Vitest (123 tests pasando) y `cargo clippy` sin warnings.
- **Siguiente tarea recomendada:** T-404 (Reproductor de animaciones .vrma).
