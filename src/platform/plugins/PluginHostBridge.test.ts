import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as THREE from "three";
import type { VRM } from "@pixiv/three-vrm";
import { AvatarController } from "../../engine/AvatarController";
import { PowerSaveController } from "../../engine/PowerSaveController";
import type { SceneManager } from "../../engine/SceneManager";
import type { PluginInfo } from "../ipc";
import {
  computeEffectiveScopes,
  PLUGIN_BRIDGE_CHANNEL,
  PluginHost,
  RegisteredAnimationResolver,
  type PluginIframeLike
} from "./PluginHost";

interface BridgeMockIframe extends PluginIframeLike {
  postedMessages: unknown[];
  triggerLoad: () => void;
}

function makeBridgeIframe(): BridgeMockIframe {
  const postedMessages: unknown[] = [];
  const loadListeners = new Set<() => void>();
  return {
    src: "",
    hidden: false,
    tabIndex: 0,
    style: { display: "", width: "", height: "", border: "" },
    contentWindow: { postMessage: (msg: unknown) => postedMessages.push(msg) },
    postedMessages,
    setAttribute: vi.fn(),
    addEventListener: (_t, fn) => loadListeners.add(fn),
    removeEventListener: (_t, fn) => loadListeners.delete(fn),
    remove: vi.fn(),
    triggerLoad: () => loadListeners.forEach((fn) => fn())
  };
}

function makeBridgeRig(resolver?: RegisteredAnimationResolver) {
  const powerSave = new PowerSaveController(
    { fpsCap: 30, pause: vi.fn(), resume: vi.fn() } as unknown as SceneManager,
    { autoAttachListeners: false }
  );
  const vrm = {
    scene: new THREE.Group(),
    expressionManager: {
      expressionMap: { happy: {}, sad: {} },
      setValue: vi.fn(),
      getValue: vi.fn().mockReturnValue(0)
    },
    update: vi.fn()
  } as unknown as VRM;
  const controller = new AvatarController({
    powerSaveController: powerSave,
    vrm,
    getAvailableAnimations: resolver
      ? () => resolver.getAvailableIds()
      : undefined,
    resolveAnimation: resolver ? (id) => resolver.resolve(id) : undefined
  });
  const listeners = new Set<(ev: MessageEvent) => void>();
  const appended: BridgeMockIframe[] = [];
  const host = new PluginHost({
    avatarController: controller,
    animationResolver: resolver,
    container: {
      appendChild: (node) => {
        appended.push(node as BridgeMockIframe);
        return node;
      }
    },
    messageTarget: {
      addEventListener: (_t, fn) => listeners.add(fn),
      removeEventListener: (_t, fn) => listeners.delete(fn)
    },
    createIframe: makeBridgeIframe
  });
  const send = (source: unknown, data: unknown, origin = "null") => {
    const ev = { origin, source, data } as unknown as MessageEvent;
    listeners.forEach((fn) => fn(ev));
  };
  return { controller, host, appended, send };
}

function pluginSpec(id: string, permissions: string[]): PluginInfo {
  return {
    id,
    name: id,
    version: "1.0.0",
    entry: "index.html",
    entryUrl: `plugin://${id}/index.html`,
    permissions,
    animations: []
  };
}

