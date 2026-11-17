import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AudioOutput,
  type AudioBufferLike,
  type AudioBufferSourceNodeLike,
  type AudioContextLike
} from "./AudioOutput";
import type { AvatarEvent } from "./AvatarCommand";
import { PowerSaveController } from "./PowerSaveController";
import type { SceneManager } from "./SceneManager";
import { SpeechController, type SpeechBubbleState } from "./SpeechController";

async function flushMicrotasks(ticks = 12): Promise<void> {
  for (let i = 0; i < ticks; i++) {
    await Promise.resolve();
  }
}

function makePcm16(amplitude: number, samples: number): Uint8Array {
  const buf = new ArrayBuffer(samples * 2);
  const view = new DataView(buf);
  const val = Math.round(Math.max(-1, Math.min(1, amplitude)) * 32767);
  for (let i = 0; i < samples; i++) view.setInt16(i * 2, val, true);
  return new Uint8Array(buf);
}

function createAudioRig(
  opts: {
    rejectDecode?: boolean;
    rejectResume?: boolean;
    decodedDuration?: number;
  } = {}
) {
  let state: AudioContextState = "suspended";
  let currentTime = 0;
  const sources: Array<{
    node: AudioBufferSourceNodeLike;
    endTime: number;
    stopped: boolean;
  }> = [];

  const ctx: AudioContextLike = {
    get state() {
      return state;
    },
    get currentTime() {
      return currentTime;
    },
    sampleRate: 48_000,
    destination: {},
    resume: vi.fn(async () => {
      if (opts.rejectResume) throw new Error("resume failed");
      state = "running";
    }),
    suspend: vi.fn(async () => {
      state = "suspended";
    }),
    close: vi.fn(async () => {
      state = "closed";
    }),
    createBuffer: (ch, len, sr) => {
      const data = Array.from({ length: ch }, () => new Float32Array(len));
      return {
        sampleRate: sr,
        length: len,
        duration: len / sr,
        numberOfChannels: ch,
        getChannelData: (c) => data[c]
      };
    },
    createBufferSource: () => {
      let buffer: AudioBufferLike | null = null;
      let onended: ((ev: Event) => unknown) | null = null;
      const rec = {
        node: null as unknown as AudioBufferSourceNodeLike,
        endTime: 0,
        stopped: false
      };
      const node: AudioBufferSourceNodeLike = {
        get buffer() {
          return buffer;
        },
        set buffer(v) {
          buffer = v;
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
          rec.endTime = when + (buffer?.duration ?? 0);
        }),
        stop: vi.fn(() => {
          rec.stopped = true;
        })
      };
      rec.node = node;
      sources.push(rec);
      return node;
    },
    decodeAudioData: vi.fn(async () => {
      if (opts.rejectDecode) throw new Error("decode failed");
      const dur = opts.decodedDuration ?? 0.2;
      const samples = new Float32Array(Math.round(48_000 * dur)).fill(0.2);
      return {
        sampleRate: 48_000,
        length: samples.length,
        duration: dur,
        numberOfChannels: 1,
        getChannelData: () => samples
      };
    })
  };

  function advanceAudio(deltaSec: number): void {
    currentTime += deltaSec;
    for (const s of sources) {
      if (!s.stopped && s.node.onended && currentTime >= s.endTime) {
        s.stopped = true;
        s.node.onended(new Event("ended"));
      }
    }
  }

  return { ctx, sources, advanceAudio };
}

