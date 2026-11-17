import { AudioOutput } from "./AudioOutput";
import { createChannelSlot } from "./AvatarChannels";
import {
  buildErrorResponse,
  type AvatarCommand,
  type AvatarEvent,
  type AvatarResponse,
  type SpeechEndReason
} from "./AvatarCommand";
import { LipSyncController } from "./LipSyncController";
import type { PowerSaveController, UnlistenFn } from "./PowerSaveController";
import { createSayItem, createSpeakItem } from "./SpeechCommandBuilders";
import {
  arbitrateSpeechItem,
  buildSpeechStreamContext,
  cancelMatchingSpeechItems,
  clearAllSpeechSlotItems,
  finishActiveSpeechItem,
  stepActiveSpeechSlot,
  type SpeechRuntimeHooks
} from "./SpeechQueueRuntime";
import {
  cancelStreamCommand,
  chunkStreamCommand,
  endStreamCommand,
  startStreamCommand,
  type StreamCommandContext
} from "./SpeechStreamCommands";
import {
  DEFAULT_MAX_SPEECH_QUEUE,
  DEFAULT_MAX_STREAM_BUFFER_BYTES,
  DEFAULT_SAY_DURATION_MS,
  DEFAULT_STREAM_TIMEOUT_MS,
  type SpeechBubbleListener,
  type SpeechBubbleState,
  type SpeechControllerOptions,
  type SpeechQueueItem,
  type StreamSpeechItem
} from "./SpeechTypes";

export type {
  SpeechBubbleListener,
  SpeechBubbleState,
  SpeechControllerOptions
} from "./SpeechTypes";

/** Unified speech queue (`speak`, streams, `say`) with ADR-0006 limits and lock cleanup. */
export class SpeechController {
  public readonly audioOutput: AudioOutput;
  public readonly lipSync: LipSyncController;

  private readonly powerSaveController: PowerSaveController;
  private readonly ownsAudioOutput: boolean;
  private readonly ownsLipSync: boolean;
  private readonly defaultSayDurationMs: number;
  private readonly slot = createChannelSlot<SpeechQueueItem>();
  private readonly streamsById = new Map<string, StreamSpeechItem>();
  private readonly heldLocks = new Set<string>();
  private readonly eventListeners = new Set<(event: AvatarEvent) => void>();
  private readonly bubbleListeners = new Set<SpeechBubbleListener>();
  private readonly unlistenFns: UnlistenFn[] = [];
  private readonly streamCtx: StreamCommandContext;
  private readonly rt: SpeechRuntimeHooks;

  private activeBubble: SpeechBubbleState | null = null;
  private lockSeq = 0;
  private playbackSeq = 0;
  private isDisposed = false;

  constructor(options: SpeechControllerOptions) {
    this.powerSaveController = options.powerSaveController;
    this.ownsAudioOutput = !options.audioOutput;
    this.audioOutput = options.audioOutput ?? new AudioOutput();
    this.ownsLipSync = !options.lipSyncController;
    this.lipSync =
      options.lipSyncController ??
      new LipSyncController({
        getAudioTime: () => this.audioOutput.currentTime
      });
    this.defaultSayDurationMs = Math.max(
      0,
      options.defaultSayDurationMs ?? DEFAULT_SAY_DURATION_MS
    );

    this.streamCtx = buildSpeechStreamContext(
      this.streamsById,
      this.slot,
      Math.max(
        1,
        options.maxStreamBufferBytes ?? DEFAULT_MAX_STREAM_BUFFER_BYTES
      ),
      this.audioOutput,
      this.lipSync,
      () => this.isDisposed,
      () => ++this.playbackSeq,
      (i, r) => finishActiveSpeechItem(this.rt, i, r)
    );
    this.rt = {
      powerSaveController: this.powerSaveController,
      heldLocks: this.heldLocks,
      slot: this.slot,
      streamsById: this.streamsById,
      audioOutput: this.audioOutput,
      lipSync: this.lipSync,
      streamCtx: this.streamCtx,
      maxQueueSize: Math.max(
        1,
        options.maxQueueSize ?? DEFAULT_MAX_SPEECH_QUEUE
      ),
      streamTimeoutMs: Math.max(
        100,
        options.streamTimeoutMs ?? DEFAULT_STREAM_TIMEOUT_MS
      ),
      isDisposed: () => this.isDisposed,
      bumpPlaybackSeq: () => {
        this.playbackSeq++;
      },
      setBubble: (bubble) => {
        this.activeBubble = bubble;
        for (const listener of this.bubbleListeners) listener(bubble);
      },
      emitEvent: (ev) => {
        for (const listener of this.eventListeners) listener(ev);
      }
    };

    if (options.emitEvent) this.eventListeners.add(options.emitEvent);
    if (options.onBubbleChange)
      this.bubbleListeners.add(options.onBubbleChange);
    this.unlistenFns.push(
      this.audioOutput.onUnderrun(() => this.lipSync.notifyUnderrun()),
      this.powerSaveController.onVisibilityChange((visible) => {
        if (!visible) this.cancelAll("hidden");
      })
    );
  }

