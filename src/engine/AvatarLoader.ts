import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { VRMLoaderPlugin, VRMUtils, type VRM } from "@pixiv/three-vrm";
import type { VRMLoaderPluginOptions } from "@pixiv/three-vrm";

/**
 * Options for loading a VRM model.
 */
export interface AvatarLoadOptions {
  /** Optional loading progress callback */
  onProgress?: (event: ProgressEvent<EventTarget>) => void;
  /** Custom options passed directly to VRMLoaderPlugin */
  pluginOptions?: VRMLoaderPluginOptions;
  /** Optional custom Three.js LoadingManager */
  loadingManager?: THREE.LoadingManager;
}

/**
 * Options for grounding and centering an object.
 */
export interface GroundOptions {
  /**
   * If true, center object horizontally along X and Z axes.
   * @default true
   */
  centerHorizontal?: boolean;
  /**
   * Target world Y coordinate for the base / feet of the model.
   * @default 0
   */
  groundY?: number;
}

/**
 * Computed bounding box, size, and center information.
 */
export interface BoundsInfo {
  box: THREE.Box3;
  size: THREE.Vector3;
  center: THREE.Vector3;
}

/**
 * Framing parameters for perspective camera.
 */
export interface PerspectiveFraming {
  target: THREE.Vector3;
  cameraPosition: THREE.Vector3;
  distance: number;
}

/**
 * Frustum bounds for orthographic camera.
 */
export interface OrthoFraming {
  left: number;
  right: number;
  top: number;
  bottom: number;
  target: THREE.Vector3;
}

/**
 * Loads a VRM avatar from a URL string or an ArrayBuffer.
 *
 * Configures GLTFLoader with VRMLoaderPlugin, validates that the file is
 * indeed a VRM asset, applies geometry/skeleton normalizations
 * (`removeUnnecessaryVertices`, `combineSkeletons`, `rotateVRM0`), and disables
 * frustum culling so skinned meshes do not disappear when looking away.
 *
 * @param source URL string or ArrayBuffer containing the VRM / GLB data.
 * @param options Loading options including progress callback and plugin configuration.
 * @returns Promise resolving to the initialized VRM instance.
 */
export async function loadVRM(
  source: string | ArrayBuffer,
  options: AvatarLoadOptions = {}
): Promise<VRM> {
  const loader = new GLTFLoader(options.loadingManager);
  loader.register(
    (parser) => new VRMLoaderPlugin(parser, options.pluginOptions)
  );

  const gltf =
    typeof source === "string"
      ? await loader.loadAsync(source, options.onProgress)
      : await loader.parseAsync(source, "");

  const vrm = gltf.userData.vrm as VRM | undefined;
  if (!vrm) {
    throw new Error(
      typeof source === "string"
        ? `Not a valid VRM model: ${source}`
        : "Not a valid VRM model: GLTF does not contain VRM metadata"
    );
  }

  // Optimize and normalize VRM model
  VRMUtils.removeUnnecessaryVertices(gltf.scene);
  VRMUtils.combineSkeletons(gltf.scene);
  VRMUtils.rotateVRM0(vrm);

  // Avoid frustum culling glitches with skinned bone animations
  vrm.scene.traverse((obj) => {
    obj.frustumCulled = false;
  });

  return vrm;
}

/**
 * Computes world-space bounding box for an Object3D hierarchy.
 * Calls `updateWorldMatrix(true, true)` before computation to ensure fresh transforms.
 */
export function computeBounds(object: THREE.Object3D): THREE.Box3 {
  object.updateWorldMatrix(true, true);
  return new THREE.Box3().setFromObject(object);
}

/**
 * Computes bounding box, dimensional size, and center point for an object.
 */
export function getBoundsInfo(object: THREE.Object3D): BoundsInfo {
  const box = computeBounds(object);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);
  return { box, size, center };
}

/**
 * Repositions an object so its feet/base rest on the floor (groundY, default 0)
 * and centers horizontally (X and Z) if requested.
 *
 * @param object Object3D to ground and center (e.g. `vrm.scene`).
 * @param options Grounding options.
 * @returns Updated bounding box after repositioning.
 */
