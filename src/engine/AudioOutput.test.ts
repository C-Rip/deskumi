import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AudioOutput,
  type AudioBufferLike,
  type AudioBufferSourceNodeLike,
  type AudioContextLike
} from "./AudioOutput";

function encodePcm16(samples: number[]): Uint8Array {
  const buf = new ArrayBuffer(samples.length * 2);
  const view = new DataView(buf);
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(i * 2, Math.round(clamped * 32767), true);
  }
  return new Uint8Array(buf);
}

function encodePcmF32(samples: number[]): Uint8Array {
  const buf = new ArrayBuffer(samples.length * 4);
  const view = new DataView(buf);
  for (let i = 0; i < samples.length; i++) {
    view.setFloat32(i * 4, samples[i], true);
  }
  return new Uint8Array(buf);
}

interface TrackedMockSource {
  node: AudioBufferSourceNodeLike;
  startWhen: number;
  endTime: number;
  stopped: boolean;
}

function createMockAudioContextRig(
  options: {
    initialState?: AudioContextState;
    contextSampleRate?: number;
    decodedDurationSec?: number;
    rejectDecode?: boolean;
  } = {}
) {
  let state: AudioContextState = options.initialState ?? "suspended";
  let currentTime = 0;
  const createdSources: TrackedMockSource[] = [];
  const createdBuffers: AudioBufferLike[] = [];

  const resume = vi.fn(async () => {
    state = "running";
  });
  const suspend = vi.fn(async () => {
    state = "suspended";
  });
  const close = vi.fn(async () => {
    state = "closed";
  });
  const decodeAudioData = vi.fn(async (data: ArrayBuffer) => {
    if (options.rejectDecode) throw new Error("decode failed");
    const sr = options.contextSampleRate ?? 48_000;
    const dur = options.decodedDurationSec ?? 0.25;
    const len = Math.max(1, Math.round(sr * dur));
    const ch = new Float32Array(len).fill(0.2);
    const buffer: AudioBufferLike = {
      sampleRate: sr,
      length: len,
      duration: dur,
      numberOfChannels: 1,
      getChannelData: () => ch
    };
    void data;
    return buffer;
  });

  const ctx: AudioContextLike = {
    get state() {
      return state;
    },
    get currentTime() {
      return currentTime;
    },
    sampleRate: options.contextSampleRate ?? 48_000,
    destination: {},
    resume,
    suspend,
    close,
    createBuffer: (numberOfChannels, length, sampleRate) => {
      const channels = Array.from(
        { length: numberOfChannels },
        () => new Float32Array(length)
      );
      const buffer: AudioBufferLike = {
        sampleRate,
        length,
        duration: length / sampleRate,
        numberOfChannels,
        getChannelData: (c) => channels[c]
      };
      createdBuffers.push(buffer);
      return buffer;
    },
    createBufferSource: () => {
      let buffer: AudioBufferLike | null = null;
      let onended: ((ev: Event) => unknown) | null = null;
      const entry: TrackedMockSource = {
        node: null as unknown as AudioBufferSourceNodeLike,
        startWhen: 0,
        endTime: 0,
        stopped: false
      };
      const node: AudioBufferSourceNodeLike = {
        get buffer() {
          return buffer;
        },
        set buffer(val) {
          buffer = val;
        },
        get onended() {
          return onended;
        },
        set onended(fn) {
          onended = fn;
        },
        connect: vi.fn(),
        disconnect: vi.fn(),
        start: vi.fn((when = currentTime) => {
          entry.startWhen = when;
          entry.endTime = when + (buffer?.duration ?? 0);
        }),
        stop: vi.fn(() => {
          entry.stopped = true;
        })
      };
      entry.node = node;
      createdSources.push(entry);
      return node;
    },
    decodeAudioData
  };

  function advanceTime(deltaSec: number): void {
    currentTime += deltaSec;
    for (const s of createdSources) {
      if (!s.stopped && s.node.onended && currentTime >= s.endTime) {
        s.stopped = true;
        s.node.onended(new Event("ended"));
      }
    }
  }

  return {
    ctx,
    resume,
    suspend,
    close,
    decodeAudioData,
    createdSources,
    createdBuffers,
    advanceTime
  };
}

