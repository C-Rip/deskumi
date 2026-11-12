import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { VRM } from "@pixiv/three-vrm";
import type { VRMAnimation } from "@pixiv/three-vrm-animation";
import { isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";
import { createVRMAnimationClip } from "@pixiv/three-vrm-animation";
import {
  loadVRMA,
  loadVRMAFromPathOrUrl,
  pickVRMAFile,
  VRMAPlayer
} from "./VRMAPlayer";

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: vi.fn(() => false)
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn()
}));

vi.mock("@tauri-apps/plugin-fs", () => ({
  readFile: vi.fn()
}));

vi.mock("@pixiv/three-vrm-animation", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@pixiv/three-vrm-animation")>();
  return {
    ...actual,
    createVRMAnimationClip: vi.fn(actual.createVRMAnimationClip)
  };
});

function createMockVRM(): VRM {
  const scene = new THREE.Group();
  return {
    scene,
    humanoid: {
      getNormalizedBoneNode: vi.fn().mockReturnValue(new THREE.Object3D()),
      getRawBoneNode: vi.fn().mockReturnValue(null)
    },
    expressionManager: {
      setValue: vi.fn(),
      getValue: vi.fn().mockReturnValue(0),
      update: vi.fn()
    },
    update: vi.fn()
  } as unknown as VRM;
}

function createMockVRMAnimation(): VRMAnimation {
  return {
    duration: 1.0,
    humanoidTracks: {
      translation: new Map(),
      rotation: new Map()
    },
    expressionTracks: new Map(),
    lookAtTrack: null,
    createAnimationClip: vi.fn()
  } as unknown as VRMAnimation;
}

describe("loadVRMA", () => {
  it("loads a valid VRMAnimation from URL via GLTFLoader", async () => {
    const mockAnim = createMockVRMAnimation();
    const loadSpy = vi
      .spyOn(GLTFLoader.prototype, "loadAsync")
      .mockResolvedValueOnce({
        scene: new THREE.Group(),
        userData: { vrmAnimations: [mockAnim] }
      } as unknown as import("three/examples/jsm/loaders/GLTFLoader.js").GLTF);

    const result = await loadVRMA("https://example.com/test.vrma");
    expect(result).toBe(mockAnim);
    expect(loadSpy).toHaveBeenCalled();
    loadSpy.mockRestore();
  });

  it("loads a valid VRMAnimation from ArrayBuffer via GLTFLoader", async () => {
    const mockAnim = createMockVRMAnimation();
    const parseSpy = vi
      .spyOn(GLTFLoader.prototype, "parseAsync")
      .mockResolvedValueOnce({
        scene: new THREE.Group(),
        userData: { vrmAnimations: [mockAnim] }
      } as unknown as import("three/examples/jsm/loaders/GLTFLoader.js").GLTF);

    const buffer = new ArrayBuffer(8);
    const result = await loadVRMA(buffer);
    expect(result).toBe(mockAnim);
    expect(parseSpy).toHaveBeenCalled();
    parseSpy.mockRestore();
  });

  it("throws an error when GLTF does not contain VRMAnimation data", async () => {
    const loadSpy = vi
      .spyOn(GLTFLoader.prototype, "loadAsync")
      .mockResolvedValueOnce({
        scene: new THREE.Group(),
        userData: {}
      } as unknown as import("three/examples/jsm/loaders/GLTFLoader.js").GLTF);

    await expect(loadVRMA("https://example.com/invalid.vrma")).rejects.toThrow(
      "Not a valid VRMA file"
    );
    loadSpy.mockRestore();
  });
});

