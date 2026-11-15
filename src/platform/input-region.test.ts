import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as THREE from "three";
import {
  areRectsEqual,
  calculateScreenBoundingBox,
  InputRegionManager,
  isPointInRects,
  normalizeRects,
  AvatarInputRegionSystem,
  type Rect
} from "./input-region";

describe("input-region", () => {
  describe("normalizeRects", () => {
    it("returns null for null input", () => {
      expect(normalizeRects(null)).toBeNull();
    });

    it("returns empty array for empty input", () => {
      expect(normalizeRects([])).toEqual([]);
    });

    it("rounds coordinates to nearest integer", () => {
      const input: Rect[] = [
        { x: 10.4, y: 20.6, w: 99.8, h: 50.1 },
        { x: -5.7, y: 0.2, w: 10.9, h: 20.4 }
      ];
      expect(normalizeRects(input)).toEqual([
        { x: 10, y: 21, w: 100, h: 50 },
        { x: -6, y: 0, w: 11, h: 20 }
      ]);
    });

    it("filters out zero or negative dimensions", () => {
      const input: Rect[] = [
        { x: 0, y: 0, w: 100, h: 100 },
        { x: 10, y: 10, w: 0, h: 50 },
        { x: 20, y: 20, w: 50, h: -10 },
        { x: 30, y: 30, w: -5, h: 0 }
      ];
      expect(normalizeRects(input)).toEqual([{ x: 0, y: 0, w: 100, h: 100 }]);
    });
  });

  describe("areRectsEqual", () => {
    it("handles null cases correctly", () => {
      expect(areRectsEqual(null, null)).toBe(true);
      expect(areRectsEqual(null, [])).toBe(false);
      expect(areRectsEqual([], null)).toBe(false);
    });

    it("compares empty arrays as equal", () => {
      expect(areRectsEqual([], [])).toBe(true);
    });

    it("detects length mismatch", () => {
      const a: Rect[] = [{ x: 1, y: 2, w: 3, h: 4 }];
      const b: Rect[] = [
        { x: 1, y: 2, w: 3, h: 4 },
        { x: 5, y: 6, w: 7, h: 8 }
      ];
      expect(areRectsEqual(a, b)).toBe(false);
    });

    it("detects coordinate differences", () => {
      const a: Rect[] = [{ x: 1, y: 2, w: 3, h: 4 }];
      expect(areRectsEqual(a, [{ x: 2, y: 2, w: 3, h: 4 }])).toBe(false);
      expect(areRectsEqual(a, [{ x: 1, y: 3, w: 3, h: 4 }])).toBe(false);
      expect(areRectsEqual(a, [{ x: 1, y: 2, w: 4, h: 4 }])).toBe(false);
      expect(areRectsEqual(a, [{ x: 1, y: 2, w: 3, h: 5 }])).toBe(false);
      expect(areRectsEqual(a, [{ x: 1, y: 2, w: 3, h: 4 }])).toBe(true);
    });
  });

  describe("calculateScreenBoundingBox", () => {
    let camera: THREE.PerspectiveCamera;

    beforeEach(() => {
      camera = new THREE.PerspectiveCamera(45, 800 / 600, 0.1, 100);
      camera.position.set(0, 0, 5);
      camera.lookAt(0, 0, 0);
      camera.updateMatrixWorld(true);
    });

    it("returns null for non-positive viewport", () => {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshBasicMaterial()
      );
      expect(calculateScreenBoundingBox(mesh, camera, 0, 600)).toBeNull();
      expect(calculateScreenBoundingBox(mesh, camera, 800, -10)).toBeNull();
    });

    it("returns null for empty object with no geometry", () => {
      const group = new THREE.Group();
      expect(calculateScreenBoundingBox(group, camera, 800, 600)).toBeNull();
    });

    it("computes projected bounding box for a centered cube", () => {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshBasicMaterial()
      );
      mesh.position.set(0, 0, 0);
      mesh.updateMatrixWorld(true);

      const rect = calculateScreenBoundingBox(mesh, camera, 800, 600, 0);
      expect(rect).not.toBeNull();
      if (!rect) return;

      // The cube is centered at origin: x and y should be centered in 800x600 viewport
      const centerX = rect.x + rect.w / 2;
      const centerY = rect.y + rect.h / 2;
      expect(Math.abs(centerX - 400)).toBeLessThan(2);
      expect(Math.abs(centerY - 300)).toBeLessThan(2);
      expect(rect.w).toBeGreaterThan(50);
      expect(rect.h).toBeGreaterThan(50);
    });

    it("applies padding around bounding box", () => {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshBasicMaterial()
      );
      mesh.updateMatrixWorld(true);

      const unpadded = calculateScreenBoundingBox(mesh, camera, 800, 600, 0)!;
      const padded = calculateScreenBoundingBox(mesh, camera, 800, 600, 10)!;

      expect(padded.x).toBeLessThanOrEqual(unpadded.x - 10);
      expect(padded.y).toBeLessThanOrEqual(unpadded.y - 10);
      expect(padded.w).toBeGreaterThanOrEqual(unpadded.w + 20);
      expect(padded.h).toBeGreaterThanOrEqual(unpadded.h + 20);
    });

    it("clamps bounding box to viewport bounds", () => {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(20, 20, 1),
        new THREE.MeshBasicMaterial()
      );
      mesh.updateMatrixWorld(true);

      const rect = calculateScreenBoundingBox(mesh, camera, 800, 600, 50)!;
      expect(rect.x).toBe(0);
      expect(rect.y).toBe(0);
      expect(rect.w).toBe(800);
      expect(rect.h).toBe(600);
    });
  });

  describe("InputRegionManager", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("dispatches first update immediately", async () => {
      const sender = vi.fn().mockResolvedValue(undefined);
      const manager = new InputRegionManager({ hz: 15, sender });

      const rects: Rect[] = [{ x: 10, y: 10, w: 100, h: 100 }];
      await manager.setRegion(rects);

      expect(sender).toHaveBeenCalledTimes(1);
      expect(sender).toHaveBeenCalledWith(rects);
      expect(manager.getLastAppliedRects()).toEqual(rects);
      expect(manager.isPending()).toBe(false);
    });

    it("deduplicates identical rects", async () => {
      const sender = vi.fn().mockResolvedValue(undefined);
      const manager = new InputRegionManager({ hz: 15, sender });

      const rects: Rect[] = [{ x: 10, y: 10, w: 100, h: 100 }];
      await manager.setRegion(rects);
      expect(sender).toHaveBeenCalledTimes(1);

      // Same rects called again
      await manager.setRegion([{ x: 10, y: 10, w: 100, h: 100 }]);
      expect(sender).toHaveBeenCalledTimes(1);
      expect(manager.isPending()).toBe(false);
    });

    it("throttles rapid updates to configured frequency (15 Hz)", async () => {
      const sender = vi.fn().mockResolvedValue(undefined);
      // 15 Hz -> interval ~66.67ms
      const manager = new InputRegionManager({ hz: 15, sender });

      // First call -> immediate
      await manager.setRegion([{ x: 10, y: 10, w: 100, h: 100 }]);
      expect(sender).toHaveBeenCalledTimes(1);

      // Calls within interval
      await manager.setRegion([{ x: 20, y: 20, w: 100, h: 100 }]);
      await manager.setRegion([{ x: 30, y: 30, w: 100, h: 100 }]);
      await manager.setRegion([{ x: 40, y: 40, w: 100, h: 100 }]);

      expect(sender).toHaveBeenCalledTimes(1);
      expect(manager.isPending()).toBe(true);

      // Advance timer by 70ms
      vi.advanceTimersByTime(70);

      expect(sender).toHaveBeenCalledTimes(2);
      expect(sender).toHaveBeenLastCalledWith([
        { x: 40, y: 40, w: 100, h: 100 }
      ]);
      expect(manager.isPending()).toBe(false);
    });

    it("supports reset to full window (null)", async () => {
      const sender = vi.fn().mockResolvedValue(undefined);
      const manager = new InputRegionManager({ hz: 15, sender });

      await manager.setRegion([{ x: 50, y: 50, w: 50, h: 50 }]);
      expect(sender).toHaveBeenCalledTimes(1);

      await manager.reset();
      expect(sender).toHaveBeenCalledTimes(2);
      expect(sender).toHaveBeenLastCalledWith(null);
      expect(manager.getLastAppliedRects()).toBeNull();
    });

    it("setImmediate bypasses throttling", async () => {
      const sender = vi.fn().mockResolvedValue(undefined);
      const manager = new InputRegionManager({ hz: 15, sender });

      await manager.setRegion([{ x: 10, y: 10, w: 100, h: 100 }]);
      expect(sender).toHaveBeenCalledTimes(1);

      await manager.setImmediate([{ x: 200, y: 200, w: 150, h: 150 }]);
      expect(sender).toHaveBeenCalledTimes(2);
      expect(sender).toHaveBeenLastCalledWith([
        { x: 200, y: 200, w: 150, h: 150 }
      ]);
    });

    it("flush sends pending rects immediately", async () => {
      const sender = vi.fn().mockResolvedValue(undefined);
      const manager = new InputRegionManager({ hz: 15, sender });

      await manager.setRegion([{ x: 10, y: 10, w: 100, h: 100 }]);
      expect(sender).toHaveBeenCalledTimes(1);

      await manager.setRegion([{ x: 50, y: 50, w: 100, h: 100 }]);
      expect(manager.isPending()).toBe(true);

      await manager.flush();
      expect(sender).toHaveBeenCalledTimes(2);
      expect(sender).toHaveBeenLastCalledWith([
        { x: 50, y: 50, w: 100, h: 100 }
      ]);
      expect(manager.isPending()).toBe(false);
    });

    it("dispose cancels pending timers", async () => {
      const sender = vi.fn().mockResolvedValue(undefined);
      const manager = new InputRegionManager({ hz: 15, sender });

      await manager.setRegion([{ x: 10, y: 10, w: 100, h: 100 }]);
      await manager.setRegion([{ x: 50, y: 50, w: 100, h: 100 }]);
      expect(manager.isPending()).toBe(true);

      manager.dispose();
      expect(manager.isPending()).toBe(false);

      vi.advanceTimersByTime(100);
      expect(sender).toHaveBeenCalledTimes(1);
    });

    it("handles sender rejection gracefully without throwing", async () => {
      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      const sender = vi.fn().mockRejectedValue(new Error("IPC failure"));
      const manager = new InputRegionManager({ hz: 15, sender });

      await expect(
        manager.setImmediate([{ x: 0, y: 0, w: 10, h: 10 }])
      ).resolves.toBeUndefined();
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe("AvatarInputRegionSystem", () => {
    it("updates region on frame tick and resets on dispose", () => {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshBasicMaterial()
      );
      const camera = new THREE.PerspectiveCamera(45, 800 / 600, 0.1, 100);
      camera.position.set(0, 0, 5);
      camera.lookAt(0, 0, 0);

      const manager = new InputRegionManager({
        hz: 15,
        sender: vi.fn().mockResolvedValue(undefined)
      });
      const setRegionSpy = vi.spyOn(manager, "setRegion");
      const resetSpy = vi.spyOn(manager, "reset");

      const system = new AvatarInputRegionSystem(
        mesh,
        camera,
        manager,
        () => ({ width: 800, height: 600 }),
        10
      );

      system.update(0.033);
      expect(setRegionSpy).toHaveBeenCalledTimes(1);
      const passedRects = setRegionSpy.mock.calls[0][0];
      expect(passedRects).not.toBeNull();
      expect(passedRects!.length).toBe(1);

      system.dispose();
      expect(resetSpy).toHaveBeenCalledTimes(1);
    });

    it("stores silhouette hit rects while keeping full window pointer active when fullWindowPointer is true", () => {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshBasicMaterial()
      );
      const camera = new THREE.PerspectiveCamera(45, 800 / 600, 0.1, 100);
      camera.position.set(0, 0, 5);
      camera.lookAt(0, 0, 0);

      const manager = new InputRegionManager({
        hz: 15,
        sender: vi.fn().mockResolvedValue(undefined)
      });
      const setRegionSpy = vi.spyOn(manager, "setRegion");
      const resetSpy = vi.spyOn(manager, "reset");

      const system = new AvatarInputRegionSystem(mesh, camera, {
        manager,
        getViewportSize: () => ({ width: 800, height: 600 }),
        padding: 10,
        fullWindowPointer: true
      });

      system.update(0.033);
      expect(setRegionSpy).not.toHaveBeenCalled();
      expect(resetSpy).toHaveBeenCalled();
      expect(system.getHitRects().length).toBe(1);
      expect(system.isPointOnAvatar(400, 300)).toBe(true);
      expect(system.isPointOnAvatar(10, 10)).toBe(false);
    });
  });

  describe("isPointInRects", () => {
    it("correctly tests points inside and outside rects", () => {
      const rects: Rect[] = [{ x: 100, y: 100, w: 50, h: 80 }];
      expect(isPointInRects(120, 140, rects)).toBe(true);
      expect(isPointInRects(100, 100, rects)).toBe(true);
      expect(isPointInRects(150, 180, rects)).toBe(false);
      expect(isPointInRects(50, 50, rects)).toBe(false);
      expect(isPointInRects(120, 140, null)).toBe(false);
      expect(isPointInRects(120, 140, [])).toBe(false);
    });
  });
});
