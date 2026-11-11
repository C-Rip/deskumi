# T-305: Reacciones al clic / Interacción táctil (Happy, Surprised)

| Campo         | Valor                                |
| ------------- | ------------------------------------ |
| Estado        | completada                           |
| Asignado      | @crivera + antigravity               |
| Fase          | F3                                   |
| Rama          | `feat/T-305-click-reactions`         |
| Depende de    | T-304, T-204                         |
| Estimación    | S (≤ 0.5 días)                       |
| Skills útiles | `three-vrm-recipes`, `task-workflow` |

## Objetivo

Implementar un sistema de reacciones interactivas cuando el usuario hace clic sobre el avatar (sin arrastrar la ventana). Al hacer clic o tocar al avatar, este debe reaccionar cambiando su expresión facial (VRM expression presets como `happy`, `surprised`, `relaxed`) y realizando una pequeña animación de rebote o inclinación con retorno suave a su estado normal.

## Contexto

- [docs/ROADMAP.md](../ROADMAP.md): Fase 3 (T-305).
- T-302 configuró el arrastre de ventana (`startDragging`). Si el usuario hace clic y suelta sin desplazamiento apreciable (umbral de arrastre de ~3-5px o evento `click`), se considera una interacción/caricia/toque.
- Three-VRM cuenta con un gestor de expresiones (`vrm.expressionManager`) que soporta presets estándar (`happy`, `surprised`, `blink`, `neutral`, `aa`, `ih`, etc.).

## Alcance

- Incluye:
  - Sistema de detección de clic diferenciado del inicio de arrastre (`click` vs `drag`).
  - `ReactionSystem` en Three.js / VRM que aplica blend shapes / morph targets de emoción (`happy`, `surprised`, etc.) durante un tiempo configurable (ej. 1.2s - 2.0s) con interpolación suave in/out (easing).
  - Efecto procedural de reacción (pequeño salto/rebote vertical o asentimiento sutil).
  - Tests unitarios en Vitest para `ReactionSystem`.
- **No incluye:**
  - Menú contextual de ajustes (pertenece a F4 - T-401).
  - Carga de animaciones `.vrma` externas (pertenece a F4 - T-404).

## Criterios de aceptación

- [x] Al hacer clic sobre el avatar sin arrastrar la ventana, el personaje reacciona con una expresión facial (ej. `happy` o `surprised`).
- [x] La expresión interpola suavemente (fade in, hold, fade out) sin saltos bruscos.
- [x] Si se inicia un arrastre de ventana (`drag`), la reacción de clic no se dispara indebidamente si el puntero se movió significativamente.
- [x] Cobertura de tests unitarios al 100% en Vitest y `npm run check` limpio.

## Archivos esperados

- `src/engine/ReactionSystem.ts` — gestor de reacciones y expresiones temporales
- `src/engine/ReactionSystem.test.ts` — tests unitarios del sistema de reacción
- `src/main.ts` — integración con `SceneManager` y eventos del DOM
- `docs/tasks/T-305-click-reactions.md` — tarjeta de tarea

## Handoff

- **Implementación**:
  - `src/engine/ReactionSystem.ts`: Manejo de expresiones (`happy`, `surprised`, `relaxed`, `wink`) con fade in / fade out senoidal y rebote/nod procedural en el avatar.
  - `src/engine/ReactionSystem.test.ts`: Cobertura exhaustiva con 6 tests unitarios pasando.
  - `src/main.ts`: Umbral de arrastre de 5px configurado en `setupWindowDrag` para no disparar reacciones al desplazar la ventana, y registro del listener `click` con `reactionSystem.triggerRandom()`.
- **Verificación**:
  - 117 tests en Vitest pasando al 100%.
  - `npm run check` limpio y verificado interactivamente por el usuario en vivo.
