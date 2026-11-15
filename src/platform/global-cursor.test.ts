import { describe, it, expect, vi } from "vitest";
import type { LookAtSystem } from "../engine/LookAtSystem";
import { GlobalCursorLookAtSystem } from "./global-cursor";

function createMockLookAt(): LookAtSystem {
  return {
    setCursorNdc: vi.fn()
  } as unknown as LookAtSystem;
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("GlobalCursorLookAtSystem", () => {
  it("polls cursor position at configured Hz and forwards NDC to LookAtSystem", async () => {
    const lookAt = createMockLookAt();
    const queryCursorPosition = vi
      .fn<() => Promise<[number, number] | null>>()
      .mockResolvedValue([200, 300]);

    const sys = new GlobalCursorLookAtSystem(lookAt, {
      hz: 10, // 100ms interval
      getViewportSize: () => ({ width: 400, height: 600 }),
      queryCursorPosition,
      checkGlobalCursorCap: async () => true
    });

    await flushPromises();

    // Below 100ms interval: should not poll yet
    sys.update(0.05);
    expect(queryCursorPosition).not.toHaveBeenCalled();

    // Crosses 100ms interval: polls and updates NDC (200, 300 -> 0, 0)
    sys.update(0.06);
    await flushPromises();
    expect(queryCursorPosition).toHaveBeenCalledTimes(1);
    expect(lookAt.setCursorNdc).toHaveBeenCalledWith(0, 0);

    // Same coordinates on next poll: should NOT reset LookAt idle timer
    sys.update(0.11);
    await flushPromises();
    expect(queryCursorPosition).toHaveBeenCalledTimes(2);
    expect(lookAt.setCursorNdc).toHaveBeenCalledTimes(1);

    // Moved coordinates: should update NDC again
    queryCursorPosition.mockResolvedValueOnce([400, 0]);
    sys.update(0.11);
    await flushPromises();
    expect(lookAt.setCursorNdc).toHaveBeenLastCalledWith(1, 1);

    sys.dispose();
  });

  it("stays inactive when globalCursor capability is false (e.g. native Wayland)", async () => {
    const lookAt = createMockLookAt();
    const queryCursorPosition = vi.fn();

    const sys = new GlobalCursorLookAtSystem(lookAt, {
      hz: 20,
      queryCursorPosition,
      checkGlobalCursorCap: async () => false
    });

    await flushPromises();
    sys.update(0.2);
    await flushPromises();

    expect(queryCursorPosition).not.toHaveBeenCalled();
    expect(lookAt.setCursorNdc).not.toHaveBeenCalled();
    sys.dispose();
  });

  it("does not overlap in-flight cursor queries and stops after dispose", async () => {
    const lookAt = createMockLookAt();
    let resolveQuery!: (val: [number, number] | null) => void;
    const queryCursorPosition = vi.fn(
      () =>
        new Promise<[number, number] | null>((resolve) => {
          resolveQuery = resolve;
        })
    );

    const sys = new GlobalCursorLookAtSystem(lookAt, {
      hz: 10,
      getViewportSize: () => ({ width: 400, height: 600 }),
      queryCursorPosition,
      checkGlobalCursorCap: async () => true
    });

    await flushPromises();

    // First poll starts in-flight query
    sys.update(0.15);
    expect(queryCursorPosition).toHaveBeenCalledTimes(1);

    // Second update while first is still pending must not start a second query
    sys.update(0.15);
    expect(queryCursorPosition).toHaveBeenCalledTimes(1);

    sys.dispose();
    resolveQuery([100, 100]);
    await flushPromises();
    expect(lookAt.setCursorNdc).not.toHaveBeenCalled();
  });
});
