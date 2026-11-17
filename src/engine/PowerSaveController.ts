import type { SceneManager } from "./SceneManager";

export type UnlistenFn = () => void;

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
  private readonly activeLocks = new Set<string>();
  private readonly idleListeners = new Set<(idle: boolean) => void>();
  private readonly visibilityListeners = new Set<(visible: boolean) => void>();

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
        void res
          .then((unlisten) => {
            if (this._isDisposed) {
              unlisten();
            } else {
              this.tauriUnlisten = unlisten;
            }
          })
          .catch((err: unknown) => {
            console.warn(
              "[PowerSaveController] Failed to subscribe to visibility listener:",
              err
            );
          });
      } else if (typeof res === "function") {
        this.tauriUnlisten = res;
      }
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
   * Acquires an active wake lock for external activity (e.g. speech, VRMA, reaction).
   * While at least one lock is active and the window is visible, maintains `activeFps`
   * and suppresses idle timeout.
   */
  public acquireActiveLock(token: string): void {
    if (this._isDisposed || !token) {
      return;
    }

    this.activeLocks.add(token);
    this.clearIdleTimer();

    if (this._isWindowVisible) {
      const wasIdle = this._isIdle;
      this._isIdle = false;
      this.sceneManager.fpsCap = this._activeFps;
      if (wasIdle) {
        this.emitIdleChange(false);
      }
    }
  }

  /**
   * Releases a previously acquired active wake lock.
   * When the last lock is released while the window is visible, re-arms the idle timer.
   */
  public releaseActiveLock(token: string): void {
    if (this._isDisposed || !token) {
      return;
    }

    const removed = this.activeLocks.delete(token);
    if (removed && this.activeLocks.size === 0 && this._isWindowVisible) {
      this.scheduleIdleTimer();
    }
  }

  /**
   * Returns true when one or more active wake locks are currently held.
   */
  public hasActiveLocks(): boolean {
    return this.activeLocks.size > 0;
  }

  /**
   * Subscribes to transitions between active and idle power-save modes.
   */
  public onIdleChange(listener: (idle: boolean) => void): UnlistenFn {
    this.idleListeners.add(listener);
    return () => {
      this.idleListeners.delete(listener);
    };
  }

  /**
   * Subscribes to window visibility transitions.
   */
  public onVisibilityChange(listener: (visible: boolean) => void): UnlistenFn {
    this.visibilityListeners.add(listener);
    return () => {
      this.visibilityListeners.delete(listener);
    };
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
      this.emitIdleChange(false);
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

    const visibilityChanged = this._isWindowVisible !== visible;
    this._isWindowVisible = visible;

    if (!visible) {
      this.clearIdleTimer();
      this.sceneManager.pause();
    } else {
      const wasIdle = this._isIdle;
      this._isIdle = false;
      this.sceneManager.fpsCap = this._activeFps;
      this.sceneManager.resume();
      this.scheduleIdleTimer();
      if (wasIdle) {
        this.emitIdleChange(false);
      }
    }

    if (visibilityChanged) {
      this.emitVisibilityChange(visible);
    }
  }

  /**
   * Disposes of listeners, active wake locks, and timers.
   */
  public dispose(): void {
    if (this._isDisposed) {
      return;
    }
    this._isDisposed = true;
    this.clearIdleTimer();
    this.activeLocks.clear();
    this.idleListeners.clear();
    this.visibilityListeners.clear();

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
    if (
      this._isDisposed ||
      !this._isWindowVisible ||
      this.activeLocks.size > 0
    ) {
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
    if (
      this._isDisposed ||
      !this._isWindowVisible ||
      this.activeLocks.size > 0
    ) {
      return;
    }
    const wasIdle = this._isIdle;
    this._isIdle = true;
    this.sceneManager.fpsCap = this._idleFps;
    if (!wasIdle) {
      this.emitIdleChange(true);
    }
  }

  private emitIdleChange(idle: boolean): void {
    for (const listener of this.idleListeners) {
      listener(idle);
    }
  }

  private emitVisibilityChange(visible: boolean): void {
    for (const listener of this.visibilityListeners) {
      listener(visible);
    }
  }

  private readonly onDomActivity = (): void => {
    this.notifyActivity();
  };

  private readonly handleDocVisibilityChange = (): void => {
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
      this.doc.addEventListener(
        "visibilitychange",
        this.handleDocVisibilityChange
      );
    }
  }

  private detachDomListeners(): void {
    if (this.target) {
      for (const eventName of ACTIVITY_EVENTS) {
        this.target.removeEventListener(eventName, this.onDomActivity);
      }
    }
    if (this.doc) {
      this.doc.removeEventListener(
        "visibilitychange",
        this.handleDocVisibilityChange
      );
    }
  }
}
