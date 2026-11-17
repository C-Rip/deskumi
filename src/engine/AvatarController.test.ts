import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as THREE from "three";
import type { VRM, VRMExpressionOverrideType } from "@pixiv/three-vrm";
import type { VRMAnimation } from "@pixiv/three-vrm-animation";
import { AnimationSystem } from "./AnimationSystem";
import { AvatarController, classifyClickRegion } from "./AvatarController";
import type { AvatarEvent } from "./AvatarCommand";
import { LookAtSystem } from "./LookAtSystem";
import { PowerSaveController } from "./PowerSaveController";
import { ReactionSystem } from "./ReactionSystem";
import type { SceneManager } from "./SceneManager";

interface MockExpressionMeta {
  overrideBlink: VRMExpressionOverrideType;
  overrideMouth: VRMExpressionOverrideType;
}

function createControllerRig(
  options: {
    expressionOverrides?: Record<string, Partial<MockExpressionMeta>>;
    withBones?: boolean;
  } = {}
) {
  const scene = new THREE.Group();
  const neckNode = new THREE.Object3D();
  neckNode.position.set(0, 1.35, 0);
  const headNode = new THREE.Object3D();
  headNode.position.set(0, 1.5, 0);
  const chestNode = new THREE.Object3D();
  const hipsNode = new THREE.Object3D();
  if (options.withBones !== false) {
    scene.add(neckNode, headNode, chestNode, hipsNode);
  }

  const boneMap: Record<string, THREE.Object3D | null> =
    options.withBones === false
      ? {}
      : { neck: neckNode, head: headNode, chest: chestNode, hips: hipsNode };

  const expressionValues = new Map<string, number>();
  const setValueSpy = vi.fn((name: string, val: number) => {
    expressionValues.set(name, val);
  });

  const expressionMap: Record<string, MockExpressionMeta> = {
    happy: { overrideBlink: "none", overrideMouth: "none" },
    sad: { overrideBlink: "none", overrideMouth: "none" },
    surprised: { overrideBlink: "none", overrideMouth: "none" },
    relaxed: { overrideBlink: "none", overrideMouth: "none" },
    blink: { overrideBlink: "none", overrideMouth: "none" },
    blinkLeft: { overrideBlink: "none", overrideMouth: "none" },
    aa: { overrideBlink: "none", overrideMouth: "none" },
    ih: { overrideBlink: "none", overrideMouth: "none" },
    ou: { overrideBlink: "none", overrideMouth: "none" },
    ee: { overrideBlink: "none", overrideMouth: "none" },
    oh: { overrideBlink: "none", overrideMouth: "none" }
  };

  if (options.expressionOverrides) {
    for (const [k, v] of Object.entries(options.expressionOverrides)) {
      expressionMap[k] = {
        overrideBlink: v.overrideBlink ?? "none",
        overrideMouth: v.overrideMouth ?? "none"
      };
    }
  }

  const callOrder: string[] = [];
  const trackedSetValue = vi.fn((name: string, val: number) => {
    callOrder.push(`setValue:${name}`);
    setValueSpy(name, val);
  });
  const updateSpy = vi.fn(() => {
    callOrder.push("vrm.update");
  });

  const vrm = {
    scene,
    humanoid: {
      getNormalizedBoneNode: (name: string) => boneMap[name] ?? null,
      getRawBoneNode: () => null
    },
    expressionManager: {
      expressionMap,
      getExpression: (name: string) => expressionMap[name] ?? null,
      setValue: trackedSetValue,
      getValue: (name: string) => expressionValues.get(name) ?? 0
    },
    lookAt: {
      target: null as THREE.Object3D | null,
      autoUpdate: true,
      update: vi.fn(),
      getLookAtWorldPosition: (out: THREE.Vector3) =>
        headNode.getWorldPosition(out)
    },
    update: updateSpy
  } as unknown as VRM;

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

  const animationSystem = new AnimationSystem(vrm, {
    blinkOptions: {
      minInterval: 0.5,
      maxInterval: 0.5,
      closingDuration: 0.1,
      closedDuration: 0.1,
      openingDuration: 0.1,
      doubleBlinkChance: 0,
      random: () => 0
    }
  });
  const reactionSystem = new ReactionSystem(vrm, { duration: 1.0 });
  const camera = new THREE.PerspectiveCamera(45, 400 / 600, 0.1, 100);
  camera.position.set(0, 1.0, 3.0);
  camera.lookAt(0, 1.0, 0);
  const lookAtSystem = new LookAtSystem(vrm, {
    camera,
    autoAttachListeners: false
  });

  return {
    vrm,
    camera,
    neckNode,
    headNode,
    expressionValues,
    trackedSetValue,
    updateSpy,
    callOrder,
    mockSceneManager,
    powerSave,
    animationSystem,
    reactionSystem,
    lookAtSystem
  };
}

