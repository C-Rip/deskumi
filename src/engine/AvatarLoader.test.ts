import { describe, it, expect, vi } from "vitest";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { VRM } from "@pixiv/three-vrm";
import {
  computeBounds,
  getBoundsInfo,
  centerAndGround,
  centerAndGroundVRM,
  scaleToHeight,
  calculateCameraDistance,
  calculatePerspectiveFraming,
  calculateOrthoFraming,
  disposeObject,
  disposeVRM,
  loadVRM
} from "./AvatarLoader";

describe("AvatarLoader math & bounds utilities", () => {
  it("computeBounds calculates accurate bounding box for an Object3D", () => {
    const group = new THREE.Group();
    const geometry = new THREE.BoxGeometry(2, 4, 6);
    const material = new THREE.MeshBasicMaterial();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(1, 2, 3);
    group.add(mesh);

    const box = computeBounds(group);
    expect(box.min.x).toBeCloseTo(0);
    expect(box.max.x).toBeCloseTo(2);
    expect(box.min.y).toBeCloseTo(0);
    expect(box.max.y).toBeCloseTo(4);
    expect(box.min.z).toBeCloseTo(0);
    expect(box.max.z).toBeCloseTo(6);
  });

  it("getBoundsInfo returns box, size, and center vectors", () => {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(2, 4, 6),
      new THREE.MeshBasicMaterial()
    );
    mesh.position.set(0, 2, 0);

    const { box, size, center } = getBoundsInfo(mesh);
    expect(box.min.y).toBeCloseTo(0);
    expect(box.max.y).toBeCloseTo(4);

    expect(size.x).toBeCloseTo(2);
    expect(size.y).toBeCloseTo(4);
    expect(size.z).toBeCloseTo(6);

    expect(center.x).toBeCloseTo(0);
    expect(center.y).toBeCloseTo(2);
    expect(center.z).toBeCloseTo(0);
  });

  it("centerAndGround grounds object base at y=0 and centers horizontally", () => {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(2, 4, 2),
      new THREE.MeshBasicMaterial()
    );
    // Initially positioned off-center and floating
    mesh.position.set(10, 8, -5);

    const updatedBox = centerAndGround(mesh);

    expect(updatedBox.min.y).toBeCloseTo(0);
    expect(updatedBox.max.y).toBeCloseTo(4);
    expect(updatedBox.min.x).toBeCloseTo(-1);
    expect(updatedBox.max.x).toBeCloseTo(1);
    expect(updatedBox.min.z).toBeCloseTo(-1);
    expect(updatedBox.max.z).toBeCloseTo(1);
  });

  it("centerAndGround respects custom groundY and centerHorizontal: false", () => {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(2, 4, 2),
      new THREE.MeshBasicMaterial()
    );
    mesh.position.set(10, 5, 20);

    const updatedBox = centerAndGround(mesh, {
      groundY: -2,
      centerHorizontal: false
    });

    expect(updatedBox.min.y).toBeCloseTo(-2);
    expect(updatedBox.max.y).toBeCloseTo(2);
    // Horizontal center remained untouched
    expect((updatedBox.min.x + updatedBox.max.x) / 2).toBeCloseTo(10);
    expect((updatedBox.min.z + updatedBox.max.z) / 2).toBeCloseTo(20);
  });

  it("centerAndGround handles empty objects without crashing", () => {
    const emptyGroup = new THREE.Group();
    const box = centerAndGround(emptyGroup);
    expect(box.isEmpty()).toBe(true);
  });

  it("centerAndGroundVRM calls centerAndGround on vrm.scene", () => {
    const mockVRM = {
      scene: new THREE.Mesh(
        new THREE.BoxGeometry(2, 2, 2),
        new THREE.MeshBasicMaterial()
      )
    } as unknown as VRM;
    mockVRM.scene.position.set(5, 5, 5);

    const box = centerAndGroundVRM(mockVRM);
    expect(box.min.y).toBeCloseTo(0);
    expect(box.max.y).toBeCloseTo(2);
  });

  it("scaleToHeight scales object to desired height", () => {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(2, 4, 2),
      new THREE.MeshBasicMaterial()
    );
    const factor = scaleToHeight(mesh, 2.0);

    expect(factor).toBeCloseTo(0.5);
    const box = computeBounds(mesh);
    expect(box.max.y - box.min.y).toBeCloseTo(2.0);
  });

  it("scaleToHeight throws on non-positive target height", () => {
    const mesh = new THREE.Mesh();
    expect(() => scaleToHeight(mesh, 0)).toThrow(
      "targetHeight must be positive"
    );
    expect(() => scaleToHeight(mesh, -1)).toThrow(
      "targetHeight must be positive"
    );
  });

  it("scaleToHeight returns 1 for flat/empty objects", () => {
    const group = new THREE.Group();
    const factor = scaleToHeight(group, 2.0);
    expect(factor).toBe(1);
  });
});

