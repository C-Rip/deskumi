# T-201: SceneManager — ciclo de vida de Three.js y loop con FPS cap

| Campo         | Valor                                              |
| ------------- | -------------------------------------------------- |
| Estado        | lista                                              |
| Asignado      | —                                                  |
| Fase          | F2                                                 |
| Rama          | `feat/T-201-scene-manager`                         |
| Depende de    | T-102                                              |
| Estimación    | M                                                  |
| Skills útiles | `three-vrm-recipes`, `task-workflow`, `git-workflow` |

## Objetivo
Implementar `src/engine/SceneManager.ts` y sus interfaces asociadas (`src/engine/types.ts`) para administrar el renderer WebGL con canal alfa, cámara perspectiva/ortográfica, iluminación básica (HemisphereLight + DirectionalLight), listener de resize responsivo y un loop `requestAnimationFrame` desacoplado que admita FPS cap (30 FPS por defecto) y pausado automático si la ventana pierde visibilidad.

## Contexto
- [docs/ARCHITECTURE.md](../ARCHITECTURE.md#principios)
- [.agents/rules/frontend-threejs.md](../../.agents/rules/frontend-threejs.md)
- [AGENTS.md](../../AGENTS.md)

## Alcance
- Incluye:
  - `src/engine/types.ts`: definición de la interfaz `System` (`update(dt: number): void`, `dispose(): void`).
  - `src/engine/SceneManager.ts`: clase que orquesta la escena Three.js, cámara, renderer, luces, lista de sistemas (`registerSystem`, `unregisterSystem`), loop desacoplado con delta time y FPS cap configurable.
  - Integración en `src/main.ts` reemplazando el código de prueba del cubo por una instancia limpia de `SceneManager`.
  - Tests unitarios en Vitest para verificar el cálculo de delta time y límite de FPS.
- **No incluye:**
  - Carga de modelos VRM (T-202).
  - Animaciones complejas o LookAt (T-204/T-301).

## Criterios de aceptación
- [ ] `SceneManager` mantiene la transparencia total (`alpha: true`, `setClearColor(0x000000, 0)`).
- [ ] El loop no consume más del FPS cap establecido.
- [ ] `npm run check` pasa (typecheck, lint, format, vitest).
- [ ] Tests de Vitest verifican registro/desregistro de sistemas y lógica de tiempo.

## Verificación
```bash
npm run check
```
