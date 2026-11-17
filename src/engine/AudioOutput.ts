import {
  decodeAndStartEncodedBuffer,
  decodeRawPcmChannels,
  defaultAudioContextFactory,
  scheduleEmptyPcmResult,
  schedulePcmBufferOnContext,
  stopTrackedEntry
} from "./AudioBufferSchedule";
import type {
  ActiveSourceEntry,
  AudioContextFactory,
  AudioContextLifecycleState,
  AudioContextLike,
  AudioOutputOptions,
  PlayEncodedAudioResult,
  ScheduledPcmResult
} from "./AudioOutputTypes";
import type { SpeakAudioBase64 } from "./AvatarCommand";
import type { PcmSampleFormat } from "./PcmDecoder";

export type * from "./AudioOutputTypes";

/**
 * Lazy WebAudio output with cold-start `resume()`, continuous PCM stream
 * scheduling (120 ms pre-buffer + underrun recovery), and auto-`suspend()`.
 */
export class AudioOutput {
  private readonly contextFactory: AudioContextFactory | null;
  private readonly preBufferSec: number;
  private readonly inactivitySuspendMs: number;
  private readonly underrunListeners = new Set<() => void>();
  private readonly onStateChange?: (state: AudioContextLifecycleState) => void;
  private readonly activeSources = new Set<ActiveSourceEntry>();

  private ctx: AudioContextLike | null = null;
  private resumePromise: Promise<void> | null = null;
  private suspendPromise: Promise<void> | null = null;
  private suspendTimer: ReturnType<typeof setTimeout> | null = null;
  private streamOpen = false;
  private inUnderrun = false;
  private nextScheduledTime: number | null = null;
  private pendingAsyncOps = 0;
  private isDisposed = false;

  constructor(options: AudioOutputOptions = {}) {
    this.contextFactory = options.createContext ?? defaultAudioContextFactory();
    this.preBufferSec = Math.max(0, options.preBufferSec ?? 0.12);
    this.inactivitySuspendMs = Math.max(
      1,
      options.inactivitySuspendMs ?? 4_000
    );
    if (options.onUnderrun) this.underrunListeners.add(options.onUnderrun);
    this.onStateChange = options.onStateChange;
  }

  public async playPcm(options: {
    pcm: Uint8Array;
    format: PcmSampleFormat;
    channels: 1 | 2;
    sampleRate: number;
    onEnded?: () => void;
  }): Promise<ScheduledPcmResult> {
    return this.runTrackedAsyncOp(async () => {
      await this.ensureRunning();
      const ch = decodeRawPcmChannels(
        options.pcm,
        options.format,
        options.channels
      );
      return this.scheduleDecodedPcm(ch, options.sampleRate, options.onEnded);
    });
  }

  public get isSupported(): boolean {
    return this.contextFactory !== null;
  }
  public get disposed(): boolean {
    return this.isDisposed;
  }
  public get state(): AudioContextLifecycleState {
    return this.ctx ? this.ctx.state : "uninitialized";
  }
  public get currentTime(): number {
    return this.ctx ? this.ctx.currentTime : 0;
  }
  public get sampleRate(): number {
    return this.ctx ? this.ctx.sampleRate : 0;
  }
  public get isPlaying(): boolean {
    return this.activeSources.size > 0;
  }
  public get isStreamActive(): boolean {
    return this.streamOpen;
  }
  public get isInUnderrun(): boolean {
    return this.inUnderrun;
  }
  public get nextStreamStartTime(): number | null {
    return this.nextScheduledTime;
  }
  public get isRunningNow(): boolean {
    return (
      !this.isDisposed && this.ctx?.state === "running" && !this.suspendPromise
    );
  }

  public onUnderrun(listener: () => void): () => void {
    this.underrunListeners.add(listener);
    return () => this.underrunListeners.delete(listener);
  }

  public async ensureRunning(): Promise<AudioContextLike> {
    this.clearSuspendTimer();
    if (this.suspendPromise) await this.suspendPromise.catch(() => {});
    if (this.isDisposed) throw new Error("AudioOutput is disposed");

    if (!this.ctx || this.ctx.state === "closed") {
      if (!this.contextFactory)
        throw new Error("WebAudio AudioContext is not available");
      this.ctx = this.contextFactory();
      this.onStateChange?.(this.ctx.state);
    }
    if (this.ctx.state === "suspended") {
      await this.resumeContext(this.ctx);
    }
    this.scheduleSuspendIfIdle();
    return this.ctx;
  }

  private async resumeContext(target: AudioContextLike): Promise<void> {
    if (!this.resumePromise) {
      this.resumePromise = target.resume().finally(() => {
        this.resumePromise = null;
      });
    }
    await this.resumePromise;
    if (this.isDisposed || !this.ctx)
      throw new Error("AudioOutput is disposed");
    this.onStateChange?.(this.ctx.state);
  }

