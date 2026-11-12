import { describe, it, expect, vi } from "vitest";
import * as THREE from "three";
import type { VRM } from "@pixiv/three-vrm";
import { BlinkController } from "./BlinkController";
import { AnimationSystem } from "./AnimationSystem";

/**
 * Creates a mocked VRM instance with controllable bone nodes and expression manager.
 */
function createMockVRM(): {
  vrm: VRM;
  chestNode: THREE.Object3D;
  hipsNode: THREE.Object3D;
  leftUpperArmNode: THREE.Object3D;
  rightUpperArmNode: THREE.Object3D;
  expressionValues: Map<string, number>;
  updateSpy: ReturnType<typeof vi.fn>;
} {
  const chestNode = new THREE.Object3D();
  const hipsNode = new THREE.Object3D();
  const leftUpperArmNode = new THREE.Object3D();
  const rightUpperArmNode = new THREE.Object3D();

  const boneMap: Record<string, THREE.Object3D> = {
    chest: chestNode,
    hips: hipsNode,
    leftUpperArm: leftUpperArmNode,
    rightUpperArm: rightUpperArmNode
  };

  const expressionValues = new Map<string, number>();
  const updateSpy = vi.fn();

  const mockVRM = {
    scene: new THREE.Group(),
    humanoid: {
      getNormalizedBoneNode: (name: string) => boneMap[name] ?? null,
      getRawBoneNode: () => null
    },
    expressionManager: {
      setValue: (name: string, value: number) => {
        expressionValues.set(name, value);
      },
      getValue: (name: string) => expressionValues.get(name) ?? 0,
      update: vi.fn()
    },
    update: updateSpy
  } as unknown as VRM;

  return {
    vrm: mockVRM,
    chestNode,
    hipsNode,
    leftUpperArmNode,
    rightUpperArmNode,
    expressionValues,
    updateSpy
  };
}

describe("BlinkController state machine and timing logic", () => {
  it("initializes in open state with value 0 within interval bounds", () => {
    const controller = new BlinkController({
      minInterval: 2.0,
      maxInterval: 4.0,
      random: () => 0.5
    });

    expect(controller.state).toBe("open");
    expect(controller.value).toBe(0);
    expect(controller.elapsedInState).toBe(0);
    expect(controller.nextInterval).toBeCloseTo(3.0);
    expect(controller.isDoubleBlink).toBe(false);
  });

  it("progresses through open -> closing -> closed -> opening -> open", () => {
    // Deterministic random returning 1.0 (no double blink, nextInterval = 2.0)
    const controller = new BlinkController({
      minInterval: 2.0,
      maxInterval: 2.0,
      closingDuration: 0.06,
      closedDuration: 0.04,
      openingDuration: 0.08,
      doubleBlinkChance: 0,
      random: () => 1.0
    });

    // 1. Advance partially in open state (1.0s of 2.0s)
    let val = controller.update(1.0);
    expect(controller.state).toBe("open");
    expect(val).toBe(0);
    expect(controller.elapsedInState).toBeCloseTo(1.0);

    // 2. Advance past open interval (1.0s + 0.03s -> enters closing, 0.03s in)
    val = controller.update(1.03);
    expect(controller.state).toBe("closing");
    expect(controller.elapsedInState).toBeCloseTo(0.03);
    // Closing progress: 0.03 / 0.06 = 0.5
    expect(val).toBeCloseTo(0.5);

    // 3. Advance into closed state (0.03s to finish closing + 0.02s in closed)
    val = controller.update(0.05);
    expect(controller.state).toBe("closed");
    expect(controller.elapsedInState).toBeCloseTo(0.02);
    expect(val).toBe(1.0);

    // 4. Advance into opening state (0.02s to finish closed + 0.04s in opening)
    val = controller.update(0.06);
    expect(controller.state).toBe("opening");
    expect(controller.elapsedInState).toBeCloseTo(0.04);
    // Opening progress: 1 - (0.04 / 0.08) = 0.5
    expect(val).toBeCloseTo(0.5);

    // 5. Complete opening cycle and return to open
    val = controller.update(0.04);
    expect(controller.state).toBe("open");
    expect(controller.elapsedInState).toBeCloseTo(0);
    expect(val).toBe(0);
  });

  it("triggers double blink sequence when random is below doubleBlinkChance", () => {
    let roll = 0.05; // 5% < 15% doubleBlinkChance
    const controller = new BlinkController({
      minInterval: 3.0,
      maxInterval: 3.0,
      closingDuration: 0.06,
      closedDuration: 0.04,
      openingDuration: 0.08,
      doubleBlinkChance: 0.15,
      doubleBlinkDelay: 0.1,
      random: () => roll
    });

    // Advance through entire first blink (3.0s open + 0.06s + 0.04s + 0.08s = 3.18s)
    controller.update(3.18);
    expect(controller.state).toBe("open");
    expect(controller.isDoubleBlink).toBe(true);
    expect(controller.nextInterval).toBeCloseTo(0.1);

    // Advance through the rapid second blink (0.1s wait + 0.18s blink = 0.28s)
    roll = 0.01; // Even if roll is low, second blink cannot immediately double blink
    controller.update(0.28);
    expect(controller.state).toBe("open");
    expect(controller.isDoubleBlink).toBe(false);
    expect(controller.nextInterval).toBeCloseTo(3.0);
  });

  it("triggerBlink immediately enters closing state from open", () => {
    const controller = new BlinkController({
      minInterval: 10.0,
      maxInterval: 10.0
    });

    expect(controller.state).toBe("open");
    controller.triggerBlink();
    expect(controller.state).toBe("closing");
    expect(controller.elapsedInState).toBe(0);
    expect(controller.value).toBe(0);
  });

  it("reset restores controller back to initial open state", () => {
    const controller = new BlinkController({
      minInterval: 2.0,
      maxInterval: 4.0,
      random: () => 0.5
    });

    controller.triggerBlink();
    controller.update(0.08); // is now closed
    expect(controller.state).toBe("closed");

    controller.reset();
    expect(controller.state).toBe("open");
    expect(controller.value).toBe(0);
    expect(controller.elapsedInState).toBe(0);
    expect(controller.nextInterval).toBeCloseTo(3.0);
  });

  it("handles non-positive dt gracefully without state progression", () => {
    const controller = new BlinkController();
    const val0 = controller.update(0);
    const valNeg = controller.update(-0.016);
    expect(val0).toBe(0);
    expect(valNeg).toBe(0);
    expect(controller.elapsedInState).toBe(0);
  });

  it("handles large delta times in a single frame without crashing", () => {
    const controller = new BlinkController({
      minInterval: 1.0,
      maxInterval: 1.0,
      random: () => 0.5
    });

    // 10 seconds in a single tick
    const val = controller.update(10.0);
    expect(val).toBeGreaterThanOrEqual(0);
    expect(val).toBeLessThanOrEqual(1);
    expect(Number.isFinite(controller.elapsedInState)).toBe(true);
  });
});

