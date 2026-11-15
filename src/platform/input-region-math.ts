import * as THREE from "three";

/**
 * 2D rectangle in window client/logical pixel coordinates.
 */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Normalizes an array of rects by rounding coordinates to integers
 * and filtering out non-positive dimensions.
 * Returns null if the input is null (representing the full window).
 */
export function normalizeRects(rects: readonly Rect[] | null): Rect[] | null {
  if (rects === null) {
    return null;
  }
  return rects
    .map((r) => ({
      x: Math.round(r.x),
      y: Math.round(r.y),
      w: Math.round(r.w),
      h: Math.round(r.h)
    }))
    .filter((r) => r.w > 0 && r.h > 0);
}

/**
 * Compares two rect arrays for equality.
 */
export function areRectsEqual(
  a: readonly Rect[] | null,
  b: readonly Rect[] | null
): boolean {
  if (a === b) {
    return true;
  }
  if (a === null || b === null) {
    return false;
  }
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    const ra = a[i];
    const rb = b[i];
    if (ra.x !== rb.x || ra.y !== rb.y || ra.w !== rb.w || ra.h !== rb.h) {
      return false;
    }
  }
  return true;
}

/**
 * Checks whether a 2D point (x, y) in window logical coordinates lies inside
 * any of the provided silhouette/hitbox rectangles.
 */
export function isPointInRects(
  x: number,
  y: number,
  rects: readonly Rect[] | null | undefined
): boolean {
  if (!rects || rects.length === 0) {
    return false;
  }
  for (const r of rects) {
    if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) {
      return true;
    }
  }
  return false;
}

/**
 * Projects the 3D bounding box of an Object3D into 2D screen/client coordinates.
 */
export function calculateScreenBoundingBox(
  object: THREE.Object3D,
  camera: THREE.Camera,
  viewportWidth: number,
  viewportHeight: number,
  padding = 0
): Rect | null {
  if (viewportWidth <= 0 || viewportHeight <= 0) {
    return null;
  }

  const box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty()) {
    return null;
  }

  camera.updateMatrixWorld(true);

  const corners: THREE.Vector3[] = [
    new THREE.Vector3(box.min.x, box.min.y, box.min.z),
    new THREE.Vector3(box.min.x, box.min.y, box.max.z),
    new THREE.Vector3(box.min.x, box.max.y, box.min.z),
    new THREE.Vector3(box.min.x, box.max.y, box.max.z),
    new THREE.Vector3(box.max.x, box.min.y, box.min.z),
    new THREE.Vector3(box.max.x, box.min.y, box.max.z),
    new THREE.Vector3(box.max.x, box.max.y, box.min.z),
    new THREE.Vector3(box.max.x, box.max.y, box.max.z)
  ];

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (const corner of corners) {
    corner.project(camera);

    const px = ((corner.x + 1) / 2) * viewportWidth;
    const py = ((1 - corner.y) / 2) * viewportHeight;

    if (px < minX) minX = px;
    if (px > maxX) maxX = px;
    if (py < minY) minY = py;
    if (py > maxY) maxY = py;
  }

  if (
    !Number.isFinite(minX) ||
    !Number.isFinite(maxX) ||
    !Number.isFinite(minY) ||
    !Number.isFinite(maxY)
  ) {
    return null;
  }

  const x0 = Math.max(0, Math.floor(minX - padding));
  const y0 = Math.max(0, Math.floor(minY - padding));
  const x1 = Math.min(viewportWidth, Math.ceil(maxX + padding));
  const y1 = Math.min(viewportHeight, Math.ceil(maxY + padding));

  const w = Math.max(0, x1 - x0);
  const h = Math.max(0, y1 - y0);

  if (w <= 0 || h <= 0) {
    return null;
  }

  return { x: x0, y: y0, w, h };
}

function projectSphereToScreenRect(
  worldPos: THREE.Vector3,
  radiusMeters: number,
  camera: THREE.Camera,
  viewportWidth: number,
  viewportHeight: number,
  padding = 0
): Rect | null {
  const p = worldPos.clone().project(camera);
  if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || p.z < -1 || p.z > 1) {
    return null;
  }

  const cx = ((p.x + 1) / 2) * viewportWidth;
  const cy = ((1 - p.y) / 2) * viewportHeight;

  const offset = worldPos
    .clone()
    .add(new THREE.Vector3(radiusMeters, 0, 0))
    .project(camera);
  const pxRadius =
    Math.max(12, Math.abs(((offset.x + 1) / 2) * viewportWidth - cx)) + padding;

  const x0 = Math.max(0, Math.floor(cx - pxRadius));
  const y0 = Math.max(0, Math.floor(cy - pxRadius));
  const x1 = Math.min(viewportWidth, Math.ceil(cx + pxRadius));
  const y1 = Math.min(viewportHeight, Math.ceil(cy + pxRadius));

  const w = x1 - x0;
  const h = y1 - y0;
  if (w <= 0 || h <= 0) return null;

  return { x: x0, y: y0, w, h };
}