describe("Camera framing calculations", () => {
  it("calculateCameraDistance computes trigonometric distance", () => {
    // Height = 2, FOV = 60 deg, margin = 1.0:
    // fov/2 = 30 deg, tan(30) = 1 / sqrt(3) ≈ 0.577350269
    // distance = (2 / 2) / 0.577350269 = sqrt(3) ≈ 1.7320508
    const distExact = calculateCameraDistance(2.0, 60, 1.0);
    expect(distExact).toBeCloseTo(Math.sqrt(3), 5);

    // With 10% margin
    const distWithMargin = calculateCameraDistance(2.0, 60, 1.1);
    expect(distWithMargin).toBeCloseTo(Math.sqrt(3) * 1.1, 5);
  });

  it("calculateCameraDistance handles edge conditions", () => {
    expect(calculateCameraDistance(0, 60)).toBe(0);
    expect(calculateCameraDistance(-5, 60)).toBe(0);
    expect(() => calculateCameraDistance(2, 0)).toThrow(
      "fovDegrees must be in (0, 180)"
    );
    expect(() => calculateCameraDistance(2, 180)).toThrow(
      "fovDegrees must be in (0, 180)"
    );
  });

  it("calculatePerspectiveFraming outputs correct target and position", () => {
    const box = new THREE.Box3(
      new THREE.Vector3(-1, 0, -1),
      new THREE.Vector3(1, 2, 1)
    );

    const framing = calculatePerspectiveFraming(box, 60, 1.0);
    expect(framing.target.x).toBeCloseTo(0);
    expect(framing.target.y).toBeCloseTo(1);
    expect(framing.target.z).toBeCloseTo(0);

    expect(framing.distance).toBeCloseTo(Math.sqrt(3), 5);
    expect(framing.cameraPosition.x).toBeCloseTo(0);
    expect(framing.cameraPosition.y).toBeCloseTo(1);
    expect(framing.cameraPosition.z).toBeCloseTo(Math.sqrt(3), 5);
  });

  it("calculateOrthoFraming calculates symmetric frustum", () => {
    const box = new THREE.Box3(
      new THREE.Vector3(-0.5, 0, -0.5),
      new THREE.Vector3(0.5, 2, 0.5)
    );
    // Height is 2. Aspect is 0.5 (e.g. 300x600 window). Margin 1.0.
    const frustum = calculateOrthoFraming(box, 0.5, 1.0);

    expect(frustum.top).toBeCloseTo(1.0);
    expect(frustum.bottom).toBeCloseTo(-1.0);
    expect(frustum.right).toBeCloseTo(0.5);
    expect(frustum.left).toBeCloseTo(-0.5);
    expect(frustum.target.y).toBeCloseTo(1.0);
  });

  it("calculateOrthoFraming rejects non-positive aspect ratio", () => {
    const box = new THREE.Box3();
    expect(() => calculateOrthoFraming(box, 0)).toThrow(
      "aspect must be positive"
    );
  });
});

describe("Disposal and cleanup", () => {
  it("disposeObject removes object from parent and disposes resources", () => {
    const parent = new THREE.Scene();
    const geometry = new THREE.BufferGeometry();
    const material = new THREE.MeshBasicMaterial();
    const texture = new THREE.Texture();
    material.map = texture;

    const geoSpy = vi.spyOn(geometry, "dispose");
    const matSpy = vi.spyOn(material, "dispose");
    const texSpy = vi.spyOn(texture, "dispose");

    const mesh = new THREE.Mesh(geometry, material);
    parent.add(mesh);

    expect(parent.children.length).toBe(1);
    disposeObject(mesh);
    expect(parent.children.length).toBe(0);
    expect(geoSpy).toHaveBeenCalled();
    expect(matSpy).toHaveBeenCalled();
    expect(texSpy).toHaveBeenCalled();
  });

  it("disposeVRM delegates to disposeObject on vrm.scene", () => {
    const parent = new THREE.Scene();
    const mesh = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial()
    );
    parent.add(mesh);

    const mockVRM = {
      scene: mesh
    } as unknown as VRM;

    disposeVRM(mockVRM);
    expect(parent.children.length).toBe(0);
  });
});

describe("loadVRM validation and pipeline", () => {
  it("rejects when GLTF from URL does not contain VRM metadata", async () => {
    const loadSpy = vi
      .spyOn(GLTFLoader.prototype, "loadAsync")
      .mockResolvedValueOnce({
        scene: new THREE.Group(),
        userData: {}
      } as unknown as import("three/examples/jsm/loaders/GLTFLoader.js").GLTF);

    await expect(loadVRM("https://example.com/test.glb")).rejects.toThrow(
      "Not a valid VRM model"
    );
    expect(loadSpy).toHaveBeenCalled();
    loadSpy.mockRestore();
  });

  it("rejects when GLTF from ArrayBuffer does not contain VRM metadata", async () => {
    const parseSpy = vi
      .spyOn(GLTFLoader.prototype, "parseAsync")
      .mockResolvedValueOnce({
        scene: new THREE.Group(),
        userData: {}
      } as unknown as import("three/examples/jsm/loaders/GLTFLoader.js").GLTF);

    await expect(loadVRM(new ArrayBuffer(16))).rejects.toThrow(
      "Not a valid VRM model"
    );
    expect(parseSpy).toHaveBeenCalled();
    parseSpy.mockRestore();
  });

  it("processes and returns VRM when valid VRM model is loaded", async () => {
    const scene = new THREE.Group();
    const mesh = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial()
    );
    mesh.frustumCulled = true;
    scene.add(mesh);

    const mockVRM = {
      scene,
      humanoid: {}
    } as unknown as VRM;

    const loadSpy = vi
      .spyOn(GLTFLoader.prototype, "loadAsync")
      .mockResolvedValueOnce({
        scene,
        userData: { vrm: mockVRM }
      } as unknown as import("three/examples/jsm/loaders/GLTFLoader.js").GLTF);

    const result = await loadVRM("https://example.com/valid.vrm");

    expect(result).toBe(mockVRM);
    // Verifies frustumCulled was set to false on all nodes
    expect(mesh.frustumCulled).toBe(false);
    expect(scene.frustumCulled).toBe(false);

    loadSpy.mockRestore();
  });
});
