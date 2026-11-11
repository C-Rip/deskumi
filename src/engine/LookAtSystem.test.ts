import { describe, it, expect, vi } from "vitest";
import * as THREE from "three";
import type { VRM } from "@pixiv/three-vrm";
import {
  calcNdcFromMouse,
  calcYawPitchFromOffset,
  clampAngle,
  clampAngles,
  calcTargetPlanePosition,
  LookAtSystem
} from "./LookAtSystem";

/**
 * Creates a mock VRM model with configurable head/neck bones and lookAt component.
 */
function createMockVRM(hasNeck = true): {
  vrm: VRM;
  headNode: THREE.Object3D;
  neckNode: THREE.Object3D | null;
  lookAtTarget: THREE.Object3D | null;
  lookAtUpdateSpy: ReturnType<typeof vi.fn>;
} {
  const headNode = new THREE.Object3D();
  headNode.name = "head";
  headNode.position.set(0, 1.5, 0);

  const neckNode = hasNeck ? new THREE.Object3D() : null;
  if (neckNode) {
    neckNode.name = "neck";
    neckNode.position.set(0, 1.3, 0);
    neckNode.add(headNode);
  }

  const vrmScene = new THREE.Group();
  if (neckNode) {
    vrmScene.add(neckNode);
  } else {
    vrmScene.add(headNode);
  }

  const boneMap: Record<string, THREE.Object3D | null> = {
    head: headNode,
    neck: neckNode
  };

  const lookAtUpdateSpy = vi.fn();
  let assignedTarget: THREE.Object3D | null = null;

  const mockLookAt = {
    get target() {
      return assignedTarget;
    },
    set target(val: THREE.Object3D | null) {
      assignedTarget = val;
    },
    autoUpdate: true,
    update: lookAtUpdateSpy,
    getLookAtWorldPosition: (out: THREE.Vector3) => {
      headNode.getWorldPosition(out);
      return out;
    }
  };

  const mockVRM = {
    scene: vrmScene,
    humanoid: {
      getNormalizedBoneNode: (name: string) => boneMap[name] ?? null,
      getRawBoneNode: () => null
    },
    lookAt: mockLookAt,
    update: vi.fn()
  } as unknown as VRM;

  return {
    vrm: mockVRM,
    headNode,
    neckNode,
    get lookAtTarget() {
      return assignedTarget;
    },
    lookAtUpdateSpy
  };
}

