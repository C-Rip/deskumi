import * as THREE from "three";
import type { VRM } from "@pixiv/three-vrm";
import type { System } from "./types";

/**
 * Maps pointer client coordinates to Three.js Normalized Device Coordinates (NDC) in [-1, 1].
 *
 * @param clientX Mouse event clientX.
 * @param clientY Mouse event clientY.
 * @param width Viewport width in pixels.
 * @param height Viewport height in pixels.
 * @returns Clamped NDC coordinates { x, y }.
 */
export function calcNdcFromMouse(
  clientX: number,
  clientY: number,
  width: number,
  height: number
): { x: number; y: number } {
  if (width <= 0 || height <= 0) {
    return { x: 0, y: 0 };
  }
  const rawX = (clientX / width) * 2 - 1;
  const rawY = -(clientY / height) * 2 + 1;
  return {
    x: Math.max(-1, Math.min(1, rawX)),
    y: Math.max(-1, Math.min(1, rawY))
  };
}

/**
 * Calculates local yaw and pitch angles in radians from relative head-to-target offset.
 *
 * @param dx Horizontal offset (X axis; positive is viewer's right).
 * @param dy Vertical offset (Y axis; positive is up).
 * @param dz Forward offset (Z axis; positive is towards camera/forward).
 * @returns Yaw (around Y axis) and pitch (around X axis) in radians.
 */
export function calcYawPitchFromOffset(
  dx: number,
  dy: number,
  dz: number
): { yaw: number; pitch: number } {
  const forwardZ = Math.max(dz, 1e-4);
  const distanceXZ = Math.hypot(dx, forwardZ);
  const yaw = Math.atan2(dx, forwardZ);
  const pitch = -Math.atan2(dy, Math.max(distanceXZ, 1e-4));
  return { yaw, pitch };
}

/**
 * Clamps an angle in radians within [-maxAngleRad, maxAngleRad].
 */
export function clampAngle(angleRad: number, maxAngleRad: number): number {
  const limit = Math.abs(maxAngleRad);
  return Math.max(-limit, Math.min(limit, angleRad));
}

/**
 * Clamps yaw and pitch angles within their respective anatomical limits.
 */
export function clampAngles(
  yaw: number,
  pitch: number,
  maxYawRad: number,
  maxPitchRad: number
): { yaw: number; pitch: number } {
  return {
    yaw: clampAngle(yaw, maxYawRad),
    pitch: clampAngle(pitch, maxPitchRad)
  };
}

/**
 * Calculates yaw and pitch angles from cursor NDC relative to face/origin NDC,
 * dividing the window frame into 4 quadrants centered at the face with exponential curve response.
 *
 * @param cursorNdc Current pointer NDC coordinates in [-1, 1].
 * @param originNdc Face or center origin NDC coordinates in [-1, 1].
 * @param maxYaw Maximum yaw angle in radians.
 * @param maxPitch Maximum pitch angle in radians.
 * @param exponent Non-linear curve power (default 1.6: subtle around center, progressive towards edges).
 */
export function calcQuadrantExponentialAngles(
  cursorNdc: { x: number; y: number },
  originNdc: { x: number; y: number },
  maxYaw: number,
  maxPitch: number,
  exponent = 1.6
): { yaw: number; pitch: number } {
  const dx = cursorNdc.x - originNdc.x;
  const dy = cursorNdc.y - originNdc.y;

  // Horizontal quadrant span from origin to boundaries [-1, 1]
  const spanX = dx >= 0 ? 1.0 - originNdc.x : originNdc.x - -1.0;
  const normX = spanX > 1e-4 ? Math.max(-1.0, Math.min(1.0, dx / spanX)) : 0.0;
  const yaw = Math.sign(normX) * Math.pow(Math.abs(normX), exponent) * maxYaw;

  // Vertical quadrant span from origin to boundaries [-1, 1]
  const spanY = dy >= 0 ? 1.0 - originNdc.y : originNdc.y - -1.0;
  const normY = spanY > 1e-4 ? Math.max(-1.0, Math.min(1.0, dy / spanY)) : 0.0;
  // Three.js Euler X: pitch > 0 tilts head downwards (dy < 0), pitch < 0 tilts head upwards (dy > 0)
  const pitch =
    -Math.sign(normY) * Math.pow(Math.abs(normY), exponent) * maxPitch;

  return {
    yaw: clampAngle(yaw, maxYaw),
    pitch: clampAngle(pitch, maxPitch)
  };
}

