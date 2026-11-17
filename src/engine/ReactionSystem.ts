import * as THREE from "three";
import type { VRM, VRMExpressionPresetName } from "@pixiv/three-vrm";
import type { System } from "./types";

/**
 * Reaction types that can be triggered.
 */
export type ReactionType = "happy" | "surprised" | "relaxed" | "wink";

/**
 * Configuration options for ReactionSystem.
 */
export interface ReactionSystemOptions {
  /**
   * Total duration of the reaction in seconds.
   * @default 1.5
   */
  duration?: number;

  /**
   * Duration of the fade-in phase in seconds.
   * @default 0.2
   */
  fadeInDuration?: number;

  /**
   * Duration of the fade-out phase in seconds.
   * @default 0.4
   */
  fadeOutDuration?: number;

  /**
   * Amplitude of the procedural vertical bounce in units (meters).
   * @default 0.04
   */
  bounceAmplitude?: number;

  /**
   * Amplitude of the procedural head nod in radians.
   * @default 0.08
   */
  nodAmplitude?: number;

  /**
   * Whether ReactionSystem directly writes expression presets to `vrm.expressionManager`.
   * Set to `false` when `AvatarController` owns expression writes.
   * @default true
   */
  manageExpressions?: boolean;
}

/**
 * Internal state for an ongoing reaction.
 */
interface ActiveReaction {
  type: ReactionType;
  preset: VRMExpressionPresetName | string;
  elapsed: number;
  duration: number;
  fadeIn: number;
  fadeOut: number;
  intensity: number;
}

/**
 * ReactionSystem manages interactive emotional responses and body bounce/nod
 * when the user clicks or taps on the avatar.
 */
export class ReactionSystem implements System {
  private activeReaction: ActiveReaction | null = null;
  private readonly defaultDuration: number;
  private readonly defaultFadeIn: number;
  private readonly defaultFadeOut: number;
  private readonly bounceAmplitude: number;
  private readonly nodAmplitude: number;
  private manageExpressions: boolean;
  private currentWeight = 0;

  // Cache initial neck/head rotations if available
  private headBone: THREE.Object3D | null = null;
  private initialHeadRotX = 0;
  private initialScenePosY = 0;
  private hasCapturedInitialPos = false;

  constructor(
    private readonly vrm: VRM,
    options: ReactionSystemOptions = {}
  ) {
    this.defaultDuration = options.duration ?? 1.5;
    this.defaultFadeIn = options.fadeInDuration ?? 0.2;
    this.defaultFadeOut = options.fadeOutDuration ?? 0.4;
    this.bounceAmplitude = options.bounceAmplitude ?? 0.04;
    this.nodAmplitude = options.nodAmplitude ?? 0.08;
    this.manageExpressions = options.manageExpressions ?? true;

    this.headBone =
      vrm.humanoid?.getNormalizedBoneNode("head") ??
      vrm.humanoid?.getRawBoneNode("head") ??
      null;

    if (this.headBone) {
      this.initialHeadRotX = this.headBone.rotation.x;
    }
  }

  /**
   * Delegates expression writing to an external coordinator such as `AvatarController`.
   */
  public setManagedByController(managed: boolean): void {
    this.manageExpressions = !managed;
  }

  /**
   * Returns the active reaction preset and current blended weight, or null if idle.
   */
  public getActiveExpression(): { preset: string; weight: number } | null {
    if (!this.activeReaction) {
      return null;
    }
    return {
      preset: this.activeReaction.preset,
      weight: this.currentWeight
    };
  }

  /**
   * Stops any active reaction and restores pose transforms.
   */
  public stop(): void {
    if (
      this.manageExpressions &&
      this.activeReaction &&
      this.vrm.expressionManager
    ) {
      this.vrm.expressionManager.setValue(this.activeReaction.preset, 0);
    }
    if (this.vrm.scene && this.hasCapturedInitialPos) {
      this.vrm.scene.position.y = this.initialScenePosY;
    }
    if (this.headBone) {
      this.headBone.rotation.x = this.initialHeadRotX;
    }
    this.activeReaction = null;
    this.currentWeight = 0;
  }

