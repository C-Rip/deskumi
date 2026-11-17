import type {
  MouthVisemeName,
  VisemeKeyframe,
  VisemeName
} from "./AvatarCommand";
import { clearMouthVisemesMap } from "./AvatarChannels";
import {
  clamp01,
  compactNumberArrays,
  sortVisemesAscending,
  type LipSyncControllerOptions
} from "./LipSyncTypes";
import {
  computePcmRmsEnvelope,
  decodePcmToFloat32Channels,
  mixChannelsToMono,
  type PcmSampleFormat,
  type RmsEnvelopeOptions
} from "./PcmDecoder";
import type { System } from "./types";

export type { LipSyncControllerOptions } from "./LipSyncTypes";

const COMPACT_THRESHOLD = 64;

/**
 * Time-synchronized lip-sync controller driven strictly by `AudioOutput.currentTime`.
 * Evaluates explicit viseme cues (`aa`, `ih`, `ou`, `ee`, `oh`, `neutral`) and falls back
 * deterministically to PCM RMS amplitude without `AnalyserNode` or per-frame allocations.
 */
export class LipSyncController implements System {
  private readonly getAudioTime: () => number;
  private readonly rmsOptions: RmsEnvelopeOptions;
  private readonly defaultTailSec: number;

  private readonly cueStarts: number[] = [];
  private readonly cueEnds: number[] = [];
  private readonly cueVisemes: VisemeName[] = [];
  private readonly cueWeights: number[] = [];
  private cueCursor = 0;

  private readonly rmsStarts: number[] = [];
  private readonly rmsEnds: number[] = [];
  private readonly rmsWeights: number[] = [];
  private rmsCursor = 0;

  private readonly weights: Record<MouthVisemeName, number> = {
    aa: 0,
    ih: 0,
    ou: 0,
    ee: 0,
    oh: 0
  };
  private activeFlag = false;
  private lastEvaluatedTime = 0;
  private isDisposed = false;

  constructor(options: LipSyncControllerOptions) {
    this.getAudioTime = options.getAudioTime;
    this.rmsOptions = {
      windowMs: options.rmsWindowMs,
      noiseFloor: options.rmsNoiseFloor,
      peakLevel: options.rmsPeakLevel
    };
    this.defaultTailSec = Math.max(0.01, options.defaultVisemeTailSec ?? 0.08);
  }

  public get disposed(): boolean {
    return this.isDisposed;
  }

  public get isActive(): boolean {
    return this.activeFlag;
  }

  public get visemeWeights(): Partial<Record<MouthVisemeName, number>> {
    return this.weights;
  }

  public scheduleVisemes(
    visemes: readonly VisemeKeyframe[],
    startTimeSec: number,
    durationSec = 0
  ): number {
    if (this.isDisposed) return startTimeSec;
    if (visemes.length === 0) return startTimeSec + Math.max(0, durationSec);

    if (this.cueCursor >= COMPACT_THRESHOLD) {
      compactNumberArrays(
        this.cueCursor,
        this.cueStarts,
        this.cueEnds,
        this.cueWeights
      );
      this.cueVisemes.splice(0, this.cueCursor);
      this.cueCursor = 0;
    }

    const sorted = sortVisemesAscending(visemes);
    const firstStartSec = startTimeSec + Math.max(0, sorted[0].t) / 1000;
    const prevLen = this.cueStarts.length;
    if (prevLen > 0) {
      if (this.cueStarts[prevLen - 1] > firstStartSec) this.cueCursor = 0;
      if (this.cueEnds[prevLen - 1] > firstStartSec) {
        this.cueEnds[prevLen - 1] = Math.max(
          this.cueStarts[prevLen - 1],
          firstStartSec
        );
      }
    }

    const lastOffsetSec = Math.max(0, sorted[sorted.length - 1].t) / 1000;
    const endOffsetSec =
      durationSec > 0 && lastOffsetSec < durationSec
        ? durationSec
        : lastOffsetSec + this.defaultTailSec;
    const segmentEndSec = startTimeSec + endOffsetSec;

    for (let i = 0; i < sorted.length; i++) {
      const kf = sorted[i];
      const cueStart = startTimeSec + Math.max(0, kf.t) / 1000;
      const cueEnd =
        i + 1 < sorted.length
          ? startTimeSec + Math.max(0, sorted[i + 1].t) / 1000
          : segmentEndSec;
      this.cueStarts.push(cueStart);
      this.cueEnds.push(Math.max(cueStart, cueEnd));
      this.cueVisemes.push(kf.v);
      this.cueWeights.push(kf.v === "neutral" ? 0 : clamp01(kf.w ?? 1));
    }

    return segmentEndSec;
  }

