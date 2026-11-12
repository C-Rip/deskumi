# T-404: Animaciones `.vrma` (`@pixiv/three-vrm-animation`) y selector

| Campo         | Valor                                              |
| ------------- | -------------------------------------------------- |
| Estado        | completado                                         |
| Asignado      | @crivera + antigravity                             |
| Fase          | F4                                                 |
| Rama          | `feat/T-404-vrma-animations`                       |
| Depende de    | T-204                                              |
| Estimación    | M (≤ 1 día)                                        |
| Skills útiles | `rust-tauri`, `three-vrm-recipes`, `task-workflow` |

## Objetivo

Soportar la carga y reproducción de animaciones `.vrma` (`VRMC_vrm_animation`) usando `@pixiv/three-vrm-animation` y `THREE.AnimationMixer`, permitiendo seleccionar un archivo `.vrma` desde el disco local mediante el menú del System Tray, persistiendo la selección en `settings.json` y deteniendo o volviendo al estado idle procedural suavemente con crossfading.

## Contexto

- [docs/ROADMAP.md](../ROADMAP.md): Fase 4 (T-404).
- Actualmente `AnimationSystem` ejecuta una animación idle procedural (respiración, balanceo de cadera, brazos en A-pose) y parpadeo automático (`BlinkController`).
- El estándar `VRMC_vrm_animation` (`.vrma`) permite compartir animaciones humanoides retargeteables entre cualquier modelo VRM 0.x y 1.0.
- Cuando se reproduce un clip `.vrma`, los tracks de huesos de la animación deben controlar el esqueleto sin pelear con las rotaciones procedurales de idle/brazos, manteniendo activo el parpadeo (`enableBlink`) y la física (`vrm.update(dt)` + `mixer.update(dt)`).

## Alcance

- Incluye:
  - Instalación de `@pixiv/three-vrm-animation@^3.3.7`.
  - Implementación de `src/engine/VRMAPlayer.ts` y tests unitarios en `src/engine/VRMAPlayer.test.ts`:
    - Carga de archivos `.vrma` con `GLTFLoader` + `VRMAnimationLoaderPlugin`.
    - Creación de clips con `createVRMAnimationClip(vrmAnimation, vrm)` y reproducción en `THREE.AnimationMixer(vrm.scene)` con soporte para crossfading (`fadeIn` / `fadeOut`), modo loop o one-shot, y parada para volver al idle procedural.
    - Lectura local de `.vrma` mediante `@tauri-apps/plugin-fs` (`readFile`) -> Blob URL en runtime Tauri, y selector nativo `pickVRMAFile()` con `@tauri-apps/plugin-dialog` filtrando `["vrma"]`.
  - Integración en `src/engine/AnimationSystem.ts` y `src/platform/avatar-picker.ts`:
    - Pausar las rotaciones procedurales de idle (respiración, sway, relaxArms) mientras un clip `.vrma` está activo para evitar conflictos de huesos, conservando `enableBlink`, `mixer.update(dt)` y `vrm.update(dt)`.
    - Restaurar la pose base de los huesos al detener la animación `.vrma` para retomar el idle procedural limpiamente.
  - Persistencia de `vrmaPath: string | null` en `AppConfig` (`src/platform/store.ts`).
  - Opciones en el System Tray (`src-tauri/src/tray.rs`): `"Cargar animación (.vrma)..."` (`MENU_LOAD_VRMA = "tray_load_vrma"` -> `"tray-request-load-vrma"`) y `"Detener animación (.vrma)"` (`MENU_STOP_VRMA = "tray_stop_vrma"` -> `"tray-request-stop-vrma"`), conectadas en `src/main.ts`.
- **No incluye:**
  - Galería integrada de animaciones preinstaladas (post v0.1).

## Criterios de aceptación

- [x] `@pixiv/three-vrm-animation` instalado y tipado estricto sin `any`.
- [x] `VRMAPlayer` carga `.vrma`, crea `AnimationClip` y reproduce con crossfade, loop/one-shot y parada.
- [x] Mientras un `.vrma` se reproduce, las rotaciones procedurales de idle se pausan sin desactivar el parpadeo ni `vrm.update(dt)`.
- [x] Selección y parada de `.vrma` disponibles desde el System Tray y persistidas en `vrmaPath` (`settings.json`).
- [x] Tests unitarios en `VRMAPlayer.test.ts` y `AnimationSystem.test.ts` pasando al 100%, junto con `npm run check` y `cargo test`/`clippy`.

## Archivos esperados

- `package.json` — dependencia `@pixiv/three-vrm-animation`
- `src/engine/VRMAPlayer.ts` — loader, player y file picker de `.vrma`
- `src/engine/VRMAPlayer.test.ts` — tests unitarios de `VRMAPlayer`
- `src/engine/AnimationSystem.ts` — integración de `VRMAPlayer` con pausa de idle procedural
- `src/platform/store.ts` — `vrmaPath` en `AppConfig`
- `src/platform/avatar-picker.ts` — helpers de carga/parada y persistencia de `.vrma`
- `src-tauri/src/tray.rs` — items de menú para cargar y detener `.vrma`
- `src/main.ts` — conexión de eventos del tray y carga inicial de `vrmaPath`
- `docs/tasks/T-404-vrma-animations.md` — esta tarjeta

## Handoff

- **Implementación finalizada:**
  - `src/engine/VRMAPlayer.ts`: Carga de archivos `.vrma` mediante `GLTFLoader` y `VRMAnimationLoaderPlugin`. Reproducción de clips mediante `createVRMAnimationClip` y `THREE.AnimationMixer`, soporte de crossfade (`fadeIn` / `fadeOut`), modos loop o one-shot (`LoopOnce`), parada inmediata o con transición suave, lectura de archivos locales en runtime Tauri convirtiéndolos a Blob URL, y selector nativo con `@tauri-apps/plugin-dialog` filtrado por `.vrma`.
  - `src/engine/AnimationSystem.ts`: Integración de `VRMAPlayer`. Pausa automática de las rotaciones procedurales de idle (respiración, sway y A-pose) mientras un `.vrma` está en reproducción activa para evitar conflictos con los tracks de huesos, restaurando limpiamente la pose base al finalizar o detenerse y manteniendo parpadeo (`enableBlink`) y física (`vrm.update(dt)`).
  - `src/platform/store.ts`: Campo `vrmaPath: string | null` (por defecto `null`) en `AppConfig` y `DEFAULT_CONFIG` para persistencia en `settings.json`.
  - `src/platform/avatar-picker.ts`: Funciones `pickAndPlayVRMA` y `stopVRMA` para gestionar la carga, parada y persistencia de `.vrma`, además de reanudar automáticamente la animación al cambiar de avatar.
  - `src-tauri/src/tray.rs`: Opciones en el System Tray `"Cargar animación (.vrma)..."` (`tray_load_vrma` -> `"tray-request-load-vrma"`) y `"Detener animación (.vrma)"` (`tray_stop_vrma` -> `"tray-request-stop-vrma"`).
  - `src/main.ts`: Escucha de eventos del System Tray y carga/reproducción inicial de `vrmaPath` desde `settings.json`.
  - Tests unitarios completos en `src/engine/VRMAPlayer.test.ts` (19 tests), `src/engine/AnimationSystem.test.ts` (18 tests) y `src/platform/store.test.ts` (4 tests), con 100% de passing tests.