/**
 * Computes a 3D target position from head position, yaw, pitch and forward direction.
 */
export function calcTargetFromYawPitch(
  headPos: THREE.Vector3,
  yaw: number,
  pitch: number,
  targetDistance: number,
  avatarQuat: THREE.Quaternion | null,
  out: THREE.Vector3
): THREE.Vector3 {
  const cosPitch = Math.cos(pitch);
  _tempHeadToTarget.set(
    targetDistance * Math.sin(yaw) * cosPitch,
    -targetDistance * Math.sin(pitch),
    targetDistance * Math.cos(yaw) * cosPitch
  );
  if (avatarQuat) {
    _tempHeadToTarget.applyQuaternion(avatarQuat);
  }
  return out.copy(headPos).add(_tempHeadToTarget);
}

// Module-scope temporary vectors for allocation-free updates
const _ndcVec = new THREE.Vector2();
const _raycaster = new THREE.Raycaster();
const _targetPlane = new THREE.Plane();
const _tempCameraDir = new THREE.Vector3();
const _tempPlaneNormal = new THREE.Vector3();
const _tempPlanePoint = new THREE.Vector3();
const _tempHeadPos = new THREE.Vector3();
const _tempHeadNdc = new THREE.Vector3();
const _tempAvatarForward = new THREE.Vector3();
const _tempAvatarQuat = new THREE.Quaternion();
const _tempHeadToTarget = new THREE.Vector3();
const _tempDefaultHeadOffset = new THREE.Vector3(0, 1.4, 0);

/**
 * Projects NDC coordinates through camera onto a plane in front of the avatar.
 */
export function calcTargetPlanePosition(
  camera: THREE.Camera,
  ndc: { x: number; y: number },
  headPos: THREE.Vector3,
  targetDistance: number,
  out: THREE.Vector3
): THREE.Vector3 {
  _ndcVec.set(ndc.x, ndc.y);
  _raycaster.setFromCamera(_ndcVec, camera);

  camera.getWorldDirection(_tempCameraDir);
  _tempPlaneNormal.copy(_tempCameraDir).negate();

  _tempPlanePoint
    .copy(headPos)
    .addScaledVector(_tempPlaneNormal, targetDistance);
  _targetPlane.setFromNormalAndCoplanarPoint(_tempPlaneNormal, _tempPlanePoint);

  const hit = _raycaster.ray.intersectPlane(_targetPlane, out);
  if (hit) {
    return out;
  }
  return _raycaster.ray.at(targetDistance, out);
}

export interface LookAtSystemOptions {
  /**
   * Perspective or orthographic camera used for unprojecting mouse coordinates.
   */
  camera: THREE.Camera;

  /**
   * Optional scene to which the target Object3D will be added.
   */
  scene?: THREE.Scene;

  /**
   * Target element or window to listen for mouse events.
   */
  targetElement?: HTMLElement | Window;

  /**
   * Distance in front of the avatar where the target plane sits (in meters).
   * @default 1.0
   */
  targetDistance?: number;

  /**
   * Maximum yaw rotation in radians (left/right). Default is ±30° (π/6).
   * @default Math.PI / 6
   */
  maxYaw?: number;

  /**
   * Maximum pitch rotation in radians (up/down). Default is ±30° (π/6).
   * @default Math.PI / 6
   */
  maxPitch?: number;

  /**
   * Proportion of rotation applied to neck vs head (0.0 to 1.0).
   * @default 0.3
   */
  neckWeight?: number;

  /**
   * Damping smoothing factor for exponential decay: 1 - exp(-damping * dt).
   * @default 10.0
   */
  damping?: number;

  /**
   * Inactivity timeout in seconds before returning to neutral front position.
   * @default 3.0
   */
  idleTimeout?: number;

  /**
   * Whether to rotate head and neck alongside eyes.
   * @default true
   */
  enableHeadRotation?: boolean;

