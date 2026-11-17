import type { VRMAnimation } from "@pixiv/three-vrm-animation";
import type { AnimationSystem } from "./AnimationSystem";
import {
  arbitrateChannel,
  createChannelSlot,
  type PoseChannelItem
} from "./AvatarChannels";
import type { AvatarCommand, AvatarResponse } from "./AvatarCommand";

export interface PoseChannelHost {
  acquireLock: (token: string) => void;
  releaseLock: (token: string) => void;
  nextLockToken: (prefix: string) => string;
  isDisposed: () => boolean;
}

export class AvatarPoseChannel {
  private readonly slot = createChannelSlot<PoseChannelItem>();
  private animationSystem: AnimationSystem | null = null;
  private poseLoadSeq = 0;

  constructor(
    private readonly host: PoseChannelHost,
    private readonly maxQueueSize: number,
    private readonly resolveAnimation?: (
      vrmaId: string
    ) => Promise<VRMAnimation | null> | VRMAnimation | null
  ) {}

  public setAnimationSystem(animationSystem: AnimationSystem | null): void {
    this.animationSystem = animationSystem;
  }

  public getState(): {
    busy: boolean;
    queueLength: number;
    ownerId: string | null;
  } {
    return {
      busy: this.slot.active !== null,
      queueLength: this.slot.queue.length,
      ownerId: this.slot.active?.ownerId ?? null
    };
  }

  public handlePose(
    cmd: Extract<AvatarCommand, { type: "animation" }>,
    ownerId: string,
    ref?: string
  ): AvatarResponse {
    const item: PoseChannelItem = {
      kind: "pose",
      ownerId,
      vrma: cmd.vrma,
      loop: cmd.loop ?? false,
      durationMs: cmd.durationMs,
      fadeInMs: cmd.fadeInMs ?? 250,
      elapsedMs: 0,
      lockToken: this.host.nextLockToken("pose"),
      loadToken: 0,
      loadSettled: false,
      startedPlaying: false
    };
    return arbitrateChannel(
      this.slot,
      item,
      cmd.policy ?? "interrupt",
      this.maxQueueSize,
      "pose",
      ref,
      {
        onInterruptActive: (prev) => {
          this.poseLoadSeq++;
          this.host.releaseLock(prev.lockToken);
          this.animationSystem?.vrmaPlayer.stop(0);
        },
        onActivate: (next) => this.activate(next)
      }
    );
  }

  public step(dtMs: number): void {
    const active = this.slot.active;
    if (!active) return;
    active.elapsedMs += dtMs;
    const byDur =
      active.durationMs !== undefined && active.elapsedMs >= active.durationMs;
    const byClip =
      !active.loop &&
      active.loadSettled &&
      active.startedPlaying &&
      !(this.animationSystem?.vrmaPlayer.isPlaying ?? false);
    if (byDur || byClip) {
      if (byDur) this.animationSystem?.vrmaPlayer.stop(0.2);
      this.host.releaseLock(active.lockToken);
      const next = this.slot.queue.shift() ?? null;
      this.slot.active = next;
      if (next) this.activate(next);
    }
  }

  public clearAll(): void {
    if (this.slot.active) {
      this.poseLoadSeq++;
      this.host.releaseLock(this.slot.active.lockToken);
      this.animationSystem?.vrmaPlayer.stop(0);
    }
    this.slot.active = null;
    this.slot.queue.length = 0;
  }

  public cancelByOwner(ownerId: string): void {
    for (let i = this.slot.queue.length - 1; i >= 0; i--) {
      if (this.slot.queue[i].ownerId === ownerId) this.slot.queue.splice(i, 1);
    }
    if (this.slot.active?.ownerId === ownerId) {
      const prev = this.slot.active;
      this.poseLoadSeq++;
      this.host.releaseLock(prev.lockToken);
      this.animationSystem?.vrmaPlayer.stop(0);
      const next = this.slot.queue.shift() ?? null;
      this.slot.active = next;
      if (next) this.activate(next);
    }
  }

  private activate(item: PoseChannelItem): void {
    this.host.acquireLock(item.lockToken);
    const token = ++this.poseLoadSeq;
    item.loadToken = token;
    if (!this.resolveAnimation) {
      item.loadSettled = true;
      return;
    }
    try {
      const maybe = this.resolveAnimation(item.vrma);
      if (maybe instanceof Promise) {
        void maybe
          .then((anim) => this.onResolved(item, token, anim))
          .catch(() => this.onFailed(item, token));
      } else {
        this.onResolved(item, token, maybe);
      }
    } catch {
      this.onFailed(item, token);
    }
  }

  private onResolved(
    item: PoseChannelItem,
    token: number,
    anim: VRMAnimation | null
  ): void {
    if (
      this.host.isDisposed() ||
      token !== this.poseLoadSeq ||
      this.slot.active !== item
    ) {
      return;
    }
    item.loadSettled = true;
    if (!anim || !this.animationSystem) {
      if (!anim) this.onFailed(item, token);
      return;
    }
    this.animationSystem.vrmaPlayer.play(anim, {
      loop: item.loop,
      fadeInDuration: item.fadeInMs / 1000
    });
    item.startedPlaying = true;
  }

  private onFailed(item: PoseChannelItem, token: number): void {
    if (
      this.host.isDisposed() ||
      token !== this.poseLoadSeq ||
      this.slot.active !== item
    ) {
      return;
    }
    this.host.releaseLock(item.lockToken);
    const next = this.slot.queue.shift() ?? null;
    this.slot.active = next;
    if (next) this.activate(next);
  }
}
