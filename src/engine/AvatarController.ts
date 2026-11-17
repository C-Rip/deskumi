import type { VRM } from "@pixiv/three-vrm";
import type { AnimationSystem } from "./AnimationSystem";
import type { AudioOutput } from "./AudioOutput";
import type { AvatarAuxChannels } from "./AvatarAuxChannels";
import type { AvatarChannel } from "./AvatarChannels";
import { classifyClickRegion } from "./AvatarClickRegion";
import {
  buildHelloResponse,
  type AvatarCommandLimits,
  type AvatarEvent,
  type AvatarEventType,
  type AvatarHelloResponse,
  type AvatarResponse,
  type ClickRegion,
  type MouthVisemeName,
  type SpeechEndReason
} from "./AvatarCommand";
import {
  createAvatarChannels,
  validateAndDispatchAvatarCommand
} from "./AvatarControllerDispatch";
import type {
  AvatarControllerAvatar,
  AvatarControllerOptions,
  DispatchOptions
} from "./AvatarControllerTypes";
import type { AvatarMouthChannel } from "./AvatarMouthChannel";
import type { AvatarPoseChannel } from "./AvatarPoseChannel";
import {
  ExpressionComposer,
  type EmotionExpressionInput
} from "./ExpressionComposer";
import type { LipSyncController } from "./LipSyncController";
import type { PowerSaveController, UnlistenFn } from "./PowerSaveController";
import type { ReactionSystem } from "./ReactionSystem";
import type {
  SpeechBubbleListener,
  SpeechBubbleState,
  SpeechController
} from "./SpeechController";
import type { System } from "./types";

export { classifyClickRegion };
export type {
  AvatarControllerAvatar,
  AvatarControllerOptions,
  DispatchOptions,
  SpeechBubbleListener,
  SpeechBubbleState
};

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

    const channels = createAvatarChannels(options, this.powerSaveController, {
      acquireLock: (token: string) => {
        this.heldLocks.add(token);
        this.powerSaveController.acquireActiveLock(token);
      },
      releaseLock: (token: string) => {
        if (this.heldLocks.delete(token))
          this.powerSaveController.releaseActiveLock(token);
      },
      nextLockToken: (prefix: string) => `avatar:${prefix}:${++this.lockSeq}`,
      emitEvent: (ev: AvatarEvent) => this.emitEvent(ev),
      isDisposed: () => this.isDisposed
    });
    this.mouthChannel = channels.mouthChannel;
    this.auxChannels = channels.auxChannels;
    this.poseChannel = channels.poseChannel;

    this.unlistenPowerSave.push(
      this.powerSaveController.onIdleChange((idle) =>
        this.emitEvent({ type: "idleChange", idle })
      ),
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
  public get speech(): SpeechController {
    return this.mouthChannel.speech;
  }
  public get audioOutput(): AudioOutput {
    return this.mouthChannel.speech.audioOutput;
  }
  public get lipSync(): LipSyncController {
    return this.mouthChannel.speech.lipSync;
  }
  public getActiveSpeechBubble(): SpeechBubbleState | null {
    return this.mouthChannel.speech.getActiveBubble();
  }
  public onSpeechBubbleChange(listener: SpeechBubbleListener): UnlistenFn {
    return this.mouthChannel.speech.onBubbleChange(listener);
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
    if (options.emitEvent)
      this.emitEvent({ type: "avatarChange", expressions: [] });
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
    return validateAndDispatchAvatarCommand(
      rawOrEnvelope,
      options,
      {
        isDisposed: this.isDisposed,
        vrm: this.vrm,
        limits: this.limits,
        isWindowVisible: this.powerSaveController.isWindowVisible,
        availableAnimations: this.getAvailableAnimationsProvider?.()
      },
      {
        auxChannels: this.auxChannels,
        mouthChannel: this.mouthChannel,
        poseChannel: this.poseChannel,
        buildHello: (opts) => this.buildHello(opts)
      }
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
    this.emotionScratch.length = 0;
    this.auxChannels.collectEmotions(this.emotionScratch);
    this.composer.composeAndApply(this.vrm?.expressionManager, {
      blinkWeight: this.animationSystem?.getBlinkWeight() ?? 0,
      emotions: this.emotionScratch,
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
    this.mouthChannel.dispose();
    this.eventListeners.clear();
  }

  private handleWindowHidden(): void {
    this.cancelAllChannels("hidden");
    this.composer.reset(this.vrm?.expressionManager);
  }

  private cancelAllChannels(reason: SpeechEndReason): void {
    this.auxChannels.clearAll();
    this.poseChannel.clearAll();
    this.mouthChannel.interruptAll(reason);
    for (const lock of this.heldLocks)
      this.powerSaveController.releaseActiveLock(lock);
    this.heldLocks.clear();
  }
}
