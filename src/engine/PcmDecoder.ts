const BASE64_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

const BASE64_LOOKUP = (() => {
  const table = new Int16Array(256).fill(-1);
  for (let i = 0; i < BASE64_ALPHABET.length; i++) {
    table[BASE64_ALPHABET.charCodeAt(i)] = i;
  }
  return table;
})();

export type PcmSampleFormat = "pcm_s16le" | "pcm_f32le";

export interface RmsWindow {
  startSec: number;
  endSec: number;
  weight: number;
}

export interface RmsEnvelopeOptions {
  /** Analysis window duration in milliseconds. @default 20 */
  windowMs?: number;
  /** Minimum RMS amplitude treated as silence. @default 0.015 */
  noiseFloor?: number;
  /** RMS amplitude mapped to 1.0 openness. @default 0.265 */
  peakLevel?: number;
}

/**
 * Decodes a base64 string into raw bytes without relying on Node-only APIs.
 */
export function decodeBase64ToBytes(base64: string): Uint8Array {
  const cleaned = base64.replace(/\s+/g, "");
  if (
    cleaned.length === 0 ||
    cleaned.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(cleaned)
  ) {
    throw new Error("Invalid base64 audio payload");
  }

  if (typeof globalThis.atob === "function") {
    const binary = globalThis.atob(cleaned);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      out[i] = binary.charCodeAt(i);
    }
    return out;
  }

  let padding = 0;
  if (cleaned.endsWith("==")) padding = 2;
  else if (cleaned.endsWith("=")) padding = 1;

  const byteLength = (cleaned.length / 4) * 3 - padding;
  const out = new Uint8Array(byteLength);
  let outIdx = 0;

  for (let i = 0; i < cleaned.length; i += 4) {
    const c0 = BASE64_LOOKUP[cleaned.charCodeAt(i)];
    const c1 = BASE64_LOOKUP[cleaned.charCodeAt(i + 1)];
    const eq2 = cleaned.charCodeAt(i + 2) === 61;
    const eq3 = cleaned.charCodeAt(i + 3) === 61;
    const c2 = eq2 ? 0 : BASE64_LOOKUP[cleaned.charCodeAt(i + 2)];
    const c3 = eq3 ? 0 : BASE64_LOOKUP[cleaned.charCodeAt(i + 3)];

    if (c0 < 0 || c1 < 0 || c2 < 0 || c3 < 0) {
      throw new Error("Invalid base64 character");
    }

    const triple = (c0 << 18) | (c1 << 12) | (c2 << 6) | c3;
    if (outIdx < byteLength) out[outIdx++] = (triple >> 16) & 0xff;
    if (!eq2 && outIdx < byteLength) out[outIdx++] = (triple >> 8) & 0xff;
    if (!eq3 && outIdx < byteLength) out[outIdx++] = triple & 0xff;
  }

  return out;
}

/**
 * Decodes interleaved little-endian PCM bytes (`pcm_s16le` or `pcm_f32le`)
 * into normalized Float32 channel arrays in [-1, 1]. Safe for unaligned views.
 */
export function decodePcmToFloat32Channels(
  bytes: Uint8Array,
  format: PcmSampleFormat,
  channels: 1 | 2
): Float32Array[] {
  const bytesPerSample = format === "pcm_f32le" ? 4 : 2;
  const frameStride = bytesPerSample * channels;
  const frameCount = Math.floor(bytes.byteLength / frameStride);
  const channelArrays: Float32Array[] = [];
  for (let c = 0; c < channels; c++) {
    channelArrays.push(new Float32Array(frameCount));
  }
  if (frameCount === 0) {
    return channelArrays;
  }

  const view = new DataView(
    bytes.buffer,
    bytes.byteOffset,
    frameCount * frameStride
  );

  if (format === "pcm_s16le") {
    for (let f = 0; f < frameCount; f++) {
      for (let c = 0; c < channels; c++) {
        const offset = (f * channels + c) * 2;
        channelArrays[c][f] = view.getInt16(offset, true) / 32768;
      }
    }
  } else {
    for (let f = 0; f < frameCount; f++) {
      for (let c = 0; c < channels; c++) {
        const offset = (f * channels + c) * 4;
        const sample = view.getFloat32(offset, true);
        channelArrays[c][f] = Number.isFinite(sample)
          ? Math.max(-1, Math.min(1, sample))
          : 0;
      }
    }
  }

  return channelArrays;
}

/**
 * Mixes 1 or 2 Float32 channel arrays down to mono without copying when already mono.
 */
export function mixChannelsToMono(
  channels: readonly Float32Array[]
): Float32Array {
  if (channels.length === 0) {
    return new Float32Array(0);
  }
  if (channels.length === 1) {
    return channels[0];
  }
  const len = channels[0].length;
  const mono = new Float32Array(len);
  const invCount = 1 / channels.length;
  for (let i = 0; i < len; i++) {
    let sum = 0;
    for (let c = 0; c < channels.length; c++) {
      sum += channels[c][i];
    }
    mono[i] = sum * invCount;
  }
  return mono;
}

/**
 * Computes deterministic time-indexed RMS amplitude windows from mono PCM samples.
 */
export function computePcmRmsEnvelope(
  samples: Float32Array,
  sampleRate: number,
  startTimeSec: number,
  options: RmsEnvelopeOptions = {}
): RmsWindow[] {
  if (samples.length === 0 || !Number.isFinite(sampleRate) || sampleRate <= 0) {
    return [];
  }

  const windowMs = Math.max(1, options.windowMs ?? 20);
  const noiseFloor = Math.max(0, options.noiseFloor ?? 0.015);
  const peakLevel = Math.max(noiseFloor + 1e-4, options.peakLevel ?? 0.265);
  const span = peakLevel - noiseFloor;
  const windowSamples = Math.max(1, Math.round(sampleRate * (windowMs / 1000)));
  const windows: RmsWindow[] = [];

  for (let offset = 0; offset < samples.length; offset += windowSamples) {
    const end = Math.min(samples.length, offset + windowSamples);
    let sumSq = 0;
    for (let i = offset; i < end; i++) {
      const s = samples[i];
      sumSq += s * s;
    }
    const rms = Math.sqrt(sumSq / (end - offset));
    const weight =
      rms <= noiseFloor ? 0 : Math.min(1, (rms - noiseFloor) / span);
    windows.push({
      startSec: startTimeSec + offset / sampleRate,
      endSec: startTimeSec + end / sampleRate,
      weight
    });
  }

  return windows;
}