  public get disposed(): boolean {
    return this.isDisposed;
  }
  public get isActive(): boolean {
    return this.slot.active !== null;
  }
  public getActiveBubble(): SpeechBubbleState | null {
    return this.activeBubble;
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
  public onEvent(listener: (event: AvatarEvent) => void): UnlistenFn {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }
  public onBubbleChange(listener: SpeechBubbleListener): UnlistenFn {
    this.bubbleListeners.add(listener);
    return () => this.bubbleListeners.delete(listener);
  }

  public handleSay(
    cmd: Extract<AvatarCommand, { type: "say" }>,
    ownerId: string,
    ref?: string
  ): AvatarResponse {
    return (
      this.checkPreconditions(ref) ??
      arbitrateSpeechItem(
        this.rt,
        createSayItem(
          cmd,
          ownerId,
          this.defaultSayDurationMs,
          `speech:say:${++this.lockSeq}`
        ),
        cmd.policy ?? "queue",
        ref
      )
    );
  }

  public handleSpeak(
    cmd: Extract<AvatarCommand, { type: "speak" }>,
    ownerId: string,
    ref?: string
  ): AvatarResponse {
    return (
      this.checkPreconditions(ref) ??
      arbitrateSpeechItem(
        this.rt,
        createSpeakItem(cmd, ownerId, `speech:speak:${++this.lockSeq}`),
        cmd.policy ?? "queue",
        ref
      )
    );
  }

  public handleSpeakStart(
    cmd: Extract<AvatarCommand, { type: "speakStart" }>,
    ownerId: string,
    ref?: string
  ): AvatarResponse {
    return (
      this.checkPreconditions(ref) ??
      startStreamCommand(
        this.streamCtx,
        cmd,
        ownerId,
        `speech:stream:${++this.lockSeq}`,
        (item) =>
          arbitrateSpeechItem(this.rt, item, cmd.policy ?? "queue", ref),
        ref
      )
    );
  }

  public handleSpeakChunk(
    cmd: Extract<AvatarCommand, { type: "speakChunk" }>,
    ownerId: string,
    ref?: string
  ): AvatarResponse {
    return (
      this.checkPreconditions(ref) ??
      chunkStreamCommand(this.streamCtx, cmd, ownerId, ref)
    );
  }

  public handleSpeakEnd(
    streamId: string,
    ownerId: string,
    ref?: string
  ): AvatarResponse {
    return (
      this.checkPreconditions(ref) ??
      endStreamCommand(this.streamCtx, streamId, ownerId, ref)
    );
  }

  public handleSpeakCancel(
    streamId: string,
    ownerId: string,
    ref?: string
  ): AvatarResponse {
    return (
      this.checkPreconditions(ref) ??
      cancelStreamCommand(this.streamCtx, streamId, ownerId, ref)
    );
  }

  public stopSpeaking(id?: string): void {
    if (id === undefined) this.cancelAll("cancelled");
    else cancelMatchingSpeechItems(this.rt, (item) => item.id === id);
  }

  public cancelByOwner(ownerId: string): void {
    cancelMatchingSpeechItems(this.rt, (item) => item.ownerId === ownerId);
  }

  public cancelAll(reason: SpeechEndReason): void {
    clearAllSpeechSlotItems(this.rt, reason);
  }

  public step(dtMs: number): void {
    stepActiveSpeechSlot(this.rt, dtMs);
  }

  public dispose(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;
    this.cancelAll("cancelled");
    for (const lock of this.heldLocks)
      this.powerSaveController.releaseActiveLock(lock);
    this.heldLocks.clear();
    for (const unlisten of this.unlistenFns) unlisten();
    this.unlistenFns.length = 0;
    this.eventListeners.clear();
    this.bubbleListeners.clear();
    if (this.ownsLipSync) this.lipSync.dispose();
    if (this.ownsAudioOutput) this.audioOutput.dispose();
  }

  private checkPreconditions(ref?: string): AvatarResponse | null {
    if (this.isDisposed)
      return buildErrorResponse("invalid", "SpeechController is disposed", ref);
    if (!this.powerSaveController.isWindowVisible) {
      return buildErrorResponse(
        "hidden",
        "Avatar window is hidden; command rejected",
        ref
      );
    }
    return null;
  }
}
