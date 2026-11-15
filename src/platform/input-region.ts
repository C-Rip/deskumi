import * as THREE from "three";
import type { System } from "../engine/types";
import { setInputRegion as sendInputRegionIpc } from "./ipc";
import { SilhouetteExtractor } from "./silhouette";
import {
  areRectsEqual,
  calculateAvatarSegmentRects,
  calculateScreenBoundingBox,
  isPointInRects,
  normalizeRects,
  type Rect
} from "./input-region-math";

export {
  areRectsEqual,
  calculateAvatarSegmentRects,
  calculateScreenBoundingBox,
  isPointInRects,
  normalizeRects,
  type Rect
};

/**
 * Options for configuring an InputRegionManager instance.
 */
export interface InputRegionManagerOptions {
  /**
   * Maximum update frequency in Hz. Defaults to 15 (~66.7ms per update).
   */
  hz?: number;

  /**
   * Custom function to dispatch the region to the underlying platform/IPC.
   * Defaults to calling `setInputRegion` from `./ipc`.
   */
  sender?: (rects: Rect[] | null) => Promise<void>;
}

/**
 * Manages click-through input regions with throttling (~15 Hz) and deduplication
 * to avoid flooding the IPC bridge during animations.
 */
export class InputRegionManager {
  private readonly intervalMs: number;
  private readonly sender: (rects: Rect[] | null) => Promise<void>;

  private lastSentTime = 0;
  private lastAppliedRects: Rect[] | null = null;
  private pendingRects: Rect[] | null | undefined = undefined;
  private timerId: ReturnType<typeof setTimeout> | null = null;

  constructor(options: InputRegionManagerOptions = {}) {
    const hz = options.hz ?? 15;
    this.intervalMs = hz > 0 ? 1000 / hz : 0;
    this.sender = options.sender ?? sendInputRegionIpc;
  }

  /**
   * Sets the target input region with throttling. If called repeatedly
   * within the throttle window, updates are batched and sent at `hz` rate.
   */
  async setRegion(rects: Rect[] | null): Promise<void> {
    const normalized = normalizeRects(rects);

    // If identical to what is already active, ignore
    if (areRectsEqual(normalized, this.lastAppliedRects)) {
      if (this.pendingRects !== undefined) {
        if (areRectsEqual(normalized, this.pendingRects)) {
          this.pendingRects = undefined;
          if (this.timerId !== null) {
            clearTimeout(this.timerId);
            this.timerId = null;
          }
        }
      }
      return;
    }

    const now = Date.now();
    const elapsed = now - this.lastSentTime;

    if (elapsed >= this.intervalMs) {
      // Discard any pending timer since we are sending immediately
      if (this.timerId !== null) {
        clearTimeout(this.timerId);
        this.timerId = null;
      }
      this.pendingRects = undefined;
      await this.apply(normalized, now);
    } else {
      // Within throttle interval; queue pending update
      this.pendingRects = normalized;
      if (this.timerId === null) {
        const delay = Math.max(0, this.intervalMs - elapsed);
        this.timerId = setTimeout(() => {
          this.timerId = null;
          if (this.pendingRects !== undefined) {
            const next = this.pendingRects;
            this.pendingRects = undefined;
            if (!areRectsEqual(next, this.lastAppliedRects)) {
              void this.apply(next, Date.now());
            }
          }
        }, delay);
      }
    }
  }

  /**
   * Immediately applies the region without throttling.
   */
  async setImmediate(rects: Rect[] | null): Promise<void> {
    if (this.timerId !== null) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
    this.pendingRects = undefined;
    const normalized = normalizeRects(rects);
    if (!areRectsEqual(normalized, this.lastAppliedRects)) {
      await this.apply(normalized, Date.now());
    }
  }

  /**
   * Resets region to full window (null).
   */
  async reset(): Promise<void> {
    await this.setImmediate(null);
  }

  /**
   * Flushes any pending throttled update immediately.
   */
  async flush(): Promise<void> {
    if (this.timerId !== null) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
    if (this.pendingRects !== undefined) {
      const next = this.pendingRects;
      this.pendingRects = undefined;
      if (!areRectsEqual(next, this.lastAppliedRects)) {
        await this.apply(next, Date.now());
      }
    }
  }

  /**
   * Returns the last applied rects (null = full window).
   */
  getLastAppliedRects(): Rect[] | null {
    return this.lastAppliedRects;
  }

