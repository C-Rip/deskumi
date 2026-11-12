# T-405: Ahorro de Energía (30→10 FPS en Reposo, Pausa si Oculta)

| Campo         | Valor                                              |
| ------------- | -------------------------------------------------- |
| Estado        | completada                                         |
| Asignado      | @crivera + antigravity                             |
| Fase          | F4                                                 |
| Rama          | `feat/T-405-power-saving`                          |
| Depende de    | T-201                                              |
| Estimación    | S (≤ medio día)                                    |
| Skills útiles | `rust-tauri`, `three-vrm-recipes`, `task-workflow` |

## Objetivo

Implementar el controlador de ahorro de energía (`PowerSaveController`) para reducir drásticamente el consumo de CPU y GPU en reposo: reduciendo la tasa de refresco a 10 FPS tras 15 segundos sin interacción del usuario y pausando completamente el bucle de renderizado (`SceneManager.pause()`) cuando la ventana está oculta (mediante eventos de System Tray o `document.visibilityState`).

## Contexto

- [docs/ROADMAP.md](../ROADMAP.md): Fase 4 (T-405) y Presupuesto de Rendimiento.
- Deskumi corre continuamente como un desktop companion en el fondo del escritorio.
- El presupuesto de rendimiento exige CPU en reposo (idle, 10 FPS) < 3% en Intel HD 630.
- En WebKitGTK / XWayland / Linux, `window.hide()` no siempre dispara inmediatamente el evento DOM `visibilitychange`. Por ello, `toggle_main_window_visibility` en `src-tauri/src/tray.rs` emite explícitamente el evento nativo `"tray-visibility-changed"` (`false` al ocultar, `true` al mostrar) para pausar la animación de forma determinista y sin consumir ciclos.

## Alcance

- **Incluye:**
  - Emisión del evento nativo `"tray-visibility-changed"` desde `src-tauri/src/tray.rs` al ocultar y mostrar la ventana.
  - Creación de `PowerSaveController` (`src/engine/PowerSaveController.ts`) con temporizador configurable de inactividad (`activeFps: 30`, `idleFps: 10`, `idleTimeoutMs: 15_000`).
  - Monitoreo de actividad de usuario en eventos DOM (`mousemove`, `mousedown`, `keydown`, `touchstart`, `wheel`) y llamada manual `notifyActivity()`.
  - Pausa inmediata de `SceneManager.pause()` al ocultar la ventana y reanudación con `SceneManager.resume()` al mostrarla.
  - Integración en `src/main.ts` y función pública `setActiveFps(fps: number)` conectada con `defaultConfigManager`.
  - Tests unitarios exhaustivos con Vitest (`src/engine/PowerSaveController.test.ts`).
- **No incluye:**
  - Detección de aplicaciones externas a pantalla completa (pertenece a F5/F6 mediante IPC opcional).

## Criterios de aceptación

- [x] Reduce automáticamente la tasa de refresco a 10 FPS tras 15 segundos sin actividad.
- [x] Restaura inmediatamente los 30 FPS ante cualquier interacción de ratón o teclado.
- [x] Pausa el bucle de renderizado al ocultar la ventana desde el tray o minimización.
- [x] Reanuda el bucle y reinicia temporizadores al volver a mostrar la ventana.
- [x] `src-tauri/src/tray.rs` emite `"tray-visibility-changed"` con payload booleano.
- [x] Expone `setActiveFps(fps: number)` en `src/main.ts` y lee `fpsCap` de la configuración persistente.
- [x] `npm run check` limpio y tests unitarios pasando al 100%.
- [x] `cargo fmt`, `cargo clippy` y `cargo test` limpios en `src-tauri/`.

## Archivos esperados

- `src-tauri/src/tray.rs` — emisión de `"tray-visibility-changed"`
- `src/engine/PowerSaveController.ts` — controlador de energía e inactividad
- `src/engine/PowerSaveController.test.ts` — suite de tests unitarios
- `src/main.ts` — integración en ciclo de vida y exportación de `setActiveFps`
- `docs/tasks/T-405-power-saving.md` — tarjeta de la tarea

## Handoff

- **Implementación finalizada:**
  - Actualizado `src-tauri/src/tray.rs` para emitir `"tray-visibility-changed"` tanto al ocultar (`false`) como al mostrar (`true`).
  - Implementado `PowerSaveController` con soporte para listeners de DOM, eventos de visibilidad de Tauri y `document.visibilityState`.
  - Integrado en `src/main.ts` con carga de `fpsCap` desde `defaultConfigManager` y exportación de `setActiveFps`.
  - Añadidos 11 tests unitarios en `src/engine/PowerSaveController.test.ts` alcanzando 134 tests pasando sin fallos.
- **Siguiente tarea recomendada:** T-406 (Autostart opcional) o T-404 (Animaciones .vrma).
