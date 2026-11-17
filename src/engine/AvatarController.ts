import type { VRM } from "@pixiv/three-vrm";
import type { VRMAnimation } from "@pixiv/three-vrm-animation";
import type { AnimationSystem } from "./AnimationSystem";
import { AvatarAuxChannels } from "./AvatarAuxChannels";
import type { AvatarChannel } from "./AvatarChannels";
import { classifyClickRegion } from "./AvatarClickRegion";
import {
  buildAckResponse,
  buildErrorResponse,
  buildHelloResponse,
  validateAvatarCommand,
  type AvatarCommand,
  type AvatarCommandLimits,
  type AvatarEvent,
  type AvatarEventType,
  type AvatarHelloResponse,
  type AvatarResponse,
  type ClickRegion,
  type MouthVisemeName,
  type SpeechEndReason
} from "./AvatarCommand";
import { AvatarMouthChannel } from "./AvatarMouthChannel";
import { AvatarPoseChannel } from "./AvatarPoseChannel";
import {
  ExpressionComposer,
  type EmotionExpressionInput
} from "./ExpressionComposer";
import type { LookAtSystem } from "./LookAtSystem";
import type { PowerSaveController, UnlistenFn } from "./PowerSaveController";
import type { ReactionSystem } from "./ReactionSystem";
import type { System } from "./types";

export { classifyClickRegion };

export interface AvatarControllerAvatar {
  vrm: VRM;
  animationSystem?: AnimationSystem;
  reactionSystem?: ReactionSystem;
  lookAtSystem?: LookAtSystem;
}

export interface AvatarControllerOptions {
  powerSaveController: PowerSaveController;
  vrm?: VRM;
  animationSystem?: AnimationSystem;
  reactionSystem?: ReactionSystem;
  lookAtSystem?: LookAtSystem;
  limits?: Partial<AvatarCommandLimits>;
  resolveAnimation?: (
    vrmaId: string
  ) => Promise<VRMAnimation | null> | VRMAnimation | null;
  getAvailableAnimations?: () => readonly string[];
  maxQueueSize?: number;
  streamTimeoutMs?: number;
}

export interface DispatchOptions {
  ownerId?: string;
  grantedScopes?: readonly string[];
}

export class AvatarController implements System {
  private readonly powerSaveController: PowerSaveController;
  private readonly limits?: Partial<AvatarCommandLimits>;
  private readonly getAvailableAnimationsProvider?: () => readonly string[];

  private vrm: VRM | null = null;
  private animationSystem: AnimationSystem | null = null;
  private reactionSystem: ReactionSystem | null = null;

  private readonly composer = new ExpressionComposer();
  private readonly eventListeners = new Set<(event: AvatarEvent) => void>();
  private readonly unlistenPowerSave: UnlistenFn[] = [];
  private readonly heldLocks = new Set<string>();
  private readonly mouthChannel: AvatarMouthChannel;
  private readonly auxChannels: AvatarAuxChannels;
  private readonly poseChannel: AvatarPoseChannel;
  private readonly emotionScratch: EmotionExpressionInput[] = [];
  private lockSeq = 0;
  private isDisposed = false;

  constructor(options: AvatarControllerOptions) {
    this.powerSaveController = options.powerSaveController;
    this.limits = options.limits;
    this.getAvailableAnimationsProvider = options.getAvailableAnimations;
    const maxQueueSize = Math.max(1, options.maxQueueSize ?? 8);
    const streamTimeoutMs = Math.max(100, options.streamTimeoutMs ?? 5_000);

    const host = {
      acquireLock: (token: string) => this.acquireLock(token),
      releaseLock: (token: string) => this.releaseLock(token),
      nextLockToken: (prefix: string) => this.nextLockToken(prefix),
      emitEvent: (ev: AvatarEvent) => this.emitEvent(ev),
      isDisposed: () => this.isDisposed
    };

    this.mouthChannel = new AvatarMouthChannel(
      host,
      maxQueueSize,
      streamTimeoutMs
    );
    this.auxChannels = new AvatarAuxChannels(host, maxQueueSize);
    this.poseChannel = new AvatarPoseChannel(
      host,
      maxQueueSize,
      options.resolveAnimation
    );

    this.unlistenPowerSave.push(
      this.powerSaveController.onIdleChange((idle) => {
        this.emitEvent({ type: "idleChange", idle });
      }),
      this.powerSaveController.onVisibilityChange((visible) => {
        if (!visible) this.handleWindowHidden();
      })
    );

    if (options.vrm) {
      this.attachAvatar(
        {
          vrm: options.vrm,
          animationSystem: options.animationSystem,
          reactionSystem: options.reactionSystem,
          lookAtSystem: options.lookAtSystem
        },
        { emitEvent: false }
      );
    }
  }