describe("loadVRMAFromPathOrUrl", () => {
  beforeEach(() => {
    vi.mocked(isTauri).mockReset();
    vi.mocked(readFile).mockReset();
  });

  it("loads directly from web or blob URL without reading filesystem", async () => {
    vi.mocked(isTauri).mockReturnValue(false);
    const mockAnim = createMockVRMAnimation();
    const loadSpy = vi
      .spyOn(GLTFLoader.prototype, "loadAsync")
      .mockResolvedValueOnce({
        scene: new THREE.Group(),
        userData: { vrmAnimations: [mockAnim] }
      } as unknown as import("three/examples/jsm/loaders/GLTFLoader.js").GLTF);

    const { vrmAnimation } = await loadVRMAFromPathOrUrl(
      "https://example.com/dance.vrma"
    );
    expect(vrmAnimation).toBe(mockAnim);
    expect(loadSpy).toHaveBeenCalled();
  });

  it("reads local file in Tauri runtime and converts to Blob URL", async () => {
    vi.mocked(isTauri).mockReturnValue(true);
    vi.mocked(readFile).mockResolvedValue(new Uint8Array([1, 2, 3]));

    const mockAnim = createMockVRMAnimation();
    const loadSpy = vi
      .spyOn(GLTFLoader.prototype, "loadAsync")
      .mockResolvedValueOnce({
        scene: new THREE.Group(),
        userData: { vrmAnimations: [mockAnim] }
      } as unknown as import("three/examples/jsm/loaders/GLTFLoader.js").GLTF);

    const createObjectURLSpy = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:mock-vrma-url");
    const revokeObjectURLSpy = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => {});

    const { vrmAnimation, blobUrl } = await loadVRMAFromPathOrUrl(
      "/path/to/local.vrma"
    );

    expect(isTauri).toHaveBeenCalled();
    expect(readFile).toHaveBeenCalledWith("/path/to/local.vrma");
    expect(createObjectURLSpy).toHaveBeenCalled();
    expect(revokeObjectURLSpy).toHaveBeenCalledWith("blob:mock-vrma-url");
    expect(vrmAnimation).toBe(mockAnim);
    expect(blobUrl).toBe("blob:mock-vrma-url");

    loadSpy.mockRestore();
  });
});

describe("pickVRMAFile", () => {
  beforeEach(() => {
    vi.mocked(isTauri).mockReset();
    vi.mocked(open).mockReset();
  });

  it("returns null in non-Tauri browser environment", async () => {
    vi.mocked(isTauri).mockReturnValue(false);
    const result = await pickVRMAFile();
    expect(result).toBeNull();
  });

  it("opens native file dialog filtered to .vrma in Tauri runtime", async () => {
    vi.mocked(isTauri).mockReturnValue(true);
    vi.mocked(open).mockResolvedValue("/home/user/dance.vrma");

    const result = await pickVRMAFile();
    expect(result).toBe("/home/user/dance.vrma");
    expect(open).toHaveBeenCalledWith(
      expect.objectContaining({
        filters: [{ name: "VRM Animation", extensions: ["vrma"] }]
      })
    );
  });

  it("returns null when user cancels dialog", async () => {
    vi.mocked(isTauri).mockReturnValue(true);
    vi.mocked(open).mockResolvedValue(null);

    const result = await pickVRMAFile();
    expect(result).toBeNull();
  });
});