describe("LookAt pure math & coordinate projection utilities", () => {
  it("calcNdcFromMouse maps pixel coordinates correctly to [-1, 1]", () => {
    // Top-left: (0, 0) -> NDC (-1, 1)
    const topLeft = calcNdcFromMouse(0, 0, 800, 600);
    expect(topLeft.x).toBeCloseTo(-1);
    expect(topLeft.y).toBeCloseTo(1);

    // Center: (400, 300) -> NDC (0, 0)
    const center = calcNdcFromMouse(400, 300, 800, 600);
    expect(center.x).toBeCloseTo(0);
    expect(center.y).toBeCloseTo(0);

    // Bottom-right: (800, 600) -> NDC (1, -1)
    const bottomRight = calcNdcFromMouse(800, 600, 800, 600);
    expect(bottomRight.x).toBeCloseTo(1);
    expect(bottomRight.y).toBeCloseTo(-1);
  });

  it("calcNdcFromMouse clamps coordinates to [-1, 1] range", () => {
    const outMin = calcNdcFromMouse(-200, -100, 800, 600);
    expect(outMin.x).toBe(-1);
    expect(outMin.y).toBe(1);

    const outMax = calcNdcFromMouse(1200, 900, 800, 600);
    expect(outMax.x).toBe(1);
    expect(outMax.y).toBe(-1);
  });

  it("calcNdcFromMouse handles zero or negative dimensions safely", () => {
    expect(calcNdcFromMouse(100, 100, 0, 600)).toEqual({ x: 0, y: 0 });
    expect(calcNdcFromMouse(100, 100, 800, 0)).toEqual({ x: 0, y: 0 });
    expect(calcNdcFromMouse(100, 100, -10, -10)).toEqual({ x: 0, y: 0 });
  });

  it("calcYawPitchFromOffset calculates proper orientation angles", () => {
    // Looking straight ahead (+Z)
    const straight = calcYawPitchFromOffset(0, 0, 1);
    expect(straight.yaw).toBeCloseTo(0);
    expect(straight.pitch).toBeCloseTo(0);

    // Looking 45° right (+X)
    const right = calcYawPitchFromOffset(1, 0, 1);
    expect(right.yaw).toBeCloseTo(Math.PI / 4);
    expect(right.pitch).toBeCloseTo(0);

    // Looking 45° left (-X)
    const left = calcYawPitchFromOffset(-1, 0, 1);
    expect(left.yaw).toBeCloseTo(-Math.PI / 4);
    expect(left.pitch).toBeCloseTo(0);

    // Looking 45° up (+Y) -> Three.js Euler X is negative for tilting up
    const up = calcYawPitchFromOffset(0, 1, 1);
    expect(up.yaw).toBeCloseTo(0);
    expect(up.pitch).toBeCloseTo(-Math.PI / 4);

    // Looking 45° down (-Y) -> Three.js Euler X is positive for tilting down
    const down = calcYawPitchFromOffset(0, -1, 1);
    expect(down.yaw).toBeCloseTo(0);
    expect(down.pitch).toBeCloseTo(Math.PI / 4);
  });

  it("calcYawPitchFromOffset guards against division by zero and negative dz", () => {
    const behind = calcYawPitchFromOffset(0, 0, -1);
    expect(Number.isFinite(behind.yaw)).toBe(true);
    expect(Number.isFinite(behind.pitch)).toBe(true);
  });

  it("clampAngle bounds angles strictly within [-limit, limit]", () => {
    const limit = Math.PI / 6; // 30 degrees ≈ 0.5236 rad

    expect(clampAngle(0.2, limit)).toBeCloseTo(0.2);
    expect(clampAngle(1.0, limit)).toBeCloseTo(limit);
    expect(clampAngle(-1.0, limit)).toBeCloseTo(-limit);
    expect(clampAngle(-limit, limit)).toBeCloseTo(-limit);
    expect(clampAngle(limit, limit)).toBeCloseTo(limit);
  });

  it("clampAngles clamps yaw and pitch simultaneously", () => {
    const maxYaw = 0.5;
    const maxPitch = 0.4;
    const result = clampAngles(0.9, -0.8, maxYaw, maxPitch);

    expect(result.yaw).toBeCloseTo(0.5);
    expect(result.pitch).toBeCloseTo(-0.4);
  });

  it("calcTargetPlanePosition unprojects NDC onto plane in front of avatar", () => {
    const camera = new THREE.PerspectiveCamera(60, 1.0, 0.1, 100);
    camera.position.set(0, 1.5, 3.0);
    camera.lookAt(0, 1.5, 0);
    camera.updateMatrixWorld(true);

    const headPos = new THREE.Vector3(0, 1.5, 0);
    const targetDistance = 1.0;
    const out = new THREE.Vector3();

    // Center of screen (NDC 0, 0)
    calcTargetPlanePosition(
      camera,
      { x: 0, y: 0 },
      headPos,
      targetDistance,
      out
    );

    expect(out.x).toBeCloseTo(0, 2);
    expect(out.y).toBeCloseTo(1.5, 2);
    expect(out.z).toBeCloseTo(1.0, 2); // 1m in front of head along camera normal

    // Right of screen (NDC 0.5, 0)
    calcTargetPlanePosition(
      camera,
      { x: 0.5, y: 0 },
      headPos,
      targetDistance,
      out
    );
    expect(out.x).toBeGreaterThan(0);
    expect(out.z).toBeCloseTo(1.0, 2);
  });
});

describe("LookAtSystem initialization and setup", () => {
  it("initializes target Object3D, hooks vrm.lookAt, and adds to scene if provided", () => {
    const { vrm } = createMockVRM();
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 10);
    camera.position.set(0, 1.5, 3);
    camera.lookAt(0, 1.5, 0);
    camera.updateMatrixWorld(true);

    const scene = new THREE.Scene();
    const system = new LookAtSystem(vrm, {
      camera,
      scene,
      targetDistance: 1.2
    });

    expect(vrm.lookAt?.target).toBe(system.target);
    expect(system.target.name).toBe("LookAtTarget");
    expect(scene.children).toContain(system.target);
    expect(system.targetDistance).toBe(1.2);
    expect(system.disposed).toBe(false);

    system.dispose();
  });

  it("stores initial bone rotations and preserves them on initialization", () => {
    const { vrm, headNode, neckNode } = createMockVRM(true);
    headNode.rotation.set(0.1, 0.2, 0.3);
    if (neckNode) {
      neckNode.rotation.set(0.05, 0.05, 0.05);
    }

    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 10);
    camera.position.set(0, 1.5, 3);
    camera.lookAt(0, 1.5, 0);

    const system = new LookAtSystem(vrm, { camera });

    // Initial rotations match baseline before movement
    expect(headNode.rotation.x).toBeCloseTo(0.1);
    expect(headNode.rotation.y).toBeCloseTo(0.2);
    if (neckNode) {
      expect(neckNode.rotation.x).toBeCloseTo(0.05);
    }

    system.dispose();
  });
});

