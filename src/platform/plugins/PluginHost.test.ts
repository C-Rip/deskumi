import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as THREE from "three";
import type { VRM } from "@pixiv/three-vrm";
import { AvatarController } from "../../engine/AvatarController";
import { PowerSaveController } from "../../engine/PowerSaveController";
import type { SceneManager } from "../../engine/SceneManager";
import type { PluginInfo } from "../ipc";
import {
  PLUGIN_BRIDGE_CHANNEL,
  PluginHost,
  type PluginIframeLike
} from "./PluginHost";

interface MockIframe extends PluginIframeLike {
  attributes: Record<string, string>;
  postedMessages: unknown[];
  removed: boolean;
  triggerLoad: () => void;
}

function createMockIframe(): MockIframe {
  const attributes: Record<string, string> = {};
  const postedMessages: unknown[] = [];
  const loadListeners = new Set<() => void>();
  const iframe: MockIframe = {
    src: "",
    hidden: false,
    tabIndex: 0,
    style: { display: "", width: "", height: "", border: "" },
    contentWindow: {
      postMessage: (msg: unknown) => {
        postedMessages.push(msg);
      }
    },
    attributes,
    postedMessages,
    removed: false,
    setAttribute(name: string, value: string) {
      attributes[name] = value;
    },
    addEventListener(type: "load", listener: () => void) {
      if (type === "load") loadListeners.add(listener);
    },
    removeEventListener(type: "load", listener: () => void) {
      if (type === "load") loadListeners.delete(listener);
    },
    remove() {
      iframe.removed = true;
    },
    triggerLoad() {
      for (const fn of loadListeners) fn();
    }
  };
  return iframe;
}

function makePlugin(
  id: string,
  permissions: string[] = ["avatar:expression"]
): PluginInfo {
  return {
    id,
    name: `Plugin ${id}`,
    version: "1.0.0",
    entry: "index.html",
    entryUrl: `plugin://${id}/index.html`,
    permissions,
    animations: []
  };
}

function createPluginTestRig() {
  let activeFps = 30;
  const mockScene = {
    get fpsCap() {
      return activeFps;
    },
    set fpsCap(val: number) {
      activeFps = val;
    },
    pause: vi.fn(),
    resume: vi.fn()
  } as unknown as SceneManager;

  const powerSave = new PowerSaveController(mockScene, {
    activeFps: 30,
    idleFps: 10,
    idleTimeoutMs: 5_000,
    autoAttachListeners: false
  });

  const vrm = {
    scene: new THREE.Group(),
    expressionManager: {
      expressionMap: { happy: {}, sad: {}, aa: {} },
      setValue: vi.fn(),
      getValue: vi.fn().mockReturnValue(0)
    },
    update: vi.fn()
  } as unknown as VRM;

  const controller = new AvatarController({
    powerSaveController: powerSave,
    vrm
  });

  const listeners = new Set<(ev: MessageEvent) => void>();
  const messageTarget = {
    addEventListener: (_type: "message", fn: (ev: MessageEvent) => void) =>
      listeners.add(fn),
    removeEventListener: (_type: "message", fn: (ev: MessageEvent) => void) =>
      listeners.delete(fn)
  };
  const appended: MockIframe[] = [];
  const container = {
    appendChild: (node: PluginIframeLike) => {
      appended.push(node as MockIframe);
      return node;
    }
  };

  return {
    controller,
    powerSave,
    messageTarget,
    listeners,
    appended,
    container
  };
}

function dispatchPluginMessage(
  listeners: Set<(ev: MessageEvent) => void>,
  source: unknown,
  data: unknown,
  origin = "null"
): void {
  const event = { origin, source, data } as unknown as MessageEvent;
  for (const fn of listeners) fn(event);
}

