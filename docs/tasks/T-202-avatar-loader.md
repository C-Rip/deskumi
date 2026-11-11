# T-202: AvatarLoader — carga, autoescala y normalización de VRM

| Campo         | Valor                                              |
| ------------- | -------------------------------------------------- |
| Estado        | lista                                              |
| Asignado      | —                                                  |
| Fase          | F2                                                 |
| Rama          | `feat/T-202-avatar-loader`                         |
| Depende de    | T-101                                              |
| Estimación    | M                                                  |
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
- [ ] `AvatarLoader` usa correctamente `VRMLoaderPlugin`.
- [ ] Implementa rotación retrocompatible para VRM 0.x y normalización de esqueletos.
- [ ] Libera texturas y geometrías en `disposeVRM`.
- [ ] `npm run check` pasa al 100%.

## Verificación
```bash
npm run check
```