  /**
   * Whether to automatically register DOM mouse listeners.
   * @default true
   */
  autoAttachListeners?: boolean;
}

/**
 * LookAtSystem tracks pointer motion with avatar eyes (`vrm.lookAt`) and head/neck,
 * applying lerp damping, anatomical angular clamping (±30°), and smooth neutral reset.
 */
export class LookAtSystem implements System {
  public readonly vrm: VRM;
  public readonly camera: THREE.Camera;
  public readonly target: THREE.Object3D;

  public targetDistance: number;
  public maxYaw: number;
  public maxPitch: number;
  public neckWeight: number;
  public damping: number;
  public idleTimeout: number;
  public enableHeadRotation: boolean;

  private isDisposed = false;
  private isMouseOutside = false;
  private timeSinceLastMove = 0;
  private hasReceivedInput = false;

  private currentYaw = 0;
  private currentPitch = 0;

  private readonly lastMouseNdc = { x: 0, y: 0 };
  private readonly currentTargetPosition = new THREE.Vector3();
  private readonly desiredTargetPosition = new THREE.Vector3();
  private readonly neutralTargetPosition = new THREE.Vector3();

  private readonly headNode: THREE.Object3D | null;
  private readonly neckNode: THREE.Object3D | null;
  private readonly baseHeadRotation: THREE.Euler;
  private readonly baseNeckRotation: THREE.Euler;

  private readonly targetElement: HTMLElement | Window | undefined;
  private readonly onMouseMoveListener: (e: MouseEvent) => void;
  private readonly onMouseLeaveListener: () => void;
  private readonly onMouseEnterListener: () => void;

  constructor(vrm: VRM, options: LookAtSystemOptions) {
    this.vrm = vrm;
    this.camera = options.camera;

    this.targetDistance = options.targetDistance ?? 1.0;
    this.maxYaw = options.maxYaw ?? Math.PI / 6;
    this.maxPitch = options.maxPitch ?? Math.PI / 6;
    this.neckWeight = Math.max(0, Math.min(1, options.neckWeight ?? 0.3));
    this.damping = options.damping ?? 10.0;
    this.idleTimeout = options.idleTimeout ?? 3.0;
    this.enableHeadRotation = options.enableHeadRotation ?? true;

    // 1. Target Object3D setup
    this.target = new THREE.Object3D();
    this.target.name = "LookAtTarget";
    if (options.scene) {
      options.scene.add(this.target);
    }
    if (this.vrm.lookAt) {
      this.vrm.lookAt.target = this.target;
      this.vrm.lookAt.autoUpdate = true;
    }

    // 2. Bone references and base rotations
    this.headNode = vrm.humanoid?.getNormalizedBoneNode("head") ?? null;
    this.neckNode = vrm.humanoid?.getNormalizedBoneNode("neck") ?? null;
    this.baseHeadRotation = this.headNode
      ? this.headNode.rotation.clone()
      : new THREE.Euler();
    this.baseNeckRotation = this.neckNode
      ? this.neckNode.rotation.clone()
      : new THREE.Euler();

    // 3. Initialize neutral and target positions
    this.getHeadWorldPosition(_tempHeadPos);
    this.getAvatarForwardDirection(_tempAvatarForward);
    this.neutralTargetPosition
      .copy(_tempHeadPos)
      .addScaledVector(_tempAvatarForward, this.targetDistance);
    this.desiredTargetPosition.copy(this.neutralTargetPosition);
    this.currentTargetPosition.copy(this.neutralTargetPosition);
    this.target.position.copy(this.currentTargetPosition);

    // 4. Mouse event listeners
    this.onMouseMoveListener = (e: MouseEvent) => {
      const width =
        this.targetElement && "innerWidth" in this.targetElement
          ? this.targetElement.innerWidth
          : (this.targetElement as HTMLElement)?.clientWidth ||
            (typeof window !== "undefined" ? window.innerWidth : 800);
      const height =
        this.targetElement && "innerHeight" in this.targetElement
          ? this.targetElement.innerHeight
          : (this.targetElement as HTMLElement)?.clientHeight ||
            (typeof window !== "undefined" ? window.innerHeight : 600);

      const ndc = calcNdcFromMouse(e.clientX, e.clientY, width, height);
      this.setCursorNdc(ndc.x, ndc.y);
    };

    this.onMouseLeaveListener = () => {
      this.isMouseOutside = true;
    };

    this.onMouseEnterListener = () => {
      this.isMouseOutside = false;
      this.timeSinceLastMove = 0;
    };

    const attachListeners = options.autoAttachListeners ?? true;
    if (attachListeners) {
      this.targetElement =
        options.targetElement ??
        (typeof window !== "undefined" ? window : undefined);
      if (this.targetElement) {
        this.targetElement.addEventListener(
          "mousemove",
          this.onMouseMoveListener as EventListener
        );
        this.targetElement.addEventListener(
          "mouseleave",
          this.onMouseLeaveListener as EventListener
        );
      }
      if (typeof document !== "undefined") {
        document.addEventListener("mouseleave", this.onMouseLeaveListener);
        document.addEventListener("mouseenter", this.onMouseEnterListener);
      }
    }
  }