describe("PluginHost postMessage bridge and permissions", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("verifies origin, source, channel, pluginId, and validateAvatarCommand", () => {
    const { controller, host, appended, send } = makeBridgeRig();
    host.mountPlugin(pluginSpec("alpha", ["avatar:expression"]), [
      "avatar:expression"
    ]);
    const iframe = appended[0];
    iframe.triggerLoad();
    expect(iframe.postedMessages[0]).toMatchObject({
      channel: PLUGIN_BRIDGE_CHANNEL,
      pluginId: "alpha",
      type: "init",
      scopes: ["avatar:expression"]
    });

    send(
      iframe.contentWindow,
      {
        channel: PLUGIN_BRIDGE_CHANNEL,
        v: 1,
        id: "bad-origin",
        cmd: { type: "expression", name: "happy" }
      },
      "https://evil.example"
    );
    send(
      {},
      {
        channel: PLUGIN_BRIDGE_CHANNEL,
        v: 1,
        id: "bad-source",
        cmd: { type: "expression", name: "happy" }
      }
    );
    send(iframe.contentWindow, {
      channel: "wrong:channel",
      v: 1,
      id: "bad-ch",
      cmd: { type: "expression", name: "happy" }
    });
    expect(iframe.postedMessages).toHaveLength(1);

    send(iframe.contentWindow, {
      channel: PLUGIN_BRIDGE_CHANNEL,
      pluginId: "beta",
      v: 1,
      id: "bad-pid",
      cmd: { type: "expression", name: "happy" }
    });
    expect(iframe.postedMessages.at(-1)).toMatchObject({
      type: "error",
      code: "forbidden",
      ref: "bad-pid"
    });

    send(iframe.contentWindow, {
      channel: PLUGIN_BRIDGE_CHANNEL,
      v: 1,
      id: "bad-range",
      cmd: { type: "expression", name: "happy", intensity: 2.5 }
    });
    expect(iframe.postedMessages.at(-1)).toMatchObject({
      type: "error",
      code: "invalid",
      ref: "bad-range"
    });

    send(iframe.contentWindow, {
      channel: PLUGIN_BRIDGE_CHANNEL,
      v: 1,
      id: "ok-1",
      cmd: { type: "expression", name: "happy", intensity: 0.8 }
    });
    expect(iframe.postedMessages.at(-1)).toMatchObject({
      channel: PLUGIN_BRIDGE_CHANNEL,
      pluginId: "alpha",
      type: "ack",
      ref: "ok-1"
    });

    host.dispose();
    controller.dispose();
  });

  it("enforces per-plugin permissions, event redaction, and registered VRMA IDs", () => {
    const resolver = new RegisteredAnimationResolver({
      initialAnimations: [{ id: "wave", source: "plugin", pluginId: "p1" }],
      readAnimationBytes: vi.fn().mockResolvedValue(new Uint8Array([1])),
      parseVrma: vi.fn().mockResolvedValue({} as never)
    });
    const { controller, host, appended, send } = makeBridgeRig(resolver);

    expect(
      computeEffectiveScopes(
        ["avatar:speak", "avatar:events"],
        ["avatar:events", "desktop:windowTitle"]
      )
    ).toEqual(["avatar:events"]);

    host.mountPlugin(
      pluginSpec("p1", [
        "avatar:animation",
        "avatar:events",
        "desktop:events",
        "desktop:windowTitle"
      ]),
      ["avatar:animation", "avatar:events", "desktop:events"]
    );
    const iframe = appended[0];

    send(iframe.contentWindow, {
      channel: PLUGIN_BRIDGE_CHANNEL,
      v: 1,
      id: "speak-1",
      cmd: { type: "say", text: "Hello" }
    });
    expect(iframe.postedMessages.at(-1)).toMatchObject({
      type: "error",
      code: "forbidden",
      ref: "speak-1"
    });

    send(iframe.contentWindow, {
      channel: PLUGIN_BRIDGE_CHANNEL,
      v: 1,
      id: "anim-bad",
      cmd: { type: "animation", vrma: "/etc/passwd.vrma" }
    });
    expect(iframe.postedMessages.at(-1)).toMatchObject({
      type: "error",
      code: "unknown_animation",
      ref: "anim-bad"
    });

    send(iframe.contentWindow, {
      channel: PLUGIN_BRIDGE_CHANNEL,
      v: 1,
      id: "anim-ok",
      cmd: { type: "animation", vrma: "wave" }
    });
    expect(iframe.postedMessages.at(-1)).toMatchObject({
      type: "ack",
      ref: "anim-ok"
    });

    send(iframe.contentWindow, {
      channel: PLUGIN_BRIDGE_CHANNEL,
      v: 1,
      id: "h1",
      cmd: { type: "hello", events: ["click", "windowFocus"] }
    });
    controller.emitClick("head");
    expect(iframe.postedMessages.at(-1)).toMatchObject({
      type: "click",
      region: "head"
    });

    controller.emitEvent({
      type: "windowFocus",
      appId: "org.gnome.Terminal",
      title: "Secret Title"
    });
    const focusMsg = iframe.postedMessages.at(-1) as Record<string, unknown>;
    expect(focusMsg).toMatchObject({
      type: "windowFocus",
      appId: "org.gnome.Terminal"
    });
    expect(focusMsg.title).toBeUndefined();

    host.updatePluginPermissions("p1", [
      "avatar:animation",
      "avatar:events",
      "desktop:events",
      "desktop:windowTitle"
    ]);
    controller.emitEvent({
      type: "windowFocus",
      appId: "firefox",
      title: "Docs"
    });
    expect(iframe.postedMessages.at(-1)).toMatchObject({
      type: "windowFocus",
      appId: "firefox",
      title: "Docs"
    });

    host.dispose();
    controller.dispose();
  });
});
