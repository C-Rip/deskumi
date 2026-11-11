# T-402: Configuración Persistente (Tauri Store Plugin)

| Campo         | Valor                         |
| ------------- | ----------------------------- |
| Estado        | completada                    |
| Asignado      | @crivera + antigravity        |
| Fase          | F4                            |
| Rama          | `feat/T-402-persistent-store` |
| Depende de    | T-201, T-401                  |
| Estimación    | M (≤ 1 día)                   |
| Skills útiles | `rust-tauri`, `task-workflow` |

## Objetivo

Implementar la persistencia de configuración del usuario usando el plugin oficial `tauri-plugin-store`. Al cerrar y volver a abrir la aplicación o mover al personaje, la configuración debe guardarse y restaurarse automáticamente:

1. Posición de la ventana en pantalla (coordenadas X, Y).
2. Límite de FPS (fpsCap: 30, 60, etc.).
3. Factor de encuadre o escala del avatar.
4. Último avatar cargado.

## Contexto

- [docs/ROADMAP.md](../ROADMAP.md): Fase 4 (T-402).
- Cuando el usuario arrastra la ventana por la pantalla con el ratón (T-302), la posición actual debe persistirse con debounce para que al reiniciar Deskumi aparezca exactamente donde se dejó.
- En Tauri v2, `tauri-plugin-store` almacena pares clave-valor serializados en un archivo JSON local en la ruta estándar de datos del usuario (`~/.config/deskumi/settings.json` o `$XDG_CONFIG_HOME`).

## Alcance

- Incluye:
  - Instalación y registro de `tauri-plugin-store` en `src-tauri` (`Cargo.toml`, `capabilities/default.json`, `lib.rs`) y en el frontend `@tauri-apps/plugin-store`.
  - Módulo TypeScript `src/platform/store.ts` con tipado estricto para las opciones de configuración y valores por defecto (`AppConfig`).
  - Restauración automática de la posición de la ventana al iniciar `Deskumi`.
  - Guardado con debounce de la posición al finalizar el arrastre.
  - Tests unitarios en Vitest para la capa de configuración.
- **No incluye:**
  - Selector de archivos / diálogo de importación de VRM (pertenece a T-403).
  - Ventana secundaria de interfaz gráfica de ajustes (pertenece a T-407).

## Criterios de aceptación

- [x] `tauri-plugin-store` está registrado y funciona en frontend y backend.
- [x] Al arrastrar la ventana y reiniciar la app, Deskumi restaura las coordenadas guardadas.
- [x] La configuración tiene valores por defecto seguros en caso de archivo inexistente o corrupto.
- [x] Tests unitarios y `npm run check` pasan al 100%.

## Archivos esperados

- `src-tauri/Cargo.toml` — dependencia de `tauri-plugin-store`
- `src-tauri/capabilities/default.json` — permisos de store
- `src/platform/store.ts` — cliente tipado de configuración
- `src/platform/store.test.ts` — tests unitarios
- `docs/tasks/T-402-persistent-store.md` — tarjeta de tarea

## Handoff

- **Implementación**:
  - `src-tauri/Cargo.toml`: agregado `tauri-plugin-store = "2"`.
  - `src-tauri/capabilities/default.json`: permisos concedidos para store y operaciones de posición.
  - `src/platform/store.ts`: `ConfigManager` con tipado estricto `AppConfig`, debounce de guardado al soltar arrastre (`saveWindowPosition`) y restauración al inicio (`restoreWindowPosition`).
  - `src/platform/store.test.ts`: tests unitarios con 100% de cobertura pasando.
  - Nota de backlog post-v0.1: refinar el comportamiento de clamping de GNOME Mutter cuando la ventana se guarda parcialmente oculta en los bordes de pantallas secundarias/inferiores.
- **Verificación**:
  - 121 tests en Vitest pasando.
  - `npm run check` y Clippy pasando limpios.
  - Verificado en disco: `~/.local/share/dev.crivera.deskumi/settings.json` persiste las coordenadas reales.