describe("LookAtSystem tracking, damping, and angular clamp", () => {
  it("rotates head and neck smoothly toward pointer with clamp (±30°)", () => {
    const { vrm, headNode, neckNode } = createMockVRM(true);
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 10);
    camera.position.set(0, 1.5, 3);
    camera.lookAt(0, 1.5, 0);
    camera.updateMatrixWorld(true);

    const maxYaw = Math.PI / 6; // 30 degrees ≈ 0.5236 rad
    const maxPitch = Math.PI / 6;

    const system = new LookAtSystem(vrm, {
      camera,
      maxYaw,
      maxPitch,
      neckWeight: 0.3,
      damping: 100.0 // High damping for quick convergence in test
    });

    // Move cursor far to the right (NDC x = 1.0)
    system.setCursorNdc(1.0, 0);
    system.update(0.1);

    // Total yaw applied should be clamped to maxYaw (±30°)
    expect(system.lastYaw).toBeLessThanOrEqual(maxYaw + 1e-4);
    expect(system.lastYaw).toBeGreaterThan(0.2);

    // Distributed between neck (30%) and head (70%)
    if (neckNode) {
      expect(neckNode.rotation.y).toBeCloseTo(system.lastYaw * 0.3, 3);
    }
    expect(headNode.rotation.y).toBeCloseTo(system.lastYaw * 0.7, 3);

    // Sum of neck + head rotation equals total clamped yaw
    const totalYaw = (neckNode ? neckNode.rotation.y : 0) + headNode.rotation.y;
    expect(totalYaw).toBeCloseTo(system.lastYaw, 3);
    expect(totalYaw).toBeLessThanOrEqual(maxYaw + 1e-4);

    system.dispose();
  });

  it("handles VRMs without neck bone by assigning 100% rotation to head", () => {
    const { vrm, headNode } = createMockVRM(false);
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 10);
    camera.position.set(0, 1.5, 3);
    camera.lookAt(0, 1.5, 0);
    camera.updateMatrixWorld(true);

    const system = new LookAtSystem(vrm, {
      camera,
      damping: 100.0
    });

    system.setCursorNdc(0.8, 0);
    system.update(0.1);

    expect(headNode.rotation.y).toBeCloseTo(system.lastYaw, 3);
    system.dispose();
  });

  it("lerp damping smooths movement across frames", () => {
    const { vrm } = createMockVRM();
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 10);
    camera.position.set(0, 1.5, 3);
    camera.lookAt(0, 1.5, 0);
    camera.updateMatrixWorld(true);

    const system = new LookAtSystem(vrm, {
      camera,
      damping: 2.0 // Slow damping to observe progression
    });

    system.setCursorNdc(0.8, 0.5);

    // First small frame
    system.update(0.016);
    const firstPosX = system.currentTargetPos.x;
    expect(firstPosX).toBeGreaterThan(0);

    // Second small frame
    system.update(0.016);
    const secondPosX = system.currentTargetPos.x;
    expect(secondPosX).toBeGreaterThan(firstPosX);

    // Third frame with sufficient time to converge
    system.update(2.0);
    expect(system.currentTargetPos.x).toBeCloseTo(
      system.desiredTargetPos.x,
      1e-3
    );

    system.dispose();
  });
});

describe("Neutral return on mouseleave and inactivity", () => {
  it("smoothly returns to neutral front position when cursor leaves window", () => {
    const { vrm, headNode } = createMockVRM(true);
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 10);
    camera.position.set(0, 1.5, 3);
    camera.lookAt(0, 1.5, 0);
    camera.updateMatrixWorld(true);

    const system = new LookAtSystem(vrm, {
      camera,
      damping: 50.0
    });

    // 1. Move to right
    system.setCursorNdc(0.8, 0);
    system.update(0.2);
    expect(system.lastYaw).toBeGreaterThan(0.2);

    // 2. Mouse leaves window
    system.setMouseOutside(true);
    expect(system.isIdle).toBe(true);

    // 3. Update engine loop to allow damping back to neutral
    system.update(0.5);

    expect(system.lastYaw).toBeCloseTo(0, 2);
    expect(headNode.rotation.y).toBeCloseTo(0, 2);

    system.dispose();
  });

  it("smoothly returns to neutral position after idle timeout", () => {
    const { vrm, headNode } = createMockVRM(true);
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 10);
    camera.position.set(0, 1.5, 3);
    camera.lookAt(0, 1.5, 0);
    camera.updateMatrixWorld(true);

    const system = new LookAtSystem(vrm, {
      camera,
      idleTimeout: 2.0,
      damping: 50.0
    });

    // 1. Cursor moves
    system.setCursorNdc(0.6, 0.4);
    system.update(0.1);
    expect(system.isIdle).toBe(false);

    // 2. Advance time past idle timeout (e.g. 2.1s)
    system.update(2.1);
    expect(system.isIdle).toBe(true);

    // Target smoothly returns to neutral
    expect(system.lastYaw).toBeCloseTo(0, 2);
    expect(system.lastPitch).toBeCloseTo(0, 2);
    expect(headNode.rotation.y).toBeCloseTo(0, 2);

    system.dispose();
  });

  it("resetToNeutral immediately restores front target and zero angles", () => {
    const { vrm, headNode } = createMockVRM(true);
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 10);
    camera.position.set(0, 1.5, 3);
    camera.lookAt(0, 1.5, 0);
    camera.updateMatrixWorld(true);

    const system = new LookAtSystem(vrm, { camera, damping: 50.0 });
    system.setCursorNdc(0.8, 0.8);
    system.update(0.1);
    expect(system.lastYaw).toBeGreaterThan(0.1);

    system.resetToNeutral();
    expect(system.lastYaw).toBe(0);
    expect(system.lastPitch).toBe(0);
    expect(headNode.rotation.y).toBeCloseTo(0);

    system.dispose();
  });
});

