---
trigger: model_decision
description: Convenciones de TypeScript, Three.js y @pixiv/three-vrm. Aplicar al crear o editar archivos en src/ (frontend, motor de render, avatares, animación, interacción).
---

# Reglas: Frontend (TypeScript + Three.js + three-vrm)

## Capas
- `src/engine/**` **no importa** `@tauri-apps/*`. Solo `src/platform/**` habla con Tauri.
- Cada sistema implementa `System { update(dt: number): void; dispose(): void }` y se
  registra en `SceneManager`. Un único `requestAnimationFrame` (en `SceneManager`).
- Lógica pura (math, timers, máquinas de estado) en funciones sin Three/DOM → test con Vitest.

## TypeScript
- `strict: true`. Prohibido `any` (usa `unknown` + narrowing). Sin `// @ts-ignore`.
- Imports de Three: `import * as THREE from "three"` y addons desde
  `three/examples/jsm/...` (o `three/addons/...`), consistente en todo el repo.
- Nada de estado global mutable salvo el bootstrap en `main.ts`.

## Render (transparencia)
- `new THREE.WebGLRenderer({ alpha: true, antialias: true, premultipliedAlpha: true })`
  + `renderer.setClearColor(0x000000, 0)`. CSS: `html, body { background: transparent }`.
- `renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))`.
- `renderer.outputColorSpace = THREE.SRGBColorSpace`.
- FPS cap y pausa (`document.visibilityState`) desde el loop, no con `setInterval`.

## three-vrm
- Carga: `loader.register((parser) => new VRMLoaderPlugin(parser))`, luego
  `gltf.userData.vrm as VRM`.
- Tras cargar: `VRMUtils.removeUnnecessaryVertices(gltf.scene)` y
  `VRMUtils.combineSkeletons(gltf.scene)` (o la utilidad equivalente de la versión
  instalada — verifica en `node_modules/@pixiv/three-vrm`). VRM 0.x mira hacia -Z:
  `VRMUtils.rotateVRM0(vrm)`.
- Llamar `vrm.update(dt)` **cada frame** (spring bones, lookAt, expresiones).
- Expresiones vía `vrm.expressionManager.setValue("blink", v)`; LookAt vía
  `vrm.lookAt.target = object3D`.
- Al cambiar de avatar: `VRMUtils.deepDispose(vrm.scene)` para liberar GPU.

## Rendimiento
- No crear objetos (`new Vector3`) dentro de `update()`: reutiliza temporales del módulo.
- Raycast/hit-test con throttle (≤ 30 Hz), no en cada `mousemove`.
