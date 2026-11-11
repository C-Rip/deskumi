import * as THREE from "three";
import type { VRM } from "@pixiv/three-vrm";
import type { System } from "./types";
import { BlinkController } from "./BlinkController";
import type { BlinkControllerOptions } from "./BlinkController";

export interface AnimationSystemOptions {
  /**
   * Whether subtle procedural idle animation (breathing and hips sway) is enabled.
   * @default true
   */
  enableIdle?: boolean;

  /**
   * Whether automatic procedural blinking is enabled.
   * @default true
   */
  enableBlink?: boolean;

  /**
   * Whether to rotate arms down from strict T-pose to natural relaxed A-pose.
   * @default true
   */
  relaxArms?: boolean;

  /**
   * Rotation angle on Z axis (in radians) for the left upper arm when relaxed.
   * @default -1.2
   */
  leftArmAngleZ?: number;

  /**
   * Rotation angle on Z axis (in radians) for the right upper arm when relaxed.
   * @default 1.2
   */
  rightArmAngleZ?: number;

  /**
   * Breathing oscillation frequency multiplier.
   * @default 1.5
   */
  breathingSpeed?: number;

  /**
   * Breathing pitch oscillation amplitude (rotation X in radians).
   * @default 0.02
   */
  breathingAmplitude?: number;

  /**
   * Hip roll sway oscillation frequency multiplier.
   * @default 0.7
   */
  swaySpeed?: number;

  /**
   * Hip roll sway oscillation amplitude (rotation Z in radians).
   * @default 0.01
   */
  swayAmplitude?: number;

  /**
   * Custom options forwarded to internal BlinkController if not directly provided.
   */
  blinkOptions?: BlinkControllerOptions;

  /**
   * Pre-configured BlinkController instance.
   */
  blinkController?: BlinkController;
}

/**
 * AnimationSystem drives procedural organic animations for a VRM avatar:
 * - Idle breathing (chest / spine rotation X)
 * - Subtle hip sway (hips rotation Z)
 * - Natural A-pose arm relaxation (left/right upper arm rotation Z)
 * - Procedural eye blinking with random interval and double-blink probability
 * - Per-frame VRM physics update (`vrm.update(dt)` for spring bones & constraints)
 */
export class AnimationSystem implements System {
  public readonly vrm: VRM;
  public readonly blinkController: BlinkController;

  public enableIdle: boolean;
  public enableBlink: boolean;
  public relaxArms: boolean;

  public leftArmAngleZ: number;
  public rightArmAngleZ: number;
  public breathingSpeed: number;
  public breathingAmplitude: number;
  public swaySpeed: number;
  public swayAmplitude: number;

  private elapsedTime = 0;
  private isDisposed = false;

  // Normalized bone node references
  private readonly chestNode: THREE.Object3D | null;
  private readonly hipsNode: THREE.Object3D | null;
  private readonly leftUpperArmNode: THREE.Object3D | null;
  private readonly rightUpperArmNode: THREE.Object3D | null;

  // Base rotations to allow restoring on dispose
  private readonly baseChestRotation = new THREE.Euler();
  private readonly baseHipsRotation = new THREE.Euler();
  private readonly baseLeftArmRotation = new THREE.Euler();
  private readonly baseRightArmRotation = new THREE.Euler();

