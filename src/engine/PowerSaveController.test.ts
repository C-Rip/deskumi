import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PowerSaveController } from "./PowerSaveController";
import type { SceneManager } from "./SceneManager";

describe("PowerSaveController", () => {
  let mockSceneManager: SceneManager;

  beforeEach(() => {
    vi.useFakeTimers();
    mockSceneManager = {
      fpsCap: 30,
      pause: vi.fn(),
      resume: vi.fn()
    } as unknown as SceneManager;
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("initializes with default options and sets sceneManager.fpsCap", () => {
    const controller = new PowerSaveController(mockSceneManager, {
      autoAttachListeners: false
    });

    expect(controller.activeFps).toBe(30);
    expect(controller.idleFps).toBe(10);
    expect(controller.idleTimeoutMs).toBe(15_000);
    expect(controller.isIdle).toBe(false);
    expect(controller.isWindowVisible).toBe(true);
    expect(mockSceneManager.fpsCap).toBe(30);

    controller.dispose();
  });

  it("throws RangeError on non-positive options", () => {
    expect(
      () =>
        new PowerSaveController(mockSceneManager, {
          activeFps: 0,
          autoAttachListeners: false
        })
    ).toThrow(RangeError);

    expect(
      () =>
        new PowerSaveController(mockSceneManager, {
          idleFps: -5,
          autoAttachListeners: false
        })
    ).toThrow(RangeError);

    expect(
      () =>
        new PowerSaveController(mockSceneManager, {
          idleTimeoutMs: 0,
          autoAttachListeners: false
        })
    ).toThrow(RangeError);
  });

  it("enters idle mode and drops fpsCap after idleTimeoutMs elapses", () => {
    const controller = new PowerSaveController(mockSceneManager, {
      activeFps: 60,
      idleFps: 15,
      idleTimeoutMs: 5_000,
      autoAttachListeners: false
    });

    expect(controller.activeFps).toBe(60);
    expect(mockSceneManager.fpsCap).toBe(60);
    expect(controller.isIdle).toBe(false);

    vi.advanceTimersByTime(4_999);
    expect(controller.isIdle).toBe(false);
    expect(mockSceneManager.fpsCap).toBe(60);

    vi.advanceTimersByTime(1);
    expect(controller.isIdle).toBe(true);
    expect(mockSceneManager.fpsCap).toBe(15);

    controller.dispose();
  });

  it("restores activeFps immediately on notifyActivity()", () => {
    const controller = new PowerSaveController(mockSceneManager, {
      activeFps: 30,
      idleFps: 10,
      idleTimeoutMs: 1_000,
      autoAttachListeners: false
    });

    vi.advanceTimersByTime(1_000);
    expect(controller.isIdle).toBe(true);
    expect(mockSceneManager.fpsCap).toBe(10);

    controller.notifyActivity();
    expect(controller.isIdle).toBe(false);
    expect(mockSceneManager.fpsCap).toBe(30);

    // Resets timer, so another 999ms is still active
    vi.advanceTimersByTime(999);
    expect(controller.isIdle).toBe(false);
    expect(mockSceneManager.fpsCap).toBe(30);

    // 1ms more enters idle again
    vi.advanceTimersByTime(1);
    expect(controller.isIdle).toBe(true);
    expect(mockSceneManager.fpsCap).toBe(10);

    controller.dispose();
  });

  it("resets idle timeout countdown if notifyActivity() is called before timeout", () => {
    const controller = new PowerSaveController(mockSceneManager, {
      activeFps: 30,
      idleFps: 10,
      idleTimeoutMs: 2_000,
      autoAttachListeners: false
    });

    vi.advanceTimersByTime(1_500);
    expect(controller.isIdle).toBe(false);

    controller.notifyActivity();

    vi.advanceTimersByTime(1_500);
    expect(controller.isIdle).toBe(false);

    vi.advanceTimersByTime(500);
    expect(controller.isIdle).toBe(true);
    expect(mockSceneManager.fpsCap).toBe(10);

    controller.dispose();
  });

  it("handles DOM activity events on target", () => {
    const target = new EventTarget();
    const controller = new PowerSaveController(mockSceneManager, {
      target,
      idleTimeoutMs: 1_000,
      autoAttachListeners: true
    });

    vi.advanceTimersByTime(1_000);
    expect(controller.isIdle).toBe(true);
    expect(mockSceneManager.fpsCap).toBe(10);

    target.dispatchEvent(new Event("mousemove"));
    expect(controller.isIdle).toBe(false);
    expect(mockSceneManager.fpsCap).toBe(30);

    vi.advanceTimersByTime(1_000);
    expect(controller.isIdle).toBe(true);

    target.dispatchEvent(new Event("keydown"));
    expect(controller.isIdle).toBe(false);
    expect(mockSceneManager.fpsCap).toBe(30);

    controller.dispose();
  });

  it("pauses SceneManager and clears idle timer when hidden via setWindowVisible(false)", () => {
    const controller = new PowerSaveController(mockSceneManager, {
      idleTimeoutMs: 1_000,
      autoAttachListeners: false
    });

    controller.setWindowVisible(false);
    expect(controller.isWindowVisible).toBe(false);
    expect(mockSceneManager.pause).toHaveBeenCalledTimes(1);

    // Time passing while hidden should not trigger idle mode
    vi.advanceTimersByTime(5_000);
    expect(controller.isIdle).toBe(false);

    // notifyActivity while hidden is ignored
    controller.notifyActivity();
    expect(mockSceneManager.fpsCap).toBe(30);

    // Becoming visible resumes SceneManager and restarts idle timer
    controller.setWindowVisible(true);
    expect(controller.isWindowVisible).toBe(true);
    expect(mockSceneManager.resume).toHaveBeenCalledTimes(1);
    expect(mockSceneManager.fpsCap).toBe(30);

    vi.advanceTimersByTime(1_000);
    expect(controller.isIdle).toBe(true);
    expect(mockSceneManager.fpsCap).toBe(10);

    controller.dispose();
  });

  it("handles document visibilitychange events", () => {
    let visibilityState = "visible";
    const doc = new EventTarget() as unknown as Document;
    Object.defineProperty(doc, "visibilityState", {
      get: () => visibilityState,
      configurable: true
    });

    const controller = new PowerSaveController(mockSceneManager, {
      doc,
      idleTimeoutMs: 1_000,
      autoAttachListeners: true
    });

    visibilityState = "hidden";
    doc.dispatchEvent(new Event("visibilitychange"));

    expect(controller.isWindowVisible).toBe(false);
    expect(mockSceneManager.pause).toHaveBeenCalled();

    visibilityState = "visible";
    doc.dispatchEvent(new Event("visibilitychange"));

    expect(controller.isWindowVisible).toBe(true);
    expect(mockSceneManager.resume).toHaveBeenCalled();

    controller.dispose();
  });

  it("updates active FPS dynamically with setActiveFps", () => {
    const controller = new PowerSaveController(mockSceneManager, {
      activeFps: 30,
      idleFps: 10,
      autoAttachListeners: false
    });

    controller.setActiveFps(60);
    expect(controller.activeFps).toBe(60);
    expect(mockSceneManager.fpsCap).toBe(60);

    // When idle, setActiveFps updates internal value but keeps fpsCap at idleFps
    vi.advanceTimersByTime(15_000);
    expect(controller.isIdle).toBe(true);
    expect(mockSceneManager.fpsCap).toBe(10);

    controller.setActiveFps(45);
    expect(controller.activeFps).toBe(45);
    expect(mockSceneManager.fpsCap).toBe(10);

    // On activity, activeFps (45) is restored
    controller.notifyActivity();
    expect(mockSceneManager.fpsCap).toBe(45);

    expect(() => controller.setActiveFps(0)).toThrow(RangeError);

    controller.dispose();
  });

  it("updates idle FPS dynamically with setIdleFps", () => {
    const controller = new PowerSaveController(mockSceneManager, {
      activeFps: 30,
      idleFps: 10,
      autoAttachListeners: false
    });

    controller.setIdleFps(15);
    expect(controller.idleFps).toBe(15);
    expect(mockSceneManager.fpsCap).toBe(30);

    // Advance into idle
    vi.advanceTimersByTime(15_000);
    expect(controller.isIdle).toBe(true);
    expect(mockSceneManager.fpsCap).toBe(15);

    // Updating idleFps while idle immediately changes fpsCap
    controller.setIdleFps(8);
    expect(controller.idleFps).toBe(8);
    expect(mockSceneManager.fpsCap).toBe(8);

    expect(() => controller.setIdleFps(-1)).toThrow(RangeError);

    controller.dispose();
  });

  it("wires custom listenTauriVisibility and cleans up on dispose", async () => {
    let tauriHandler: ((visible: boolean) => void) | null = null;
    const unlistenFn = vi.fn();

    const controller = new PowerSaveController(mockSceneManager, {
      autoAttachListeners: false,
      listenTauriVisibility: (handler) => {
        tauriHandler = handler;
        return unlistenFn;
      }
    });

    expect(tauriHandler).not.toBeNull();

    // Trigger tray hide event
    tauriHandler!(false);
    expect(controller.isWindowVisible).toBe(false);
    expect(mockSceneManager.pause).toHaveBeenCalledTimes(1);

    // Trigger tray show event
    tauriHandler!(true);
    expect(controller.isWindowVisible).toBe(true);
    expect(mockSceneManager.resume).toHaveBeenCalledTimes(1);

    controller.dispose();
    expect(controller.isDisposed).toBe(true);
    expect(unlistenFn).toHaveBeenCalledTimes(1);
  });
});
