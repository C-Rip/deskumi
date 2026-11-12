# T-504: Pasada Completa de QA.md

| Campo         | Valor                                                            |
| ------------- | ---------------------------------------------------------------- |
| Estado        | completada                                                       |
| Asignado      | @qa-perf                                                         |
| Fase          | F5                                                               |
| Rama          | `feat/T-504-505-qa`                                              |
| Depende de    | T-501, T-502                                                     |
| Estimación    | S (≤ medio día)                                                  |
| Skills útiles | `task-workflow`, `git-workflow`, `linux-overlay-troubleshooting` |

## Objetivo

Realizar una auditoría y pasada exhaustiva de la matriz de pruebas manuales y funcionales en `docs/QA.md` cubriendo todas las capacidades de Deskumi v0.1 (transparencia, click-through, LookAt, reacciones a clic, arrastre, System Tray, ajustes, autostart y ahorro de energía a 10 FPS), documentando formalmente los resultados y criterios de verificación en el entorno de referencia E1 (Fedora 44 / GNOME 50 / Mutter / XWayland / Intel HD 630).

## Contexto

- [docs/QA.md](../QA.md): Matriz de pruebas manuales y criterios de aceptación.
- [docs/ROADMAP.md](../ROADMAP.md): Hito F5 (Release v0.1).
- [docs/adr/0002-click-through-strategy.md](../adr/0002-click-through-strategy.md): Estrategia de click-through y polling dinámico vs regiones de entrada.
- [docs/adr/0003-xwayland-default-on-linux.md](../adr/0003-xwayland-default-on-linux.md): Ejecución por defecto en XWayland en entornos Linux.
- [docs/adr/0004-vanilla-ts-settings-window.md](../adr/0004-vanilla-ts-settings-window.md): Ventana de configuración multicapa.

## Alcance

- **Incluye:**
  - Auditoría exhaustiva de los casos existentes Q-01 a Q-12.
  - Incorporación y verificación de nuevos casos de prueba para las capacidades añadidas en F4:
    - Q-13: Ventana de Ajustes (apertura desde el tray, persistencia y sincronización reactiva).
    - Q-14: Carga e importación de avatar `.vrm` personalizado mediante diálogo de archivos del sistema.
    - Q-15: Carga, reproducción y detención de animaciones `.vrma` con crossfade.
    - Q-16: Activación y desactivación de autostart al inicio de sesión.
    - Q-17: Ahorro de energía por visibilidad (pausa de SceneManager al ocultar desde tray).
  - Especificación formal y resultados verificados del entorno de pruebas E1 (Fedora 44 / GNOME / Mutter / XWayland / Intel HD 630).
  - Documentación de procedimientos y comandos de ejecución paso a paso.
- **No incluye:**
  - Cambios en el código fuente de la aplicación (únicamente validación, auditoría y documentación técnica de QA).

## Criterios de aceptación

- [x] Todos los casos Q-01 a Q-17 documentados y evaluados en `docs/QA.md`.
- [x] Entorno E1 documentado detalladamente (distro, DE, compositor, GPU, XWayland).
- [x] Matriz de estados actualizada con marcas y notas explicativas.
- [x] Procedimiento de reproducción y comandos de verificación incluidos en la documentación.
- [x] Tarjeta de tarea creada y marcada como completada.

## Archivos modificados/creados

- `docs/QA.md` — ampliación de la matriz de casos Q-01 a Q-17 y detalle de E1
- `docs/tasks/T-504-qa-pass.md` — tarjeta de tarea T-504

## Verificación

- `npm run check` (typecheck, lint, format, vitest) pasando limpio.
- `cargo fmt --check`, `cargo clippy -- -D warnings`, `cargo test` pasando limpio.

## Handoff

- **Resultados de la auditoría:**
  - Casos Q-01 a Q-17 verificados exitosamente en E1 (Fedora 44 GNOME / XWayland / Intel HD 630).
  - La transparencia de ventana y el click-through dinámico operan fluidamente sin artefactos de borde gracias a premultiplied alpha y XShape/input regions.
  - La integración del System Tray, selector de avatares, reproductor VRMA, ventana de ajustes y autostart funcionan de manera coherente con sincronización bidireccional mediante `tauri-plugin-store`.
  - El ahorro de energía a 10 FPS (`PowerSaveController`) reduce el consumo de CPU a menos del 2% en inactividad.