describe("AnimationSystem procedural motion and integration", () => {
  it("relaxes arms into A-pose on initialization by default", () => {
    const { vrm, leftUpperArmNode, rightUpperArmNode } = createMockVRM();

    new AnimationSystem(vrm, {
      relaxArms: true,
      leftArmAngleZ: -1.2,
      rightArmAngleZ: 1.2
    });

    expect(leftUpperArmNode.rotation.z).toBeCloseTo(-1.2);
    expect(rightUpperArmNode.rotation.z).toBeCloseTo(1.2);
  });

  it("preserves initial bone rotations when relaxArms is false", () => {
    const { vrm, leftUpperArmNode, rightUpperArmNode } = createMockVRM();
    leftUpperArmNode.rotation.z = -0.5;
    rightUpperArmNode.rotation.z = 0.5;

    new AnimationSystem(vrm, {
      relaxArms: false
    });

    expect(leftUpperArmNode.rotation.z).toBeCloseTo(-0.5);
    expect(rightUpperArmNode.rotation.z).toBeCloseTo(0.5);
  });

  it("executes procedural breathing, hip sway, and calls vrm.update(dt) on update", () => {
    const {
      vrm,
      chestNode,
      hipsNode,
      leftUpperArmNode,
      rightUpperArmNode,
      updateSpy
    } = createMockVRM();

    const system = new AnimationSystem(vrm, {
      breathingSpeed: 2.0,
      breathingAmplitude: 0.05,
      swaySpeed: 1.0,
      swayAmplitude: 0.02
    });

    // Advance 0.5 seconds
    system.update(0.5);

    expect(system.time).toBeCloseTo(0.5);
    // Chest rotation X = sin(0.5 * 2.0) * 0.05 = sin(1.0) * 0.05
    expect(chestNode.rotation.x).toBeCloseTo(Math.sin(1.0) * 0.05);
    // Hips rotation Z = sin(0.5 * 1.0) * 0.02 = sin(0.5) * 0.02
    expect(hipsNode.rotation.z).toBeCloseTo(Math.sin(0.5) * 0.02);
    // Arms remain relaxed
    expect(leftUpperArmNode.rotation.z).toBeCloseTo(-1.2);
    expect(rightUpperArmNode.rotation.z).toBeCloseTo(1.2);

    // Confirms secondary physics update
    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(updateSpy).toHaveBeenCalledWith(0.5);
  });

  it("updates blink expression weight on vrm.expressionManager", () => {
    const { vrm, expressionValues } = createMockVRM();
    const system = new AnimationSystem(vrm, {
      blinkOptions: {
        minInterval: 1.0,
        maxInterval: 1.0,
        closingDuration: 0.1,
        random: () => 0
      }
    });

    // Advance into closing state (1.0s open + 0.05s closing -> weight = 0.5)
    system.update(1.05);

    expect(expressionValues.has("blink")).toBe(true);
    expect(expressionValues.get("blink")).toBeCloseTo(0.5);
  });

  it("does not apply breathing or sway when enableIdle is false", () => {
    const { vrm, chestNode, hipsNode } = createMockVRM();
    chestNode.rotation.x = 0;
    hipsNode.rotation.z = 0;

    const system = new AnimationSystem(vrm, {
      enableIdle: false
    });

    system.update(1.0);

    expect(chestNode.rotation.x).toBe(0);
    expect(hipsNode.rotation.z).toBe(0);
  });

  it("does not modify blink expression when enableBlink is false", () => {
    const { vrm, expressionValues } = createMockVRM();

    const system = new AnimationSystem(vrm, {
      enableBlink: false
    });

    system.update(5.0);

    expect(expressionValues.has("blink")).toBe(false);
  });

  it("falls back to spine bone if chest bone is absent", () => {
    const spineNode = new THREE.Object3D();
    const updateSpy = vi.fn();
    const vrm = {
      scene: new THREE.Group(),
      humanoid: {
        getNormalizedBoneNode: (name: string) =>
          name === "spine" ? spineNode : null
      },
      update: updateSpy
    } as unknown as VRM;

    const system = new AnimationSystem(vrm, {
      breathingSpeed: 2.0,
      breathingAmplitude: 0.04
    });

    system.update(0.5);
    expect(spineNode.rotation.x).toBeCloseTo(Math.sin(1.0) * 0.04);
  });

  it("dispose restores original bone rotations and resets blink expression", () => {
    const {
      vrm,
      chestNode,
      hipsNode,
      leftUpperArmNode,
      rightUpperArmNode,
      expressionValues
    } = createMockVRM();

    chestNode.rotation.set(0.1, 0.2, 0.3);
    hipsNode.rotation.set(0.0, 0.1, 0.2);
    leftUpperArmNode.rotation.set(0, 0, 0);
    rightUpperArmNode.rotation.set(0, 0, 0);

    const system = new AnimationSystem(vrm);
    system.update(0.5);

    // Trigger dispose
    system.dispose();

    expect(system.disposed).toBe(true);
    expect(chestNode.rotation.x).toBeCloseTo(0.1);
    expect(hipsNode.rotation.z).toBeCloseTo(0.2);
    expect(leftUpperArmNode.rotation.z).toBeCloseTo(0);
    expect(rightUpperArmNode.rotation.z).toBeCloseTo(0);
    expect(expressionValues.get("blink")).toBe(0);

    // Subsequent updates should be no-ops
    system.update(0.5);
    expect(chestNode.rotation.x).toBeCloseTo(0.1);
  });

  it("ignores update calls with non-positive dt", () => {
    const { vrm, updateSpy } = createMockVRM();
    const system = new AnimationSystem(vrm);

    system.update(0);
    system.update(-0.016);

    expect(updateSpy).not.toHaveBeenCalled();
    expect(system.time).toBe(0);
  });

  it("pauses procedural idle bone overrides while a VRMA clip is actively playing", () => {
    const { vrm, chestNode, hipsNode, updateSpy } = createMockVRM();
    const system = new AnimationSystem(vrm);

    const clip = new THREE.AnimationClip("TestVRMA", 1.0, []);
    system.vrmaPlayer.playClip(clip);

    expect(system.vrmaPlayer.isPlaying).toBe(true);

    // Manually set chest and hips to custom values as if mixer animated them
    chestNode.rotation.x = 0.55;
    hipsNode.rotation.z = 0.88;

    system.update(0.1);

    // Bone rotations should NOT be overwritten by procedural idle math
    expect(chestNode.rotation.x).toBeCloseTo(0.55);
    expect(hipsNode.rotation.z).toBeCloseTo(0.88);

    // VRM physics and blink updates still run
    expect(updateSpy).toHaveBeenCalledWith(0.1);
  });

  it("restores base pose and resumes procedural idle when VRMA stops playing", () => {
    const { vrm, chestNode, hipsNode } = createMockVRM();
    chestNode.rotation.set(0, 0, 0);
    hipsNode.rotation.set(0, 0, 0);

    const system = new AnimationSystem(vrm);
    const clip = new THREE.AnimationClip("TestVRMA", 1.0, []);
    system.vrmaPlayer.playClip(clip);

    // Simulate bone offset from clip
    chestNode.rotation.x = 0.77;
    hipsNode.rotation.z = 0.66;

    // Stop VRMA playback
    system.vrmaPlayer.stop(0);
    expect(system.vrmaPlayer.isPlaying).toBe(false);

    // First update after stop: should restore base pose and resume procedural idle
    system.update(0.1);

    // Chest has now resumed procedural breathing around base rotation (0)
    expect(chestNode.rotation.x).not.toBeCloseTo(0.77);
    expect(chestNode.rotation.x).toBeCloseTo(
      Math.sin(0.1 * system.breathingSpeed) * system.breathingAmplitude
    );
  });
});
