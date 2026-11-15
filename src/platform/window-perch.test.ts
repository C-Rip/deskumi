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
    expect(moveDeskumi).toHaveBeenCalledWith(375, 148);
    expect(onPerchStateChange).toHaveBeenCalledWith(true);

    // Same rect again -> should not move again
    await controller.step();
    expect(moveDeskumi).toHaveBeenCalledTimes(1);

    // Active window closed / null -> should unperch immediately
    queryActiveWindow.mockResolvedValueOnce(null);
    await controller.step();
    expect(onPerchStateChange).toHaveBeenLastCalledWith(false);

    controller.dispose();
    expect(onPerchStateChange).toHaveBeenLastCalledWith(false);
  });
});