  /**
   * Triggers a reaction on the avatar.
   * If a reaction is already playing, it will be smoothly replaced.
   */
  trigger(
    type: ReactionType = "happy",
    duration = this.defaultDuration,
    intensity = 1.0
  ): void {
    let preset: VRMExpressionPresetName | string = "happy";
    switch (type) {
      case "happy":
        preset = "happy";
        break;
      case "surprised":
        preset = "surprised";
        break;
      case "relaxed":
        preset = "relaxed";
        break;
      case "wink":
        preset = "blinkLeft";
        break;
    }

    // Reset previous expression if directly managing expressions
    if (
      this.manageExpressions &&
      this.activeReaction &&
      this.vrm.expressionManager
    ) {
      this.vrm.expressionManager.setValue(this.activeReaction.preset, 0);
    }

    // Capture the base position only when starting from rest (not mid-bounce)
    // so rapid consecutive clicks never accumulate vertical elevation
    if (!this.activeReaction && this.vrm.scene) {
      this.initialScenePosY = this.vrm.scene.position.y;
      this.hasCapturedInitialPos = true;
    }

    const clampedDuration = Math.max(duration, 0.2);
    const clampedIntensity = Math.max(0, Math.min(1, intensity));
    this.currentWeight = 0;

    this.activeReaction = {
      type,
      preset,
      elapsed: 0,
      duration: clampedDuration,
      fadeIn: Math.min(this.defaultFadeIn, clampedDuration * 0.3),
      fadeOut: Math.min(this.defaultFadeOut, clampedDuration * 0.4),
      intensity: clampedIntensity
    };
  }

  /**
   * Triggers a random pleasant reaction (happy, surprised, relaxed, wink).
   */
  triggerRandom(): void {
    const choices: ReactionType[] = ["happy", "surprised", "relaxed", "wink"];
    const chosen = choices[Math.floor(Math.random() * choices.length)];
    this.trigger(chosen);
  }

  /**
   * Updates the baseline vertical offset (e.g. when changed from settings panel)
   * so ongoing or future reactions return to the exact new vertical position.
   */
  setBasePositionY(y: number): void {
    this.initialScenePosY = y;
    this.hasCapturedInitialPos = true;
    if (!this.activeReaction && this.vrm.scene) {
      this.vrm.scene.position.y = y;
    }
  }

  /**
   * Returns whether a reaction is currently active.
   */
  isPlaying(): boolean {
    return this.activeReaction !== null;
  }

  /**
   * Returns the currently active reaction type or null.
   */
  getCurrentReaction(): ReactionType | null {
    return this.activeReaction?.type ?? null;
  }

  update(dt: number): void {
    if (!this.activeReaction) {
      return;
    }

    const reaction = this.activeReaction;
    reaction.elapsed += dt;

    if (reaction.elapsed >= reaction.duration) {
      // End reaction
      if (this.manageExpressions && this.vrm.expressionManager) {
        this.vrm.expressionManager.setValue(reaction.preset, 0);
      }
      if (this.vrm.scene) {
        this.vrm.scene.position.y = this.initialScenePosY;
      }
      if (this.headBone) {
        this.headBone.rotation.x = this.initialHeadRotX;
      }
      this.activeReaction = null;
      this.currentWeight = 0;
      return;
    }

    // Calculate expression blend weight (0 to 1 with smooth in/out)
    let weight = 1.0;
    const { elapsed, duration, fadeIn, fadeOut } = reaction;

    if (elapsed < fadeIn && fadeIn > 0) {
      weight = Math.sin((elapsed / fadeIn) * (Math.PI / 2));
    } else if (elapsed > duration - fadeOut && fadeOut > 0) {
      const outProgress = (duration - elapsed) / fadeOut;
      weight = Math.sin(outProgress * (Math.PI / 2));
    }

    weight = Math.max(0, Math.min(1, weight)) * reaction.intensity;
    this.currentWeight = weight;

    // Apply facial expression to VRM when directly managing expressions
    if (this.manageExpressions && this.vrm.expressionManager) {
      this.vrm.expressionManager.setValue(reaction.preset, weight);
    }

    // Apply subtle procedural bounce / hop (1 cycle of a sine wave)
    const bounceProgress = elapsed / duration;
    const bounceOffset =
      Math.sin(bounceProgress * Math.PI) * this.bounceAmplitude * weight;
    if (this.vrm.scene) {
      this.vrm.scene.position.y = this.initialScenePosY + bounceOffset;
    }

    // Apply subtle head nod / tilt
    if (this.headBone) {
      const nodOffset =
        Math.sin(bounceProgress * Math.PI * 2) * this.nodAmplitude * weight;
      this.headBone.rotation.x = this.initialHeadRotX - nodOffset;
    }
  }

  dispose(): void {
    this.stop();
  }
}