  public get disposed(): boolean {
    return this.isDisposed;
  }

  public get currentTargetPos(): THREE.Vector3 {
    return this.currentTargetPosition;
  }

  public get desiredTargetPos(): THREE.Vector3 {
    return this.desiredTargetPosition;
  }

  public get neutralTargetPos(): THREE.Vector3 {
    return this.neutralTargetPosition;
  }

  public get isIdle(): boolean {
    return (
      this.isMouseOutside ||
      this.timeSinceLastMove >= this.idleTimeout ||
      !this.hasReceivedInput
    );
  }

  public get lastYaw(): number {
    return this.currentYaw;
  }

  public get lastPitch(): number {
    return this.currentPitch;
  }

  /**
   * Sets normalized cursor position directly in [-1, 1] range.
   */
  public setCursorNdc(ndcX: number, ndcY: number): void {
    this.lastMouseNdc.x = Math.max(-1, Math.min(1, ndcX));
    this.lastMouseNdc.y = Math.max(-1, Math.min(1, ndcY));
    this.isMouseOutside = false;
    this.hasReceivedInput = true;
    this.timeSinceLastMove = 0;
  }

  /**
   * Manually flags whether mouse cursor is outside of the window.
   */
  public setMouseOutside(isOutside: boolean): void {
    this.isMouseOutside = isOutside;
    if (!isOutside) {
      this.timeSinceLastMove = 0;
    }
  }

  /**
   * Resets target directly to neutral front position.
   */
  public resetToNeutral(): void {
    this.isMouseOutside = true;
    this.desiredTargetPosition.copy(this.neutralTargetPosition);
    this.currentTargetPosition.copy(this.neutralTargetPosition);
    this.target.position.copy(this.currentTargetPosition);
    this.applyHeadNeckAngles(0, 0);
  }

  /**
   * Updates lookAt target position and head/neck rotations.
   * @param dt Elapsed seconds since last frame.
   */
  public update(dt: number): void {
    if (this.isDisposed || dt <= 0) {
      return;
    }

    this.timeSinceLastMove += dt;

    // 1. Refresh head position and neutral target
    this.getHeadWorldPosition(_tempHeadPos);
    this.getAvatarForwardDirection(_tempAvatarForward);
    this.neutralTargetPosition
      .copy(_tempHeadPos)
      .addScaledVector(_tempAvatarForward, this.targetDistance);

    // 2. Select desired target (neutral if outside, idle, or uninitialized)
    if (this.isIdle) {
      this.desiredTargetPosition.copy(this.neutralTargetPosition);
    } else {
      // Project head world position to NDC screen coordinates
      _tempHeadNdc.copy(_tempHeadPos).project(this.camera);

      // Compute natural 4-quadrant exponential angles centered at the face
      const { yaw, pitch } = calcQuadrantExponentialAngles(
        this.lastMouseNdc,
        { x: _tempHeadNdc.x, y: _tempHeadNdc.y },
        this.maxYaw,
        this.maxPitch
      );

      // Generate 3D lookAt target point from exponential angles
      this.vrm.scene.getWorldQuaternion(_tempAvatarQuat);
      calcTargetFromYawPitch(
        _tempHeadPos,
        yaw,
        pitch,
        this.targetDistance,
        _tempAvatarQuat,
        this.desiredTargetPosition
      );
    }

    // 3. Smooth damping towards desired target
    const lerpFactor = 1 - Math.exp(-this.damping * dt);
    this.currentTargetPosition.lerp(this.desiredTargetPosition, lerpFactor);
    this.target.position.copy(this.currentTargetPosition);

    // 4. Smooth head and neck rotation with angular limits (±30°)
    if (this.enableHeadRotation) {
      this.updateHeadAndNeckRotation(_tempHeadPos);
    }
  }

