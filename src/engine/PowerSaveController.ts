import { isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { SceneManager } from "./SceneManager";

export interface PowerSaveControllerOptions {
  /**
   * Target FPS when user is actively interacting.
   * Defaults to `sceneManager.fpsCap` (or 30).
   */
  activeFps?: number;

  /**
   * Target FPS when user is idle (no interaction for `idleTimeoutMs`).
   * @default 10
   */
  idleFps?: number;

  /**
   * Milliseconds of user inactivity before reducing FPS to `idleFps`.
   * @default 15_000
   */
  idleTimeoutMs?: number;

  /**
   * Target element or window to attach user activity listeners.
   * Defaults to `window` when available.
   */
  target?: EventTarget | null;

  /**
   * Document object to listen for `visibilitychange` events.
   * Defaults to `document` when available.
   */
  doc?: Document | null;

  /**
   * Whether to automatically attach DOM activity and visibility listeners on construction.
   * @default true
   */
  autoAttachListeners?: boolean;

  /**
   * Optional custom subscription function for Tauri visibility events.
   * Useful for unit testing or custom event injection.
   * If omitted and running in Tauri, subscribes to `"tray-visibility-changed"`.
   */
  listenTauriVisibility?: (
    handler: (visible: boolean) => void
  ) => Promise<UnlistenFn> | UnlistenFn;
}

const ACTIVITY_EVENTS = [
  "mousemove",
  "mousedown",
  "keydown",
  "touchstart",
  "wheel"
] as const;

/**
 * PowerSaveController monitors user activity and window visibility to reduce
 * CPU/GPU power consumption:
 * - Lowers `sceneManager.fpsCap` from `activeFps` (e.g. 30) to `idleFps` (e.g. 10)
 *   after `idleTimeoutMs` (default 15s) of inactivity.
 * - Immediately restores `activeFps` upon any user activity.
 * - Pauses `sceneManager` completely when the window is hidden (via Tauri tray
 *   visibility events or `document.visibilityState`) and resumes when visible.
 */
export class PowerSaveController {
  private _activeFps: number;
  private _idleFps: number;
  private readonly _idleTimeoutMs: number;
  private _isIdle = false;
  private _isWindowVisible = true;
  private _isDisposed = false;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private tauriUnlisten: UnlistenFn | null = null;

  private readonly target: EventTarget | null;
  private readonly doc: Document | null;
  private readonly attachedListeners: boolean;

  constructor(
    private readonly sceneManager: SceneManager,
    options: PowerSaveControllerOptions = {}
  ) {
    const initialActiveFps = options.activeFps ?? sceneManager.fpsCap ?? 30;
    if (initialActiveFps <= 0) {
      throw new RangeError("activeFps must be greater than 0");
    }
    const initialIdleFps = options.idleFps ?? 10;
    if (initialIdleFps <= 0) {
      throw new RangeError("idleFps must be greater than 0");
    }
    const timeoutMs = options.idleTimeoutMs ?? 15_000;
    if (timeoutMs <= 0) {
      throw new RangeError("idleTimeoutMs must be greater than 0");
    }

    this._activeFps = initialActiveFps;
    this._idleFps = initialIdleFps;
    this._idleTimeoutMs = timeoutMs;

    this.target =
      options.target !== undefined
        ? options.target
        : typeof window !== "undefined"
          ? window
          : null;

    this.doc =
      options.doc !== undefined
        ? options.doc
        : typeof document !== "undefined"
          ? document
          : null;

    this.attachedListeners = options.autoAttachListeners ?? true;

    // Apply initial active FPS
    this.sceneManager.fpsCap = this._activeFps;

    if (this.attachedListeners) {
      this.attachDomListeners();
    }

    if (options.listenTauriVisibility) {
      const res = options.listenTauriVisibility((visible: boolean) => {
        this.setWindowVisible(visible);
      });
      if (res instanceof Promise) {
        void res.then((unlisten) => {
          if (this._isDisposed) {
            unlisten();
          } else {
            this.tauriUnlisten = unlisten;
          }
        });
      } else if (typeof res === "function") {
        this.tauriUnlisten = res;
      }
    } else if (isTauri()) {
      void listen<boolean>("tray-visibility-changed", (event) => {
        this.setWindowVisible(event.payload);
      })
        .then((unlisten) => {
          if (this._isDisposed) {
            unlisten();
          } else {
            this.tauriUnlisten = unlisten;
          }
        })
        .catch((err: unknown) => {
          console.warn(
            "[PowerSaveController] Failed to listen to tray-visibility-changed:",
            err
          );
        });
    }

    // Check initial document visibility state if available
    if (this.doc && this.doc.visibilityState === "hidden") {
      this.setWindowVisible(false);
    } else {
      this.scheduleIdleTimer();
    }
  }

  public get activeFps(): number {
    return this._activeFps;
  }

  public get idleFps(): number {
    return this._idleFps;
  }

  public get idleTimeoutMs(): number {
    return this._idleTimeoutMs;
  }

  public get isIdle(): boolean {
    return this._isIdle;
  }

  public get isWindowVisible(): boolean {
    return this._isWindowVisible;
  }

  public get isDisposed(): boolean {
    return this._isDisposed;
  }

  /**
   * Updates the target FPS when active. If currently active (not idle),
   * immediately updates `sceneManager.fpsCap`.
   */
  public setActiveFps(fps: number): void {
    if (fps <= 0) {
      throw new RangeError("activeFps must be greater than 0");
    }
    this._activeFps = fps;
    if (!this._isIdle && !this._isDisposed) {
      this.sceneManager.fpsCap = this._activeFps;
    }
  }

  /**
   * Updates the target FPS when idle. If currently idle,
   * immediately updates `sceneManager.fpsCap`.
   */
  public setIdleFps(fps: number): void {
    if (fps <= 0) {
      throw new RangeError("idleFps must be greater than 0");
    }
    this._idleFps = fps;
    if (this._isIdle && !this._isDisposed) {
      this.sceneManager.fpsCap = this._idleFps;
    }
  }

  /**
   * Signals user or external activity, immediately restoring `activeFps`
   * and resetting the idle countdown timer.
   */
  public notifyActivity(): void {
    if (this._isDisposed || !this._isWindowVisible) {
      return;
    }

    if (this._isIdle) {
      this._isIdle = false;
      this.sceneManager.fpsCap = this._activeFps;
    }

    this.scheduleIdleTimer();
  }

  /**
   * Explicitly updates window visibility state (e.g. from Tauri `"tray-visibility-changed"`
   * event or `document.visibilityState`).
   * When hidden (`false`), pauses `sceneManager` and clears the idle timer.
   * When visible (`true`), resumes `sceneManager`, restores `activeFps`, and restarts the idle timer.
   */
  public setWindowVisible(visible: boolean): void {
    if (this._isDisposed) {
      return;
    }

    this._isWindowVisible = visible;

    if (!visible) {
      this.clearIdleTimer();
      this.sceneManager.pause();
    } else {
      this._isIdle = false;
      this.sceneManager.fpsCap = this._activeFps;
      this.sceneManager.resume();
      this.scheduleIdleTimer();
    }
  }

  /**
   * Disposes of listeners and timers.
   */
  public dispose(): void {
    if (this._isDisposed) {
      return;
    }
    this._isDisposed = true;
    this.clearIdleTimer();

    if (this.tauriUnlisten) {
      this.tauriUnlisten();
      this.tauriUnlisten = null;
    }

    if (this.attachedListeners) {
      this.detachDomListeners();
    }
  }

  private scheduleIdleTimer(): void {
    this.clearIdleTimer();
    if (this._isDisposed || !this._isWindowVisible) {
      return;
    }
    this.idleTimer = setTimeout(() => {
      this.enterIdle();
    }, this._idleTimeoutMs);
  }

  private clearIdleTimer(): void {
    if (this.idleTimer !== null) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  private enterIdle(): void {
    this.idleTimer = null;
    if (this._isDisposed || !this._isWindowVisible) {
      return;
    }
    this._isIdle = true;
    this.sceneManager.fpsCap = this._idleFps;
  }

  private readonly onDomActivity = (): void => {
    this.notifyActivity();
  };

  private readonly onVisibilityChange = (): void => {
    if (!this.doc || this._isDisposed) {
      return;
    }
    if (this.doc.visibilityState === "hidden") {
      this.setWindowVisible(false);
    } else if (this.doc.visibilityState === "visible") {
      this.setWindowVisible(true);
    }
  };

  private attachDomListeners(): void {
    if (this.target) {
      for (const eventName of ACTIVITY_EVENTS) {
        this.target.addEventListener(eventName, this.onDomActivity, {
          passive: true
        });
      }
    }
    if (this.doc) {
      this.doc.addEventListener("visibilitychange", this.onVisibilityChange);
    }
  }

  private detachDomListeners(): void {
    if (this.target) {
      for (const eventName of ACTIVITY_EVENTS) {
        this.target.removeEventListener(eventName, this.onDomActivity);
      }
    }
    if (this.doc) {
      this.doc.removeEventListener("visibilitychange", this.onVisibilityChange);
    }
  }
}
