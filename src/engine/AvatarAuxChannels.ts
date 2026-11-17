import {
  arbitrateChannel,
  createChannelSlot,
  reactionPresetForName,
  type ChannelSlot,
  type ExpressionChannelItem,
  type LookAtChannelItem
} from "./AvatarChannels";
import {
  buildAckResponse,
  buildErrorResponse,
  type AvatarCommand,
  type AvatarResponse
} from "./AvatarCommand";
import type { EmotionExpressionInput } from "./ExpressionComposer";
import type { LookAtSystem } from "./LookAtSystem";
import type { ReactionSystem } from "./ReactionSystem";

export interface AuxChannelHost {
  acquireLock: (token: string) => void;
  releaseLock: (token: string) => void;
  nextLockToken: (prefix: string) => string;
}

export class AvatarAuxChannels {
  private readonly lookAtSlot = createChannelSlot<LookAtChannelItem>();
  private readonly expressionSlot = createChannelSlot<ExpressionChannelItem>();

  private reactionSystem: ReactionSystem | null = null;
  private lookAtSystem: LookAtSystem | null = null;

  constructor(
    private readonly host: AuxChannelHost,
    private readonly maxQueueSize: number
  ) {}

  public setSystems(systems: {
    reactionSystem: ReactionSystem | null;
    lookAtSystem: LookAtSystem | null;
  }): void {
    this.reactionSystem = systems.reactionSystem;
    this.lookAtSystem = systems.lookAtSystem;
  }

  public getState(channel: "lookAt" | "expression"): {
    busy: boolean;
    queueLength: number;
    ownerId: string | null;
  } {
    const slot = channel === "lookAt" ? this.lookAtSlot : this.expressionSlot;
    return {
      busy: slot.active !== null,
      queueLength: slot.queue.length,
      ownerId: slot.active?.ownerId ?? null
    };
  }

  public handleLookAt(
    cmd: Extract<AvatarCommand, { type: "lookAt" }>,
    ownerId: string,
    ref?: string
  ): AvatarResponse {
    const durationMs = cmd.durationMs ?? 3_000;
    const policy = cmd.policy ?? "interrupt";
    if (durationMs === 0) {
      if (this.lookAtSlot.active && policy === "drop") {
        return buildErrorResponse("busy", "lookAt channel is busy", ref);
      }
      this.clearLookAtSlot();
      return buildAckResponse(ref);
    }
    const item: LookAtChannelItem = {
      kind: "lookAt",
      ownerId,
      x: cmd.x,
      y: cmd.y,
      durationMs,
      elapsedMs: 0,
      lockToken: this.host.nextLockToken("lookAt")
    };
    return arbitrateChannel(
      this.lookAtSlot,
      item,
      policy,
      this.maxQueueSize,
      "lookAt",
      ref,
      {
        onInterruptActive: (prev) => this.host.releaseLock(prev.lockToken),
        onActivate: (next) => {
          this.host.acquireLock(next.lockToken);
          this.lookAtSystem?.setExternalNdc(next.x, next.y);
        }
      }
    );
  }

  public handleExpression(
    cmd: Extract<AvatarCommand, { type: "expression" }>,
    ownerId: string,
    ref?: string
  ): AvatarResponse {
    const policy = cmd.policy ?? "interrupt";
    const intensity = cmd.intensity ?? 1.0;
    if (cmd.durationMs === 0 || intensity === 0) {
      if (this.expressionSlot.active && policy === "drop") {
        return buildErrorResponse("busy", "expression channel is busy", ref);
      }
      this.clearExpressionSlot();
      return buildAckResponse(ref);
    }
    const item: ExpressionChannelItem = {
      kind: "expression",
      ownerId,
      name: cmd.name,
      intensity,
      durationMs: cmd.durationMs,
      elapsedMs: 0,
      lockToken:
        cmd.durationMs !== undefined ? this.host.nextLockToken("expr") : null
    };
    return arbitrateChannel(
      this.expressionSlot,
      item,
      policy,
      this.maxQueueSize,
      "expression",
      ref,
      {
        onInterruptActive: (prev) => this.cleanupExpression(prev),
        onActivate: (next) => this.activateExpression(next)
      }
    );
  }

  public handleReaction(
    cmd: Extract<AvatarCommand, { type: "reaction" }>,
    ownerId: string,
    ref?: string
  ): AvatarResponse {
    const item: ExpressionChannelItem = {
      kind: "reaction",
      ownerId,
      name: cmd.name,
      intensity: cmd.intensity ?? 1.0,
      durationMs: cmd.durationMs ?? 1_500,
      elapsedMs: 0,
      lockToken: this.host.nextLockToken("react")
    };
    return arbitrateChannel(
      this.expressionSlot,
      item,
      cmd.policy ?? "interrupt",
      this.maxQueueSize,
      "expression",
      ref,
      {
        onInterruptActive: (prev) => this.cleanupExpression(prev),
        onActivate: (next) => this.activateExpression(next)
      }
    );
  }