describe("PluginHost lifecycle and limits", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("mounts hidden sandbox='allow-scripts' iframes and enforces maxWorkers = 3", () => {
    const { controller, messageTarget, appended, container } =
      createPluginTestRig();
    const errors: string[] = [];
    const host = new PluginHost({
      avatarController: controller,
      container,
      messageTarget,
      createIframe: createMockIframe,
      onError: (id) => errors.push(id)
    });

    host.mountPlugin(makePlugin("p1"), []);
    host.mountPlugin(makePlugin("p2"), []);
    host.mountPlugin(makePlugin("p3"), []);
    expect(host.getActiveCount()).toBe(3);

    expect(appended[0].attributes.sandbox).toBe("allow-scripts");
    expect(appended[0].attributes.sandbox).not.toContain("allow-same-origin");
    expect(appended[0].hidden).toBe(true);
    expect(appended[0].style.display).toBe("none");
    expect(appended[0].src).toBe("plugin://p1/index.html");

    expect(() => host.mountPlugin(makePlugin("p4"), [])).toThrow(
      "Maximum active plugins limit (3) reached"
    );

    host.syncPlugins([
      { plugin: makePlugin("p1"), grantedPermissions: [] },
      { plugin: makePlugin("p2"), grantedPermissions: [] },
      { plugin: makePlugin("p3"), grantedPermissions: [] },
      { plugin: makePlugin("p4"), grantedPermissions: [] }
    ]);
    expect(host.getActivePluginIds()).toEqual(["p1", "p2", "p3"]);
    expect(errors).toEqual(["p4"]);

    host.unmountPlugin("p2");
    expect(host.getActiveCount()).toBe(2);
    host.mountPlugin(makePlugin("p4"), []);
    expect(host.getActivePluginIds()).toEqual(["p1", "p3", "p4"]);

    host.dispose();
    controller.dispose();
  });

  it("rejects non-plugin:// entry URLs", () => {
    const { controller, messageTarget, container } = createPluginTestRig();
    const host = new PluginHost({
      avatarController: controller,
      container,
      messageTarget,
      createIframe: createMockIframe
    });

    const bad = makePlugin("evil");
    bad.entryUrl = "https://evil.example/index.html";
    expect(() => host.mountPlugin(bad, [])).toThrow("Invalid plugin entry URL");

    host.dispose();
    controller.dispose();
  });

  it("cleans up streams, locks, and iframe on unmount/reload and enforces rate limits", () => {
    let nowMs = 1_000;
    const {
      controller,
      powerSave,
      messageTarget,
      listeners,
      appended,
      container
    } = createPluginTestRig();
    const host = new PluginHost({
      avatarController: controller,
      container,
      messageTarget,
      createIframe: createMockIframe,
      rateLimitPerSec: 3,
      now: () => nowMs
    });

    const plugin = makePlugin("streamer", ["avatar:speak", "avatar:lookAt"]);
    host.mountPlugin(plugin, ["avatar:speak", "avatar:lookAt"]);
    const iframe1 = appended[0];

    dispatchPluginMessage(listeners, iframe1.contentWindow, {
      channel: PLUGIN_BRIDGE_CHANNEL,
      v: 1,
      id: "s1",
      cmd: { type: "speakStart", streamId: "st-1", sampleRate: 22050 }
    });
    dispatchPluginMessage(listeners, iframe1.contentWindow, {
      channel: PLUGIN_BRIDGE_CHANNEL,
      v: 1,
      id: "l1",
      cmd: { type: "lookAt", x: 0.2, y: 0.3, durationMs: 5000 }
    });
    expect(controller.getChannelState("mouth").busy).toBe(true);
    expect(controller.getChannelState("lookAt").busy).toBe(true);
    expect(powerSave.hasActiveLocks()).toBe(true);

    dispatchPluginMessage(listeners, iframe1.contentWindow, {
      channel: PLUGIN_BRIDGE_CHANNEL,
      v: 1,
      id: "l2",
      cmd: { type: "lookAt", x: 0.1, y: 0.1 }
    });
    dispatchPluginMessage(listeners, iframe1.contentWindow, {
      channel: PLUGIN_BRIDGE_CHANNEL,
      v: 1,
      id: "l3",
      cmd: { type: "lookAt", x: 0, y: 0 }
    });
    expect(iframe1.postedMessages.at(-1)).toMatchObject({
      type: "error",
      code: "rate_limited",
      ref: "l3"
    });

    nowMs += 2_000;
    host.reloadPlugin(plugin, ["avatar:speak"]);
    expect(iframe1.removed).toBe(true);
    expect(iframe1.src).toBe("about:blank");
    expect(controller.getChannelState("mouth").busy).toBe(false);
    expect(controller.getChannelState("lookAt").busy).toBe(false);
    expect(powerSave.hasActiveLocks()).toBe(false);
    expect(host.getPluginScopes("streamer")).toEqual(["avatar:speak"]);

    host.dispose();
    controller.dispose();
  });
});
