# T-304: Hit-test y silueta exacta del avatar (Pixel-Perfect / Alpha Silhouette)

| Campo         | Valor                                                          |
| ------------- | -------------------------------------------------------------- |
| Estado        | en curso                                                       |
| Asignado      | @crivera + antigravity                                         |
| Fase          | F3                                                             |
| Rama          | `feat/T-304-pixel-silhouette-hit-test`                         |
| Depende de    | T-303, T-202                                                   |
| Estimación    | M (≤ 1 día)                                                    |
| Skills útiles | `three-vrm-recipes`, `linux-overlay-troubleshooting`, `task-workflow` |

## Objetivo

Calcular la silueta exacta del avatar de forma pixel-perfect (utilizando rasterizado de opacidad/alpha en Three.js o descomposición en micro-bandas de cuadrícula) para que la región interactiva enviada a Cairo/GTK (`set_input_region`) calque con absoluta precisión el contorno del pelo, ropa, dedos, y deje 100% libre el espacio entre extremidades y ropa sin aproximaciones toscas de cajas.

## Contexto

- [ADR-0002](../adr/0002-click-through-strategy.md): Estrategia de click-through por Input Region con Cairo en Linux.
- [docs/ROADMAP.md](../ROADMAP.md): Fase 3 (T-304).
- T-303 dejó operativo el puente IPC y la propagación recursiva a nivel GtkWindow/GdkWindow, pero las cajas alineadas a ejes (AABBs) sobre extremidades diagonales cubren zonas vacías triangulares o dejan fuera dedos según su grosor.

## Alcance

- Incluye:
  - Generador de silueta exacta por rasterizado de máscara alpha (off-screen render target o canvas downsampled a resolución óptima, p. ej. celda de 8×8 o 16×16 px).
  - Algoritmo de generación de bandas horizontales de rectángulos disjuntos (run-length encoding) que se traduce directamente en bandas de Cairo sin overhead.
  - Integración en `InputRegionManager` con throttling (~15 Hz) para que al moverse o animarse el personaje, la silueta se actualice suavemente.
  - Tests unitarios en Vitest validando la descomposición de la máscara alpha en rectángulos.
- **No incluye:**
  - Lógica de emociones / click reactions (pertenece a T-305).

## Criterios de aceptación

- [ ] La silueta generada calca el contorno real del modelo (ropa, dedos, piernas).
- [ ] El espacio entre piernas y bajo los brazos es 100% interactivo para las ventanas de fondo.
- [ ] Rendimiento sostenido a 30 FPS en Three.js sin caídas de framerate ni saturación de CPU.
- [ ] Tests en Vitest y `npm run check` pasan al 100%.

## Archivos esperados

- `src/platform/silhouette.ts` — rasterizado de máscara alpha y RLE a rectángulos
- `src/platform/silhouette.test.ts` — tests unitarios del extractor de silueta
- `src/platform/input-region.ts` — integración con `InputRegionManager`
- `docs/tasks/T-304-pixel-silhouette-hit-test.md` — tarjeta de tarea

## Handoff

_Pendiente al completar la implementación._
