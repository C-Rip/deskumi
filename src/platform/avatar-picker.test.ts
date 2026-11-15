import { describe, it, expect, vi, beforeEach } from "vitest";
import * as THREE from "three";
import type { VRM } from "@pixiv/three-vrm";
import { isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import {
  pickVRMAFile,
  setupAvatarInScene,
  teardownAvatarContext
} from "./avatar-picker";
import type { SceneManager } from "../engine/SceneManager";

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: vi.fn(() => false)
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn()
}));

function createMockVRM(): VRM {
  const scene = new THREE.Group();
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial()
  );
  scene.add(mesh);

  return {
    scene,
    humanoid: null,
    expressionManager: null
  } as unknown as VRM;
}

function createMockSceneManager(): SceneManager {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 400 / 600, 0.1, 100);
  const renderer = {
    getRenderTarget: vi.fn(),
    getClearColor: vi.fn().mockReturnValue(new THREE.Color(0, 0, 0)),
    getClearAlpha: vi.fn().mockReturnValue(0),
    setRenderTarget: vi.fn(),
    setClearColor: vi.fn(),
    clear: vi.fn(),
    render: vi.fn(),
    readRenderTargetPixels: vi.fn()
  } as unknown as THREE.WebGLRenderer;

  const registeredSystems: unknown[] = [];

  return {
    scene,
    camera,
    renderer,
    registerSystem: vi
      .fn()
      .mockImplementation((sys) => registeredSystems.push(sys)),
    unregisterSystem: vi.fn().mockImplementation((sys) => {
      const idx = registeredSystems.indexOf(sys);
      if (idx !== -1) registeredSystems.splice(idx, 1);
    })
  } as unknown as SceneManager;
}

describe("avatar-picker lifecycle", () => {
  it("sets up and registers all systems for an avatar", () => {
    const vrm = createMockVRM();
    const sceneManager = createMockSceneManager();

    const context = setupAvatarInScene(vrm, sceneManager, "blob:fake-url");

    expect(context.vrm).toBe(vrm);
    expect(context.blobUrl).toBe("blob:fake-url");
    expect(sceneManager.scene.children).toContain(vrm.scene);
    expect(sceneManager.registerSystem).toHaveBeenCalledTimes(4); // lookAt, anim, inputRegion, reaction
  });

  it("tears down an existing avatar context and revokes blob URL", () => {
    const vrm = createMockVRM();
    const sceneManager = createMockSceneManager();
    const revokeSpy = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => {});

    const context = setupAvatarInScene(vrm, sceneManager, "blob:fake-url");
    expect(sceneManager.scene.children).toContain(vrm.scene);

    teardownAvatarContext(context, sceneManager);

    expect(sceneManager.scene.children).not.toContain(vrm.scene);
    expect(sceneManager.unregisterSystem).toHaveBeenCalledTimes(4);
    expect(revokeSpy).toHaveBeenCalledWith("blob:fake-url");

    revokeSpy.mockRestore();
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
