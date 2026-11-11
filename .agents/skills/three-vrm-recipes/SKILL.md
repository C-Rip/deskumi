---
name: three-vrm-recipes
description: >-
  Recetas verificables para avatares VRM con Three.js y @pixiv/three-vrm en
  Deskumi: carga, encuadre automático, idle procedural, parpadeo, lookAt al
  cursor, animaciones VRMA, hit-test y liberación de memoria. Usar al implementar o
  depurar cualquier cosa en src/engine/ relacionada con el avatar.
---

# three-vrm recipes

> Antes de copiar: confirma firmas en `node_modules/@pixiv/three-vrm/types/` de la
> versión instalada. Estas recetas asumen three-vrm v3 (VRM 0.x y 1.0).

## Carga

```ts
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { VRMLoaderPlugin, VRMUtils, type VRM } from "@pixiv/three-vrm";

export async function loadVRM(url: string): Promise<VRM> {
  const loader = new GLTFLoader();
  loader.register((parser) => new VRMLoaderPlugin(parser));
  const gltf = await loader.loadAsync(url);
  const vrm = gltf.userData.vrm as VRM | undefined;
  if (!vrm) throw new Error(`Not a VRM file: ${url}`);
  VRMUtils.removeUnnecessaryVertices(gltf.scene);
  VRMUtils.combineSkeletons(gltf.scene);
  VRMUtils.rotateVRM0(vrm); // no-op en VRM 1.0
  vrm.scene.traverse((o) => {
    o.frustumCulled = false;
  });
  return vrm;
}
```

## Encuadre automático (cámara a cuerpo completo)

Calcula `Box3().setFromObject(vrm.scene)`, centra en X, apoya pies en y=0, y ajusta
la cámara perspectiva: `distance = (height / 2) / Math.tan(fov/2 rad) * 1.1`.
Para un "desktop pet" una cámara **ortográfica** facilita mapear píxeles ↔ mundo.

## Idle procedural (sin archivos de animación)

- Respiración: `chest`/`spine` rotación X `sin(t * 1.5) * 0.02`.
- Balanceo: `hips` rotación Z `sin(t * 0.7) * 0.01`.
- Brazos abajo (T-pose → A-pose): `leftUpperArm.rotation.z = -1.2`, `rightUpperArm.rotation.z = 1.2`
  (signos pueden variar según VRM 0.x/1.0: verificar visualmente).
- Usar `vrm.humanoid.getNormalizedBoneNode("chest")`.

## Parpadeo

Máquina de estados pura (testeable): `open → closing (60 ms) → closed (40 ms) → opening (80 ms) → open`,
siguiente parpadeo en `random(2, 6) s`; 15 % de probabilidad de doble parpadeo.
Aplicar con `vrm.expressionManager?.setValue("blink", value)`.

## LookAt al cursor

```ts
const target = new THREE.Object3D();
scene.add(target);
vrm.lookAt!.target = target;
// cada movimiento (throttled): NDC → punto en plano frente a la cara
ndc.set((x / w) * 2 - 1, -(y / h) * 2 + 1);
raycaster.setFromCamera(ndc, camera);
raycaster.ray.at(1.0, target.position); // 1 m frente a la cámara
```

Para girar también la cabeza: interpolar `head` hacia el target con límite (±30°).

## Loop

```ts
update(dt) { /* sistemas que tocan huesos/expresiones */ vrm.update(dt); }
```

`vrm.update` **después** de modificar huesos y expresiones, **antes** de `render`.

## Animaciones VRMA (F4)

`@pixiv/three-vrm-animation`: registrar `VRMAnimationLoaderPlugin`,
`createVRMAnimationClip(vrmAnimation, vrm)` y reproducir con `THREE.AnimationMixer`.

## Hit-test (¿el cursor está sobre el personaje?)

- Barato: raycast contra los `SkinnedMesh` del avatar (ojo: raycast de skinned mesh
  usa la pose de bind salvo three ≥ r15x con `computeBoundingBox` por frame; verificar).
- Robusto: leer el alpha del píxel bajo el cursor con `renderer.readRenderTargetPixels`
  sobre un render target pequeño (throttle 15–30 Hz).
- Para la input region (ADR-0002): rejilla de 16 px sobre el alpha del frame →
  fusionar celdas en rectángulos → `set_input_region`.

## Liberar memoria al cambiar de avatar

`scene.remove(vrm.scene); VRMUtils.deepDispose(vrm.scene);`