function createHarness(
  audioRig = createAudioRig(),
  maxStreamBufferBytes?: number
) {
  const sceneManager = {
    fpsCap: 30,
    pause: vi.fn(),
    resume: vi.fn()
  } as unknown as SceneManager;
  const powerSave = new PowerSaveController(sceneManager, {
    activeFps: 30,
    idleFps: 10,
    idleTimeoutMs: 5_000,
    autoAttachListeners: false
  });
  const createContext = vi.fn(() => audioRig.ctx);
  const audioOutput = new AudioOutput({
    createContext,
    preBufferSec: 0.12,
    inactivitySuspendMs: 4_000
  });
  const events: AvatarEvent[] = [];
  const bubbles: Array<SpeechBubbleState | null> = [];
  const speech = new SpeechController({
    powerSaveController: powerSave,
    audioOutput,
    maxStreamBufferBytes,
    emitEvent: (ev) => events.push(ev),
    onBubbleChange: (b) => bubbles.push(b)
  });
  return {
    powerSave,
    audioOutput,
    speech,
    events,
    bubbles,
    createContext,
    audioRig
  };
}

describe("SpeechController", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("enforces max 8 queued items, policy arbitration, bubble callbacks, and keeps AudioContext lazy for say", () => {
    const h = createHarness();
    expect(
      h.speech.handleSay(
        { type: "say", id: "s0", text: "Active", durationMs: 200 },
        "ws:1"
      ).type
    ).toBe("ack");
    expect(h.createContext).not.toHaveBeenCalled();
    expect(h.powerSave.hasActiveLocks()).toBe(true);
    expect(h.speech.getActiveBubble()).toEqual({
      id: "s0",
      text: "Active",
      kind: "say"
    });

    for (let i = 1; i <= 8; i++) {
      expect(
        h.speech.handleSay(
          {
            type: "say",
            id: `q${i}`,
            text: `Q${i}`,
            policy: "queue",
            durationMs: 100
          },
          "ws:1"
        ).type
      ).toBe("ack");
    }
    const ninth = h.speech.handleSay(
      { type: "say", text: "Overflow", policy: "queue" },
      "ws:1",
      "r9"
    );
    expect(ninth).toEqual({
      v: 1,
      type: "error",
      ref: "r9",
      code: "busy",
      message: "mouth channel queue is full"
    });
    expect(
      h.speech.handleSay(
        { type: "say", text: "Dropped", policy: "drop" },
        "ws:1"
      ).type
    ).toBe("error");

    // Interrupt replaces active and clears all 8 queued items
    expect(
      h.speech.handleSay(
        {
          type: "say",
          id: "int",
          text: "Urgent",
          durationMs: 100,
          policy: "interrupt"
        },
        "ws:2"
      ).type
    ).toBe("ack");
    expect(h.speech.getState().queueLength).toBe(0);
    expect(h.speech.getActiveBubble()?.text).toBe("Urgent");

    h.speech.step(100);
    expect(h.speech.isActive).toBe(false);
    expect(h.powerSave.hasActiveLocks()).toBe(false);
    expect(h.speech.getActiveBubble()).toBeNull();
    expect(h.bubbles.at(-1)).toBeNull();
    expect(h.events).toContainEqual({
      type: "speechEnd",
      id: "s0",
      interrupted: true,
      reason: "interrupted"
    });
    expect(h.events).toContainEqual({
      type: "speechEnd",
      id: "int",
      interrupted: false,
      reason: "finished"
    });

    h.speech.dispose();
    h.powerSave.dispose();
  });

  it("plays streaming PCM with relative visemes, RMS fallback, 10 MB limit, and waits for audio completion", async () => {
    const h = createHarness(createAudioRig(), 1024);
    expect(
      h.speech.handleSpeakStart(
        {
          type: "speakStart",
          streamId: "st1",
          id: "utt-stream",
          text: "Hello world",
          sampleRate: 22050,
          channels: 1,
          format: "pcm_s16le"
        },
        "ws:1"
      ).type
    ).toBe("ack");
    expect(h.powerSave.hasActiveLocks()).toBe(true);
    await flushMicrotasks();

    // Chunk 1 (882 bytes = 20ms @ 22050 Hz) with relative viseme
    expect(
      h.speech.handleSpeakChunk(
        {
          type: "speakChunk",
          streamId: "st1",
          pcm: makePcm16(0.2, 441),
          visemes: [{ t: 5, v: "oh", w: 0.9 }]
        },
        "ws:1"
      ).type
    ).toBe("ack");

    // Second chunk of 400 bytes would exceed 1024-byte stream buffer cap -> too_large
    const tooBig = h.speech.handleSpeakChunk(
      { type: "speakChunk", streamId: "st1", pcm: makePcm16(0.2, 200) },
      "ws:1",
      "over"
    );
    expect(tooBig).toMatchObject({
      type: "error",
      ref: "over",
      code: "too_large"
    });

    // Chunk 1 starts at preBuffer 0.12s -> viseme t=5ms activates at 0.125s
    h.audioRig.advanceAudio(0.13);
    h.speech.step(130);
    expect(h.speech.lipSync.visemeWeights.oh).toBeCloseTo(0.9, 5);

    // Finish Chunk 1 (at 0.14s) -> frees its 882 buffered bytes so Chunk 2 now fits
    h.audioRig.advanceAudio(0.05); // t = 0.18s -> Chunk 1 ended -> underrun closes mouth
    expect(h.speech.lipSync.visemeWeights.oh).toBe(0);

    // Chunk 2 (PCM only, no visemes) triggers RMS fallback
    expect(
      h.speech.handleSpeakChunk(
        { type: "speakChunk", streamId: "st1", pcm: makePcm16(0.2, 441) },
        "ws:1"
      ).type
    ).toBe("ack");
    expect(h.speech.handleSpeakEnd("st1", "ws:1").type).toBe("ack");
    expect(h.speech.isActive).toBe(true);

    // Chunk 2 plays at 0.18 + 0.12 = 0.30..0.32s -> RMS opens "aa"
    h.audioRig.advanceAudio(0.13); // t = 0.31s
    h.speech.step(130);
    expect(h.speech.lipSync.visemeWeights.aa).toBeGreaterThan(0.5);

    // Chunk 2 completes at 0.32s -> speechEnd emitted, lock released, auto-suspend armed
    h.audioRig.advanceAudio(0.05); // t = 0.36s
    expect(h.speech.isActive).toBe(false);
    expect(h.powerSave.hasActiveLocks()).toBe(false);
    expect(h.events).toContainEqual({
      type: "speechEnd",
      id: "utt-stream",
      interrupted: false,
      reason: "finished"
    });

    vi.advanceTimersByTime(4_000);
    expect(h.audioOutput.state).toBe("suspended");

    h.speech.dispose();
    h.powerSave.dispose();
  });

  it("releases wake locks across timeout, cancelByOwner, speakCancel, hidden, stopSpeaking, and audio errors", async () => {
    // 1. Timeout (5s) + ownership isolation
    const h1 = createHarness();
    h1.speech.handleSpeakStart(
      { type: "speakStart", streamId: "s1", id: "to", sampleRate: 22050 },
      "owner:a"
    );
    await flushMicrotasks();
    const stolen = h1.speech.handleSpeakCancel("s1", "owner:b", "stolen");
    expect(stolen).toMatchObject({
      type: "error",
      code: "forbidden",
      ref: "stolen"
    });
    h1.speech.step(5_000);
    expect(h1.powerSave.hasActiveLocks()).toBe(false);
    expect(h1.events.at(-1)).toEqual({
      type: "speechEnd",
      id: "to",
      interrupted: true,
      reason: "timeout"
    });

    // 2. cancelByOwner removes queued & active items for that owner only
    h1.speech.handleSay({ type: "say", id: "a1", text: "A" }, "owner:a");
    h1.speech.handleSay(
      { type: "say", id: "b1", text: "B", policy: "queue" },
      "owner:b"
    );
    h1.speech.cancelByOwner("owner:a");
    expect(h1.powerSave.hasActiveLocks()).toBe(true);
    expect(h1.speech.getState().ownerId).toBe("owner:b");

    // 3. Window hidden terminates active speech with reason: "hidden" & releases lock
    h1.powerSave.setWindowVisible(false);
    expect(h1.powerSave.hasActiveLocks()).toBe(false);
    expect(h1.speech.getActiveBubble()).toBeNull();
    expect(h1.events.at(-1)).toEqual({
      type: "speechEnd",
      id: "b1",
      interrupted: true,
      reason: "hidden"
    });
    expect(
      h1.speech.handleSay({ type: "say", text: "Blocked" }, "owner:b").type
    ).toBe("error");
    h1.speech.dispose();
    h1.powerSave.dispose();

    // 4. Encoded audio decode failure & resume failure release wake locks cleanly
    const hDecodeErr = createHarness(createAudioRig({ rejectDecode: true }));
    hDecodeErr.speech.handleSpeak(
      {
        type: "speak",
        id: "bad-wav",
        audio: { base64: "AQID", mime: "audio/wav" }
      },
      "ws:1"
    );
    expect(hDecodeErr.powerSave.hasActiveLocks()).toBe(true);
    await flushMicrotasks();
    expect(hDecodeErr.powerSave.hasActiveLocks()).toBe(false);
    expect(hDecodeErr.events.at(-1)).toEqual({
      type: "speechEnd",
      id: "bad-wav",
      interrupted: true,
      reason: "cancelled"
    });
    hDecodeErr.speech.dispose();
    hDecodeErr.powerSave.dispose();

    const hResumeErr = createHarness(createAudioRig({ rejectResume: true }));
    hResumeErr.speech.handleSpeakStart(
      {
        type: "speakStart",
        streamId: "bad-ctx",
        id: "r-err",
        sampleRate: 22050
      },
      "ws:1"
    );
    expect(hResumeErr.powerSave.hasActiveLocks()).toBe(true);
    await flushMicrotasks();
    expect(hResumeErr.powerSave.hasActiveLocks()).toBe(false);
    hResumeErr.speech.dispose();
    hResumeErr.powerSave.dispose();
  });

  it("supports targeted stopSpeaking(id) and aborts in-flight encoded audio decode cleanly", async () => {
    const h = createHarness();
    h.speech.handleSpeak(
      {
        type: "speak",
        id: "in-flight",
        text: "Decoding",
        audio: { base64: "AQID", mime: "audio/wav" }
      },
      "ws:1"
    );
    h.speech.handleSay(
      { type: "say", id: "queued-1", text: "First queued", policy: "queue" },
      "ws:1"
    );
    h.speech.handleSay(
      { type: "say", id: "queued-2", text: "Second queued", policy: "queue" },
      "ws:1"
    );

    // Targeted removal of queued item and active in-flight decode
    h.speech.stopSpeaking("queued-1");
    expect(h.speech.getState().queueLength).toBe(1);

    h.speech.stopSpeaking("in-flight");
    await flushMicrotasks();
    expect(h.audioRig.sources).toHaveLength(0);
    expect(h.speech.getActiveBubble()?.id).toBe("queued-2");
    expect(h.powerSave.hasActiveLocks()).toBe(true);

    h.speech.stopSpeaking();
    expect(h.powerSave.hasActiveLocks()).toBe(false);
    expect(h.speech.isActive).toBe(false);

    // pcmBase64 valid + malformed check on stream
    expect(
      h.speech.handleSpeakStart(
        { type: "speakStart", streamId: "b64-st", sampleRate: 22050 },
        "ws:1"
      ).type
    ).toBe("ack");
    await flushMicrotasks();
    const badB64 = h.speech.handleSpeakChunk(
      { type: "speakChunk", streamId: "b64-st", pcmBase64: "not!valid!b64" },
      "ws:1",
      "bad-b64"
    );
    expect(badB64).toMatchObject({
      type: "error",
      code: "invalid",
      ref: "bad-b64"
    });
    expect(
      h.speech.handleSpeakChunk(
        { type: "speakChunk", streamId: "b64-st", pcmBase64: "AQIDBA==" },
        "ws:1"
      ).type
    ).toBe("ack");
    h.speech.handleSpeakCancel("b64-st", "ws:1");
    expect(h.powerSave.hasActiveLocks()).toBe(false);

    h.speech.dispose();
    h.powerSave.dispose();
  });
});