  /**
   * Computes clamped yaw/pitch and updates head and neck nodes.
   */
  private updateHeadAndNeckRotation(headPos: THREE.Vector3): void {
    _tempHeadToTarget.copy(this.currentTargetPosition).sub(headPos);

    // Transform into avatar local space to account for character orientation
    this.vrm.scene.getWorldQuaternion(_tempAvatarQuat).invert();
    _tempHeadToTarget.applyQuaternion(_tempAvatarQuat);

    const dx = _tempHeadToTarget.x;
    const dy = _tempHeadToTarget.y;
    const dz = Math.max(_tempHeadToTarget.z, 1e-4);

    const { yaw, pitch } = calcYawPitchFromOffset(dx, dy, dz);
    const clampedYaw = clampAngle(yaw, this.maxYaw);
    const clampedPitch = clampAngle(pitch, this.maxPitch);

    this.applyHeadNeckAngles(clampedYaw, clampedPitch);
  }

  /**
   * Applies clamped yaw/pitch distributed across neck and head bones.
   */
  private applyHeadNeckAngles(yaw: number, pitch: number): void {
    this.currentYaw = yaw;
    this.currentPitch = pitch;

    const neckW = this.neckNode ? this.neckWeight : 0;
    const headW = 1 - neckW;

    if (this.neckNode) {
      this.neckNode.rotation.x = this.baseNeckRotation.x + pitch * neckW;
      this.neckNode.rotation.y = this.baseNeckRotation.y + yaw * neckW;
      this.neckNode.rotation.z = this.baseNeckRotation.z;
    }

    if (this.headNode) {
      this.headNode.rotation.x = this.baseHeadRotation.x + pitch * headW;
      this.headNode.rotation.y = this.baseHeadRotation.y + yaw * headW;
      this.headNode.rotation.z = this.baseHeadRotation.z;
    }
  }

  private getHeadWorldPosition(out: THREE.Vector3): THREE.Vector3 {
    if (this.vrm.lookAt) {
      return this.vrm.lookAt.getLookAtWorldPosition(out);
    }
    if (this.headNode) {
      return this.headNode.getWorldPosition(out);
    }
    return out.copy(this.vrm.scene.position).add(_tempDefaultHeadOffset);
  }

  private getAvatarForwardDirection(out: THREE.Vector3): THREE.Vector3 {
    out.set(0, 0, 1);
    return out.applyQuaternion(
      this.vrm.scene.getWorldQuaternion(_tempAvatarQuat)
    );
  }

  /**
   * Disposes of listeners, detaches lookAt target, and restores bone rotations.
   */
  public dispose(): void {
    if (this.isDisposed) {
      return;
    }
    this.isDisposed = true;

    if (this.targetElement) {
      this.targetElement.removeEventListener(
        "mousemove",
        this.onMouseMoveListener as EventListener
      );
      this.targetElement.removeEventListener(
        "mouseleave",
        this.onMouseLeaveListener as EventListener
      );
    }
    if (typeof document !== "undefined") {
      document.removeEventListener("mouseleave", this.onMouseLeaveListener);
      document.removeEventListener("mouseenter", this.onMouseEnterListener);
    }

    if (this.target.parent) {
      this.target.parent.remove(this.target);
    }

    if (this.vrm.lookAt && this.vrm.lookAt.target === this.target) {
      this.vrm.lookAt.target = null;
    }

    if (this.headNode) {
      this.headNode.rotation.copy(this.baseHeadRotation);
    }
    if (this.neckNode) {
      this.neckNode.rotation.copy(this.baseNeckRotation);
    }
  }
}
