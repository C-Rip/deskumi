import type { System } from "../engine/types";
import { calcNdcFromMouse, type LookAtSystem } from "../engine/LookAtSystem";
import { getPlatformCaps, getWindowCursorPosition } from "./ipc";

export interface GlobalCursorLookAtOptions {
  /**
   * Maximum polling frequency in Hz.
   * @default 15
   */
  hz?: number;

  /**
   * Optional viewport size provider. Defaults to `window.innerWidth/innerHeight`.
   */
  getViewportSize?: () => { width: number; height: number };

  /**
   * Optional logical frame size provider (used when GTK/X11 window size differs
   * from WebView CSS pixels due to HiDPI fractional scaling).
   */
  getLogicalFrameSize?: () => { width: number; height: number } | null;

  /**
   * Optional custom cursor position provider (for testing).
   */
  queryCursorPosition?: () => Promise<[number, number] | null>;

  /**
   * Optional capability checker (for testing).
   */
  checkGlobalCursorCap?: () => Promise<boolean>;
}

/**
 * Bridges global cursor polling (`get_window_cursor_position`) to `LookAtSystem`
 * on platforms where `caps.globalCursor` is `true` (X11 / XWayland / Windows),
 * allowing silhouette click-through (`fullWindowPointer: false`) while still
 * tracking the pointer across transparent areas and the rest of the desktop.
 */
export class GlobalCursorLookAtSystem implements System {
  private readonly intervalMs: number;
  private readonly getViewportSize: () => { width: number; height: number };
  private readonly getLogicalFrameSize: () => {
    width: number;
    height: number;
  } | null;
  private readonly queryCursorPosition: () => Promise<[number, number] | null>;

  private isDisposed = false;
  private isCapChecked = false;
  private isEnabled = false;
  private isQueryInFlight = false;
  private elapsedMs = 0;

  private lastX: number | null = null;
  private lastY: number | null = null;
  private lastCssX: number | null = null;
  private lastCssY: number | null = null;

  constructor(
    private readonly lookAtSystem: LookAtSystem,
    options: GlobalCursorLookAtOptions = {}
  ) {
    const hz = Math.max(1, options.hz ?? 15);
    this.intervalMs = 1000 / hz;

    this.getViewportSize =
      options.getViewportSize ??
      (() => ({
        width: typeof window !== "undefined" ? window.innerWidth : 400,
        height: typeof window !== "undefined" ? window.innerHeight : 600
      }));
    this.getLogicalFrameSize = options.getLogicalFrameSize ?? (() => null);

    this.queryCursorPosition =
      options.queryCursorPosition ?? getWindowCursorPosition;

    const checkCap =
      options.checkGlobalCursorCap ??
      (async () => {
        const caps = await getPlatformCaps();
        return caps.globalCursor;
      });

    void checkCap()
      .then((supported) => {
        if (!this.isDisposed) {
          this.isCapChecked = true;
          this.isEnabled = supported;
          if (supported) {
            this.lookAtSystem.setIgnoreMouseLeave?.(true);
          }
        }
      })
      .catch(() => {
        if (!this.isDisposed) {
          this.isCapChecked = true;
          this.isEnabled = false;
        }
      });
  }

  public update(dt: number): void {
    if (
      this.isDisposed ||
      !this.isCapChecked ||
      !this.isEnabled ||
      this.isQueryInFlight ||
      dt <= 0
    ) {
      return;
    }

    this.elapsedMs += dt * 1000;
    if (this.elapsedMs < this.intervalMs) {
      return;
    }
    this.elapsedMs = 0;
    this.isQueryInFlight = true;

    void this.queryCursorPosition()
      .then((pos) => {
        if (this.isDisposed || !pos) {
          return;
        }
        const [x, y] = pos;
        if (x === this.lastX && y === this.lastY) {
          return;
        }
        this.lastX = x;
        this.lastY = y;

        const { width, height } = this.getViewportSize();
        const logical = this.getLogicalFrameSize();
        const scaleX =
          logical && logical.width > 0 && width > 0 ? logical.width / width : 1;
        const scaleY =
          logical && logical.height > 0 && height > 0
            ? logical.height / height
            : 1;
        const cssX = x / scaleX;
        const cssY = y / scaleY;
        this.lastCssX = cssX;
        this.lastCssY = cssY;

        const ndc = calcNdcFromMouse(cssX, cssY, width, height);
        this.lookAtSystem.setCursorNdc(ndc.x, ndc.y);
      })
      .catch(() => {
        // Ignore transient IPC query errors
      })
      .finally(() => {
        this.isQueryInFlight = false;
      });
  }

  public getLastCursorPosition(): { x: number; y: number } | null {
    if (this.lastCssX === null || this.lastCssY === null) {
      return null;
    }
    return { x: this.lastCssX, y: this.lastCssY };
  }

  public dispose(): void {
    this.isDisposed = true;
    this.isEnabled = false;
    this.lookAtSystem.setIgnoreMouseLeave?.(false);
  }
}
