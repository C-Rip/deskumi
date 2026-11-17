import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import type { VRM } from "@pixiv/three-vrm";
import { AvatarController } from "../engine/AvatarController";
import { PowerSaveController } from "../engine/PowerSaveController";
import type { SceneManager } from "../engine/SceneManager";
import type { BridgeStatus, PluginInfo, RegisteredAnimation } from "./ipc";
import type { PlatformCaps } from "./caps";
import type { AppRuntimeState } from "./app-listeners";
import { RegisteredAnimationResolver } from "./plugins/RegisteredAnimationResolver";
import { setupRuntimeIntegrations } from "./runtime-integrations";
import { cloneAppConfig, DEFAULT_CONFIG } from "./store";

const LINUX_CAPS: PlatformCaps = {
  os: "linux",
  displayServer: "xwayland",
  globalCursor: true,
  inputRegion: true,
  alwaysOnTop: true,
  setPosition: true,
  localBridge: true,
  plugins: true
};

const WINDOWS_CAPS: PlatformCaps = {
  ...LINUX_CAPS,
  os: "windows",
  displayServer: "win32",
  inputRegion: false,
  localBridge: false,
  plugins: false
};

function makePlugin(id: string): PluginInfo {
  return {
    id,
    name: `Plugin ${id}`,
    version: "1.0.0",
    entry: "index.html",
    entryUrl: `plugin://${id}/index.html`,
    permissions: ["avatar:speak", "desktop:windowTitle"],
    animations: []
  };
}

function createRuntimeTestRig() {
  const registeredAnims: RegisteredAnimation[] = [];
  const startLocalBridge = vi.fn<() => Promise<BridgeStatus>>(async () => ({
    running: true,
    port: 49200,
    bridgeFilePath: "/run/user/1000/deskumi/bridge.json",
    token: "tok",
    connectedClients: 0,
    maxClients: 4
  }));
  const stopLocalBridge = vi.fn<() => Promise<BridgeStatus>>(async () => ({
    running: false,
    port: null,
    bridgeFilePath: null,
    token: null,
    connectedClients: 0,
    maxClients: 4
  }));
  const registerAnimation = vi.fn(
    async (id: string, _path: string, label?: string) => {
      const entry: RegisteredAnimation = { id, label, source: "user" };
      const idx = registeredAnims.findIndex((a) => a.id === id);
      if (idx >= 0) registeredAnims[idx] = entry;
      else registeredAnims.push(entry);
      return entry;
    }
  );
  const unregisterAnimation = vi.fn(async (id: string) => {
    const idx = registeredAnims.findIndex((a) => a.id === id);
    if (idx < 0) return false;
    registeredAnims.splice(idx, 1);
    return true;
  });

  const sceneManager = {
    fpsCap: 30,
    camera: new THREE.PerspectiveCamera(),
    registerSystem: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn()
  } as unknown as SceneManager;
  const powerSave = new PowerSaveController(sceneManager, {
    activeFps: 30,
    idleFps: 10,
    idleTimeoutMs: 5000,
    autoAttachListeners: false
  });
  const vrm = {
    scene: new THREE.Group(),
    expressionManager: {
      expressionMap: { happy: {} },
      setValue: vi.fn(),
      getValue: vi.fn().mockReturnValue(0)
    },
    update: vi.fn()
  } as unknown as VRM;

  const avatarController = new AvatarController({
    powerSaveController: powerSave
  });
  avatarController.attachAvatar({ vrm });
  const animationResolver = new RegisteredAnimationResolver({
    listAnimations: async () => [...registeredAnims]
  });
  const state: AppRuntimeState = {
    avatarContext: null,
    activeAvatarPath: null,
    configuredFrameSize: { width: 400, height: 600 },
    activeScale: 1,
    activeOffsetY: 0
  };
  const container = {
    clientWidth: 400,
    clientHeight: 600,
    appendChild: vi.fn(),
    removeChild: vi.fn()
  } as unknown as HTMLElement;

  return {
    registeredAnims,
    startLocalBridge,
    stopLocalBridge,
    registerAnimation,
    unregisterAnimation,
    sceneManager,
    avatarController,
    animationResolver,
    state,
    container
  };
}