  constructor(vrm: VRM, options: AnimationSystemOptions = {}) {
    this.vrm = vrm;

    this.enableIdle = options.enableIdle ?? true;
    this.enableBlink = options.enableBlink ?? true;
    this.relaxArms = options.relaxArms ?? true;

    this.leftArmAngleZ = options.leftArmAngleZ ?? -1.2;
    this.rightArmAngleZ = options.rightArmAngleZ ?? 1.2;
    this.breathingSpeed = options.breathingSpeed ?? 1.5;
    this.breathingAmplitude = options.breathingAmplitude ?? 0.02;
    this.swaySpeed = options.swaySpeed ?? 0.7;
    this.swayAmplitude = options.swayAmplitude ?? 0.01;

    this.blinkController =
      options.blinkController ?? new BlinkController(options.blinkOptions);

    // Retrieve normalized bone nodes if humanoid is defined
    this.chestNode =
      this.vrm.humanoid?.getNormalizedBoneNode("chest") ??
      this.vrm.humanoid?.getNormalizedBoneNode("spine") ??
      null;
    this.hipsNode = this.vrm.humanoid?.getNormalizedBoneNode("hips") ?? null;
    this.leftUpperArmNode =
      this.vrm.humanoid?.getNormalizedBoneNode("leftUpperArm") ?? null;
    this.rightUpperArmNode =
      this.vrm.humanoid?.getNormalizedBoneNode("rightUpperArm") ?? null;

    // Cache initial base rotations
    if (this.chestNode) {
      this.baseChestRotation.copy(this.chestNode.rotation);
    }
    if (this.hipsNode) {
      this.baseHipsRotation.copy(this.hipsNode.rotation);
    }
    if (this.leftUpperArmNode) {
      this.baseLeftArmRotation.copy(this.leftUpperArmNode.rotation);
    }
    if (this.rightUpperArmNode) {
      this.baseRightArmRotation.copy(this.rightUpperArmNode.rotation);
    }

    // Apply initial arm relaxation if requested
    if (this.relaxArms) {
      if (this.leftUpperArmNode) {
        this.leftUpperArmNode.rotation.z =
          this.baseLeftArmRotation.z + this.leftArmAngleZ;
      }
      if (this.rightUpperArmNode) {
        this.rightUpperArmNode.rotation.z =
          this.baseRightArmRotation.z + this.rightArmAngleZ;
      }
    }
  }

  /**
   * Returns current elapsed simulation time in seconds.
   */
  public get time(): number {
    return this.elapsedTime;
  }

  /**
   * Whether this system has been disposed.
   */
  public get disposed(): boolean {
    return this.isDisposed;
  }

  /**
   * Updates idle bone transforms, blink expression weight, and calls vrm.update(dt).
   * @param dt Delta time since the last rendered frame in seconds.
   */
  public update(dt: number): void {
    if (this.isDisposed || dt <= 0) {
      return;
    }

    this.elapsedTime += dt;

    // 1. Procedural Idle Motion (breathing + hip sway)
    if (this.enableIdle) {
      if (this.chestNode) {
        this.chestNode.rotation.x =
          this.baseChestRotation.x +
          Math.sin(this.elapsedTime * this.breathingSpeed) *
            this.breathingAmplitude;
      }

      if (this.hipsNode) {
        this.hipsNode.rotation.z =
          this.baseHipsRotation.z +
          Math.sin(this.elapsedTime * this.swaySpeed) * this.swayAmplitude;
      }

      if (this.relaxArms) {
        if (this.leftUpperArmNode) {
          this.leftUpperArmNode.rotation.z =
            this.baseLeftArmRotation.z + this.leftArmAngleZ;
        }
        if (this.rightUpperArmNode) {
          this.rightUpperArmNode.rotation.z =
            this.baseRightArmRotation.z + this.rightArmAngleZ;
        }
      }
    }

    // 2. Procedural Blink Expression
    if (this.enableBlink && this.vrm.expressionManager) {
      const blinkValue = this.blinkController.update(dt);
      this.vrm.expressionManager.setValue("blink", blinkValue);
    }

    // 3. VRM Core & Secondary Physics Update (spring bones, constraints, lookAt, morphs)
    this.vrm.update(dt);
  }

  /**
   * Disposes of the animation system and restores modified bones/expressions.
   */
  public dispose(): void {
    if (this.isDisposed) {
      return;
    }
    this.isDisposed = true;

    // Restore bones to initial rotations
    if (this.chestNode) {
      this.chestNode.rotation.copy(this.baseChestRotation);
    }
    if (this.hipsNode) {
      this.hipsNode.rotation.copy(this.baseHipsRotation);
    }
    if (this.leftUpperArmNode) {
      this.leftUpperArmNode.rotation.copy(this.baseLeftArmRotation);
    }
    if (this.rightUpperArmNode) {
      this.rightUpperArmNode.rotation.copy(this.baseRightArmRotation);
    }

    // Reset blink expression
    if (this.vrm.expressionManager) {
      this.vrm.expressionManager.setValue("blink", 0);
    }
  }
}
