import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as THREE from "three";
import type { VRM } from "@pixiv/three-vrm";
import { AvatarController } from "../../engine/AvatarController";
import { PowerSaveController } from "../../engine/PowerSaveController";
import type { SceneManager } from "../../engine/SceneManager";
import type { BridgeInboundPayload, BridgeOutboundMessage } from "../ipc";
import { BridgeClient, decodeChannelBinarySpeakChunk } from "./BridgeClient";

function buildChannelBinaryFrame(options: {
  clientId: string;
  streamId: string;
  sampleRate?: number;
  pcm: Uint8Array;
  magic?: string;
  kind?: number;
  flags?: number;
}): ArrayBuffer {
  const enc = new TextEncoder();
  const magic = enc.encode(options.magic ?? "DSK1");
  const cid = enc.encode(options.clientId);
  const sid = enc.encode(options.streamId);
  const total = 14 + cid.length + sid.length + options.pcm.length;
  const buf = new ArrayBuffer(total);
  const view = new DataView(buf);
  const out = new Uint8Array(buf);
  out.set(magic.subarray(0, 4), 0);
  out[4] = options.kind ?? 1;
  out[5] = options.flags ?? 0;
  view.setUint16(6, cid.length, false);
  view.setUint16(8, sid.length, false);
  view.setUint32(10, options.sampleRate ?? 0, false);
  out.set(cid, 14);
  out.set(sid, 14 + cid.length);
  out.set(options.pcm, 14 + cid.length + sid.length);
  return buf;
}

function createTestHarness() {
  const mockSceneManager = {
    fpsCap: 30,
    pause: vi.fn(),
    resume: vi.fn()
  } as unknown as SceneManager;

  const powerSave = new PowerSaveController(mockSceneManager, {
    activeFps: 30,
    idleFps: 10,
    idleTimeoutMs: 5_000,
    autoAttachListeners: false
  });

  const vrm = {
    scene: new THREE.Group(),
    humanoid: {
      getNormalizedBoneNode: () => null,
      getRawBoneNode: () => null
    },
    expressionManager: {
      expressionMap: {
        happy: {},
        aa: {},
        ih: {},
        ou: {},
        ee: {},
        oh: {}
      },
      setValue: vi.fn(),
      getValue: () => 0
    },
    update: vi.fn()
  } as unknown as VRM;

  const avatarController = new AvatarController({
    powerSaveController: powerSave,
    vrm,
    getAvailableAnimations: () => ["wave", "nod"]
  });

  const sent: BridgeOutboundMessage[] = [];
  let inboundCallback: ((payload: BridgeInboundPayload) => void) | null = null;
  const unlistenSpy = vi.fn();

  return {
    powerSave,
    avatarController,
    sent,
    subscribeInbound: async (
      cb: (payload: BridgeInboundPayload) => void
    ): Promise<() => void> => {
      inboundCallback = cb;
      return unlistenSpy;
    },
    sendEvent: async (msg: BridgeOutboundMessage): Promise<void> => {
      sent.push(msg);
    },
    pushInbound: (payload: BridgeInboundPayload) => {
      inboundCallback?.(payload);
    },
    unlistenSpy
  };
}

