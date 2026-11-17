import * as THREE from "three";
import type { VRM } from "@pixiv/three-vrm";
import type { System } from "./types";
import { BlinkController } from "./BlinkController";
import type { BlinkControllerOptions } from "./BlinkController";
import { VRMAPlayer } from "./VRMAPlayer";

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

  /**
   * Optional pre-configured VRMAPlayer instance.
   */
  vrmaPlayer?: VRMAPlayer;

  /**
   * Whether AnimationSystem directly writes blink weights to `vrm.expressionManager`.
   * Set to `false` when `AvatarController` owns expression writes.
   * @default true
   */
  manageExpressions?: boolean;

  /**
   * Whether AnimationSystem invokes `vrm.update(dt)` at the end of `update(dt)`.
   * Set to `false` when `AvatarController` performs the final `vrm.update(dt)`.
   * @default true
   */
  autoUpdateVrm?: boolean;
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
  public readonly vrmaPlayer: VRMAPlayer;

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
  private wasVRMAPlaying = false;
  private targetSitting = false;
  private sitBlend = 0;
  private manageExpressions: boolean;
  private autoUpdateVrm: boolean;
  private currentBlinkWeight = 0;

  // Normalized bone node references
  private readonly chestNode: THREE.Object3D | null;
  private readonly hipsNode: THREE.Object3D | null;
  private readonly leftUpperArmNode: THREE.Object3D | null;
  private readonly rightUpperArmNode: THREE.Object3D | null;
  private readonly leftUpperLegNode: THREE.Object3D | null;
  private readonly rightUpperLegNode: THREE.Object3D | null;
  private readonly leftLowerLegNode: THREE.Object3D | null;
  private readonly rightLowerLegNode: THREE.Object3D | null;

  // Base rotations & positions to allow restoring on dispose
  private readonly baseChestRotation = new THREE.Euler();
  private readonly baseHipsRotation = new THREE.Euler();
  private readonly baseHipsPosition = new THREE.Vector3();
  private readonly baseLeftArmRotation = new THREE.Euler();
  private readonly baseRightArmRotation = new THREE.Euler();
  private readonly baseLeftUpperLegRotation = new THREE.Euler();
  private readonly baseRightUpperLegRotation = new THREE.Euler();
  private readonly baseLeftLowerLegRotation = new THREE.Euler();
  private readonly baseRightLowerLegRotation = new THREE.Euler();

  constructor(vrm: VRM, options: AnimationSystemOptions = {}) {
    this.vrm = vrm;

    this.enableIdle = options.enableIdle ?? true;
    this.enableBlink = options.enableBlink ?? true;
    this.relaxArms = options.relaxArms ?? true;
    this.manageExpressions = options.manageExpressions ?? true;
    this.autoUpdateVrm = options.autoUpdateVrm ?? true;

    this.leftArmAngleZ = options.leftArmAngleZ ?? -1.2;
    this.rightArmAngleZ = options.rightArmAngleZ ?? 1.2;
    this.breathingSpeed = options.breathingSpeed ?? 1.5;
    this.breathingAmplitude = options.breathingAmplitude ?? 0.02;
    this.swaySpeed = options.swaySpeed ?? 0.7;
    this.swayAmplitude = options.swayAmplitude ?? 0.01;

    this.blinkController =
      options.blinkController ?? new BlinkController(options.blinkOptions);
    this.vrmaPlayer = options.vrmaPlayer ?? new VRMAPlayer(vrm);

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
    this.leftUpperLegNode =
      this.vrm.humanoid?.getNormalizedBoneNode("leftUpperLeg") ?? null;
    this.rightUpperLegNode =
      this.vrm.humanoid?.getNormalizedBoneNode("rightUpperLeg") ?? null;
    this.leftLowerLegNode =
      this.vrm.humanoid?.getNormalizedBoneNode("leftLowerLeg") ?? null;
    this.rightLowerLegNode =
      this.vrm.humanoid?.getNormalizedBoneNode("rightLowerLeg") ?? null;

    // Cache initial base rotations & hips position
    if (this.chestNode) {
      this.baseChestRotation.copy(this.chestNode.rotation);
    }
    if (this.hipsNode) {
      this.baseHipsRotation.copy(this.hipsNode.rotation);
      this.baseHipsPosition.copy(this.hipsNode.position);
    }
    if (this.leftUpperArmNode) {
      this.baseLeftArmRotation.copy(this.leftUpperArmNode.rotation);
    }
    if (this.rightUpperArmNode) {
      this.baseRightArmRotation.copy(this.rightUpperArmNode.rotation);
    }
    if (this.leftUpperLegNode) {
      this.baseLeftUpperLegRotation.copy(this.leftUpperLegNode.rotation);
    }
    if (this.rightUpperLegNode) {
      this.baseRightUpperLegRotation.copy(this.rightUpperLegNode.rotation);
    }
    if (this.leftLowerLegNode) {
      this.baseLeftLowerLegRotation.copy(this.leftLowerLegNode.rotation);
    }
    if (this.rightLowerLegNode) {
      this.baseRightLowerLegRotation.copy(this.rightLowerLegNode.rotation);
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

  public get isSitting(): boolean {
    return this.targetSitting;
  }

  /**
   * Delegates expression writing and `vrm.update(dt)` to an external
   * coordinator such as `AvatarController`.
   */
  public setManagedByController(managed: boolean): void {
    this.manageExpressions = !managed;
    this.autoUpdateVrm = !managed;
  }

  /**
   * Returns the latest computed procedural blink weight in [0, 1].
   */
  public getBlinkWeight(): number {
    if (this.isDisposed || !this.enableBlink) {
      return 0;
    }
    return this.currentBlinkWeight;
  }

  /**
   * Transitions the avatar into or out of a procedural sitting pose
   * (e.g. when perched on top of a desktop window titlebar).
   */
  public setSitting(sitting: boolean): void {
    this.targetSitting = sitting;
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

    // 1. Advance VRMA animation mixer (if any clip is loaded/playing)
    this.vrmaPlayer.update(dt);
    const isVRMAPlaying = this.vrmaPlayer.isPlaying;

    // Transitioning from playing to idle: restore base pose cleanly
    if (this.wasVRMAPlaying && !isVRMAPlaying) {
      this.restoreBasePose(this.relaxArms);
    }
    this.wasVRMAPlaying = isVRMAPlaying;

    // 2. Procedural Idle Motion (breathing + hip sway + relax arms + sitting pose)
    // Paused when VRMA is actively playing so bone tracks drive humanoid without fighting
    if (this.enableIdle && !isVRMAPlaying) {
      const targetBlend = this.targetSitting ? 1 : 0;
      const step = Math.min(1, dt * 6);
      this.sitBlend += (targetBlend - this.sitBlend) * step;

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
        this.hipsNode.position.y =
          this.baseHipsPosition.y - 0.2 * this.sitBlend;
      }

      if (this.relaxArms) {
        if (this.leftUpperArmNode) {
          this.leftUpperArmNode.rotation.z =
            this.baseLeftArmRotation.z + this.leftArmAngleZ;
          this.leftUpperArmNode.rotation.x =
            this.baseLeftArmRotation.x + 0.2 * this.sitBlend;
        }
        if (this.rightUpperArmNode) {
          this.rightUpperArmNode.rotation.z =
            this.baseRightArmRotation.z + this.rightArmAngleZ;
          this.rightUpperArmNode.rotation.x =
            this.baseRightArmRotation.x + 0.2 * this.sitBlend;
        }
      }

      // Procedural sitting leg pose with subtle dangling swing
      const legSwing = Math.sin(this.elapsedTime * 2.2) * 0.08 * this.sitBlend;
      if (this.leftUpperLegNode) {
        this.leftUpperLegNode.rotation.x =
          this.baseLeftUpperLegRotation.x - 1.35 * this.sitBlend;
        this.leftUpperLegNode.rotation.z =
          this.baseLeftUpperLegRotation.z - 0.06 * this.sitBlend;
      }
      if (this.rightUpperLegNode) {
        this.rightUpperLegNode.rotation.x =
          this.baseRightUpperLegRotation.x - 1.35 * this.sitBlend;
        this.rightUpperLegNode.rotation.z =
          this.baseRightUpperLegRotation.z + 0.06 * this.sitBlend;
      }
      if (this.leftLowerLegNode) {
        this.leftLowerLegNode.rotation.x =
          this.baseLeftLowerLegRotation.x + 1.45 * this.sitBlend + legSwing;
      }
      if (this.rightLowerLegNode) {
        this.rightLowerLegNode.rotation.x =
          this.baseRightLowerLegRotation.x + 1.45 * this.sitBlend - legSwing;
      }
    }

    // 3. Procedural Blink Expression
    if (this.enableBlink) {
      this.currentBlinkWeight = this.blinkController.update(dt);
      if (this.manageExpressions && this.vrm.expressionManager) {
        this.vrm.expressionManager.setValue("blink", this.currentBlinkWeight);
      }
    } else {
      this.currentBlinkWeight = 0;
    }

    // 4. VRM Core & Secondary Physics Update (spring bones, constraints, lookAt, morphs)
    if (this.autoUpdateVrm) {
      this.vrm.update(dt);
    }
  }

  /**
   * Restores bones to their initial base rotations (optionally applying arm relaxation).
   * @param includeRelaxArms Whether to re-apply arm relaxation angle if relaxArms is enabled.
   */
  public restoreBasePose(includeRelaxArms = false): void {
    if (this.chestNode) {
      this.chestNode.rotation.copy(this.baseChestRotation);
    }
    if (this.hipsNode) {
      this.hipsNode.rotation.copy(this.baseHipsRotation);
      this.hipsNode.position.copy(this.baseHipsPosition);
    }
    if (this.leftUpperArmNode) {
      this.leftUpperArmNode.rotation.copy(this.baseLeftArmRotation);
      if (includeRelaxArms && this.relaxArms) {
        this.leftUpperArmNode.rotation.z =
          this.baseLeftArmRotation.z + this.leftArmAngleZ;
      }
    }
    if (this.rightUpperArmNode) {
      this.rightUpperArmNode.rotation.copy(this.baseRightArmRotation);
      if (includeRelaxArms && this.relaxArms) {
        this.rightUpperArmNode.rotation.z =
          this.baseRightArmRotation.z + this.rightArmAngleZ;
      }
    }
    if (this.leftUpperLegNode) {
      this.leftUpperLegNode.rotation.copy(this.baseLeftUpperLegRotation);
    }
    if (this.rightUpperLegNode) {
      this.rightUpperLegNode.rotation.copy(this.baseRightUpperLegRotation);
    }
    if (this.leftLowerLegNode) {
      this.leftLowerLegNode.rotation.copy(this.baseLeftLowerLegRotation);
    }
    if (this.rightLowerLegNode) {
      this.rightLowerLegNode.rotation.copy(this.baseRightLowerLegRotation);
    }
  }

  /**
   * Disposes of the animation system and restores modified bones/expressions.
   */
  public dispose(): void {
    if (this.isDisposed) {
      return;
    }
    this.isDisposed = true;

    this.vrmaPlayer.dispose();
    this.restoreBasePose(false);
    this.currentBlinkWeight = 0;

    // Reset blink expression when directly managing expressions
    if (this.manageExpressions && this.vrm.expressionManager) {
      this.vrm.expressionManager.setValue("blink", 0);
    }
  }
}
