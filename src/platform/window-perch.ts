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

export const DEFAULT_MIN_TOP_ROOM_PX = 24;

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
    options.footOverlapPx ?? Math.round(deskumiSize.height * 0.36);
  const minTopRoomPx =
    options.minTopRoomPx !== undefined && Number.isFinite(options.minTopRoomPx)
      ? Math.max(0, options.minTopRoomPx)
      : DEFAULT_MIN_TOP_ROOM_PX;

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
  getSeatOverlapPx?: (deskumiSize: WindowSize) => number | null;
  minTopRoomPx?: number;
  getMinTopRoomPx?: () => number | null | undefined;
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
  private readonly getSeatOverlapPx?: (
    deskumiSize: WindowSize
  ) => number | null;
  private readonly getMinTopRoomPx?: () => number | null | undefined;
  private readonly queryActiveWindow: () => Promise<
    [number, number, number, number] | null
  >;
  private readonly moveDeskumi: (x: number, y: number) => Promise<void>;
  private readonly onPerchStateChange?: (isPerched: boolean) => void;

  private configuredMinTopRoomPx?: number;
  private timerId: ReturnType<typeof setInterval> | null = null;
  private isEnabled = false;
  private isPerched = false;
  private isInFlight = false;
  private lastX: number | null = null;
  private lastY: number | null = null;
  private lastTargetRect: [number, number, number, number] | null = null;
  private suppressedRect: [number, number, number, number] | null = null;

  constructor(options: WindowPerchControllerOptions = {}) {
    this.intervalMs = Math.max(16, options.intervalMs ?? 25);
    this.getDeskumiSize =
      options.getDeskumiSize ??
      (() => ({
        width: typeof window !== "undefined" ? window.innerWidth : 400,
        height: typeof window !== "undefined" ? window.innerHeight : 600
      }));
    this.getSeatOverlapPx = options.getSeatOverlapPx;
    this.configuredMinTopRoomPx = options.minTopRoomPx;
    this.getMinTopRoomPx = options.getMinTopRoomPx;
    this.queryActiveWindow = options.queryActiveWindow ?? getActiveWindowRect;
    this.moveDeskumi = options.moveDeskumi ?? setWindowDesktopPosition;
    this.onPerchStateChange = options.onPerchStateChange;
  }

  public setMinTopRoomPx(minTopRoomPx: number | null | undefined): void {
    this.configuredMinTopRoomPx =
      minTopRoomPx === null ? undefined : minTopRoomPx;
  }

  public get minTopRoomPx(): number {
    const raw = this.getMinTopRoomPx?.() ?? this.configuredMinTopRoomPx;
    return typeof raw === "number" && Number.isFinite(raw)
      ? Math.max(0, raw)
      : DEFAULT_MIN_TOP_ROOM_PX;
  }

  private setPerched(perched: boolean): void {
    if (this.isPerched !== perched) {
      this.isPerched = perched;
      if (!perched) {
        this.lastX = null;
        this.lastY = null;
        this.lastTargetRect = null;
      }
      this.onPerchStateChange?.(perched);
    }
  }

  /**
   * Called when the user manually drags Deskumi away from a window.
   * Un-perches immediately and suppresses re-attaching to the current window
   * until the user focuses or moves another window.
   */
  public notifyManualDrag(): void {
    if (this.lastTargetRect) {
      this.suppressedRect = [...this.lastTargetRect];
    }
    this.setPerched(false);
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
        this.suppressedRect = null;
        this.setPerched(false);
        return;
      }

      if (this.suppressedRect) {
        const [sx, sy, sw, sh] = this.suppressedRect;
        if (
          Math.abs(rect[0] - sx) < 4 &&
          Math.abs(rect[1] - sy) < 4 &&
          Math.abs(rect[2] - sw) < 4 &&
          Math.abs(rect[3] - sh) < 4
        ) {
          return;
        }
        this.suppressedRect = null;
      }

      const [x, y, width, height] = rect;
      const targetRect: WindowRect = { x, y, width, height };
      let pos = this.computePerchPosition(targetRect, this.getDeskumiSize());
      if (!pos) {
        if (this.isPerched && this.lastTargetRect) {
          const [lx, ly, lw] = this.lastTargetRect;
          const isSameWindowMovedUp =
            Math.abs(x - lx) < 80 && Math.abs(width - lw) < 80;
          const seatX = lx + lw / 2;
          const isPerchCoveredByFocusedWindow =
            seatX >= x && seatX <= x + width && ly >= y && ly <= y + height;

          if (isSameWindowMovedUp || isPerchCoveredByFocusedWindow) {
            this.setPerched(false);
          }
        }
        return;
      }

      this.lastTargetRect = [x, y, width, height];

      const wasPerched = this.isPerched;
      this.setPerched(true);
      if (!wasPerched) {
        // Recompute once in case onPerchStateChange resized the compact sitting frame.
        pos =
          this.computePerchPosition(targetRect, this.getDeskumiSize()) ?? pos;
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

  private computePerchPosition(
    target: WindowRect,
    deskumiSize: WindowSize
  ): { x: number; y: number } | null {
    const seatOverlap = this.getSeatOverlapPx?.(deskumiSize) ?? undefined;
    return calculateWindowPerchPosition(target, deskumiSize, {
      ...(seatOverlap !== undefined ? { footOverlapPx: seatOverlap } : {}),
      minTopRoomPx: this.minTopRoomPx
    });
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