describe("BridgeClient", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("handles hello handshake, validates commands, and returns ack/hello/error", async () => {
    const h = createTestHarness();
    const client = new BridgeClient({
      avatarController: h.avatarController,
      grantedScopes: ["avatar:speak", "avatar:expression"],
      subscribeInbound: h.subscribeInbound,
      sendEvent: h.sendEvent
    });
    await client.start();

    h.pushInbound({
      kind: "command",
      clientId: "ws:1",
      envelope: {
        v: 1,
        id: "h-1",
        cmd: { type: "hello", events: ["speechStart", "speechEnd"] }
      }
    });

    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]).toEqual({
      targetClientIds: ["ws:1"],
      payload: expect.objectContaining({
        v: 1,
        type: "hello",
        ref: "h-1",
        scopes: ["avatar:speak", "avatar:expression"],
        expressions: ["happy", "aa", "ih", "ou", "ee", "oh"],
        animations: ["wave", "nod"],
        subscribedEvents: ["speechStart", "speechEnd"]
      })
    });

    h.sent.length = 0;
    h.pushInbound({
      kind: "command",
      clientId: "ws:1",
      envelope: { v: 1, id: "s-1", cmd: { type: "say", text: "Hola" } }
    });
    expect(h.sent[0]).toEqual({
      targetClientIds: ["ws:1"],
      payload: { v: 1, type: "ack", ref: "s-1" }
    });

    h.sent.length = 0;
    h.pushInbound({
      kind: "command",
      clientId: "ws:1",
      envelope: { v: 2, id: "bad-v", cmd: { type: "say", text: "Nope" } }
    });
    expect(h.sent[0]).toEqual({
      targetClientIds: ["ws:1"],
      payload: expect.objectContaining({
        v: 1,
        type: "error",
        ref: "bad-v",
        code: "invalid"
      })
    });

    client.dispose();
    h.avatarController.dispose();
    h.powerSave.dispose();
  });

  it("enforces command and event scopes including avatar:interrupt, desktop:events, and desktop:windowTitle", async () => {
    const h = createTestHarness();
    const client = new BridgeClient({
      avatarController: h.avatarController,
      grantedScopes: ["avatar:speak", "avatar:events"],
      subscribeInbound: h.subscribeInbound,
      sendEvent: h.sendEvent
    });
    await client.start();

    h.pushInbound({
      kind: "command",
      clientId: "ws:1",
      envelope: {
        v: 1,
        cmd: { type: "hello", events: ["click", "windowFocus"] }
      }
    });
    h.pushInbound({
      kind: "command",
      clientId: "ws:2",
      envelope: {
        v: 1,
        cmd: { type: "hello", events: ["speechStart"] }
      }
    });
    h.sent.length = 0;

    // stopSpeaking rejected without avatar:interrupt
    h.pushInbound({
      kind: "command",
      clientId: "ws:1",
      envelope: { v: 1, id: "int-1", cmd: { type: "stopSpeaking" } }
    });
    expect(h.sent[0]).toEqual({
      targetClientIds: ["ws:1"],
      payload: expect.objectContaining({
        type: "error",
        ref: "int-1",
        code: "forbidden"
      })
    });

    // windowFocus blocked completely when desktop:events is off
    h.sent.length = 0;
    client.publishEvent({
      type: "windowFocus",
      appId: "org.mozilla.firefox",
      title: "Private Tab"
    });
    expect(h.sent).toHaveLength(0);

    // click delivered ONLY to ws:1 (not ws:2)
    h.avatarController.emitClick("head");
    expect(h.sent).toEqual([
      {
        targetClientIds: ["ws:1"],
        payload: { v: 1, type: "click", region: "head" }
      }
    ]);

    // Enable desktop:events (without desktop:windowTitle) -> appId sent, title stripped
    client.setGrantedScopes([
      "avatar:speak",
      "avatar:interrupt",
      "avatar:events",
      "desktop:events"
    ]);
    h.sent.length = 0;
    client.publishEvent({
      type: "windowFocus",
      appId: "org.mozilla.firefox",
      title: "Private Tab"
    });
    expect(h.sent).toEqual([
      {
        targetClientIds: ["ws:1"],
        payload: { v: 1, type: "windowFocus", appId: "org.mozilla.firefox" }
      }
    ]);

    // Enable desktop:windowTitle -> both appId and title delivered
    client.setGrantedScopes(["desktop:events", "desktop:windowTitle"]);
    h.sent.length = 0;
    client.publishEvent({
      type: "windowFocus",
      appId: "org.mozilla.firefox",
      title: "Docs"
    });
    expect(h.sent).toEqual([
      {
        targetClientIds: ["ws:1"],
        payload: {
          v: 1,
          type: "windowFocus",
          appId: "org.mozilla.firefox",
          title: "Docs"
        }
      }
    ]);

    // stopSpeaking now succeeds with avatar:interrupt
    client.setGrantedScopes(["avatar:interrupt"]);
    h.sent.length = 0;
    h.pushInbound({
      kind: "command",
      clientId: "ws:1",
      envelope: { v: 1, id: "int-2", cmd: { type: "stopSpeaking" } }
    });
    expect(h.sent[0]).toEqual({
      targetClientIds: ["ws:1"],
      payload: { v: 1, type: "ack", ref: "int-2" }
    });

    client.dispose();
    h.avatarController.dispose();
    h.powerSave.dispose();
  });

  it("decodes binary PCM frames, enforces stream ownership, and cleans up on clientDisconnected", async () => {
    const h = createTestHarness();
    const client = new BridgeClient({
      avatarController: h.avatarController,
      grantedScopes: ["avatar:speak", "avatar:events"],
      subscribeInbound: h.subscribeInbound,
      sendEvent: h.sendEvent
    });
    await client.start();

    // ws:1 and ws:2 connect
    h.pushInbound({
      kind: "command",
      clientId: "ws:1",
      envelope: { v: 1, cmd: { type: "hello" } }
    });
    h.pushInbound({
      kind: "command",
      clientId: "ws:2",
      envelope: { v: 1, cmd: { type: "hello", events: ["speechEnd"] } }
    });

    // ws:1 opens stream st-1
    h.pushInbound({
      kind: "command",
      clientId: "ws:1",
      envelope: {
        v: 1,
        id: "st-start",
        cmd: {
          type: "speakStart",
          streamId: "st-1",
          id: "utt-1",
          sampleRate: 22050
        }
      }
    });
    expect(h.powerSave.hasActiveLocks()).toBe(true);
    h.sent.length = 0;

    // ws:1 sends binary PCM chunk -> accepted without spam ack
    const pcm = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    h.pushInbound(
      buildChannelBinaryFrame({
        clientId: "ws:1",
        streamId: "st-1",
        sampleRate: 22050,
        pcm
      })
    );
    expect(h.sent).toHaveLength(0);

    // ws:2 tries to inject binary PCM chunk into ws:1's stream -> rejected with forbidden
    h.pushInbound(
      buildChannelBinaryFrame({
        clientId: "ws:2",
        streamId: "st-1",
        sampleRate: 22050,
        pcm
      })
    );
    expect(h.sent).toEqual([
      {
        targetClientIds: ["ws:2"],
        payload: expect.objectContaining({
          v: 1,
          type: "error",
          code: "forbidden"
        })
      }
    ]);

    // ws:1 disconnects mid-stream -> cancels stream, releases wake lock, notifies ws:2
    h.sent.length = 0;
    h.pushInbound({ kind: "clientDisconnected", clientId: "ws:1" });
    expect(h.powerSave.hasActiveLocks()).toBe(false);
    expect(client.getConnectedClientIds()).toEqual(["ws:2"]);
    expect(h.sent).toEqual([
      {
        targetClientIds: ["ws:2"],
        payload: {
          v: 1,
          type: "speechEnd",
          id: "utt-1",
          interrupted: true,
          reason: "cancelled"
        }
      }
    ]);

    client.dispose();
    expect(h.unlistenSpy).toHaveBeenCalledTimes(1);
    h.avatarController.dispose();
    h.powerSave.dispose();
  });

  it("rejects malformed binary Channel frames cleanly", async () => {
    const h = createTestHarness();
    const client = new BridgeClient({
      avatarController: h.avatarController,
      grantedScopes: ["avatar:speak"],
      subscribeInbound: h.subscribeInbound,
      sendEvent: h.sendEvent
    });
    await client.start();

    const badMagic = buildChannelBinaryFrame({
      clientId: "ws:1",
      streamId: "st-1",
      pcm: new Uint8Array([1, 2]),
      magic: "NOPE"
    });
    expect(decodeChannelBinarySpeakChunk(badMagic).ok).toBe(false);

    const badRate = buildChannelBinaryFrame({
      clientId: "ws:1",
      streamId: "st-1",
      sampleRate: 4000,
      pcm: new Uint8Array([1, 2])
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    h.pushInbound(badRate);
    warnSpy.mockRestore();

    expect(h.sent).toEqual([
      {
        targetClientIds: ["ws:1"],
        payload: expect.objectContaining({
          v: 1,
          type: "error",
          code: "invalid"
        })
      }
    ]);

    client.dispose();
    h.avatarController.dispose();
    h.powerSave.dispose();
  });
});
