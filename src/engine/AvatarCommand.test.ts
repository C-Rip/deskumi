import { describe, it, expect } from "vitest";
import {
  AVATAR_PROTOCOL_VERSION,
  buildAckResponse,
  buildErrorResponse,
  buildEventEnvelope,
  buildHelloResponse,
  DEFAULT_AVATAR_COMMAND_LIMITS,
  validateAvatarCommand
} from "./AvatarCommand";

describe("AvatarCommand schema and validation", () => {
  it("accepts all 12 valid commands with strict v: 1 envelope", () => {
    const validMessages: unknown[] = [
      {
        v: 1,
        id: "h1",
        cmd: {
          type: "hello",
          token: "secret-token",
          clientName: "py-tts",
          clientVersion: "0.1.0",
          events: ["click", "speechEnd"]
        }
      },
      {
        v: 1,
        id: "s1",
        cmd: {
          type: "speak",
          id: "utt-1",
          text: "Hola",
          audio: { base64: "AQIDBA==", mime: "audio/wav", sampleRate: 22050 },
          visemes: [
            { t: 0, v: "aa", w: 0.9 },
            { t: 120, v: "neutral", w: 0 }
          ],
          durationMs: 1200,
          policy: "queue"
        }
      },
      {
        v: 1,
        cmd: {
          type: "speakStart",
          streamId: "stream-1",
          id: "utt-2",
          text: "Streaming",
          sampleRate: 24000,
          channels: 1,
          format: "pcm_s16le",
          policy: "interrupt"
        }
      },
      {
        v: 1,
        cmd: {
          type: "speakChunk",
          streamId: "stream-1",
          pcm: new Uint8Array([1, 2, 3, 4]),
          visemes: [{ t: 10, v: "oh", w: 1 }],
          sampleRate: 24000
        }
      },
      { v: 1, cmd: { type: "speakEnd", streamId: "stream-1" } },
      { v: 1, cmd: { type: "speakCancel", streamId: "stream-1" } },
      {
        v: 1,
        cmd: {
          type: "say",
          id: "say-1",
          text: "Buenos días",
          durationMs: 3000,
          policy: "drop"
        }
      },
      { v: 1, cmd: { type: "stopSpeaking", id: "utt-1" } },
      {
        v: 1,
        cmd: {
          type: "expression",
          name: "happy",
          intensity: 0.75,
          durationMs: 2500,
          policy: "interrupt"
        }
      },
      {
        v: 1,
        cmd: {
          type: "animation",
          vrma: "wave",
          loop: false,
          durationMs: 2000,
          fadeInMs: 250,
          policy: "queue"
        }
      },
      {
        v: 1,
        cmd: {
          type: "lookAt",
          x: -1,
          y: 1,
          durationMs: 3000,
          policy: "interrupt"
        }
      },
      {
        v: 1,
        cmd: {
          type: "reaction",
          name: "wink",
          durationMs: 1500,
          intensity: 1,
          policy: "drop"
        }
      }
    ];

    for (const msg of validMessages) {
      const res = validateAvatarCommand(msg);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value.v).toBe(AVATAR_PROTOCOL_VERSION);
      }
    }
  });

  it("rejects non-object envelopes, unsupported protocol versions, and invalid ids", () => {
    for (const bad of [null, undefined, 42, "hello", []]) {
      const res = validateAvatarCommand(bad);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error.code).toBe("invalid");
    }

    const wrongVersion = validateAvatarCommand({
      v: 2,
      id: "req-1",
      cmd: { type: "say", text: "hi" }
    });
    expect(wrongVersion.ok).toBe(false);
    if (!wrongVersion.ok) {
      expect(wrongVersion.error.code).toBe("invalid");
      expect(wrongVersion.error.ref).toBe("req-1");
    }

    const missingVersion = validateAvatarCommand({
      cmd: { type: "say", text: "hi" }
    });
    expect(missingVersion.ok).toBe(false);

    const badId = validateAvatarCommand({
      v: 1,
      id: 123,
      cmd: { type: "say", text: "hi" }
    });
    expect(badId.ok).toBe(false);
    if (!badId.ok) expect(badId.error.ref).toBeUndefined();
  });

  it("rejects text exceeding 500 chars explicitly without truncating", () => {
    const exact = validateAvatarCommand({
      v: 1,
      cmd: { type: "say", text: "a".repeat(500) }
    });
    expect(exact.ok).toBe(true);

    const tooLong = validateAvatarCommand({
      v: 1,
      id: "t1",
      cmd: { type: "say", text: "a".repeat(501) }
    });
    expect(tooLong.ok).toBe(false);
    if (!tooLong.ok) {
      expect(tooLong.error.code).toBe("too_large");
      expect(tooLong.error.ref).toBe("t1");
    }

    const blankSay = validateAvatarCommand({
      v: 1,
      cmd: { type: "say", text: "   " }
    });
    expect(blankSay.ok).toBe(false);
    if (!blankSay.ok) expect(blankSay.error.code).toBe("invalid");
  });

  it("rejects visemes > 256 entries and out-of-range viseme weights or invalid names", () => {
    const maxVisemes = Array.from({ length: 256 }, (_, i) => ({
      t: i * 10,
      v: "aa",
      w: 0.5
    }));
    expect(
      validateAvatarCommand({
        v: 1,
        cmd: { type: "speak", visemes: maxVisemes }
      }).ok
    ).toBe(true);

    const overVisemes = [...maxVisemes, { t: 2560, v: "neutral", w: 0 }];
    const overRes = validateAvatarCommand({
      v: 1,
      cmd: { type: "speak", visemes: overVisemes }
    });
    expect(overRes.ok).toBe(false);
    if (!overRes.ok) expect(overRes.error.code).toBe("too_large");

    for (const badWeight of [-0.01, 1.01, Number.NaN, Infinity]) {
      const res = validateAvatarCommand({
        v: 1,
        cmd: {
          type: "speak",
          visemes: [{ t: 0, v: "aa", w: badWeight }]
        }
      });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error.code).toBe("invalid");
    }

    const badVisemeName = validateAvatarCommand({
      v: 1,
      cmd: { type: "speak", visemes: [{ t: 0, v: "smile", w: 1 }] }
    });
    expect(badVisemeName.ok).toBe(false);
  });

  it("rejects sampleRate outside 8000..48000 and non-integers", () => {
    expect(
      validateAvatarCommand({
        v: 1,
        cmd: { type: "speakStart", streamId: "s", sampleRate: 8000 }
      }).ok
    ).toBe(true);
    expect(
      validateAvatarCommand({
        v: 1,
        cmd: { type: "speakStart", streamId: "s", sampleRate: 48000 }
      }).ok
    ).toBe(true);

    for (const badRate of [7999, 48001, 22050.5, Number.NaN, -16000]) {
      const res = validateAvatarCommand({
        v: 1,
        cmd: { type: "speakStart", streamId: "s", sampleRate: badRate }
      });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error.code).toBe("invalid");
    }
  });

  it("rejects audio.url variant in v1 and enforces audio size limits", () => {
    const withUrl = validateAvatarCommand({
      v: 1,
      cmd: {
        type: "speak",
        audio: { url: "http://127.0.0.1:50021/audio.wav" }
      }
    });
    expect(withUrl.ok).toBe(false);
    if (!withUrl.ok) expect(withUrl.error.code).toBe("invalid");

    const hybridUrl = validateAvatarCommand({
      v: 1,
      cmd: {
        type: "speak",
        audio: {
          base64: "AQID",
          mime: "audio/wav",
          url: "http://127.0.0.1:50021/audio.wav"
        }
      }
    });
    expect(hybridUrl.ok).toBe(false);

    const oversizedAudio = validateAvatarCommand(
      {
        v: 1,
        cmd: {
          type: "speak",
          audio: { base64: "AAAA".repeat(10), mime: "audio/wav" }
        }
      },
      { maxAudioBytes: 12 }
    );
    expect(oversizedAudio.ok).toBe(false);
    if (!oversizedAudio.ok) expect(oversizedAudio.error.code).toBe("too_large");
  });

  it("rejects out-of-range intensity, durationMs, and lookAt coordinates without clamping", () => {
    for (const badIntensity of [-0.1, 1.1, Number.NaN, Infinity]) {
      const exprRes = validateAvatarCommand({
        v: 1,
        cmd: { type: "expression", name: "happy", intensity: badIntensity }
      });
      expect(exprRes.ok).toBe(false);
      if (!exprRes.ok) expect(exprRes.error.code).toBe("invalid");
    }

    for (const badDuration of [-1, 30_001, Number.NaN, Infinity]) {
      const sayRes = validateAvatarCommand({
        v: 1,
        cmd: { type: "say", text: "hi", durationMs: badDuration }
      });
      expect(sayRes.ok).toBe(false);
      if (!sayRes.ok) expect(sayRes.error.code).toBe("invalid");
    }

    expect(
      validateAvatarCommand({
        v: 1,
        cmd: { type: "say", text: "hi", durationMs: 30_000 }
      }).ok
    ).toBe(true);

    for (const [x, y] of [
      [-1.01, 0],
      [1.01, 0],
      [0, -1.5],
      [0, 1.5],
      [Number.NaN, 0]
    ]) {
      const lookRes = validateAvatarCommand({
        v: 1,
        cmd: { type: "lookAt", x, y }
      });
      expect(lookRes.ok).toBe(false);
      if (!lookRes.ok) expect(lookRes.error.code).toBe("invalid");
    }
  });

  it("checks scopes, hidden window state, and known expressions/animations via context", () => {
    const forbiddenRes = validateAvatarCommand(
      { v: 1, id: "r1", cmd: { type: "stopSpeaking" } },
      undefined,
      { grantedScopes: ["avatar:speak"] }
    );
    expect(forbiddenRes.ok).toBe(false);
    if (!forbiddenRes.ok) {
      expect(forbiddenRes.error.code).toBe("forbidden");
      expect(forbiddenRes.error.ref).toBe("r1");
    }

    const hiddenRes = validateAvatarCommand(
      { v: 1, id: "r2", cmd: { type: "say", text: "hello" } },
      undefined,
      { isWindowVisible: false }
    );
    expect(hiddenRes.ok).toBe(false);
    if (!hiddenRes.ok) expect(hiddenRes.error.code).toBe("hidden");

    // hello handshake remains permitted even if window is hidden
    const helloHidden = validateAvatarCommand(
      { v: 1, cmd: { type: "hello" } },
      undefined,
      { isWindowVisible: false }
    );
    expect(helloHidden.ok).toBe(true);

    const unknownExpr = validateAvatarCommand(
      { v: 1, cmd: { type: "expression", name: "smug" } },
      undefined,
      { availableExpressions: ["happy", "sad"] }
    );
    expect(unknownExpr.ok).toBe(false);
    if (!unknownExpr.ok)
      expect(unknownExpr.error.code).toBe("unknown_expression");

    const unknownAnim = validateAvatarCommand(
      { v: 1, cmd: { type: "animation", vrma: "../../etc/passwd" } },
      undefined,
      { availableAnimations: ["wave", "nod"] }
    );
    expect(unknownAnim.ok).toBe(false);
    if (!unknownAnim.ok)
      expect(unknownAnim.error.code).toBe("unknown_animation");
  });

  it("builds hello, ack, error, and event envelopes cleanly", () => {
    const ack = buildAckResponse("req-1");
    expect(ack).toEqual({ v: 1, type: "ack", ref: "req-1" });

    const err = buildErrorResponse("busy", "Channel is busy", "req-2");
    expect(err).toEqual({
      v: 1,
      type: "error",
      ref: "req-2",
      code: "busy",
      message: "Channel is busy"
    });

    const hello = buildHelloResponse({
      ref: "h1",
      scopes: ["avatar:speak"],
      expressions: ["happy", "sad"],
      animations: ["wave"],
      subscribedEvents: ["click", "click", "speechEnd"]
    });
    expect(hello).toEqual({
      v: 1,
      type: "hello",
      ref: "h1",
      protocolVersion: 1,
      limits: DEFAULT_AVATAR_COMMAND_LIMITS,
      scopes: ["avatar:speak"],
      expressions: ["happy", "sad"],
      animations: ["wave"],
      subscribedEvents: ["click", "speechEnd"]
    });

    const ev = buildEventEnvelope({ type: "click", region: "head" });
    expect(ev).toEqual({ v: 1, type: "click", region: "head" });
  });
});