  public async suspend(): Promise<void> {
    this.clearSuspendTimer();
    if (
      this.isDisposed ||
      this.ctx?.state !== "running" ||
      this.activeSources.size > 0 ||
      this.pendingAsyncOps > 0
    ) {
      return;
    }
    if (!this.suspendPromise) {
      const target = this.ctx;
      this.suspendPromise = target.suspend().finally(() => {
        this.suspendPromise = null;
      });
    }
    await this.suspendPromise;
    if (this.ctx) this.onStateChange?.(this.ctx.state);
  }

  public async playEncodedAudio(
    audio: SpeakAudioBase64,
    options: { shouldCancel?: () => boolean; onEnded?: () => void } = {}
  ): Promise<PlayEncodedAudioResult> {
    return this.runTrackedAsyncOp(async () => {
      const ctx = await this.ensureRunning();
      const shouldAbort = (): boolean =>
        this.isDisposed || Boolean(options.shouldCancel?.());
      if (shouldAbort()) return { cancelled: true };
      return await decodeAndStartEncodedBuffer(
        ctx,
        audio.base64,
        this.activeSources,
        shouldAbort,
        () => this.handleSourceEnded(options.onEnded)
      );
    });
  }

  public startStream(): void {
    this.clearSuspendTimer();
    this.streamOpen = true;
    this.inUnderrun = false;
    this.nextScheduledTime = null;
  }

  public endStream(): void {
    this.streamOpen = false;
    this.scheduleSuspendIfIdle();
  }

  public scheduleDecodedPcm(
    channelsData: readonly Float32Array[],
    sampleRate: number,
    onEnded?: () => void
  ): ScheduledPcmResult {
    if (this.isDisposed || !this.ctx || this.ctx.state === "closed") {
      throw new Error("AudioContext is not running");
    }
    this.clearSuspendTimer();
    if ((channelsData[0]?.length ?? 0) === 0) {
      this.scheduleSuspendIfIdle();
      return scheduleEmptyPcmResult(this.ctx.currentTime, onEnded);
    }

    const scheduled = schedulePcmBufferOnContext(
      this.ctx,
      channelsData,
      sampleRate,
      this.preBufferSec,
      this.nextScheduledTime,
      this.activeSources,
      () => this.handleSourceEnded(onEnded)
    );
    if (scheduled.hadUnderrun && !this.inUnderrun) {
      this.inUnderrun = true;
      for (const listener of this.underrunListeners) listener();
    }
    this.inUnderrun = false;
    this.nextScheduledTime = scheduled.nextTime;
    return scheduled.result;
  }

  public checkUnderrun(): boolean {
    if (
      !this.streamOpen ||
      this.inUnderrun ||
      !this.ctx ||
      this.nextScheduledTime === null
    )
      return false;
    if (this.ctx.currentTime < this.nextScheduledTime) return false;
    this.inUnderrun = true;
    for (const listener of this.underrunListeners) listener();
    return true;
  }

  public stopAll(): void {
    this.streamOpen = false;
    this.inUnderrun = false;
    this.nextScheduledTime = null;
    for (const entry of Array.from(this.activeSources))
      stopTrackedEntry(entry, this.activeSources);
    this.activeSources.clear();
    this.scheduleSuspendIfIdle();
  }

  public dispose(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;
    this.stopAll();
    this.clearSuspendTimer();
    this.underrunListeners.clear();
    if (this.ctx && this.ctx.state !== "closed")
      void this.ctx.close().catch(() => {});
    this.ctx = null;
  }

  private handleSourceEnded(onEnded?: () => void): void {
    onEnded?.();
    if (this.activeSources.size > 0) return;
    if (this.streamOpen) {
      this.inUnderrun = true;
      for (const listener of this.underrunListeners) listener();
    }
    this.scheduleSuspendIfIdle();
  }

  private scheduleSuspendIfIdle(): void {
    this.clearSuspendTimer();
    const busy =
      this.isDisposed ||
      this.ctx?.state !== "running" ||
      this.activeSources.size > 0 ||
      this.pendingAsyncOps > 0;
    if (busy) return;
    this.suspendTimer = setTimeout(() => {
      this.suspendTimer = null;
      void this.suspend().catch(() => {});
    }, this.inactivitySuspendMs);
  }

  private clearSuspendTimer(): void {
    if (this.suspendTimer !== null) {
      clearTimeout(this.suspendTimer);
      this.suspendTimer = null;
    }
  }

  private async runTrackedAsyncOp<T>(fn: () => Promise<T>): Promise<T> {
    this.pendingAsyncOps++;
    try {
      return await fn();
    } finally {
      this.pendingAsyncOps = Math.max(0, this.pendingAsyncOps - 1);
      this.scheduleSuspendIfIdle();
    }
  }
}
