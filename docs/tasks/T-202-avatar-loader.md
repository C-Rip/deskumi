# T-202: AvatarLoader — carga, autoescala y normalización de VRM

| Campo         | Valor                                                |
| ------------- | ---------------------------------------------------- |
| Estado        | en revisión                                          |
| Asignado      | worker-202                                           |
| Fase          | F2                                                   |
| Rama          | `feat/T-202-avatar-loader`                           |
| Depende de    | T-101                                                |
| Estimación    | M                                                    |
| Skills útiles | `three-vrm-recipes`, `task-workflow`, `git-workflow` |

## Objetivo

Implementar `src/engine/AvatarLoader.ts` utilizando Three.js (`GLTFLoader`) y `@pixiv/three-vrm` (`VRMLoaderPlugin`) para cargar modelos `.vrm`, normalizar sus esqueletos (`VRMUtils.combineSkeletons`, `VRMUtils.removeUnnecessaryVertices`, rotación VRM 0.x) y calcular automáticamente el bounding box para encuadre y centrado en la escena.

## Contexto

- [.agents/skills/three-vrm-recipes/SKILL.md](../../.agents/skills/three-vrm-recipes/SKILL.md)
- [.agents/rules/frontend-threejs.md](../../.agents/rules/frontend-threejs.md)
- [docs/ARCHITECTURE.md](../ARCHITECTURE.md)

## Alcance

- Incluye:
  - `src/engine/AvatarLoader.ts`: función `loadVRM(urlOrBuffer)` que retorna la instancia `VRM` y provee utilidades para calcular el bounding box (`computeBounds`) y centrar/escalar al personaje sobre el suelo (`y = 0`).
  - Manejo de errores claro si el asset no es un VRM válido.
  - Función de limpieza segura (`disposeVRM`) para liberar memoria y geometrías de la GPU.
  - Tests unitarios en Vitest para las funciones de cálculo matemático de encuadre.
- **No incluye:**
  - Descarga del modelo oficial (T-203).
  - Animación procedural de parpadeo/idle (T-204).

## Criterios de aceptación

- [x] `AvatarLoader` usa correctamente `VRMLoaderPlugin`.
- [x] Implementa rotación retrocompatible para VRM 0.x y normalización de esqueletos.
- [x] Libera texturas y geometrías en `disposeVRM`.
- [x] `npm run check` pasa al 100%.

## Verificación

```bash
npm run check
```

## Handoff

### Qué se hizo

- **`src/engine/AvatarLoader.ts`:**
  - `loadVRM(source: string | ArrayBuffer, options?: AvatarLoadOptions)`: Carga modelos `.vrm` vía `GLTFLoader` registrando `VRMLoaderPlugin`. Valida que el asset contenga metadatos VRM (lanzando error descriptivo si es un GLTF sin VRM o binario incompatible). Aplica optimizaciones de VRM (`VRMUtils.removeUnnecessaryVertices`, `VRMUtils.combineSkeletons`), rotación retrocompatible para VRM 0.x (`VRMUtils.rotateVRM0`) y deshabilita `frustumCulled` en todos los nodos para evitar recortes indeseados en mallas con rigging.
  - `computeBounds(object: THREE.Object3D)` y `getBoundsInfo(object: THREE.Object3D)`: Cálculo de bounding box exacto en espacio de mundo con actualización previa de matrices.
  - `centerAndGround(object: THREE.Object3D, options?: GroundOptions)` y `centerAndGroundVRM(vrm: VRM)`: Centrado horizontal (X, Z) y alineación vertical de la base/pies en el suelo (`groundY = 0` por defecto).
  - `scaleToHeight(object: THREE.Object3D, targetHeight: number)`: Autoescala proporcional a una altura objetivo en unidades de mundo Three.js.
  - `calculateCameraDistance(height, fovDegrees, margin)`: Cálculo trigonométrico puro de la distancia requerida de cámara con margen configurable (por defecto 10%).
  - `calculatePerspectiveFraming(box, fovDegrees, margin)`: Cálculo de posición de cámara y target para encuadrar al avatar en cámara perspectiva.
  - `calculateOrthoFraming(box, aspect, margin)`: Cálculo simétrico de planos frustum (`left`, `right`, `top`, `bottom`) para cámara ortográfica.
  - `disposeObject(object: THREE.Object3D)` y `disposeVRM(vrm: VRM)`: Desvinculación segura de la escena Three.js y liberación recursiva completa de GPU (geometrías, materiales, texturas y uniformes vía `VRMUtils.deepDispose`).
- **`src/engine/AvatarLoader.test.ts`:**
  - 19 pruebas unitarias en Vitest cubriendo matemática de encuadre, centrado, bounding boxes, escala, desecho de memoria y pipeline de carga y validación de `loadVRM`.

### Decisiones tomadas

1. **Soporte dual de URL y ArrayBuffer**: `loadVRM` acepta `string` (para rutas o URLs remotas) usando `loader.loadAsync` y `ArrayBuffer` (para assets leídos desde IPC o disco local) usando `loader.parseAsync`.
2. **Uso de `VRMUtils.deepDispose`**: Se aprovecha la utilidad nativa de `@pixiv/three-vrm` que recorre y libera materiales (incluyendo uniformes y texturas de shaders como MToon) y geometrías, garantizando que no existan memory leaks en GPU al alternar avatares.
3. **Funciones puras de encuadre**: La trigonometría de distancia y frustums ortográficos se separó en funciones puras para facilitar tanto pruebas unitarias exhaustivas en Vitest sin requerir WebGL ni DOM, como la integración con cámaras perspectiva u ortográficas en `SceneManager`.

### Siguiente paso para el siguiente agente

- En **T-203** (descarga de modelo muestra) y **T-204** (animación idle/parpadeo): Importar `loadVRM`, `centerAndGroundVRM` y `disposeVRM` desde `src/engine/AvatarLoader.ts`.
- En **T-201** (`SceneManager`): Utilizar `calculatePerspectiveFraming` o `calculateOrthoFraming` para ajustar la cámara al cargar o redimensionar la ventana.
