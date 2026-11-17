import { describe, expect, it, vi } from "vitest";
import {
  calculateWindowPerchPosition,
  WindowPerchController
} from "./window-perch";

describe("calculateWindowPerchPosition", () => {
  it("centers Deskumi horizontally atop the target window titlebar", () => {
    const pos = calculateWindowPerchPosition(
      { x: 200, y: 400, width: 600, height: 500 },
      { width: 250, height: 300 },
      { footOverlapPx: 10 }
    );
    expect(pos).toEqual({ x: 375, y: 110 });
  });

  it("returns null when target window is near the top edge (maximized)", () => {
    const pos = calculateWindowPerchPosition(
      { x: 0, y: 10, width: 1200, height: 800 },
      { width: 250, height: 300 }
    );
    expect(pos).toBeNull();
  });

  it("returns null when there is not enough vertical room above the target window", () => {
    const pos = calculateWindowPerchPosition(
      { x: 10, y: 120, width: 100, height: 400 },
      { width: 250, height: 300 },
      { footOverlapPx: 10 }
    );
    expect(pos).toBeNull();
  });

  it("clamps x to >= 0 when target window is near the left edge", () => {
    const pos = calculateWindowPerchPosition(
      { x: 10, y: 400, width: 100, height: 400 },
      { width: 250, height: 300 },
      { footOverlapPx: 10 }
    );
    expect(pos).toEqual({ x: 0, y: 110 });
  });
});

describe("WindowPerchController", () => {
  it("moves Deskumi when enabled and skips redundant moves within threshold", async () => {
    const queryActiveWindow = vi
      .fn<() => Promise<[number, number, number, number] | null>>()
      .mockResolvedValue([200, 400, 600, 500]);
    const moveDeskumi = vi.fn().mockResolvedValue(undefined);
    const onPerchStateChange = vi.fn();

    const controller = new WindowPerchController({
      intervalMs: 1000,
      getDeskumiSize: () => ({ width: 250, height: 300 }),
      queryActiveWindow,
      moveDeskumi,
      onPerchStateChange
    });

    controller.setEnabled(true);
    await vi.waitFor(() => expect(moveDeskumi).toHaveBeenCalledTimes(1));
    expect(moveDeskumi).toHaveBeenCalledWith(375, 208);
    expect(onPerchStateChange).toHaveBeenCalledWith(true);

    // Same rect again -> should not move again
    await controller.step();
    expect(moveDeskumi).toHaveBeenCalledTimes(1);

    // Focusing a different maximized/top-edge window that does NOT cover the
    // perched titlebar (e.g. on another monitor) -> stays perched
    queryActiveWindow.mockResolvedValueOnce([1400, 10, 1200, 800]);
    await controller.step();
    expect(controller.perched).toBe(true);
    expect(moveDeskumi).toHaveBeenCalledTimes(1);

    // Focusing a maximized window that covers the perched titlebar -> unperches
    queryActiveWindow.mockResolvedValueOnce([0, 10, 1200, 800]);
    await controller.step();
    expect(controller.perched).toBe(false);
    expect(onPerchStateChange).toHaveBeenLastCalledWith(false);

    // Re-perch, then push the *same* perched window to the top edge -> unperches
    queryActiveWindow.mockResolvedValueOnce([200, 400, 600, 500]);
    await controller.step();
    expect(controller.perched).toBe(true);
    queryActiveWindow.mockResolvedValueOnce([200, 10, 600, 500]);
    await controller.step();
    expect(controller.perched).toBe(false);
    expect(onPerchStateChange).toHaveBeenLastCalledWith(false);

    // Re-perch on valid window, then manually drag Deskumi off -> unperches and stays off
    queryActiveWindow.mockResolvedValueOnce([200, 400, 600, 500]);
    await controller.step();
    expect(controller.perched).toBe(true);
    controller.notifyManualDrag();
    expect(controller.perched).toBe(false);
    queryActiveWindow.mockResolvedValueOnce([200, 400, 600, 500]);
    await controller.step();
    expect(controller.perched).toBe(false);

    // Active window closed / null -> should unperch immediately
    queryActiveWindow.mockResolvedValueOnce(null);
    await controller.step();
    expect(onPerchStateChange).toHaveBeenLastCalledWith(false);

    controller.dispose();
    expect(onPerchStateChange).toHaveBeenLastCalledWith(false);
  });

  it("uses dynamic getSeatOverlapPx when provided", async () => {
    const queryActiveWindow = vi
      .fn<() => Promise<[number, number, number, number] | null>>()
      .mockResolvedValue([200, 400, 600, 500]);
    const moveDeskumi = vi.fn().mockResolvedValue(undefined);

    const controller = new WindowPerchController({
      intervalMs: 1000,
      getDeskumiSize: () => ({ width: 250, height: 300 }),
      getSeatOverlapPx: (size) => Math.round(size.height * 0.42),
      queryActiveWindow,
      moveDeskumi
    });

    controller.setEnabled(true);
    await vi.waitFor(() => expect(moveDeskumi).toHaveBeenCalledTimes(1));
    // y = 400 - 300 + round(300 * 0.42) = 100 + 126 = 226
    expect(moveDeskumi).toHaveBeenCalledWith(375, 226);
    controller.dispose();
  });
});
