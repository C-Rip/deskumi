# T-201: SceneManager — ciclo de vida de Three.js y loop con FPS cap

| Campo         | Valor                                                |
| ------------- | ---------------------------------------------------- |
| Estado        | completada                                           |
| Asignado      | worker-201                                           |
| Fase          | F2                                                   |
| Rama          | `feat/T-201-scene-manager`                           |
| Depende de    | T-102                                                |
| Estimación    | M                                                    |
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

- [x] `SceneManager` mantiene la transparencia total (`alpha: true`, `setClearColor(0x000000, 0)`).
- [x] El loop no consume más del FPS cap establecido.
- [x] `npm run check` pasa (typecheck, lint, format, vitest).
- [x] Tests de Vitest verifican registro/desregistro de sistemas y lógica de tiempo.

## Verificación

```bash
npm run check
```

## Handoff

### Implementado

- **Interfaces y tipos (`src/engine/types.ts`):**
  - Definida la interfaz `System` con métodos `update(dt: number): void` y `dispose(): void` para el ciclo de vida de los subsistemas del motor.
  - Definidas las opciones de configuración en `SceneManagerOptions` (contenedor, cámara, FPS cap, renderers custom/fallback, tamaño inicial y flags de visibilidad).
- **Calculador de tiempo desacoplado (`src/engine/FrameTicker.ts`):**
  - Clase pura para limitación de FPS (`fpsCap`, 30 por defecto), cálculo de delta time en segundos, compensación de drift temporal acumulado y tope máximo de delta time (`maxDelta: 0.1s`) para prevenir saltos tras suspensión/lag.
  - Soporte completo para `pause()`, `resume()` y reseteo sin saltos temporales.
- **SceneManager (`src/engine/SceneManager.ts`):**
  - Orquestación de la escena Three.js con WebGLRenderer transparente (`alpha: true`, `premultipliedAlpha: true`, `setClearColor(0x000000, 0)`, `setPixelRatio`, `outputColorSpace = THREE.SRGBColorSpace`).
  - Cámara `PerspectiveCamera` (FOV 45, near 0.1, far 100, posición `[0, 0, 4]`).
  - Iluminación base: `HemisphereLight` (0xffffff, 0x444444, 1.0) y `DirectionalLight` (0xffffff, 1.0).
  - Manejo de listeners responsivos para `resize` y pausa automática en `document.visibilityState === "hidden"`.
  - Registro y ciclo de vida de subsistemas (`registerSystem`, `unregisterSystem`, `getSystems`).
  - Limpieza exhaustiva en `dispose()` (remueve event listeners, cancela RAF, dispone renderer y sistemas registrados).
- **Integración (`src/main.ts`):**
  - Reemplazado el código de prueba del cubo por una instancia limpia de `SceneManager` conectada al contenedor `#app` ejecutando el loop con 30 FPS cap.
- **Tests unitarios (Vitest):**
  - `src/engine/FrameTicker.test.ts`: 8 tests verificando inicialización, FPS cap, skipping de frames a frecuencias mayores, limitación de FPS en el tiempo (30 FPS en simulación de monitor 120Hz), clamp de delta time ante pausas y reanudación limpia.
  - `src/engine/SceneManager.test.ts`: 6 tests verificando setup de escena/cámara/luces, registro y desregistro de sistemas, llamada con delta time durante ticks activos, respeto de FPS cap, pausa/reanudación, listener de resize y `dispose()`.

### Siguiente tarea (T-202)

- `AvatarLoader` (T-202) podrá agregar avatares VRM cargados directamente a `sceneManager.scene` e integrar sistemas de animación/expresión implementando la interfaz `System` para registrarse en `sceneManager.registerSystem(animationSystem)`.