describe("AvatarController", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("acts as single expression writer before vrm.update(dt) while delegating AnimationSystem and ReactionSystem", () => {
    const rig = createControllerRig();
    const controller = new AvatarController({
      powerSaveController: rig.powerSave,
      vrm: rig.vrm,
      animationSystem: rig.animationSystem,
      reactionSystem: rig.reactionSystem,
      lookAtSystem: rig.lookAtSystem
    });

    rig.reactionSystem.trigger("happy", 1.0);

    // Advance AnimationSystem (into blink closing) and ReactionSystem: neither should write directly or call vrm.update
    rig.animationSystem.update(0.55); // blink = 0.5
    rig.reactionSystem.update(0.2); // happy > 0
    expect(rig.trackedSetValue).not.toHaveBeenCalled();
    expect(rig.updateSpy).not.toHaveBeenCalled();

    // AvatarController composes and writes expressions BEFORE calling vrm.update(dt)
    rig.callOrder.length = 0;
    controller.update(0.016);
    expect(rig.updateSpy).toHaveBeenCalledTimes(1);
    const updateIndex = rig.callOrder.indexOf("vrm.update");
    expect(updateIndex).toBeGreaterThan(0);
    expect(rig.callOrder.indexOf("setValue:blink")).toBeLessThan(updateIndex);
    expect(rig.callOrder.indexOf("setValue:happy")).toBeLessThan(updateIndex);
    expect(rig.expressionValues.get("blink")).toBeGreaterThan(0);
    expect(rig.expressionValues.get("happy")).toBeGreaterThan(0);

    controller.dispose();
    rig.powerSave.dispose();
  });

  it("honors overrideBlink, overrideMouth, attenuates mouth-affecting emotions, and treats neutral viseme as closed mouth", () => {
    const rig = createControllerRig({
      expressionOverrides: {
        relaxed: { overrideBlink: "block", overrideMouth: "block" },
        sad: { overrideBlink: "blend", overrideMouth: "blend" },
        happy: { overrideBlink: "none", overrideMouth: "none" }
      }
    });
    const controller = new AvatarController({
      powerSaveController: rig.powerSave,
      vrm: rig.vrm,
      animationSystem: rig.animationSystem
    });

    // Advance into blink closing (0.55s -> blink = 0.5)
    rig.animationSystem.update(0.55);

    // 1. overrideBlink="block" & overrideMouth="block" suppresses both blink and mouth visemes
    controller.dispatch({
      v: 1,
      cmd: { type: "expression", name: "relaxed", intensity: 1.0 }
    });
    controller.setMouthActive(true);
    controller.setMouthVisemes({ aa: 0.9 });
    controller.update(0.016);

    expect(rig.expressionValues.get("relaxed")).toBeCloseTo(1.0);
    expect(rig.expressionValues.get("blink") ?? 0).toBe(0);
    expect(rig.expressionValues.get("aa") ?? 0).toBe(0);

    // 2. overrideBlink="none" & overrideMouth="none": happy attenuates when mouth viseme is open
    controller.dispatch({
      v: 1,
      cmd: { type: "expression", name: "happy", intensity: 1.0 }
    });
    controller.setMouthVisemes({ aa: 1.0 });
    controller.update(0.016);
    expect(rig.expressionValues.get("aa")).toBeCloseTo(1.0);
    expect(rig.expressionValues.get("happy")).toBeLessThan(1.0);
    expect(rig.expressionValues.get("happy")).toBeGreaterThan(0);
    expect(rig.expressionValues.get("blink")).toBeGreaterThan(0);

    // 3. Viseme "neutral" via speak closes mouth without ever calling setValue("neutral", ...)
    controller.setMouthActive(false);
    controller.clearMouthVisemes();
    controller.dispatch({
      v: 1,
      cmd: {
        type: "speak",
        visemes: [
          { t: 0, v: "aa", w: 0.8 },
          { t: 100, v: "neutral", w: 1.0 }
        ],
        durationMs: 300
      }
    });

    rig.trackedSetValue.mockClear();
    controller.update(0.05); // t = 50ms -> aa active
    expect(rig.expressionValues.get("aa")).toBeCloseTo(0.8);

    controller.update(0.06); // t = 110ms -> neutral active -> closes aa, never writes "neutral"
    expect(rig.expressionValues.get("aa")).toBe(0);
    expect(rig.trackedSetValue).not.toHaveBeenCalledWith(
      "neutral",
      expect.anything()
    );

    controller.dispose();
    rig.powerSave.dispose();
  });

  it("arbitrates interrupt, queue, and drop policies across all 4 independent channels", () => {
    const rig = createControllerRig();
    let vrmaPlaying = false;
    const playSpy = vi
      .spyOn(rig.animationSystem.vrmaPlayer, "play")
      .mockImplementation(() => {
        vrmaPlaying = true;
        return {} as THREE.AnimationAction;
      });
    const stopSpy = vi
      .spyOn(rig.animationSystem.vrmaPlayer, "stop")
      .mockImplementation(() => {
        vrmaPlaying = false;
      });
    vi.spyOn(
      rig.animationSystem.vrmaPlayer,
      "isPlaying",
      "get"
    ).mockImplementation(() => vrmaPlaying);
    const fakeClip = {} as VRMAnimation;

    const controller = new AvatarController({
      powerSaveController: rig.powerSave,
      vrm: rig.vrm,
      animationSystem: rig.animationSystem,
      reactionSystem: rig.reactionSystem,
      lookAtSystem: rig.lookAtSystem,
      getAvailableAnimations: () => ["wave", "dance"],
      resolveAnimation: () => fakeClip
    });

    const events: AvatarEvent[] = [];
    controller.onEvent((ev) => events.push(ev));

    // All 4 channels can run concurrently without blocking each other
    expect(
      controller.dispatch(
        { v: 1, cmd: { type: "lookAt", x: 0.5, y: 0.2, durationMs: 500 } },
        { ownerId: "plugin:a" }
      ).type
    ).toBe("ack");
    expect(
      controller.dispatch(
        { v: 1, cmd: { type: "expression", name: "happy", durationMs: 500 } },
        { ownerId: "plugin:a" }
      ).type
    ).toBe("ack");
    expect(
      controller.dispatch(
        {
          v: 1,
          cmd: { type: "say", id: "u1", text: "Hello", durationMs: 500 }
        },
        { ownerId: "plugin:a" }
      ).type
    ).toBe("ack");
    expect(
      controller.dispatch(
        { v: 1, cmd: { type: "animation", vrma: "wave", durationMs: 500 } },
        { ownerId: "plugin:a" }
      ).type
    ).toBe("ack");

    expect(playSpy).toHaveBeenCalledTimes(1);
    expect(controller.getChannelState("lookAt").busy).toBe(true);
    expect(controller.getChannelState("expression").busy).toBe(true);
    expect(controller.getChannelState("mouth").busy).toBe(true);
    expect(controller.getChannelState("pose").busy).toBe(true);

    // policy: "drop" rejects with "busy" even from a different owner
    const dropRes = controller.dispatch(
      { v: 1, id: "d1", cmd: { type: "say", text: "Nope", policy: "drop" } },
      { ownerId: "ws:1" }
    );
    expect(dropRes).toEqual({
      v: 1,
      type: "error",
      ref: "d1",
      code: "busy",
      message: "mouth channel is busy"
    });

    // policy: "queue" enqueues on lookAt & mouth, advances after completion
    expect(
      controller.dispatch(
        {
          v: 1,
          cmd: {
            type: "lookAt",
            x: -0.8,
            y: -0.4,
            durationMs: 300,
            policy: "queue"
          }
        },
        { ownerId: "ws:1" }
      ).type
    ).toBe("ack");
    expect(
      controller.dispatch(
        {
          v: 1,
          cmd: {
            type: "say",
            id: "u2",
            text: "Queued",
            durationMs: 300,
            policy: "queue"
          }
        },
        { ownerId: "ws:1" }
      ).type
    ).toBe("ack");
    expect(controller.getChannelState("mouth").queueLength).toBe(1);

    // Advance 500ms -> first items finish, queued items activate
    controller.update(0.5);
    expect(controller.getChannelState("mouth").ownerId).toBe("ws:1");
    expect(controller.getChannelState("lookAt").ownerId).toBe("ws:1");

    // policy: "interrupt" replaces active item and clears queue
    expect(
      controller.dispatch(
        {
          v: 1,
          cmd: {
            type: "say",
            id: "u3",
            text: "Urgent",
            durationMs: 200,
            policy: "interrupt"
          }
        },
        { ownerId: "plugin:b" }
      ).type
    ).toBe("ack");
    expect(
      controller.dispatch(
        {
          v: 1,
          cmd: { type: "animation", vrma: "dance", policy: "interrupt" }
        },
        { ownerId: "plugin:b" }
      ).type
    ).toBe("ack");
    expect(stopSpy).toHaveBeenCalled();

    expect(events).toContainEqual({ type: "speechStart", id: "u1" });
    expect(events).toContainEqual({
      type: "speechEnd",
      id: "u1",
      interrupted: false,
      reason: "finished"
    });
    expect(events).toContainEqual({ type: "speechStart", id: "u2" });
    expect(events).toContainEqual({
      type: "speechEnd",
      id: "u2",
      interrupted: true,
      reason: "interrupted"
    });
    expect(events).toContainEqual({ type: "speechStart", id: "u3" });

    controller.dispose();
    rig.powerSave.dispose();
  });

  it("enforces stream ownership, chunk visemes, timeout, and releases wake locks on all error/cancel paths", () => {
    const rig = createControllerRig();
    const controller = new AvatarController({
      powerSaveController: rig.powerSave,
      vrm: rig.vrm,
      streamTimeoutMs: 5_000
    });

    const events: AvatarEvent[] = [];
    controller.onEvent((ev) => events.push(ev));

    // Start stream owned by ws:1
    controller.dispatch(
      {
        v: 1,
        cmd: {
          type: "speakStart",
          streamId: "st-1",
          id: "s-id",
          sampleRate: 22050
        }
      },
      { ownerId: "ws:1" }
    );
    expect(rig.powerSave.hasActiveLocks()).toBe(true);

    // Another owner cannot push chunks or cancel ws:1's stream
    const stolen = controller.dispatch(
      {
        v: 1,
        cmd: {
          type: "speakChunk",
          streamId: "st-1",
          visemes: [{ t: 0, v: "oh", w: 1 }]
        }
      },
      { ownerId: "ws:2" }
    );
    expect(stolen.type).toBe("error");
    if (stolen.type === "error") expect(stolen.code).toBe("forbidden");

    // Stream times out after 5s of inactivity and releases lock
    controller.update(5.0);
    expect(rig.powerSave.hasActiveLocks()).toBe(false);
    expect(events).toContainEqual({
      type: "speechEnd",
      id: "s-id",
      interrupted: true,
      reason: "timeout"
    });

    // speakCancel also releases lock
    controller.dispatch(
      {
        v: 1,
        cmd: {
          type: "speakStart",
          streamId: "st-2",
          id: "s-2",
          sampleRate: 22050
        }
      },
      { ownerId: "ws:1" }
    );
    expect(rig.powerSave.hasActiveLocks()).toBe(true);
    controller.dispatch(
      { v: 1, cmd: { type: "speakCancel", streamId: "st-2" } },
      { ownerId: "ws:1" }
    );
    expect(rig.powerSave.hasActiveLocks()).toBe(false);
    expect(events).toContainEqual({
      type: "speechEnd",
      id: "s-2",
      interrupted: true,
      reason: "cancelled"
    });

    controller.dispose();
    rig.powerSave.dispose();
  });

  it("rejects commands with hidden and terminates active speech/locks when window hides", () => {
    const rig = createControllerRig();
    const controller = new AvatarController({
      powerSaveController: rig.powerSave,
      vrm: rig.vrm,
      animationSystem: rig.animationSystem,
      reactionSystem: rig.reactionSystem,
      lookAtSystem: rig.lookAtSystem
    });

    const events: AvatarEvent[] = [];
    controller.onEvent((ev) => events.push(ev));

    controller.dispatch({
      v: 1,
      cmd: { type: "say", id: "hide-utt", text: "Talking", durationMs: 5_000 }
    });
    expect(rig.powerSave.hasActiveLocks()).toBe(true);

    // Hide window via PowerSaveController
    rig.powerSave.setWindowVisible(false);
    expect(rig.powerSave.hasActiveLocks()).toBe(false);
    expect(events).toContainEqual({
      type: "speechEnd",
      id: "hide-utt",
      interrupted: true,
      reason: "hidden"
    });

    // Commands while hidden respond with error: "hidden"
    const hiddenRes = controller.dispatch({
      v: 1,
      id: "cmd-while-hidden",
      cmd: { type: "expression", name: "happy" }
    });
    expect(hiddenRes).toEqual({
      v: 1,
      type: "error",
      ref: "cmd-while-hidden",
      code: "hidden",
      message: "Avatar window is hidden; command rejected"
    });

    // hello still responds while hidden
    const helloRes = controller.dispatch({
      v: 1,
      id: "h-hidden",
      cmd: { type: "hello" }
    });
    expect(helloRes.type).toBe("hello");

    controller.dispose();
    rig.powerSave.dispose();
  });

  it("classifies click region into head vs body by projecting the neck bone", () => {
    const rig = createControllerRig();
    // Neck is at y=1.35, camera is at y=1.0 z=3.0 looking at y=1.0
    // Project neck to see its screen Y in a 600px tall viewport
    const projectedNeck = new THREE.Vector3();
    rig.neckNode.updateWorldMatrix(true, false);
    rig.camera.updateMatrixWorld();
    rig.neckNode.getWorldPosition(projectedNeck);
    projectedNeck.project(rig.camera);
    const neckClientY = (1 - projectedNeck.y) * 0.5 * 600;

    expect(
      classifyClickRegion(rig.vrm, rig.camera, neckClientY - 20, 600)
    ).toBe("head");
    expect(
      classifyClickRegion(rig.vrm, rig.camera, neckClientY + 20, 600)
    ).toBe("body");
    expect(classifyClickRegion(rig.vrm, rig.camera, 100, 0)).toBe("body");

    // Missing neck/head bone falls back safely to "body"
    const noBoneRig = createControllerRig({ withBones: false });
    expect(classifyClickRegion(noBoneRig.vrm, noBoneRig.camera, 50, 600)).toBe(
      "body"
    );

    rig.powerSave.dispose();
    noBoneRig.powerSave.dispose();
  });

  it("emits avatarChange and idleChange events and releases locks on dispose", () => {
    const rig = createControllerRig();
    const controller = new AvatarController({
      powerSaveController: rig.powerSave
    });

    const events: AvatarEvent[] = [];
    controller.onEvent((ev) => events.push(ev));

    controller.attachAvatar({
      vrm: rig.vrm,
      animationSystem: rig.animationSystem,
      reactionSystem: rig.reactionSystem,
      lookAtSystem: rig.lookAtSystem
    });

    const avatarChangeEv = events.find((e) => e.type === "avatarChange");
    expect(avatarChangeEv).toBeDefined();
    if (avatarChangeEv && avatarChangeEv.type === "avatarChange") {
      expect(avatarChangeEv.expressions).toContain("happy");
      expect(avatarChangeEv.expressions).toContain("aa");
    }

    controller.emitClick("head");
    expect(events).toContainEqual({ type: "click", region: "head" });

    // Idle transition emits idleChange(true), active command wakes with idleChange(false)
    vi.advanceTimersByTime(5_000);
    expect(events).toContainEqual({ type: "idleChange", idle: true });

    controller.dispatch({ v: 1, cmd: { type: "say", text: "Wake up" } });
    expect(events).toContainEqual({ type: "idleChange", idle: false });
    expect(rig.powerSave.hasActiveLocks()).toBe(true);

    controller.dispose();
    expect(rig.powerSave.hasActiveLocks()).toBe(false);
    rig.powerSave.dispose();
  });

  it("releases pose active lock when async resolveAnimation rejects or returns null", async () => {
    const rig = createControllerRig();
    const controller = new AvatarController({
      powerSaveController: rig.powerSave,
      vrm: rig.vrm,
      animationSystem: rig.animationSystem,
      getAvailableAnimations: () => ["broken", "missing"],
      resolveAnimation: async (id) => {
        if (id === "broken") throw new Error("boom");
        return null;
      }
    });

    controller.dispatch({
      v: 1,
      cmd: { type: "animation", vrma: "broken" }
    });
    expect(rig.powerSave.hasActiveLocks()).toBe(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(rig.powerSave.hasActiveLocks()).toBe(false);
    expect(controller.getChannelState("pose").busy).toBe(false);

    controller.dispatch({
      v: 1,
      cmd: { type: "animation", vrma: "missing" }
    });
    expect(rig.powerSave.hasActiveLocks()).toBe(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(rig.powerSave.hasActiveLocks()).toBe(false);

    controller.dispose();
    rig.powerSave.dispose();
  });
});
