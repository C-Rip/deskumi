import { describe, it, expect, vi } from "vitest";
import * as THREE from "three";
import type { VRM } from "@pixiv/three-vrm";
import { ReactionSystem } from "./ReactionSystem";

function createMockVRM(): VRM {
  const scene = new THREE.Group();
  const head = new THREE.Object3D();

  const setExpressionValue = vi.fn();
  const expressionManager = {
    setValue: setExpressionValue,
    getValue: vi.fn().mockReturnValue(0)
  };

  const humanoid = {
    getNormalizedBoneNode: vi.fn().mockImplementation((name: string) => {
      if (name === "head") return head;
      return null;
    }),
    getRawBoneNode: vi.fn().mockReturnValue(null)
  };

  return {
    scene,
    humanoid,
    expressionManager
  } as unknown as VRM;
}

describe("ReactionSystem", () => {
  it("initializes with default options and is not playing initially", () => {
    const vrm = createMockVRM();
    const system = new ReactionSystem(vrm);

    expect(system.isPlaying()).toBe(false);
    expect(system.getCurrentReaction()).toBeNull();
  });

  it("triggers happy expression and updates weights over time", () => {
    const vrm = createMockVRM();
    const system = new ReactionSystem(vrm, {
      duration: 1.0,
      fadeInDuration: 0.2,
      fadeOutDuration: 0.2
    });

    system.trigger("happy");
    expect(system.isPlaying()).toBe(true);
    expect(system.getCurrentReaction()).toBe("happy");

    // Advance 0.1s (mid fadeIn)
    system.update(0.1);
    expect(vrm.expressionManager?.setValue).toHaveBeenCalledWith(
      "happy",
      expect.any(Number)
    );

    // Advance to duration completion
    system.update(0.9);
    expect(system.isPlaying()).toBe(false);
    expect(system.getCurrentReaction()).toBeNull();
    // After finishing, expression value reset to 0
    expect(vrm.expressionManager?.setValue).toHaveBeenLastCalledWith(
      "happy",
      0
    );
  });

  it("triggers surprised expression and random reaction", () => {
    const vrm = createMockVRM();
    const system = new ReactionSystem(vrm, { duration: 1.0 });

    system.trigger("surprised");
    expect(system.getCurrentReaction()).toBe("surprised");
    system.update(0.1);
    expect(vrm.expressionManager?.setValue).toHaveBeenCalledWith(
      "surprised",
      expect.any(Number)
    );

    // Trigger random
    system.triggerRandom();
    expect(system.isPlaying()).toBe(true);
    expect(system.getCurrentReaction()).not.toBeNull();
  });

  it("resets previous expression when a new reaction is triggered while active", () => {
    const vrm = createMockVRM();
    const system = new ReactionSystem(vrm, { duration: 2.0 });

    system.trigger("happy");
    system.update(0.5);

    // Now trigger surprised before happy finishes
    system.trigger("surprised");
    expect(vrm.expressionManager?.setValue).toHaveBeenCalledWith("happy", 0);
    expect(system.getCurrentReaction()).toBe("surprised");
  });

  it("applies procedural bounce to scene position Y", () => {
    const vrm = createMockVRM();
    vrm.scene.position.y = 0;

    const system = new ReactionSystem(vrm, {
      duration: 1.0,
      bounceAmplitude: 0.05
    });

    system.trigger("happy");
    // At half-way, bounce is peak
    system.update(0.5);
    expect(vrm.scene.position.y).toBeGreaterThan(0);

    // When done, returns to original position
    system.update(0.6);
    expect(vrm.scene.position.y).toBe(0);
  });

  it("cleans up on dispose", () => {
    const vrm = createMockVRM();
    const system = new ReactionSystem(vrm);

    system.trigger("wink");
    system.update(0.2);
    expect(system.isPlaying()).toBe(true);

    system.dispose();
    expect(system.isPlaying()).toBe(false);
    expect(vrm.expressionManager?.setValue).toHaveBeenCalledWith(
      "blinkLeft",
      0
    );
  });
});
