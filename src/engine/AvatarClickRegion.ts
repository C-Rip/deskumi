import * as THREE from "three";
import type { VRM } from "@pixiv/three-vrm";
import type { ClickRegion } from "./AvatarCommand";

const _neckWorldPos = new THREE.Vector3();

/**
 * Projects the VRM `neck` (or fallback `head`) bone to screen Y and returns
 * `"head"` when `clientY` is above the neck, else `"body"`.
 */
export function classifyClickRegion(
  vrm: VRM,
  camera: THREE.Camera,
  clientY: number,
  viewportHeight: number
): ClickRegion {
  if (viewportHeight <= 0 || !Number.isFinite(clientY)) return "body";
  const bone =
    vrm.humanoid?.getNormalizedBoneNode("neck") ??
    vrm.humanoid?.getNormalizedBoneNode("head") ??
    vrm.humanoid?.getRawBoneNode("neck") ??
    vrm.humanoid?.getRawBoneNode("head") ??
    null;
  if (!bone) return "body";
  bone.updateWorldMatrix(true, false);
  camera.updateMatrixWorld();
  bone.getWorldPosition(_neckWorldPos);
  _neckWorldPos.project(camera);
  if (!Number.isFinite(_neckWorldPos.y)) return "body";
  const neckClientY = (1 - _neckWorldPos.y) * 0.5 * viewportHeight;
  return clientY < neckClientY ? "head" : "body";
}
