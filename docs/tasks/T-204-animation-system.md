# T-204: AnimationSystem — idle procedural, parpadeo aleatorio y spring bones

| Campo         | Valor                                                |
| ------------- | ---------------------------------------------------- |
| Estado        | completada                                           |
| Asignado      | worker-204                                           |
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
4. Actualización continua del avatar (`vrm.update(dt)`) para calcular las físicas secundarias de pelo y ropa (_spring bones_).
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

- [x] El avatar parpadea de forma natural a intervalos variables.
- [x] Se ejecuta `vrm.update(dt)` en cada frame activo.
- [x] `npm run check` pasa al 100%.
- [x] Al correr la app se observa el modelo 3D en la ventana transparente con movimiento idle.

## Verificación

```bash
npm run check
```

## Handoff

### Qué se implementó

1. **`src/engine/BlinkController.ts`**:
   - Máquina de estados procedural testeable de forma aislada: `open` -> `closing` (60 ms) -> `closed` (40 ms) -> `opening` (80 ms) -> `open`.
   - Intervalos aleatorios configurables (default 2 a 6 s).
   - Probabilidad de doble parpadeo del 15% con retardo rápido (100 ms).
   - Soporte para generador PRNG personalizado para tests deterministas.
   - Métodos utilitarios `triggerBlink()` y `reset()`.

2. **`src/engine/AnimationSystem.ts`**:
   - Implementa la interfaz `System` para orquestación en `SceneManager`.
   - Animación idle procedural: respiración en `chest`/`spine` (rotación X senoidal) y balanceo sutil en `hips` (rotación Z senoidal).
   - Relajación de brazos desde T-pose hacia A-pose natural (`leftUpperArm` a -1.2 rad, `rightUpperArm` a +1.2 rad).
   - Aplicación por frame del peso de parpadeo a través de `vrm.expressionManager.setValue("blink", weight)`.
   - Ejecución de `vrm.update(dt)` en cada frame activo para resolver dinámicas secundarias (_spring bones_ de ropa y cabello) y restricciones (_constraints_).
   - Limpieza completa y restauración de rotaciones y expresiones originales en `dispose()`.

3. **`src/main.ts` y configuración Vite**:
   - Declaración de tipos en `src/vite-env.d.ts` y regla `assetsInclude: ["**/*.vrm"]` en `vite.config.ts`.
   - Conexión completa en el bootstrap para cargar el avatar oficial de muestra `assets/avatars/VRM1_Constraint_Twist_Sample.vrm` con `loadVRM()`.
   - Centrado y apoyo en el suelo con `centerAndGroundVRM()`, encuadre automático de cámara con `calculatePerspectiveFraming()`, y registro de `AnimationSystem` en `SceneManager`.

4. **Tests unitarios (`src/engine/AnimationSystem.test.ts`)**:
   - 16 pruebas con Vitest verificando estados, transiciones y pesos del parpadeo, doble parpadeo, oscilaciones de respiración/balanceo, fallback a hueso spine, y ciclo de vida/disposal.

### Siguientes pasos

- T-301: LookAt dinámico y seguimiento del cursor con raycast al plano frontal de la cabeza.
- T-302: Drag & drop e interactividad de la ventana.
