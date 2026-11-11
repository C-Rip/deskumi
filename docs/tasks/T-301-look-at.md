# T-301: LookAt al cursor (seguimiento de mirada y cabeza)

| Campo         | Valor                                                |
| ------------- | ---------------------------------------------------- |
| Estado        | lista                                                |
| Asignado      | —                                                    |
| Fase          | F3                                                   |
| Rama          | `feat/T-301-look-at`                                 |
| Depende de    | T-204                                                |
| Estimación    | M                                                    |
| Skills útiles | `three-vrm-recipes`, `task-workflow`, `git-workflow` |

## Objetivo

Implementar `src/engine/LookAtSystem.ts` (implementando `System`) para que el avatar siga la posición del cursor con los ojos y la cabeza:

1. Mapeo de coordenadas del puntero del mouse (NDC x, y) a un target tridimensional (`Object3D`) situado frente a la cara del modelo.
2. Integración nativa con `vrm.lookAt`: asignar `vrm.lookAt.target = targetObject`.
3. Interpolación suave (damping / lerp) para evitar giros bruscos o jitter.
4. Límite angular en el cuello/cabeza (clamp yaw/pitch a ±30°) para mantener una postura natural y anatómicamente creíble.
5. Retorno suave a la posición neutra (mirando al frente) si el cursor sale de la ventana o no hay movimiento por varios segundos.

## Contexto

- [.agents/skills/three-vrm-recipes/SKILL.md](../../.agents/skills/three-vrm-recipes/SKILL.md#lookat-al-cursor)
- [.agents/rules/frontend-threejs.md](../../.agents/rules/frontend-threejs.md)
- [docs/ARCHITECTURE.md](../ARCHITECTURE.md)

## Alcance

- Incluye:
  - `src/engine/LookAtSystem.ts` desacoplado y testeable.
  - Listener de `mousemove` / `mouseleave` en la ventana.
  - Tests unitarios en Vitest para las funciones de mapeo de coordenadas y clamping angular.
  - Registro de `LookAtSystem` en `SceneManager` dentro de `src/main.ts`.
- **No incluye:**
  - Arrastre de ventana (T-302).
  - Silueta para click-through (T-303 / T-304).

## Criterios de aceptación

- [ ] La mirada del personaje sigue de forma suave el movimiento del mouse.
- [ ] No hay rotaciones imposibles (clamp dentro de límites anatómicos).
- [ ] Si el mouse sale de la ventana, la mirada regresa al frente gradualmente.
- [ ] `npm run check` pasa al 100%.

## Verificación

```bash
npm run check
```