  /**
   * Returns true if there is a pending queued update.
   */
  isPending(): boolean {
    return this.pendingRects !== undefined;
  }

  /**
   * Cleans up timers and pending state.
   */
  dispose(): void {
    if (this.timerId !== null) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
    this.pendingRects = undefined;
  }

  private async apply(rects: Rect[] | null, timestamp: number): Promise<void> {
    this.lastAppliedRects = rects;
    this.lastSentTime = timestamp;
    try {
      await this.sender(rects);
    } catch (err: unknown) {
      console.error("[deskumi] Failed to set input region:", err);
    }
  }
}

/**
 * Default global instance of InputRegionManager configured at 15 Hz.
 */
export const defaultInputRegionManager = new InputRegionManager({ hz: 15 });

/**
 * High-level wrapper function to set the input region with 15 Hz throttling.
 */
export async function setInputRegion(rects: Rect[] | null): Promise<void> {
  await defaultInputRegionManager.setRegion(rects);
}

/**
 * Resets the input region to the full window.
 */
export async function resetInputRegion(): Promise<void> {
  await defaultInputRegionManager.reset();
}

/**
 * Configuration options for AvatarInputRegionSystem.
 */
export interface AvatarInputRegionSystemOptions {
  /**
   * Optional Three.js WebGLRenderer for pixel-perfect alpha silhouette extraction.
   */
  renderer?: THREE.WebGLRenderer;

  /**
   * Optional Scene reference (needed if renderer is supplied).
   */
  scene?: THREE.Scene;

  /**
   * Downscale factor for the silhouette extractor (default 4).
   */
  downscale?: number;

  /**
   * InputRegionManager to receive calculated rects.
   */
  manager?: InputRegionManager;

  /**
   * Viewport size provider function.
   */
  getViewportSize?: () => { width: number; height: number };

  /**
   * Padding in pixels around hit regions (default 4 for silhouette, 8 for boxes).
   */
  padding?: number;

  /**
   * When true, keeps the OS window input region open to the full frame so mousemove
   * events are tracked across the entire frame, while still extracting silhouette rects
   * for in-window hit testing (reactions and dragging).
   */
  fullWindowPointer?: boolean;

  /**
   * Optional logical frame size provider (used when GTK/X11 window size differs
   * from WebView CSS pixels due to HiDPI fractional scaling).
   */
  getLogicalFrameSize?: () => { width: number; height: number } | null;
}

/**
 * Engine system that continuously synchronizes the input region with the
 * avatar's pixel-perfect silhouette (or fallback projected anatomical segments).
 */
export class AvatarInputRegionSystem implements System {
  private readonly manager: InputRegionManager;
  private readonly getViewportSize: () => { width: number; height: number };
  private readonly getLogicalFrameSize: () => {
    width: number;
    height: number;
  } | null;
  private readonly padding: number;
  private readonly silhouetteExtractor: SilhouetteExtractor | null = null;
  private readonly renderer?: THREE.WebGLRenderer;
  private readonly scene?: THREE.Scene;
  private fullWindowPointer = false;
  private lastCalculatedRects: Rect[] = [];

  constructor(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private readonly avatarOrVRM: any,
    private readonly camera: THREE.Camera,
    optionsOrManager:
      | InputRegionManager
      | AvatarInputRegionSystemOptions = defaultInputRegionManager,
    legacyGetViewportSize?: () => { width: number; height: number },
    legacyPadding = 8
  ) {
    if (
      optionsOrManager &&
      ("setRegion" in optionsOrManager || "reset" in optionsOrManager)
    ) {
      // Legacy signature: (avatarOrVRM, camera, manager, getViewportSize, padding)
      this.manager = optionsOrManager as InputRegionManager;
      this.getViewportSize =
        legacyGetViewportSize ??
        (() => ({
          width: typeof window !== "undefined" ? window.innerWidth : 800,
          height: typeof window !== "undefined" ? window.innerHeight : 600
        }));
      this.getLogicalFrameSize = () => null;
      this.padding = legacyPadding;
    } else {
      // Options object signature
      const opts = (optionsOrManager ?? {}) as AvatarInputRegionSystemOptions;
      this.manager = opts.manager ?? defaultInputRegionManager;
      this.renderer = opts.renderer;
      this.scene = opts.scene;
      this.fullWindowPointer = opts.fullWindowPointer ?? false;
      this.getLogicalFrameSize = opts.getLogicalFrameSize ?? (() => null);
      this.getViewportSize =
        opts.getViewportSize ??
        (() => {
          if (this.renderer) {
            const size = this.renderer.getSize(new THREE.Vector2());
            if (size.x > 0 && size.y > 0) {
              return { width: size.x, height: size.y };
            }
          }
          return {
            width: typeof window !== "undefined" ? window.innerWidth : 800,
            height: typeof window !== "undefined" ? window.innerHeight : 600
          };
        });
      this.padding = opts.padding ?? (opts.renderer ? 3 : 8);

      if (this.renderer && this.scene) {
        this.silhouetteExtractor = new SilhouetteExtractor({
          downscale: opts.downscale ?? 4,
          padding: this.padding
        });
      }
    }
  }