  public get disposed(): boolean {
    return this.isDisposed;
  }

  public attachAvatar(
    avatar: AvatarControllerAvatar,
    options: { emitEvent?: boolean } = {}
  ): void {
    if (this.isDisposed) return;
    this.detachAvatar({ emitEvent: false });
    this.vrm = avatar.vrm;
    this.animationSystem = avatar.animationSystem ?? null;
    this.reactionSystem = avatar.reactionSystem ?? null;
    this.auxChannels.setSystems({
      reactionSystem: this.reactionSystem,
      lookAtSystem: avatar.lookAtSystem ?? null
    });
    this.poseChannel.setAnimationSystem(this.animationSystem);
    this.animationSystem?.setManagedByController(true);
    this.reactionSystem?.setManagedByController(true);
    if (options.emitEvent ?? true) {
      this.emitEvent({
        type: "avatarChange",
        expressions: this.getAvailableExpressions()
      });
    }
  }

  public detachAvatar(options: { emitEvent?: boolean } = {}): void {
    this.cancelAllChannels("cancelled");
    this.composer.reset(this.vrm?.expressionManager);
    this.animationSystem?.setManagedByController(false);
    this.reactionSystem?.setManagedByController(false);
    this.vrm = null;
    this.animationSystem = null;
    this.reactionSystem = null;
    this.auxChannels.setSystems({ reactionSystem: null, lookAtSystem: null });
    this.poseChannel.setAnimationSystem(null);
    if (options.emitEvent) {
      this.emitEvent({ type: "avatarChange", expressions: [] });
    }
  }

  public getAvailableExpressions(): string[] {
    const em = this.vrm?.expressionManager as
      { expressionMap?: Record<string, unknown> } | undefined;
    return em?.expressionMap ? Object.keys(em.expressionMap) : [];
  }

  public getAvailableAnimations(): string[] {
    return [...(this.getAvailableAnimationsProvider?.() ?? [])];
  }

  public buildHello(options: {
    ref?: string;
    scopes: readonly string[];
    subscribedEvents?: readonly AvatarEventType[];
  }): AvatarHelloResponse {
    return buildHelloResponse({
      ref: options.ref,
      limits: this.limits,
      scopes: options.scopes,
      expressions: this.getAvailableExpressions(),
      animations: this.getAvailableAnimations(),
      subscribedEvents: options.subscribedEvents
    });
  }