  public schedulePcmSamples(
    samples: Float32Array,
    sampleRate: number,
    startTimeSec: number
  ): number {
    if (this.isDisposed || samples.length === 0 || sampleRate <= 0) {
      return startTimeSec;
    }

    if (this.rmsCursor >= COMPACT_THRESHOLD) {
      compactNumberArrays(
        this.rmsCursor,
        this.rmsStarts,
        this.rmsEnds,
        this.rmsWeights
      );
      this.rmsCursor = 0;
    }

    const windows = computePcmRmsEnvelope(
      samples,
      sampleRate,
      startTimeSec,
      this.rmsOptions
    );
    if (
      windows.length > 0 &&
      this.rmsStarts.length > 0 &&
      this.rmsStarts[this.rmsStarts.length - 1] > windows[0].startSec
    ) {
      this.rmsCursor = 0;
    }

    for (let i = 0; i < windows.length; i++) {
      const win = windows[i];
      this.rmsStarts.push(win.startSec);
      this.rmsEnds.push(win.endSec);
      this.rmsWeights.push(win.weight);
    }

    return startTimeSec + samples.length / sampleRate;
  }

  public schedulePcmBytes(options: {
    pcm: Uint8Array | ArrayBuffer;
    format: PcmSampleFormat;
    channels: 1 | 2;
    sampleRate: number;
    startTimeSec: number;
  }): number {
    const bytes =
      options.pcm instanceof Uint8Array
        ? options.pcm
        : new Uint8Array(options.pcm);
    const decoded = decodePcmToFloat32Channels(
      bytes,
      options.format,
      options.channels
    );
    return this.schedulePcmSamples(
      mixChannelsToMono(decoded),
      options.sampleRate,
      options.startTimeSec
    );
  }

  public notifyUnderrun(): void {
    clearMouthVisemesMap(this.weights);
    this.activeFlag = false;
  }

  /** Updates viseme weights against `AudioOutput.currentTime` (never accumulates `dt`). */
  public update(): void {
    if (!this.isDisposed) this.evaluateAt(this.getAudioTime());
  }

  /** Evaluates viseme weights (or RMS fallback) at an explicit time with zero allocations. */
  public evaluateAt(audioTimeSec: number): void {
    clearMouthVisemesMap(this.weights);
    this.activeFlag = false;
    if (this.isDisposed || !Number.isFinite(audioTimeSec)) return;

    if (audioTimeSec < this.lastEvaluatedTime) {
      this.cueCursor = 0;
      this.rmsCursor = 0;
    }
    this.lastEvaluatedTime = audioTimeSec;

    while (
      this.cueCursor < this.cueStarts.length &&
      this.cueEnds[this.cueCursor] <= audioTimeSec
    ) {
      this.cueCursor++;
    }
    let matchedCue = -1;
    for (let i = this.cueCursor; i < this.cueStarts.length; i++) {
      if (this.cueStarts[i] > audioTimeSec) break;
      if (audioTimeSec < this.cueEnds[i]) matchedCue = i;
    }
    if (matchedCue !== -1) {
      this.activeFlag = true;
      const viseme = this.cueVisemes[matchedCue];
      if (viseme !== "neutral")
        this.weights[viseme] = this.cueWeights[matchedCue];
      return;
    }

    while (
      this.rmsCursor < this.rmsStarts.length &&
      this.rmsEnds[this.rmsCursor] <= audioTimeSec
    ) {
      this.rmsCursor++;
    }
    let matchedRms = -1;
    for (let i = this.rmsCursor; i < this.rmsStarts.length; i++) {
      if (this.rmsStarts[i] > audioTimeSec) break;
      if (audioTimeSec < this.rmsEnds[i]) matchedRms = i;
    }
    if (matchedRms !== -1) {
      this.activeFlag = true;
      this.weights.aa = this.rmsWeights[matchedRms];
    }
  }

  public clear(): void {
    this.cueStarts.length = 0;
    this.cueEnds.length = 0;
    this.cueVisemes.length = 0;
    this.cueWeights.length = 0;
    this.cueCursor = 0;
    this.rmsStarts.length = 0;
    this.rmsEnds.length = 0;
    this.rmsWeights.length = 0;
    this.rmsCursor = 0;
    clearMouthVisemesMap(this.weights);
    this.activeFlag = false;
    this.lastEvaluatedTime = 0;
  }

  public dispose(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;
    this.clear();
  }
}