  public step(dtMs: number): void {
    this.stepLookAt(dtMs);
    this.stepExpression(dtMs);
  }

  public collectEmotions(out: EmotionExpressionInput[]): void {
    const reactionExpr = this.reactionSystem?.getActiveExpression() ?? null;
    const activeExpr = this.expressionSlot.active;
    if (reactionExpr) {
      out.push({ name: reactionExpr.preset, weight: reactionExpr.weight });
    } else if (activeExpr?.kind === "expression") {
      out.push({ name: activeExpr.name, weight: activeExpr.intensity });
    } else if (activeExpr?.kind === "reaction") {
      out.push({
        name: reactionPresetForName(activeExpr.name),
        weight: activeExpr.intensity
      });
    }
  }

  public clearAll(): void {
    this.clearLookAtSlot();
    this.clearExpressionSlot();
  }

  public cancelByOwner(ownerId: string): void {
    this.cancelSlot(this.lookAtSlot, ownerId, (next) => {
      if (next) {
        this.host.acquireLock(next.lockToken);
        this.lookAtSystem?.setExternalNdc(next.x, next.y);
      } else {
        this.lookAtSystem?.clearExternalNdc();
      }
    });
    this.cancelSlot(
      this.expressionSlot,
      ownerId,
      (next) => {
        if (next) this.activateExpression(next);
      },
      (prev) => {
        if (prev.kind === "reaction") this.reactionSystem?.stop();
      }
    );
  }

  private activateExpression(item: ExpressionChannelItem): void {
    if (item.lockToken) this.host.acquireLock(item.lockToken);
    if (item.kind === "reaction") {
      this.reactionSystem?.trigger(
        item.name,
        item.durationMs / 1000,
        item.intensity
      );
    } else {
      this.reactionSystem?.stop();
    }
  }

  private cleanupExpression(item: ExpressionChannelItem): void {
    if (item.lockToken) this.host.releaseLock(item.lockToken);
    if (item.kind === "reaction") this.reactionSystem?.stop();
  }

  private stepLookAt(dtMs: number): void {
    const active = this.lookAtSlot.active;
    if (!active) return;
    active.elapsedMs += dtMs;
    this.lookAtSystem?.setExternalNdc(active.x, active.y);
    if (active.elapsedMs >= active.durationMs) {
      this.host.releaseLock(active.lockToken);
      const next = this.lookAtSlot.queue.shift() ?? null;
      this.lookAtSlot.active = next;
      if (next) {
        this.host.acquireLock(next.lockToken);
        this.lookAtSystem?.setExternalNdc(next.x, next.y);
      } else {
        this.lookAtSystem?.clearExternalNdc();
      }
    }
  }

  private stepExpression(dtMs: number): void {
    const active = this.expressionSlot.active;
    if (!active) return;
    active.elapsedMs += dtMs;
    if (
      active.durationMs !== undefined &&
      active.elapsedMs >= active.durationMs
    ) {
      this.cleanupExpression(active);
      const next = this.expressionSlot.queue.shift() ?? null;
      this.expressionSlot.active = next;
      if (next) this.activateExpression(next);
    }
  }

  private clearLookAtSlot(): void {
    if (this.lookAtSlot.active)
      this.host.releaseLock(this.lookAtSlot.active.lockToken);
    this.lookAtSlot.active = null;
    this.lookAtSlot.queue.length = 0;
    this.lookAtSystem?.clearExternalNdc();
  }

  private clearExpressionSlot(): void {
    if (this.expressionSlot.active)
      this.cleanupExpression(this.expressionSlot.active);
    this.expressionSlot.active = null;
    this.expressionSlot.queue.length = 0;
  }

  private cancelSlot<T extends { ownerId: string; lockToken?: string | null }>(
    slot: ChannelSlot<T>,
    ownerId: string,
    onNext: (next: T | null) => void,
    onStopActive?: (prev: T) => void
  ): void {
    for (let i = slot.queue.length - 1; i >= 0; i--) {
      if (slot.queue[i].ownerId === ownerId) slot.queue.splice(i, 1);
    }
    if (slot.active?.ownerId === ownerId) {
      const prev = slot.active;
      if (prev.lockToken) this.host.releaseLock(prev.lockToken);
      onStopActive?.(prev);
      const next = slot.queue.shift() ?? null;
      slot.active = next;
      onNext(next);
    }
  }
}