export function centerAndGround(
  object: THREE.Object3D,
  options: GroundOptions = {}
): THREE.Box3 {
  const { centerHorizontal = true, groundY = 0 } = options;

  const initialBounds = computeBounds(object);
  if (initialBounds.isEmpty()) {
    return initialBounds;
  }

  // Adjust Y so min.y aligns with groundY
  const deltaY = groundY - initialBounds.min.y;
  object.position.y += deltaY;

  // Center horizontally along X and Z
  if (centerHorizontal) {
    const centerX = (initialBounds.min.x + initialBounds.max.x) / 2;
    const centerZ = (initialBounds.min.z + initialBounds.max.z) / 2;
    object.position.x -= centerX;
    object.position.z -= centerZ;
  }

  return computeBounds(object);
}

/**
 * Convenience wrapper to center and ground a VRM avatar's scene.
 */
export function centerAndGroundVRM(
  vrm: VRM,
  options: GroundOptions = {}
): THREE.Box3 {
  return centerAndGround(vrm.scene, options);
}

/**
 * Scales an Object3D proportionally so that its total height matches `targetHeight`.
 *
 * @param object Object3D to scale.
 * @param targetHeight Desired height in world units (must be > 0).
 * @returns Applied scale factor (newScale / oldScale).
 */
export function scaleToHeight(
  object: THREE.Object3D,
  targetHeight: number
): number {
  if (targetHeight <= 0) {
    throw new Error(`targetHeight must be positive, got ${targetHeight}`);
  }

  const bounds = computeBounds(object);
  const currentHeight = bounds.max.y - bounds.min.y;
  if (currentHeight <= 0) {
    return 1;
  }

  const factor = targetHeight / currentHeight;
  object.scale.multiplyScalar(factor);
  object.updateWorldMatrix(true, true);
  return factor;
}

/**
 * Calculates optimal distance for a perspective camera to frame an object of given height.
 * Formula: distance = (height / 2) / tan(fov / 2) * margin
 *
 * @param height Height of the subject in world units.
 * @param fovDegrees Vertical field of view in degrees.
 * @param margin Safety margin multiplier (defaults to 1.1 = 10% breathing room).
 */
export function calculateCameraDistance(
  height: number,
  fovDegrees: number,
  margin = 1.1
): number {
  if (height <= 0) return 0;
  if (fovDegrees <= 0 || fovDegrees >= 180) {
    throw new Error(`fovDegrees must be in (0, 180), got ${fovDegrees}`);
  }
  const fovRad = (fovDegrees * Math.PI) / 180;
  return (height / 2 / Math.tan(fovRad / 2)) * margin;
}

/**
 * Computes perspective camera placement and look-at target to frame an object's bounding box.
 *
 * @param box Bounding box of the object.
 * @param fovDegrees Vertical field of view in degrees.
 * @param margin Margin multiplier (default 1.1).
 */
export function calculatePerspectiveFraming(
  box: THREE.Box3,
  fovDegrees: number,
  margin = 1.1
): PerspectiveFraming {
  const target = new THREE.Vector3();
  const size = new THREE.Vector3();
  box.getCenter(target);
  box.getSize(size);

  const distance = calculateCameraDistance(size.y, fovDegrees, margin);
  const cameraPosition = new THREE.Vector3(
    target.x,
    target.y,
    target.z + distance
  );

  return { target, cameraPosition, distance };
}

/**
 * Computes orthographic camera frustum planes to snugly frame an object's bounding box.
 *
 * @param box Bounding box of the object.
 * @param aspect Viewport aspect ratio (width / height).
 * @param margin Margin multiplier (default 1.1).
 */
export function calculateOrthoFraming(
  box: THREE.Box3,
  aspect: number,
  margin = 1.1
): OrthoFraming {
  if (aspect <= 0) {
    throw new Error(`aspect must be positive, got ${aspect}`);
  }
  const target = new THREE.Vector3();
  const size = new THREE.Vector3();
  box.getCenter(target);
  box.getSize(size);

  const framedHeight = size.y * margin;
  const framedWidth = framedHeight * aspect;

  const halfH = framedHeight / 2;
  const halfW = framedWidth / 2;

  return {
    left: -halfW,
    right: halfW,
    top: halfH,
    bottom: -halfH,
    target
  };
}

/**
 * Recursively disposes an Object3D hierarchy and frees textures, materials, and geometries.
 * Also removes the object from its parent if present.
 */
export function disposeObject(object: THREE.Object3D): void {
  if (object.parent) {
    object.parent.remove(object);
  }
  VRMUtils.deepDispose(object);
}

/**
 * Safely disposes a VRM avatar:
 * removes it from the scene graph and frees all GPU buffers, geometries, materials, and textures.
 */
export function disposeVRM(vrm: VRM): void {
  disposeObject(vrm.scene);
}
