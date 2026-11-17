import type {
  ActiveSourceEntry,
  AudioBufferLike,
  AudioContextFactory,
  AudioContextLike,
  PlayEncodedAudioResult,
  ScheduledPcmResult
} from "./AudioOutputTypes";
import {
  decodeBase64ToBytes,
  decodePcmToFloat32Channels,
  type PcmSampleFormat
} from "./PcmDecoder";

export function defaultAudioContextFactory(): AudioContextFactory | null {
  if (
    typeof globalThis !== "undefined" &&
    typeof globalThis.AudioContext === "function"
  ) {
    return () => new globalThis.AudioContext();
  }
  return null;
}

/**
 * Decodes a base64-encoded container audio payload via `AudioContext.decodeAudioData`.
 */
export async function decodeBase64ToAudioBuffer(
  ctx: AudioContextLike,
  base64: string
): Promise<AudioBufferLike> {
  const bytes = decodeBase64ToBytes(base64);
  const bufferSlice = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  ) as ArrayBuffer;
  return await ctx.decodeAudioData(bufferSlice);
}

export async function decodeAndStartEncodedBuffer(
  ctx: AudioContextLike,
  base64: string,
  activeSources: Set<ActiveSourceEntry>,
  shouldAbort: () => boolean,
  onNodeEnded: () => void
): Promise<PlayEncodedAudioResult> {
  const decoded = await decodeBase64ToAudioBuffer(ctx, base64);
  if (shouldAbort()) return { cancelled: true };
  const startTime = ctx.currentTime;
  const duration =
    decoded.duration > 0
      ? decoded.duration
      : decoded.length / Math.max(1, decoded.sampleRate);
  const stop = startTrackedBufferNode(
    ctx,
    decoded,
    startTime,
    activeSources,
    onNodeEnded
  );
  return {
    cancelled: false,
    startTime,
    endTime: startTime + duration,
    duration,
    buffer: decoded,
    stop
  };
}

/**
 * Allocates an `AudioBuffer` at the given `sampleRate` and copies de-interleaved Float32 channels.
 */
export function buildAudioBufferFromChannels(
  ctx: AudioContextLike,
  channelsData: readonly Float32Array[],
  sampleRate: number
): AudioBufferLike {
  const frameCount = channelsData[0]?.length ?? 0;
  const buffer = ctx.createBuffer(channelsData.length, frameCount, sampleRate);
  for (let c = 0; c < channelsData.length; c++) {
    buffer.getChannelData(c).set(channelsData[c]);
  }
  return buffer;
}

/**
 * Creates, connects, tracks, and starts an `AudioBufferSourceNode` at `startTime`.
 */
export function startTrackedBufferNode(
  ctx: AudioContextLike,
  buffer: AudioBufferLike,
  startTime: number,
  activeSources: Set<ActiveSourceEntry>,
  onEnded: (entry: ActiveSourceEntry) => void
): () => void {
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(ctx.destination);

  const entry: ActiveSourceEntry = { node: source };
  activeSources.add(entry);

  source.onended = () => {
    if (!activeSources.delete(entry)) return;
    source.onended = null;
    try {
      source.disconnect();
    } catch {
      /* ignore disconnect errors on torn-down nodes */
    }
    onEnded(entry);
  };

  source.start(startTime);
  return () => stopTrackedEntry(entry, activeSources);
}

export function stopTrackedEntry(
  entry: ActiveSourceEntry,
  activeSources: Set<ActiveSourceEntry>
): void {
  if (!activeSources.delete(entry)) return;
  entry.node.onended = null;
  try {
    entry.node.stop();
  } catch {
    /* ignore if node has not started or already stopped */
  }
  try {
    entry.node.disconnect();
  } catch {
    /* ignore disconnect errors */
  }
}

export function decodeRawPcmChannels(
  pcm: Uint8Array,
  format: PcmSampleFormat,
  channels: 1 | 2
): Float32Array[] {
  return decodePcmToFloat32Channels(pcm, format, channels);
}

export function scheduleEmptyPcmResult(
  now: number,
  onEnded?: () => void
): ScheduledPcmResult {
  onEnded?.();
  return {
    startTime: now,
    endTime: now,
    duration: 0,
    hadUnderrun: false,
    stop: () => {}
  };
}

export function schedulePcmBufferOnContext(
  ctx: AudioContextLike,
  channelsData: readonly Float32Array[],
  sampleRate: number,
  preBufferSec: number,
  nextScheduledTime: number | null,
  activeSources: Set<ActiveSourceEntry>,
  onNodeEnded: () => void
): { result: ScheduledPcmResult; nextTime: number; hadUnderrun: boolean } {
  const frameCount = channelsData[0]?.length ?? 0;
  const now = ctx.currentTime;
  const buffer = buildAudioBufferFromChannels(ctx, channelsData, sampleRate);
  const hadUnderrun = nextScheduledTime !== null && nextScheduledTime <= now;
  const startTime =
    nextScheduledTime === null || nextScheduledTime <= now
      ? now + preBufferSec
      : nextScheduledTime;
  const duration =
    buffer.duration > 0 ? buffer.duration : frameCount / sampleRate;
  const endTime = startTime + duration;
  const stop = startTrackedBufferNode(
    ctx,
    buffer,
    startTime,
    activeSources,
    onNodeEnded
  );
  return {
    result: { startTime, endTime, duration, hadUnderrun, stop },
    nextTime: endTime,
    hadUnderrun
  };
}
