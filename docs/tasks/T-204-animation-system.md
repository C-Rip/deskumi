# T-204: AnimationSystem — idle procedural, parpadeo aleatorio y spring bones

| Campo         | Valor                                                |
| ------------- | ---------------------------------------------------- |
| Estado        | lista                                                |
| Asignado      | —                                                    |
| Fase          | F2                                                   |
| Rama          | `feat/T-204-animation-system`                        |
| Depende de    | T-201, T-202                                         |
| Estimación    | M                                                    |
| Skills útiles | `three-vrm-recipes`, `task-workflow`, `git-workflow` |

## Objetivo
Implementar `src/engine/AnimationSystem.ts` implementando la interfaz `System` para dotar de vida orgánica al avatar VRM mediante:
1. Máquina de estados procedural para parpadeo (`blink`): ojos abiertos -> cerrando -> cerrados -> abriendo, con intervalos aleatorios (2 a 6 s) y probabilidad de doble parpadeo.
2. Animación procedural sutil de respiración/idle: rotación suave de columna (`chest`/`spine`) y balanceo de cadera (`hips`).
3. Posicionamiento natural de brazos (A-pose o relajados a los costados) si el modelo viene en T-pose estricta.
4. Actualización continua del avatar (`vrm.update(dt)`) para calcular las físicas secundarias de pelo y ropa (*spring bones*).
5. Conexión completa en `src/main.ts` cargando el avatar de muestra `assets/avatars/VRM1_Constraint_Twist_Sample.vrm` en la escena de `SceneManager`.

## Contexto
- [.agents/skills/three-vrm-recipes/SKILL.md](../../.agents/skills/three-vrm-recipes/SKILL.md)
- [.agents/rules/frontend-threejs.md](../../.agents/rules/frontend-threejs.md)
- [docs/ARCHITECTURE.md](../ARCHITECTURE.md)

## Alcance
- Incluye:
  - `src/engine/AnimationSystem.ts`: sistema desacoplado que implementa `System`.
  - Algoritmo de parpadeo parametrizable y testeable de forma aislada.
  - Actualización de `src/main.ts` para instanciar `SceneManager`, cargar el modelo VRM vía `AvatarLoader`, encuadrar la cámara y registrar `AnimationSystem`.
  - Tests unitarios en Vitest para la lógica de tiempos de parpadeo y estados.
- **No incluye:**
  - Tracking de cursor / LookAt global (F3 / T-301).
  - Drag & Drop de la ventana (F3 / T-302).

## Criterios de aceptación
- [ ] El avatar parpadea de forma natural a intervalos variables.
- [ ] Se ejecuta `vrm.update(dt)` en cada frame activo.
- [ ] `npm run check` pasa al 100%.
- [ ] Al correr la app se observa el modelo 3D en la ventana transparente con movimiento idle.

## Verificación
```bash
npm run check
```
