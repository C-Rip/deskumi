import { describe, it, expect, vi } from "vitest";
import * as THREE from "three";
import type { VRM } from "@pixiv/three-vrm";
import type { VRMAnimation } from "@pixiv/three-vrm-animation";
import { AnimationSystem } from "../../engine/AnimationSystem";
import { AvatarController } from "../../engine/AvatarController";
import { PowerSaveController } from "../../engine/PowerSaveController";
import type { SceneManager } from "../../engine/SceneManager";
import { VRMAPlayer } from "../../engine/VRMAPlayer";
import type { RegisteredAnimation } from "../ipc";
import { RegisteredAnimationResolver } from "./RegisteredAnimationResolver";

function createMockVRM(): VRM {
  const scene = new THREE.Group();
  return {
    scene,
    humanoid: {
      getNormalizedBoneNode: vi.fn().mockReturnValue(new THREE.Object3D()),
      getRawBoneNode: vi.fn().mockReturnValue(null)
    },
    expressionManager: {
      expressionMap: { happy: {} },
      setValue: vi.fn(),
      getValue: vi.fn().mockReturnValue(0)
    },
    update: vi.fn()
  } as unknown as VRM;
}

function createMockVRMAnimation(): VRMAnimation {
  return {
    duration: 1.0,
    humanoidTracks: { translation: new Map(), rotation: new Map() },
    expressionTracks: new Map(),
    lookAtTrack: null,
    createAnimationClip: vi.fn()
  } as unknown as VRMAnimation;
}

describe("RegisteredAnimationResolver", () => {
  it("resolves registered IDs to AvatarController and rejects free paths with unknown_animation", async () => {
    const mockAnim = createMockVRMAnimation();
    const readAnimationBytes = vi
      .fn()
      .mockResolvedValue(new Uint8Array([1, 2, 3, 4]));
    const parseVrma = vi.fn().mockResolvedValue(mockAnim);

    const resolver = new RegisteredAnimationResolver({
      initialAnimations: [
        { id: "wave", label: "Wave", source: "plugin", pluginId: "hello" }
      ],
      readAnimationBytes,
      parseVrma
    });

    const vrm = createMockVRM();
    const animationSystem = new AnimationSystem(vrm);
    const playSpy = vi
      .spyOn(animationSystem.vrmaPlayer, "play")
      .mockReturnValue({} as THREE.AnimationAction);

    const powerSave = new PowerSaveController(
      {
        fpsCap: 30,
        pause: vi.fn(),
        resume: vi.fn()
      } as unknown as SceneManager,
      { autoAttachListeners: false }
    );
    const controller = new AvatarController({
      powerSaveController: powerSave,
      vrm,
      animationSystem,
      getAvailableAnimations: () => resolver.getAvailableIds(),
      resolveAnimation: (id) => resolver.resolve(id)
    });

    // Free path rejected cleanly with unknown_animation
    const badRes = controller.dispatch(
      { v: 1, id: "bad", cmd: { type: "animation", vrma: "/tmp/evil.vrma" } },
      { grantedScopes: ["avatar:animation"] }
    );
    expect(badRes).toMatchObject({
      type: "error",
      code: "unknown_animation",
      ref: "bad"
    });
    expect(readAnimationBytes).not.toHaveBeenCalled();

    // Registered ID executes and resolves bytes through registry
    const okRes = controller.dispatch(
      {
        v: 1,
        id: "ok",
        cmd: { type: "animation", vrma: "wave", loop: false }
      },
      { grantedScopes: ["avatar:animation"] }
    );
    expect(okRes).toMatchObject({ type: "ack", ref: "ok" });

    await vi.waitFor(() => {
      expect(playSpy).toHaveBeenCalledWith(mockAnim, {
        loop: false,
        fadeInDuration: 0.25
      });
    });
    expect(readAnimationBytes).toHaveBeenCalledTimes(1);
    expect(parseVrma).toHaveBeenCalledTimes(1);

    controller.dispose();
  });

  it("rejects all animation IDs when registry is empty", () => {
    const resolver = new RegisteredAnimationResolver({
      initialAnimations: []
    });
    const powerSave = new PowerSaveController(
      {
        fpsCap: 30,
        pause: vi.fn(),
        resume: vi.fn()
      } as unknown as SceneManager,
      { autoAttachListeners: false }
    );
    const controller = new AvatarController({
      powerSaveController: powerSave,
      getAvailableAnimations: () => resolver.getAvailableIds(),
      resolveAnimation: (id) => resolver.resolve(id)
    });

    const res = controller.dispatch(
      { v: 1, id: "a1", cmd: { type: "animation", vrma: "wave" } },
      { grantedScopes: ["avatar:animation"] }
    );
    expect(res).toMatchObject({
      type: "error",
      code: "unknown_animation",
      ref: "a1"
    });
    controller.dispose();
  });

  it("plays registered animations directly on VRMAPlayer and refreshes cache", async () => {
    const anim1 = createMockVRMAnimation();
    const anim2 = createMockVRMAnimation();
    let currentList: RegisteredAnimation[] = [{ id: "dance", source: "user" }];
    const readAnimationBytes = vi
      .fn()
      .mockResolvedValue(new Uint8Array([9, 8, 7]));
    const parseVrma = vi
      .fn()
      .mockResolvedValueOnce(anim1)
      .mockResolvedValueOnce(anim2);

    const resolver = new RegisteredAnimationResolver({
      listAnimations: async () => currentList,
      readAnimationBytes,
      parseVrma
    });
    await resolver.refresh();

    const vrm = createMockVRM();
    const player = new VRMAPlayer(vrm);
    const playSpy = vi
      .spyOn(player, "play")
      .mockReturnValue({} as THREE.AnimationAction);

    expect(await resolver.playOn(player, "missing")).toBeNull();
    await resolver.playOn(player, "dance", { loop: true });
    await resolver.playOn(player, "dance", { loop: false });
    expect(playSpy).toHaveBeenCalledTimes(2);
    expect(readAnimationBytes).toHaveBeenCalledTimes(1);

    currentList = [{ id: "bow", source: "user" }];
    await resolver.refresh();
    expect(resolver.has("dance")).toBe(false);
    expect(resolver.has("bow")).toBe(true);
    await resolver.playOn(player, "bow");
    expect(readAnimationBytes).toHaveBeenCalledTimes(2);

    player.dispose();
    resolver.dispose();
  });
});