  public setFullWindowPointer(enabled: boolean): void {
    this.fullWindowPointer = enabled;
    if (enabled) {
      void this.manager.reset();
    }
  }

  public get isFullWindowPointer(): boolean {
    return this.fullWindowPointer;
  }

  public getHitRects(): Rect[] {
    return this.lastCalculatedRects;
  }

  public isPointOnAvatar(x: number, y: number): boolean {
    if (this.lastCalculatedRects.length === 0) {
      return true;
    }
    return isPointInRects(x, y, this.lastCalculatedRects);
  }

  private applyOrStoreRects(
    rects: Rect[],
    viewportSize: { width: number; height: number }
  ): void {
    this.lastCalculatedRects = normalizeRects(rects) ?? [];
    if (this.fullWindowPointer) {
      void this.manager.reset();
      return;
    }

    const logical = this.getLogicalFrameSize();
    const scaleX =
      logical && logical.width > 0 && viewportSize.width > 0
        ? logical.width / viewportSize.width
        : 1;
    const scaleY =
      logical && logical.height > 0 && viewportSize.height > 0
        ? logical.height / viewportSize.height
        : 1;

    if (Math.abs(scaleX - 1) < 0.01 && Math.abs(scaleY - 1) < 0.01) {
      void this.manager.setRegion(this.lastCalculatedRects);
      return;
    }

    const scaledRects = this.lastCalculatedRects.map((r) => ({
      x: Math.round(r.x * scaleX),
      y: Math.round(r.y * scaleY),
      w: Math.max(1, Math.round(r.w * scaleX)),
      h: Math.max(1, Math.round(r.h * scaleY))
    }));
    void this.manager.setRegion(scaledRects);
  }

  update(_dt: number): void {
    void _dt;
    const size = this.getViewportSize();

    // 1. Pixel-perfect silhouette extraction if renderer & scene are provided
    if (this.silhouetteExtractor && this.renderer && this.scene) {
      try {
        const silhouetteRects = this.silhouetteExtractor.extract(
          this.renderer,
          this.scene,
          this.camera,
          size.width,
          size.height
        );
        if (silhouetteRects.length > 0) {
          this.applyOrStoreRects(silhouetteRects, size);
          return;
        }
      } catch (err: unknown) {
        console.warn(
          "[deskumi] Silhouette extraction failed, falling back to segments:",
          err
        );
      }
    }

    // 2. Anatomical segments fallback
    const isVRM =
      this.avatarOrVRM &&
      ("humanoid" in this.avatarOrVRM || "scene" in this.avatarOrVRM);
    const rects = isVRM
      ? calculateAvatarSegmentRects(
          this.avatarOrVRM,
          this.camera,
          size.width,
          size.height,
          this.padding
        )
      : null;

    if (rects && rects.length > 0) {
      this.applyOrStoreRects(rects, size);
    } else {
      // 3. Whole avatar bounding box fallback
      const rootObj = this.avatarOrVRM?.scene ?? this.avatarOrVRM;
      if (rootObj && "isObject3D" in rootObj) {
        const rect = calculateScreenBoundingBox(
          rootObj,
          this.camera,
          size.width,
          size.height,
          this.padding
        );
        if (rect) {
          this.applyOrStoreRects([rect], size);
        }
      }
    }
  }

  dispose(): void {
    if (this.silhouetteExtractor) {
      this.silhouetteExtractor.dispose();
    }
    void this.manager.reset();
  }
}