describe("AudioOutput", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("lazily creates AudioContext and calls resume() on cold start", async () => {
    const rig = createMockAudioContextRig({ initialState: "suspended" });
    const createContext = vi.fn(() => rig.ctx);
    const states: string[] = [];

    const audio = new AudioOutput({
      createContext,
      onStateChange: (s) => states.push(s)
    });

    expect(createContext).not.toHaveBeenCalled();
    expect(audio.state).toBe("uninitialized");

    await Promise.all([audio.ensureRunning(), audio.ensureRunning()]);
    expect(createContext).toHaveBeenCalledTimes(1);
    expect(rig.resume).toHaveBeenCalledTimes(1);
    expect(audio.state).toBe("running");
    expect(states).toEqual(["suspended", "running"]);

    audio.dispose();
    expect(rig.close).toHaveBeenCalledTimes(1);
  });

  it("decodes base64 encoded audio and supports cancellation mid-decode", async () => {
    const rig = createMockAudioContextRig({ decodedDurationSec: 0.25 });
    const audio = new AudioOutput({ createContext: () => rig.ctx });

    const onEnded = vi.fn();
    const res = await audio.playEncodedAudio(
      { base64: "AQIDBA==", mime: "audio/wav" },
      { onEnded }
    );
    expect(res.cancelled).toBe(false);
    expect(rig.decodeAudioData).toHaveBeenCalledTimes(1);
    expect(audio.isPlaying).toBe(true);

    rig.advanceTime(0.3);
    expect(onEnded).toHaveBeenCalledTimes(1);
    expect(audio.isPlaying).toBe(false);

    let cancelled = false;
    const pending = audio.playEncodedAudio(
      { base64: "AQIDBA==", mime: "audio/wav" },
      { shouldCancel: () => cancelled }
    );
    cancelled = true;
    const aborted = await pending;
    expect(aborted).toEqual({ cancelled: true });
    expect(rig.createdSources).toHaveLength(1);

    audio.dispose();
  });

  it("schedules PCM s16le/f32le at 22050/44100/48000 Hz with 120 ms pre-buffer and chaining", async () => {
    const rig = createMockAudioContextRig({ contextSampleRate: 48_000 });
    const audio = new AudioOutput({
      createContext: () => rig.ctx,
      preBufferSec: 0.12
    });

    audio.startStream();
    // 100 ms at 22050 Hz (2205 samples)
    const pcm22k = encodePcm16(new Array(2205).fill(0.5));
    const c1 = await audio.playPcm({
      pcm: pcm22k,
      format: "pcm_s16le",
      channels: 1,
      sampleRate: 22050
    });
    expect(c1.startTime).toBeCloseTo(0.12, 5);
    expect(c1.endTime).toBeCloseTo(0.22, 5);
    expect(rig.createdBuffers[0].sampleRate).toBe(22050);
    expect(rig.createdBuffers[0].getChannelData(0)[0]).toBeCloseTo(0.5, 3);

    // 50 ms stereo pcm_f32le at 44100 Hz arriving at t = 0.04s -> chains at 0.22s
    rig.advanceTime(0.04);
    const stereoF32 = encodePcmF32(new Array(2205 * 2).fill(-0.25));
    const c2 = await audio.playPcm({
      pcm: stereoF32,
      format: "pcm_f32le",
      channels: 2,
      sampleRate: 44100
    });
    expect(c2.startTime).toBeCloseTo(0.22, 5);
    expect(c2.endTime).toBeCloseTo(0.27, 5);
    expect(rig.createdBuffers[1].numberOfChannels).toBe(2);
    expect(rig.createdBuffers[1].sampleRate).toBe(44100);

    // 48000 Hz mono chunk chains at 0.27s
    const pcm48k = encodePcm16(new Array(4800).fill(0.25));
    const c3 = await audio.playPcm({
      pcm: pcm48k,
      format: "pcm_s16le",
      channels: 1,
      sampleRate: 48000
    });
    expect(c3.startTime).toBeCloseTo(0.27, 5);
    expect(c3.endTime).toBeCloseTo(0.37, 5);

    audio.dispose();
  });

  it("handles underrun cleanly without overlapping buffers and auto-suspends after 4s inactivity", async () => {
    const rig = createMockAudioContextRig();
    const onUnderrun = vi.fn();
    const audio = new AudioOutput({
      createContext: () => rig.ctx,
      preBufferSec: 0.12,
      inactivitySuspendMs: 4_000,
      onUnderrun
    });

    audio.startStream();
    await audio.playPcm({
      pcm: encodePcm16(new Array(2205).fill(0.4)),
      format: "pcm_s16le",
      channels: 1,
      sampleRate: 22050
    });

    // Advance past 0.22s -> buffer drains -> underrun fired, silence
    rig.advanceTime(0.3);
    expect(audio.isPlaying).toBe(false);
    expect(audio.isInUnderrun).toBe(true);
    expect(onUnderrun).toHaveBeenCalledTimes(1);

    // Late chunk arrives at t = 0.30s -> re-buffers cleanly at 0.30 + 0.12 = 0.42s
    const recovered = await audio.playPcm({
      pcm: encodePcm16(new Array(2205).fill(0.4)),
      format: "pcm_s16le",
      channels: 1,
      sampleRate: 22050
    });
    expect(recovered.startTime).toBeCloseTo(0.42, 5);
    expect(audio.isInUnderrun).toBe(false);

    // End stream cleanly and drain final chunk
    audio.endStream();
    rig.advanceTime(0.3); // currentTime = 0.60s > 0.52s
    expect(audio.isPlaying).toBe(false);
    expect(onUnderrun).toHaveBeenCalledTimes(1);

    // Inactivity auto-suspend triggers after 4000ms
    vi.advanceTimersByTime(3_999);
    expect(rig.suspend).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(rig.suspend).toHaveBeenCalledTimes(1);
    expect(audio.state).toBe("suspended");

    audio.dispose();
  });
});
