# T-301: LookAt al cursor (seguimiento de mirada y cabeza)

| Campo         | Valor                                                |
| ------------- | ---------------------------------------------------- |
| Estado        | completada                                           |
| Asignado      | worker-301                                           |
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

- [x] La mirada del personaje sigue de forma suave el movimiento del mouse.
- [x] No hay rotaciones imposibles (clamp dentro de límites anatómicos).
- [x] Si el mouse sale de la ventana, la mirada regresa al frente gradualmente.
- [x] `npm run check` pasa al 100%.

## Verificación

```bash
npm run check
```

## Handoff

### Qué se implementó

1. **`src/engine/LookAtSystem.ts`**:
   - Implementa la interfaz `System` para ejecutarse en el loop de `SceneManager`.
   - Funciones matemáticas puras desacopladas y testeables:
     - `calcNdcFromMouse(clientX, clientY, width, height)`: proyecta coordenadas del puntero a NDC en `[-1, 1]` con clamping y protección de dimensiones no positivas.
     - `calcYawPitchFromOffset(dx, dy, dz)`: calcula ángulos yaw (rotación horizontal Y) y pitch (rotación vertical X en Three.js) a partir de la distancia relativa cabeza-target.
     - `clampAngle(angle, maxAngle)` y `clampAngles(yaw, pitch, maxYaw, maxPitch)`: restricción estricta de ángulos dentro de los límites anatómicos (±30° o $\pi/6$ rad por defecto).
     - `calcTargetPlanePosition(camera, ndc, headPos, targetDistance, out)`: proyeccion del rayo de la cámara sobre un plano virtual situado a `targetDistance` frente a la cara del modelo, sin asignación de memoria dinámica durante el update.
   - Integración nativa con `vrm.lookAt`: creación de `LookAtTarget` (`THREE.Object3D`), asignación directa a `vrm.lookAt.target` con `autoUpdate = true`, sincronizando los ojos del avatar.
   - Rotación coordinada y suave de cuello y cabeza: distribuye el giro angular (30% cuello, 70% cabeza por defecto, o 100% a cabeza si el modelo carece de hueso de cuello) preservando las rotaciones base de reposo.
   - Interpolación por decaimiento exponencial (`lerpFactor = 1 - Math.exp(-damping * dt)`): seguimiento fluido sin jitter ni saltos bruscos.
   - Retorno automático y gradual a la posición neutra frontal (`neutralTargetPosition`): se activa cuando el puntero sale de la ventana (`mouseleave`) o tras inactividad prolongada (`idleTimeout = 3.0s`).
   - Gestión segura del ciclo de vida (`dispose()`): desenlaza listeners DOM (`mousemove`, `mouseleave`, `mouseenter`), desvincula `vrm.lookAt.target`, remueve el target de la escena y restaura los huesos a sus rotaciones originales.

2. **Integración en `src/main.ts`**:
   - Creación e instanciación de `LookAtSystem` con la cámara y escena de `SceneManager` tras cargar el avatar de muestra.
   - Registro en `SceneManager` previo a `AnimationSystem` para que `vrm.update(dt)` en `AnimationSystem` procese las dinámicas de spring bones con la orientación de cabeza y cuello ya calculada.

3. **Tests unitarios (`src/engine/LookAtSystem.test.ts`)**:
   - 18 pruebas con Vitest cubriendo: mapeo NDC, límites anatómicos y clamping, cálculo de ángulos de orientación, unprojecting sobre plano 3D, seguimiento con lerp damping, distribución anatómica cuello/cabeza, retorno a neutro por timeout y mouseleave, listeners DOM sintéticos y restauración completa en dispose.

### Siguientes pasos

- T-302: Integración de arrastre de ventana nativo con `getCurrentWindow().startDragging()`.
- T-303 / T-304: Silueta dinámica y click-through selectivo sobre el personaje.