function projectBoneSegment(
  nodes: (THREE.Object3D | null | undefined)[],
  radiusMeters: number,
  camera: THREE.Camera,
  viewportWidth: number,
  viewportHeight: number,
  padding = 0
): Rect | null {
  const validNodes = nodes.filter((n): n is THREE.Object3D => n != null);
  if (validNodes.length === 0) return null;

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (const node of validNodes) {
    const worldPos = new THREE.Vector3();
    node.getWorldPosition(worldPos);

    const rect = projectSphereToScreenRect(
      worldPos,
      radiusMeters,
      camera,
      viewportWidth,
      viewportHeight,
      padding
    );
    if (rect) {
      if (rect.x < minX) minX = rect.x;
      if (rect.x + rect.w > maxX) maxX = rect.x + rect.w;
      if (rect.y < minY) minY = rect.y;
      if (rect.y + rect.h > maxY) maxY = rect.y + rect.h;
    }
  }

  if (
    !Number.isFinite(minX) ||
    !Number.isFinite(maxX) ||
    !Number.isFinite(minY) ||
    !Number.isFinite(maxY) ||
    maxX <= minX ||
    maxY <= minY
  ) {
    return null;
  }

  return {
    x: Math.round(minX),
    y: Math.round(minY),
    w: Math.round(maxX - minX),
    h: Math.round(maxY - minY)
  };
}

/**
 * Calculates segmented anatomical input rects for a VRM avatar
 * (head, torso, left/right arms, left/right legs) so negative space between limbs
 * and on the sides cleanly passes clicks through to background apps.
 */
export function calculateAvatarSegmentRects(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vrm: any,
  camera: THREE.Camera,
  viewportWidth: number,
  viewportHeight: number,
  padding = 8
): Rect[] {
  if (!vrm || viewportWidth <= 0 || viewportHeight <= 0) {
    return [];
  }

  camera.updateMatrixWorld(true);

  const humanoid = vrm.humanoid;
  if (!humanoid) {
    const full = calculateScreenBoundingBox(
      vrm.scene ?? vrm,
      camera,
      viewportWidth,
      viewportHeight,
      padding
    );
    return full ? [full] : [];
  }

  const getBone = (name: string): THREE.Object3D | null => {
    return (
      humanoid.getNormalizedBoneNode?.(name) ??
      humanoid.getRawBoneNode?.(name) ??
      null
    );
  };

  const rects: Rect[] = [];

  const headRect = projectBoneSegment(
    [getBone("head"), getBone("neck")],
    0.13,
    camera,
    viewportWidth,
    viewportHeight,
    padding
  );
  if (headRect) rects.push(headRect);

  const torsoRect = projectBoneSegment(
    [getBone("chest"), getBone("spine"), getBone("hips")],
    0.11,
    camera,
    viewportWidth,
    viewportHeight,
    padding
  );
  if (torsoRect) rects.push(torsoRect);

  const leftArmRect = projectBoneSegment(
    [getBone("leftUpperArm"), getBone("leftLowerArm"), getBone("leftHand")],
    0.045,
    camera,
    viewportWidth,
    viewportHeight,
    padding
  );
  if (leftArmRect) rects.push(leftArmRect);

  const rightArmRect = projectBoneSegment(
    [getBone("rightUpperArm"), getBone("rightLowerArm"), getBone("rightHand")],
    0.045,
    camera,
    viewportWidth,
    viewportHeight,
    padding
  );
  if (rightArmRect) rects.push(rightArmRect);

  const leftLegRect = projectBoneSegment(
    [getBone("leftUpperLeg"), getBone("leftLowerLeg"), getBone("leftFoot")],
    0.045,
    camera,
    viewportWidth,
    viewportHeight,
    padding
  );
  if (leftLegRect) rects.push(leftLegRect);

  const rightLegRect = projectBoneSegment(
    [getBone("rightUpperLeg"), getBone("rightLowerLeg"), getBone("rightFoot")],
    0.045,
    camera,
    viewportWidth,
    viewportHeight,
    padding
  );
  if (rightLegRect) rects.push(rightLegRect);

  if (rects.length === 0) {
    const fallback = calculateScreenBoundingBox(
      vrm.scene ?? vrm,
      camera,
      viewportWidth,
      viewportHeight,
      padding
    );
    if (fallback) rects.push(fallback);
  }

  return rects;
}
