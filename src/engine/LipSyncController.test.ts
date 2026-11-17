import { describe, expect, it } from "vitest";
import { LipSyncController } from "./LipSyncController";
import { computePcmRmsEnvelope } from "./PcmDecoder";

function makePcm16Chunk(amplitude: number, sampleCount: number): Uint8Array {
  const buf = new ArrayBuffer(sampleCount * 2);
  const view = new DataView(buf);
  const value = Math.round(Math.max(-1, Math.min(1, amplitude)) * 32767);
  for (let i = 0; i < sampleCount; i++) {
    view.setInt16(i * 2, value, true);
  }
  return new Uint8Array(buf);
}

describe("LipSyncController", () => {
  it("synchronizes visemes strictly against audio time without accumulating render dt", () => {
    let audioTime = 0;
    const lipSync = new LipSyncController({ getAudioTime: () => audioTime });

    lipSync.scheduleVisemes(
      [
        { t: 100, v: "oh", w: 0.7 },
        { t: 0, v: "aa", w: 0.9 },
        { t: 200, v: "neutral", w: 1.0 }
      ],
      0.5,
      0.35
    );

    // During pre-start silence (t < 0.50s), repeated update() calls keep mouth closed
    for (let i = 0; i < 10; i++) {
      lipSync.update();
    }
    expect(lipSync.isActive).toBe(false);
    expect(lipSync.visemeWeights).toEqual({
      aa: 0,
      ih: 0,
      ou: 0,
      ee: 0,
      oh: 0
    });

    // Audio clock jumps straight to 0.55s -> "aa" active
    audioTime = 0.55;
    lipSync.update();
    expect(lipSync.isActive).toBe(true);
    expect(lipSync.visemeWeights.aa).toBeCloseTo(0.9, 5);

    // Audio clock jumps to 0.62s -> "oh" active, "aa" cleared
    audioTime = 0.62;
    lipSync.update();
    expect(lipSync.visemeWeights.aa).toBe(0);
    expect(lipSync.visemeWeights.oh).toBeCloseTo(0.7, 5);

    // Audio clock reaches "neutral" at 0.71s -> closes mouth without creating "neutral" key
    audioTime = 0.71;
    lipSync.update();
    expect(lipSync.visemeWeights).toEqual({
      aa: 0,
      ih: 0,
      ou: 0,
      ee: 0,
      oh: 0
    });
    expect("neutral" in lipSync.visemeWeights).toBe(false);

    lipSync.dispose();
  });

  it("interprets chunk viseme timestamps relative to each chunk start time", () => {
    let audioTime = 0;
    const lipSync = new LipSyncController({ getAudioTime: () => audioTime });

    // Chunk 1 starts at 0.12s (duration 0.10s), viseme at +20ms -> 0.14s
    lipSync.scheduleVisemes([{ t: 20, v: "ee", w: 0.6 }], 0.12, 0.1);
    // Chunk 2 starts at 0.22s (duration 0.10s), viseme at +30ms -> 0.25s
    lipSync.scheduleVisemes([{ t: 30, v: "ou", w: 0.85 }], 0.22, 0.1);

    audioTime = 0.13;
    lipSync.update();
    expect(lipSync.visemeWeights.ee).toBe(0);

    audioTime = 0.15;
    lipSync.update();
    expect(lipSync.visemeWeights.ee).toBeCloseTo(0.6, 5);

    audioTime = 0.23;
    lipSync.update();
    expect(lipSync.visemeWeights.ee).toBe(0);
    expect(lipSync.visemeWeights.ou).toBe(0);

    audioTime = 0.26;
    lipSync.update();
    expect(lipSync.visemeWeights.ou).toBeCloseTo(0.85, 5);

    audioTime = 0.33;
    lipSync.update();
    expect(lipSync.visemeWeights.ou).toBe(0);

    lipSync.dispose();
  });

  it("computes deterministic RMS amplitude fallback from PCM and yields to explicit visemes", () => {
    let audioTime = 0;
    const lipSync = new LipSyncController({
      getAudioTime: () => audioTime,
      rmsWindowMs: 20,
      rmsNoiseFloor: 0.015,
      rmsPeakLevel: 0.265
    });

    const sr = 16_000;
    // Chunk A [0.12, 0.22): quiet noise floor -> closed mouth
    lipSync.schedulePcmBytes({
      pcm: makePcm16Chunk(0.005, 1600),
      format: "pcm_s16le",
      channels: 1,
      sampleRate: sr,
      startTimeSec: 0.12
    });
    // Chunk B [0.22, 0.32): moderate speech amplitude (~0.14) -> open mouth
    lipSync.schedulePcmBytes({
      pcm: makePcm16Chunk(0.14, 1600),
      format: "pcm_s16le",
      channels: 1,
      sampleRate: sr,
      startTimeSec: 0.22
    });
    // Chunk C [0.32, 0.42): loud amplitude + explicit viseme -> explicit viseme overrides RMS
    lipSync.schedulePcmBytes({
      pcm: makePcm16Chunk(0.3, 1600),
      format: "pcm_s16le",
      channels: 1,
      sampleRate: sr,
      startTimeSec: 0.32
    });
    lipSync.scheduleVisemes([{ t: 0, v: "ih", w: 0.75 }], 0.32, 0.1);

    audioTime = 0.15;
    lipSync.update();
    expect(lipSync.visemeWeights.aa).toBe(0);

    audioTime = 0.25;
    lipSync.update();
    const expectedRms = computePcmRmsEnvelope(
      new Float32Array(320).fill(0.14),
      sr,
      0.22
    )[0].weight;
    expect(lipSync.visemeWeights.aa).toBeCloseTo(expectedRms, 2);
    expect(lipSync.visemeWeights.aa).toBeGreaterThan(0.4);

    audioTime = 0.35;
    lipSync.update();
    expect(lipSync.visemeWeights.ih).toBeCloseTo(0.75, 5);
    expect(lipSync.visemeWeights.aa).toBe(0);

    lipSync.dispose();
  });

  it("closes mouth on underrun and reuses preallocated weights object across frames", () => {
    let audioTime = 0;
    const lipSync = new LipSyncController({ getAudioTime: () => audioTime });
    const weightsRef = lipSync.visemeWeights;

    lipSync.scheduleVisemes([{ t: 0, v: "aa", w: 0.8 }], 0.1, 0.2);

    audioTime = 0.15;
    lipSync.update();
    expect(lipSync.visemeWeights).toBe(weightsRef);
    expect(weightsRef.aa).toBeCloseTo(0.8, 5);

    lipSync.notifyUnderrun();
    expect(lipSync.isActive).toBe(false);
    expect(weightsRef.aa).toBe(0);

    lipSync.dispose();
  });
});