describe("setupRuntimeIntegrations live sync", () => {
  it("syncs bridge lifecycle, scopes, animations, and max-3 plugins with granted permissions", async () => {
    const rig = createRuntimeTestRig();
    const bridgeStartSpy = vi.fn(async () => {});
    const bridgeSetScopesSpy = vi.fn();
    const pluginSyncSpy = vi.fn();
    const listPlugins = vi.fn(async () => [
      makePlugin("p1"),
      makePlugin("p2"),
      makePlugin("p3"),
      makePlugin("p4")
    ]);

    const integrations = setupRuntimeIntegrations({
      container: rig.container,
      sceneManager: rig.sceneManager,
      avatarController: rig.avatarController,
      animationResolver: rig.animationResolver,
      state: rig.state,
      speechBubble: {
        visible: false,
        show: vi.fn(),
        hide: vi.fn(),
        updateAnchor: vi.fn(),
        dispose: vi.fn()
      } as unknown as never,
      bridgeClient: {
        start: bridgeStartSpy,
        setGrantedScopes: bridgeSetScopesSpy,
        dispose: vi.fn()
      } as unknown as never,
      pluginHost: {
        syncPlugins: pluginSyncSpy,
        dispose: vi.fn()
      } as unknown as never,
      deps: {
        isTauri: () => true,
        getPlatformCaps: async () => LINUX_CAPS,
        startLocalBridge: rig.startLocalBridge,
        stopLocalBridge: rig.stopLocalBridge,
        listPlugins,
        listRegisteredAnimations: async () => [...rig.registeredAnims],
        registerAnimation: rig.registerAnimation,
        unregisterAnimation: rig.unregisterAnimation
      }
    });

    const cfg1 = cloneAppConfig(DEFAULT_CONFIG);
    cfg1.bridgeEnabled = true;
    cfg1.bridgeScopes = ["avatar:speak", "desktop:events"];
    cfg1.enabledPlugins = ["p1", "p2", "p3", "p4"];
    cfg1.pluginPermissions = { p1: ["avatar:speak"] };
    cfg1.registeredAnimations = [{ id: "wave", path: "/tmp/wave.vrma" }];

    await integrations.syncConfig(cfg1);

    expect(bridgeSetScopesSpy).toHaveBeenCalledWith([
      "avatar:speak",
      "desktop:events"
    ]);
    expect(bridgeStartSpy).toHaveBeenCalledTimes(1);
    expect(rig.startLocalBridge).toHaveBeenCalledTimes(1);
    expect(rig.registerAnimation).toHaveBeenCalledWith(
      "wave",
      "/tmp/wave.vrma",
      undefined
    );
    expect(rig.animationResolver.getAvailableIds()).toEqual(["wave"]);
    expect(pluginSyncSpy).toHaveBeenCalledTimes(1);
    const mounted = pluginSyncSpy.mock.calls[0][0];
    expect(mounted).toHaveLength(3);
    expect(mounted[0].grantedPermissions).toEqual(["avatar:speak"]);
    expect(mounted[1].grantedPermissions).toEqual([]);

    const cfg2 = cloneAppConfig(DEFAULT_CONFIG);
    cfg2.bridgeEnabled = false;
    await integrations.syncConfig(cfg2);

    expect(rig.stopLocalBridge).toHaveBeenCalledTimes(1);
    expect(rig.unregisterAnimation).toHaveBeenCalledWith("wave");
    expect(rig.animationResolver.getAvailableIds()).toEqual([]);
    expect(pluginSyncSpy).toHaveBeenLastCalledWith([]);
    integrations.dispose();
  });

  it("skips starting bridge and plugins when platform caps are disabled", async () => {
    const rig = createRuntimeTestRig();
    const pluginSyncSpy = vi.fn();
    const integrations = setupRuntimeIntegrations({
      container: rig.container,
      sceneManager: rig.sceneManager,
      avatarController: rig.avatarController,
      animationResolver: rig.animationResolver,
      state: rig.state,
      speechBubble: {
        visible: false,
        show: vi.fn(),
        hide: vi.fn(),
        updateAnchor: vi.fn(),
        dispose: vi.fn()
      } as unknown as never,
      bridgeClient: {
        start: vi.fn(async () => {}),
        setGrantedScopes: vi.fn(),
        dispose: vi.fn()
      } as unknown as never,
      pluginHost: {
        syncPlugins: pluginSyncSpy,
        dispose: vi.fn()
      } as unknown as never,
      deps: {
        isTauri: () => true,
        getPlatformCaps: async () => WINDOWS_CAPS,
        startLocalBridge: rig.startLocalBridge,
        stopLocalBridge: rig.stopLocalBridge,
        listPlugins: vi.fn(async () => [makePlugin("p1")]),
        listRegisteredAnimations: async () => [],
        registerAnimation: rig.registerAnimation,
        unregisterAnimation: rig.unregisterAnimation
      }
    });

    const cfg = cloneAppConfig(DEFAULT_CONFIG);
    cfg.bridgeEnabled = true;
    cfg.enabledPlugins = ["p1"];
    await integrations.syncConfig(cfg);

    expect(rig.startLocalBridge).not.toHaveBeenCalled();
    expect(pluginSyncSpy).toHaveBeenLastCalledWith([]);
    integrations.dispose();
  });
});