describe("VRMAPlayer playback & lifecycle", () => {
  let vrm: VRM;
  let player: VRMAPlayer;

  beforeEach(() => {
    vrm = createMockVRM();
    player = new VRMAPlayer(vrm);
  });

  afterEach(() => {
    player.dispose();
  });

  it("initializes with default inactive state", () => {
    expect(player.isPlaying).toBe(false);
    expect(player.activeAction).toBeNull();
    expect(player.activeAnimation).toBeNull();
    expect(player.disposed).toBe(false);
  });

  it("plays a clip with looping enabled by default", () => {
    const clip = new THREE.AnimationClip("TestClip", 1.0, []);
    const action = player.playClip(clip);

    expect(player.isPlaying).toBe(true);
    expect(player.activeAction).toBe(action);
    expect(action.loop).toBe(THREE.LoopRepeat);
    expect(action.clampWhenFinished).toBe(false);
    expect(action.timeScale).toBe(1.0);
  });

  it("plays a clip in one-shot mode when loop: false", () => {
    const clip = new THREE.AnimationClip("OneShotClip", 0.5, []);
    const action = player.playClip(clip, { loop: false, timeScale: 1.5 });

    expect(player.isPlaying).toBe(true);
    expect(action.loop).toBe(THREE.LoopOnce);
    expect(action.clampWhenFinished).toBe(true);
    expect(action.timeScale).toBe(1.5);
  });

  it("plays VRMAnimation using createVRMAnimationClip", () => {
    const mockAnim = createMockVRMAnimation();
    const clip = new THREE.AnimationClip("VRMAClip", 1.0, []);
    vi.mocked(createVRMAnimationClip).mockReturnValue(clip);

    const action = player.play(mockAnim, { loop: true });

    expect(createVRMAnimationClip).toHaveBeenCalledWith(mockAnim, vrm);
    expect(player.isPlaying).toBe(true);
    expect(player.activeAnimation).toBe(mockAnim);
    expect(player.activeAction).toBe(action);
  });

  it("crossfades smoothly when switching between clips", () => {
    const clipA = new THREE.AnimationClip("ClipA", 1.0, []);
    const clipB = new THREE.AnimationClip("ClipB", 1.0, []);

    const actionA = player.playClip(clipA);
    const fadeOutSpy = vi.spyOn(actionA, "fadeOut");
    const fadeInSpy = vi.spyOn(THREE.AnimationAction.prototype, "fadeIn");

    const actionB = player.playClip(clipB, { fadeInDuration: 0.3 });

    expect(fadeOutSpy).toHaveBeenCalledWith(0.3);
    expect(fadeInSpy).toHaveBeenCalledWith(0.3);
    expect(player.activeAction).toBe(actionB);

    fadeInSpy.mockRestore();
  });

  it("stops immediately when fadeOutDuration is 0", () => {
    const clip = new THREE.AnimationClip("TestClip", 1.0, []);
    const action = player.playClip(clip);
    const stopSpy = vi.spyOn(action, "stop");

    player.stop(0);

    expect(stopSpy).toHaveBeenCalled();
    expect(player.isPlaying).toBe(false);
    expect(player.activeAction).toBeNull();
  });

  it("fades out gradually when fadeOutDuration is specified", () => {
    const clip = new THREE.AnimationClip("FadeClip", 1.0, []);
    const action = player.playClip(clip);
    const fadeOutSpy = vi.spyOn(action, "fadeOut");

    player.stop(0.5);

    expect(fadeOutSpy).toHaveBeenCalledWith(0.5);
    // Still playing during fade out
    expect(player.activeAction).toBe(action);

    // Advance 0.25s: still active
    player.update(0.25);
    expect(player.activeAction).toBe(action);

    // Advance 0.26s: fade complete, cleared
    player.update(0.26);
    expect(player.isPlaying).toBe(false);
    expect(player.activeAction).toBeNull();
  });

  it("handles finished mixer event to clear one-shot animations", () => {
    const clip = new THREE.AnimationClip("OneShotClip", 1.0, []);
    const action = player.playClip(clip, { loop: false });

    // Simulate mixer finished event
    player.mixer.dispatchEvent({
      type: "finished",
      action,
      direction: 1
    });

    expect(player.isPlaying).toBe(false);
    expect(player.activeAction).toBeNull();
  });

  it("ignores mixer finished event from other unrelated actions", () => {
    const clip = new THREE.AnimationClip("TestClip", 1.0, []);
    const otherClip = new THREE.AnimationClip("OtherClip", 1.0, []);

    const action = player.playClip(clip);
    const otherAction = player.mixer.clipAction(otherClip);

    player.mixer.dispatchEvent({
      type: "finished",
      action: otherAction,
      direction: 1
    });

    expect(player.isPlaying).toBe(true);
    expect(player.activeAction).toBe(action);
  });

  it("advances internal mixer on update(dt)", () => {
    const mixerUpdateSpy = vi.spyOn(player.mixer, "update");
    const clip = new THREE.AnimationClip("Clip", 1.0, []);
    player.playClip(clip);

    player.update(0.016);
    expect(mixerUpdateSpy).toHaveBeenCalledWith(0.016);

    // Zero or negative delta is ignored
    player.update(0);
    player.update(-0.016);
    expect(mixerUpdateSpy).toHaveBeenCalledTimes(1);
  });

  it("disposes cleanly and prevents further playback", () => {
    const clip = new THREE.AnimationClip("Clip", 1.0, []);
    player.playClip(clip);

    player.dispose();
    expect(player.disposed).toBe(true);
    expect(player.isPlaying).toBe(false);
    expect(player.activeAction).toBeNull();

    expect(() => player.playClip(clip)).toThrow(
      "Cannot play animation on a disposed VRMAPlayer"
    );
  });
});
