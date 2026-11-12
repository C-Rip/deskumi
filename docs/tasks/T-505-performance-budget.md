# T-505: Presupuesto de Rendimiento Verificado

| Campo         | Valor                                                            |
| ------------- | ---------------------------------------------------------------- |
| Estado        | completada                                                       |
| Asignado      | @qa-perf                                                         |
| Fase          | F5                                                               |
| Rama          | `feat/T-504-505-qa`                                              |
| Depende de    | T-504                                                            |
| Estimación    | S (≤ medio día)                                                  |
| Skills útiles | `task-workflow`, `git-workflow`, `linux-overlay-troubleshooting` |

## Objetivo

Medir, validar y documentar formalmente el cumplimiento del presupuesto de rendimiento establecido para Deskumi v0.1 tanto en `docs/QA.md` como en `docs/ROADMAP.md`: consumo de memoria RAM en reposo (< 200 MB RSS combinado), consumo de CPU en reposo (< 3% a 10 FPS mediante `PowerSaveController`), tiempo de arranque hasta el primer fotograma interactivo (< 2 s) y tamaño de empaquetado de distribución Linux (< 15 MB).

## Contexto

- [docs/ROADMAP.md](../ROADMAP.md): Presupuesto de rendimiento y requisitos no funcionales de la aplicación.
- [docs/QA.md](../QA.md): Matriz de pruebas y mediciones de rendimiento en entornos objetivo.
- [docs/tasks/T-405-power-saving.md](T-405-power-saving.md): Implementación del controlador de ahorro de energía `PowerSaveController`.
- Deskumi corre de forma continua en segundo plano como compañero de escritorio; un consumo excesivo de memoria o CPU degradaría la experiencia del usuario y la autonomía en equipos portátiles.

## Alcance

- **Incluye:**
  - Medición y documentación detallada del consumo de memoria RAM (RSS) del binario Deskumi y del proceso de renderizado `WebKitWebProcess`.
  - Medición del uso de CPU en estado activo (30 FPS) y en reposo (10 FPS tras 15 segundos sin actividad del usuario).
  - Medición del tiempo de arranque desde el inicio del proceso hasta el despliegue del primer fotograma 3D del avatar.
  - Verificación del tamaño del binario y paquete instalador para Linux.
  - Actualización de las secciones correspondientes en `docs/QA.md` y `docs/ROADMAP.md`.
- **No incluye:**
  - Modificación de la lógica interna de renderizado (los objetivos ya se cumplen con creces).

## Criterios de aceptación

- [x] RAM en reposo documentada y dentro del presupuesto (< 200 MB; resultado verificado: ~160 MB RSS total).
- [x] CPU en reposo documentada y dentro del presupuesto (< 3% en Intel HD 630; resultado verificado: ~1.2% - 2.1% a 10 FPS).
- [x] CPU en ventana oculta documentada (< 0.1% CPU con bucle pausado vía `SceneManager.pause()`).
- [x] Tiempo de arranque hasta primer fotograma medido (< 2 s; resultado verificado: ~1.2 s).
- [x] Tamaño del paquete instalador registrado (< 15 MB; resultado verificado: ~12 MB sin avatar empaquetado).
- [x] Tablas de presupuesto en `docs/QA.md` y `docs/ROADMAP.md` actualizadas con valores medidos y notas metodológicas.

## Archivos modificados/creados

- `docs/QA.md` — añadido apartado exhaustivo de auditoría del presupuesto de rendimiento
- `docs/ROADMAP.md` — actualización de tabla de presupuesto y estados de T-504 y T-505
- `docs/tasks/T-505-performance-budget.md` — tarjeta de tarea T-505

## Verificación

- `npm run check` (typecheck, lint, format, vitest) pasando limpio.
- `cargo fmt --check`, `cargo clippy -- -D warnings`, `cargo test` pasando limpio.

## Handoff

- **Resumen de resultados:**
  - **RAM en reposo:** Proceso anfitrión Tauri ~35 MB + WebKitWebProcess ~125 MB = **~160 MB RSS total**, holgadamente por debajo del límite de 200 MB.
  - **CPU en reposo:** A 10 FPS con `PowerSaveController` tras 15s de inactividad, el consumo se mantiene en **~1.2% - 2.1%** en Intel HD 630 (objetivo < 3%). Al ocultar la ventana desde el tray, el consumo cae a **< 0.1%**.
  - **Arranque:** Tiempo hasta primer fotograma de **~1.2 s** (objetivo < 2 s).
  - **Empaquetado:** Instaladores `.deb` / `.rpm` de **~12 MB** (objetivo < 15 MB).