  public onEvent(listener: (event: AvatarEvent) => void): UnlistenFn {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  public emitEvent(event: AvatarEvent): void {
    for (const listener of this.eventListeners) listener(event);
  }

  public emitClick(region: ClickRegion): void {
    this.emitEvent({ type: "click", region });
  }

  public setMouthVisemes(
    weights: Partial<Record<MouthVisemeName, number>>
  ): void {
    this.mouthChannel.setVisemes(weights);
  }

  public clearMouthVisemes(): void {
    this.mouthChannel.clearVisemes();
  }

  public setMouthActive(active: boolean): void {
    this.mouthChannel.setExternalActive(active);
  }

  public getChannelState(channel: AvatarChannel): {
    busy: boolean;
    queueLength: number;
    ownerId: string | null;
  } {
    if (channel === "mouth") return this.mouthChannel.getState();
    if (channel === "pose") return this.poseChannel.getState();
    return this.auxChannels.getState(channel);
  }

  public dispatch(
    rawOrEnvelope: unknown,
    options: DispatchOptions = {}
  ): AvatarResponse {
    if (this.isDisposed) {
      return buildErrorResponse("invalid", "AvatarController is disposed");
    }
    const em = this.vrm?.expressionManager as
      { expressionMap?: Record<string, unknown> } | undefined;
    const hasExprMap = Boolean(em && "expressionMap" in em && em.expressionMap);
    const res = validateAvatarCommand(rawOrEnvelope, this.limits, {
      isWindowVisible: this.powerSaveController.isWindowVisible,
      grantedScopes: options.grantedScopes,
      availableExpressions: hasExprMap
        ? Object.keys(em!.expressionMap!)
        : undefined,
      availableAnimations: this.getAvailableAnimationsProvider
        ? this.getAvailableAnimationsProvider()
        : undefined
    });
    if (!res.ok) return res.error;
    const { id: ref, cmd } = res.value;
    return this.executeCommand(
      cmd,
      options.ownerId ?? "default",
      ref,
      options.grantedScopes ?? []
    );
  }

  public cancelByOwner(ownerId: string): void {
    this.auxChannels.cancelByOwner(ownerId);
    this.mouthChannel.cancelByOwner(ownerId);
    this.poseChannel.cancelByOwner(ownerId);
  }

  public update(dt: number): void {
    if (this.isDisposed || dt <= 0) return;
    const dtMs = dt * 1000;
    this.auxChannels.step(dtMs);
    this.mouthChannel.step(dtMs);
    this.poseChannel.step(dtMs);

    const emotions = this.emotionScratch;
    emotions.length = 0;
    this.auxChannels.collectEmotions(emotions);

    this.composer.composeAndApply(this.vrm?.expressionManager, {
      blinkWeight: this.animationSystem?.getBlinkWeight() ?? 0,
      emotions,
      mouthVisemes: this.mouthChannel.visemeWeights,
      isMouthActive: this.mouthChannel.isActive
    });
    this.vrm?.update?.(dt);
  }

  public dispose(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;
    for (const unlisten of this.unlistenPowerSave) unlisten();
    this.unlistenPowerSave.length = 0;
    this.detachAvatar({ emitEvent: false });
    this.eventListeners.clear();
  }

  private executeCommand(
    cmd: AvatarCommand,
    ownerId: string,
    ref: string | undefined,
    scopes: readonly string[]
  ): AvatarResponse {
    switch (cmd.type) {
      case "hello":
        return this.buildHello({ ref, scopes, subscribedEvents: cmd.events });
      case "lookAt":
        return this.auxChannels.handleLookAt(cmd, ownerId, ref);
      case "expression":
        return this.auxChannels.handleExpression(cmd, ownerId, ref);
      case "reaction":
        return this.auxChannels.handleReaction(cmd, ownerId, ref);
      case "animation":
        return this.poseChannel.handlePose(cmd, ownerId, ref);
      case "say":
        return this.mouthChannel.handleSay(cmd, ownerId, ref);
      case "speak":
        return this.mouthChannel.handleSpeak(cmd, ownerId, ref);
      case "speakStart":
        return this.mouthChannel.handleSpeakStart(cmd, ownerId, ref);
      case "speakChunk":
        return this.mouthChannel.handleSpeakChunk(cmd, ownerId, ref);
      case "speakEnd":
        return this.mouthChannel.handleSpeakEnd(cmd.streamId, ownerId, ref);
      case "speakCancel":
        return this.mouthChannel.handleSpeakCancel(cmd.streamId, ownerId, ref);
      case "stopSpeaking":
        this.mouthChannel.interruptAll("cancelled");
        return buildAckResponse(ref);
    }
  }

  private handleWindowHidden(): void {
    this.cancelAllChannels("hidden");
    this.composer.reset(this.vrm?.expressionManager);
  }

  private cancelAllChannels(reason: SpeechEndReason): void {
    this.auxChannels.clearAll();
    this.poseChannel.clearAll();
    this.mouthChannel.interruptAll(reason);
    for (const lock of this.heldLocks) {
      this.powerSaveController.releaseActiveLock(lock);
    }
    this.heldLocks.clear();
  }

  private nextLockToken(prefix: string): string {
    return `avatar:${prefix}:${++this.lockSeq}`;
  }

  private acquireLock(token: string): void {
    this.heldLocks.add(token);
    this.powerSaveController.acquireActiveLock(token);
  }

  private releaseLock(token: string): void {
    if (this.heldLocks.delete(token)) {
      this.powerSaveController.releaseActiveLock(token);
    }
  }
}
