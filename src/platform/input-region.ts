import * as THREE from "three";
import type { System } from "../engine/types";
import { setInputRegion as sendInputRegionIpc } from "./ipc";

/**
 * 2D rectangle in window client/logical pixel coordinates.
 */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

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
 * Normalizes an array of rects by rounding coordinates to integers
 * and filtering out non-positive dimensions.
 * Returns null if the input is null (representing the full window).
 */
export function normalizeRects(rects: readonly Rect[] | null): Rect[] | null {
  if (rects === null) {
    return null;
  }
  return rects
    .map((r) => ({
      x: Math.round(r.x),
      y: Math.round(r.y),
      w: Math.round(r.w),
      h: Math.round(r.h)
    }))
    .filter((r) => r.w > 0 && r.h > 0);
}

/**
 * Compares two rect arrays for equality.
 */
export function areRectsEqual(
  a: readonly Rect[] | null,
  b: readonly Rect[] | null
): boolean {
  if (a === b) {
    return true;
  }
  if (a === null || b === null) {
    return false;
  }
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    const ra = a[i];
    const rb = b[i];
    if (ra.x !== rb.x || ra.y !== rb.y || ra.w !== rb.w || ra.h !== rb.h) {
      return false;
    }
  }
  return true;
}

/**
 * Projects the 3D bounding box of an Object3D into 2D screen/client coordinates.
 *
 * @param object The 3D object to measure (e.g. avatar scene root).
 * @param camera Camera used for scene rendering.
 * @param viewportWidth Width of viewport in CSS/logical pixels.
 * @param viewportHeight Height of viewport in CSS/logical pixels.
 * @param padding Optional padding in pixels around the projected box.
 * @returns Projected Rect clamped to viewport, or null if invisible/empty.
 */
export function calculateScreenBoundingBox(
  object: THREE.Object3D,
  camera: THREE.Camera,
  viewportWidth: number,
  viewportHeight: number,
  padding = 0
): Rect | null {
  if (viewportWidth <= 0 || viewportHeight <= 0) {
    return null;
  }

  const box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty()) {
    return null;
  }

  camera.updateMatrixWorld(true);

  const corners: THREE.Vector3[] = [
    new THREE.Vector3(box.min.x, box.min.y, box.min.z),
    new THREE.Vector3(box.min.x, box.min.y, box.max.z),
    new THREE.Vector3(box.min.x, box.max.y, box.min.z),
    new THREE.Vector3(box.min.x, box.max.y, box.max.z),
    new THREE.Vector3(box.max.x, box.min.y, box.min.z),
    new THREE.Vector3(box.max.x, box.min.y, box.max.z),
    new THREE.Vector3(box.max.x, box.max.y, box.min.z),
    new THREE.Vector3(box.max.x, box.max.y, box.max.z)
  ];

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (const corner of corners) {
    corner.project(camera);

    // Convert Normalized Device Coordinates (NDC) [-1, 1] to screen coords
    const px = ((corner.x + 1) / 2) * viewportWidth;
    const py = ((1 - corner.y) / 2) * viewportHeight;

    if (px < minX) minX = px;
    if (px > maxX) maxX = px;
    if (py < minY) minY = py;
    if (py > maxY) maxY = py;
  }

  if (
    !Number.isFinite(minX) ||
    !Number.isFinite(maxX) ||
    !Number.isFinite(minY) ||
    !Number.isFinite(maxY)
  ) {
    return null;
  }

  // Apply padding and clamp to viewport bounds
  const x0 = Math.max(0, Math.floor(minX - padding));
  const y0 = Math.max(0, Math.floor(minY - padding));
  const x1 = Math.min(viewportWidth, Math.ceil(maxX + padding));
  const y1 = Math.min(viewportHeight, Math.ceil(maxY + padding));

  const w = Math.max(0, x1 - x0);
  const h = Math.max(0, y1 - y0);

  if (w <= 0 || h <= 0) {
    return null;
  }

  return { x: x0, y: y0, w, h };
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
 * Engine system that continuously synchronizes the input region with the
 * avatar's projected screen bounding box.
 */
export class AvatarInputRegionSystem implements System {
  constructor(
    private readonly avatarRoot: THREE.Object3D,
    private readonly camera: THREE.Camera,
    private readonly manager: InputRegionManager = defaultInputRegionManager,
    private readonly getViewportSize: () => {
      width: number;
      height: number;
    } = () => ({
      width: typeof window !== "undefined" ? window.innerWidth : 800,
      height: typeof window !== "undefined" ? window.innerHeight : 600
    }),
    private readonly padding = 16
  ) {}

  update(_dt: number): void {
    void _dt;
    const size = this.getViewportSize();
    const rect = calculateScreenBoundingBox(
      this.avatarRoot,
      this.camera,
      size.width,
      size.height,
      this.padding
    );
    if (rect) {
      void this.manager.setRegion([rect]);
    }
  }

  dispose(): void {
    void this.manager.reset();
  }
}
