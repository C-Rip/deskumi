import {
  arbitrateChannel,
  clearMouthVisemesMap,
  createChannelSlot,
  estimatePcmDurationMs,
  sampleVisemeWeights,
  type MouthChannelItem
} from "./AvatarChannels";
import {
  buildAckResponse,
  buildErrorResponse,
  type AvatarCommand,
  type AvatarEvent,
  type AvatarResponse,
  type CommandPolicy,
  type MouthVisemeName,
  type SpeechEndReason
} from "./AvatarCommand";

export interface MouthChannelHost {
  acquireLock: (token: string) => void;
  releaseLock: (token: string) => void;
  nextLockToken: (prefix: string) => string;
  emitEvent: (event: AvatarEvent) => void;
}

export class AvatarMouthChannel {
  private readonly slot = createChannelSlot<MouthChannelItem>();
  private readonly streamsById = new Map<
    string,
    Extract<MouthChannelItem, { kind: "stream" }>
  >();
  private readonly visemes: Partial<Record<MouthVisemeName, number>> = {};
  private externalActive = false;

  constructor(
    private readonly host: MouthChannelHost,
    private readonly maxQueueSize: number,
    private readonly streamTimeoutMs: number
  ) {}

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

  public get isActive(): boolean {
    return this.externalActive || this.slot.active !== null;
  }

  public get visemeWeights(): Partial<Record<MouthVisemeName, number>> {
    return this.visemes;
  }

  public setVisemes(weights: Partial<Record<MouthVisemeName, number>>): void {
    clearMouthVisemesMap(this.visemes);
    for (const key of ["aa", "ih", "ou", "ee", "oh"] as const) {
      if (weights[key] !== undefined) this.visemes[key] = weights[key];
    }
  }

  public clearVisemes(): void {
    clearMouthVisemesMap(this.visemes);
  }

  public setExternalActive(active: boolean): void {
    this.externalActive = active;
  }

  public handleSay(
    cmd: Extract<AvatarCommand, { type: "say" }>,
    ownerId: string,
    ref?: string
  ): AvatarResponse {
    const item: MouthChannelItem = {
      kind: "say",
      ownerId,
      id: cmd.id,
      text: cmd.text,
      durationMs: cmd.durationMs ?? 3_000,
      elapsedMs: 0,
      lockToken: this.host.nextLockToken("mouth")
    };
    return this.arbitrate(item, cmd.policy ?? "queue", ref);
  }

  public handleSpeak(
    cmd: Extract<AvatarCommand, { type: "speak" }>,
    ownerId: string,
    ref?: string
  ): AvatarResponse {
    const visemes = cmd.visemes ?? [];
    const lastT = visemes.reduce((m, k) => Math.max(m, k.t), 0);
    const durationMs =
      cmd.durationMs ?? (visemes.length > 0 ? lastT + 200 : 3_000);
    const item: MouthChannelItem = {
      kind: "speak",
      ownerId,
      id: cmd.id,
      text: cmd.text,
      audio: cmd.audio,
      visemes: [...visemes],
      durationMs,
      elapsedMs: 0,
      lockToken: this.host.nextLockToken("mouth")
    };
    return this.arbitrate(item, cmd.policy ?? "queue", ref);
  }

  public handleSpeakStart(
    cmd: Extract<AvatarCommand, { type: "speakStart" }>,
    ownerId: string,
    ref?: string
  ): AvatarResponse {
    const existing = this.streamsById.get(cmd.streamId);
    if (existing) {
      return buildErrorResponse(
        existing.ownerId === ownerId ? "busy" : "forbidden",
        `streamId ${cmd.streamId} is already in use`,
        ref
      );
    }
    const item: Extract<MouthChannelItem, { kind: "stream" }> = {
      kind: "stream",
      ownerId,
      streamId: cmd.streamId,
      id: cmd.id,
      text: cmd.text,
      sampleRate: cmd.sampleRate,
      channels: cmd.channels ?? 1,
      format: cmd.format ?? "pcm_s16le",
      ended: false,
      endAtMs: 0,
      idleMs: 0,
      elapsedMs: 0,
      chunkCursorMs: 0,
      visemes: [],
      lockToken: this.host.nextLockToken("stream")
    };
    const res = this.arbitrate(item, cmd.policy ?? "queue", ref);
    if (res.type === "ack") this.streamsById.set(cmd.streamId, item);
    return res;
  }

  public handleSpeakChunk(
    cmd: Extract<AvatarCommand, { type: "speakChunk" }>,
    ownerId: string,
    ref?: string
  ): AvatarResponse {
    const stream = this.streamsById.get(cmd.streamId);
    if (!stream) {
      return buildErrorResponse(
        "invalid",
        `Unknown streamId: ${cmd.streamId}`,
        ref
      );
    }
    if (stream.ownerId !== ownerId) {
      return buildErrorResponse(
        "forbidden",
        "Stream owned by another client",
        ref
      );
    }
    if (stream.ended) {
      return buildErrorResponse("invalid", "Stream already ended", ref);
    }
    stream.idleMs = 0;
    const baseMs = Math.max(stream.elapsedMs, stream.chunkCursorMs);
    let maxVisemeRel = 0;
    if (cmd.visemes) {
      for (const kf of cmd.visemes) {
        stream.visemes.push({ ...kf, t: baseMs + kf.t });
        if (kf.t > maxVisemeRel) maxVisemeRel = kf.t;
      }
    }
    const bytes =
      cmd.pcm?.byteLength ??
      (cmd.pcmBase64 ? Math.floor((cmd.pcmBase64.length * 3) / 4) : 0);
    const pcmDur =
      bytes > 0
        ? estimatePcmDurationMs(
            bytes,
            cmd.sampleRate ?? stream.sampleRate,
            stream.channels,
            stream.format
          )
        : maxVisemeRel > 0
          ? maxVisemeRel + 80
          : 0;
    stream.chunkCursorMs = baseMs + pcmDur;
    return buildAckResponse(ref);
  }

