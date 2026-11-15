import { getActiveWindowRect, setWindowDesktopPosition } from "./ipc";

export interface WindowRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WindowSize {
  width: number;
  height: number;
}

/**
 * Computes the desktop `(x, y)` coordinates for Deskumi to perch centered
 * atop a target window's titlebar, or `null` when there is insufficient space
 * above the target window (e.g. maximized at the top edge).
 */
export function calculateWindowPerchPosition(
  target: WindowRect,
  deskumiSize: WindowSize,
  options: { footOverlapPx?: number; minTopRoomPx?: number } = {}
): { x: number; y: number } | null {
  const footOverlapPx =
    options.footOverlapPx ?? Math.round(deskumiSize.height * 0.16);
  const minTopRoomPx = options.minTopRoomPx ?? 24;

  if (
    target.width <= 0 ||
    target.height <= 0 ||
    deskumiSize.width <= 0 ||
    deskumiSize.height <= 0
  ) {
    return null;
  }

  if (target.y < minTopRoomPx) {
    return null;
  }

  const x = Math.max(
    0,
    Math.round(target.x + (target.width - deskumiSize.width) / 2)
  );
  const y = Math.round(target.y - deskumiSize.height + footOverlapPx);
  if (y < 0) {
    return null;
  }
  return { x, y };
}

export interface WindowPerchControllerOptions {
  intervalMs?: number;
  getDeskumiSize?: () => WindowSize;
  queryActiveWindow?: () => Promise<[number, number, number, number] | null>;
  moveDeskumi?: (x: number, y: number) => Promise<void>;
  onPerchStateChange?: (isPerched: boolean) => void;
}

/**
 * Periodically aligns Deskumi above the active desktop window's titlebar
 * when window interaction mode is enabled.
 */
export class WindowPerchController {
  private readonly intervalMs: number;
  private readonly getDeskumiSize: () => WindowSize;
  private readonly queryActiveWindow: () => Promise<
    [number, number, number, number] | null
  >;
  private readonly moveDeskumi: (x: number, y: number) => Promise<void>;
  private readonly onPerchStateChange?: (isPerched: boolean) => void;

  private timerId: ReturnType<typeof setInterval> | null = null;
  private isEnabled = false;
  private isPerched = false;
  private isInFlight = false;
  private lastX: number | null = null;
  private lastY: number | null = null;

  constructor(options: WindowPerchControllerOptions = {}) {
    this.intervalMs = Math.max(16, options.intervalMs ?? 25);
    this.getDeskumiSize =
      options.getDeskumiSize ??
      (() => ({
        width: typeof window !== "undefined" ? window.innerWidth : 400,
        height: typeof window !== "undefined" ? window.innerHeight : 600
      }));
    this.queryActiveWindow = options.queryActiveWindow ?? getActiveWindowRect;
    this.moveDeskumi = options.moveDeskumi ?? setWindowDesktopPosition;
    this.onPerchStateChange = options.onPerchStateChange;
  }

  private setPerched(perched: boolean): void {
    if (this.isPerched !== perched) {
      this.isPerched = perched;
      if (!perched) {
        this.lastX = null;
        this.lastY = null;
      }
      this.onPerchStateChange?.(perched);
    }
  }

  public setEnabled(enabled: boolean): void {
    if (this.isEnabled === enabled) return;
    this.isEnabled = enabled;
    this.lastX = null;
    this.lastY = null;

    if (enabled) {
      this.start();
    } else {
      this.stop();
      this.setPerched(false);
    }
  }

  public get enabled(): boolean {
    return this.isEnabled;
  }

  public get perched(): boolean {
    return this.isPerched;
  }

  public async step(): Promise<void> {
    if (!this.isEnabled || this.isInFlight) return;
    this.isInFlight = true;
    try {
      const rect = await this.queryActiveWindow();
      if (!this.isEnabled) return;
      if (!rect) {
        this.setPerched(false);
        return;
      }

      const [x, y, width, height] = rect;
      let pos = calculateWindowPerchPosition(
        { x, y, width, height },
        this.getDeskumiSize()
      );
      if (!pos) {
        this.setPerched(false);
        return;
      }

      const wasPerched = this.isPerched;
      this.setPerched(true);
      if (!wasPerched) {
        // Recompute once in case onPerchStateChange resized the compact sitting frame.
        pos =
          calculateWindowPerchPosition(
            { x, y, width, height },
            this.getDeskumiSize()
          ) ?? pos;
      }

      let nextX = pos.x;
      let nextY = pos.y;

      if (this.lastX !== null && this.lastY !== null) {
        const dx = pos.x - this.lastX;
        const dy = pos.y - this.lastY;
        if (Math.abs(dx) < 1 && Math.abs(dy) < 1) {
          return;
        }
        // Smoothly glide across large jumps (e.g. switching windows) while
        // keeping small drag updates 1:1 with zero lag.
        if (Math.hypot(dx, dy) > 36) {
          nextX = Math.round(this.lastX + dx * 0.45);
          nextY = Math.round(this.lastY + dy * 0.45);
        }
      }

      this.lastX = nextX;
      this.lastY = nextY;
      await this.moveDeskumi(nextX, nextY);
    } catch {
      // Ignore transient IPC errors
    } finally {
      this.isInFlight = false;
    }
  }

  private start(): void {
    if (this.timerId !== null) return;
    void this.step();
    this.timerId = setInterval(() => {
      void this.step();
    }, this.intervalMs);
  }

  private stop(): void {
    if (this.timerId !== null) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
  }

  public dispose(): void {
    this.isEnabled = false;
    this.stop();
    this.setPerched(false);
  }
}