describe("DOM mouse listeners and event integration", () => {
  it("processes synthetic mousemove and mouseleave events", () => {
    const { vrm } = createMockVRM();
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 10);
    camera.position.set(0, 1.5, 3);
    camera.lookAt(0, 1.5, 0);
    camera.updateMatrixWorld(true);

    const dummyElement = new THREE.EventDispatcher() as unknown as HTMLElement;
    const listeners = new Map<string, (e: unknown) => void>();
    dummyElement.addEventListener = (
      type: string,
      listener: (e: unknown) => void
    ) => {
      listeners.set(type, listener);
    };
    dummyElement.removeEventListener = (type: string) => {
      listeners.delete(type);
    };
    Object.defineProperty(dummyElement, "clientWidth", { value: 800 });
    Object.defineProperty(dummyElement, "clientHeight", { value: 600 });

    const system = new LookAtSystem(vrm, {
      camera,
      targetElement: dummyElement,
      damping: 50.0
    });

    // Simulate mousemove to center-right (600, 300) -> NDC (0.5, 0)
    const moveFn = listeners.get("mousemove");
    expect(moveFn).toBeDefined();
    moveFn?.({ clientX: 600, clientY: 300 } as MouseEvent);

    system.update(0.1);
    expect(system.isIdle).toBe(false);
    expect(system.lastYaw).toBeGreaterThan(0.1);

    // Simulate mouseleave
    const leaveFn = listeners.get("mouseleave");
    expect(leaveFn).toBeDefined();
    leaveFn?.({} as MouseEvent);

    expect(system.isIdle).toBe(true);

    system.dispose();
    expect(listeners.size).toBe(0);
  });
});

describe("Disposal and cleanup", () => {
  it("restores original bone rotations, detaches target, and ignores further updates", () => {
    const { vrm, headNode, neckNode } = createMockVRM(true);
    headNode.rotation.set(0.01, 0.02, 0.03);
    if (neckNode) {
      neckNode.rotation.set(0.04, 0.05, 0.06);
    }

    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 10);
    camera.position.set(0, 1.5, 3);
    camera.lookAt(0, 1.5, 0);
    camera.updateMatrixWorld(true);

    const scene = new THREE.Scene();
    const system = new LookAtSystem(vrm, {
      camera,
      scene,
      damping: 100.0
    });

    // Cause some rotation
    system.setCursorNdc(0.7, -0.4);
    system.update(0.1);
    expect(headNode.rotation.y).not.toBeCloseTo(0.02);

    // Dispose
    system.dispose();
    expect(system.disposed).toBe(true);

    // Rotations restored
    expect(headNode.rotation.x).toBeCloseTo(0.01);
    expect(headNode.rotation.y).toBeCloseTo(0.02);
    expect(headNode.rotation.z).toBeCloseTo(0.03);
    if (neckNode) {
      expect(neckNode.rotation.x).toBeCloseTo(0.04);
      expect(neckNode.rotation.y).toBeCloseTo(0.05);
      expect(neckNode.rotation.z).toBeCloseTo(0.06);
    }

    // VRM lookAt target cleared
    expect(vrm.lookAt?.target).toBeNull();

    // Scene removed target
    expect(scene.children).not.toContain(system.target);

    // Further updates do nothing
    system.update(0.1);
    expect(headNode.rotation.y).toBeCloseTo(0.02);
  });
});