  public handleSpeakEnd(
    streamId: string,
    ownerId: string,
    ref?: string
  ): AvatarResponse {
    const stream = this.streamsById.get(streamId);
    if (!stream) {
      return buildErrorResponse(
        "invalid",
        `Unknown streamId: ${streamId}`,
        ref
      );
    }
    if (stream.ownerId !== ownerId) {
      return buildErrorResponse(
        "forbidden",
        "Stream owned by another client",
        ref
      );
    }
    stream.ended = true;
    stream.idleMs = 0;
    const lastV = stream.visemes.reduce((m, k) => Math.max(m, k.t), 0);
    stream.endAtMs = Math.max(
      stream.elapsedMs,
      stream.chunkCursorMs,
      stream.visemes.length > 0 ? lastV + 100 : 0
    );
    return buildAckResponse(ref);
  }

  public handleSpeakCancel(
    streamId: string,
    ownerId: string,
    ref?: string
  ): AvatarResponse {
    const stream = this.streamsById.get(streamId);
    if (!stream) {
      return buildErrorResponse(
        "invalid",
        `Unknown streamId: ${streamId}`,
        ref
      );
    }
    if (stream.ownerId !== ownerId) {
      return buildErrorResponse(
        "forbidden",
        "Stream owned by another client",
        ref
      );
    }
    this.streamsById.delete(streamId);
    if (this.slot.active === stream) {
      this.finishActive(stream, true, "cancelled");
    } else {
      const idx = this.slot.queue.indexOf(stream);
      if (idx !== -1) this.slot.queue.splice(idx, 1);
    }
    return buildAckResponse(ref);
  }

  public step(dtMs: number): void {
    const active = this.slot.active;
    if (!active) return;
    active.elapsedMs += dtMs;

    if (active.kind === "say") {
      if (active.elapsedMs >= active.durationMs) {
        this.finishActive(active, false, "finished");
      }
      return;
    }

    if (active.visemes.length > 0) {
      sampleVisemeWeights(active.visemes, active.elapsedMs, this.visemes);
    }

    if (active.kind === "speak") {
      if (active.elapsedMs >= active.durationMs) {
        this.finishActive(active, false, "finished");
      }
      return;
    }

    if (!active.ended) {
      active.idleMs += dtMs;
      if (active.idleMs >= this.streamTimeoutMs) {
        this.streamsById.delete(active.streamId);
        this.finishActive(active, true, "timeout");
      }
    } else if (active.elapsedMs >= active.endAtMs) {
      this.streamsById.delete(active.streamId);
      this.finishActive(active, false, "finished");
    }
  }

  public interruptAll(reason: SpeechEndReason): void {
    if (this.slot.active) {
      const prev = this.slot.active;
      if (prev.kind === "stream") this.streamsById.delete(prev.streamId);
      this.host.releaseLock(prev.lockToken);
      this.clearVisemes();
      this.slot.active = null;
      this.emitSpeechEnd(prev.id, true, reason);
    }
    for (const q of this.slot.queue) {
      if (q.kind === "stream") this.streamsById.delete(q.streamId);
    }
    this.slot.queue.length = 0;
  }

  public cancelByOwner(ownerId: string): void {
    for (let i = this.slot.queue.length - 1; i >= 0; i--) {
      const q = this.slot.queue[i];
      if (q.ownerId === ownerId) {
        this.slot.queue.splice(i, 1);
        if (q.kind === "stream") this.streamsById.delete(q.streamId);
      }
    }
    if (this.slot.active?.ownerId === ownerId) {
      const prev = this.slot.active;
      if (prev.kind === "stream") this.streamsById.delete(prev.streamId);
      this.finishActive(prev, true, "cancelled");
    }
  }

  private arbitrate(
    item: MouthChannelItem,
    policy: CommandPolicy,
    ref?: string
  ): AvatarResponse {
    return arbitrateChannel(
      this.slot,
      item,
      policy,
      this.maxQueueSize,
      "mouth",
      ref,
      {
        onInterruptActive: (prev) => {
          if (prev.kind === "stream") this.streamsById.delete(prev.streamId);
          this.host.releaseLock(prev.lockToken);
          this.clearVisemes();
          this.emitSpeechEnd(prev.id, true, "interrupted");
        },
        onActivate: (next) => this.activateItem(next),
        onDropQueued: (queued) => {
          if (queued.kind === "stream")
            this.streamsById.delete(queued.streamId);
        }
      }
    );
  }

  private activateItem(item: MouthChannelItem): void {
    this.host.acquireLock(item.lockToken);
    this.clearVisemes();
    this.host.emitEvent(
      item.id !== undefined
        ? { type: "speechStart", id: item.id }
        : { type: "speechStart" }
    );
  }

  private finishActive(
    active: MouthChannelItem,
    interrupted: boolean,
    reason: SpeechEndReason
  ): void {
    this.host.releaseLock(active.lockToken);
    this.clearVisemes();
    this.slot.active = null;
    this.emitSpeechEnd(active.id, interrupted, reason);
    const next = this.slot.queue.shift() ?? null;
    this.slot.active = next;
    if (next) this.activateItem(next);
  }

  private emitSpeechEnd(
    id: string | undefined,
    interrupted: boolean,
    reason: SpeechEndReason
  ): void {
    this.host.emitEvent(
      id !== undefined
        ? { type: "speechEnd", id, interrupted, reason }
        : { type: "speechEnd", interrupted, reason }
    );
  }
}
