import * as THREE from "three";
import type { VRM } from "@pixiv/three-vrm";
import {
  calculateBubblePosition,
  computeTailOffset,
  DEFAULT_BUBBLE_MARGIN,
  type BubblePlacement,
  type BubbleSize,
  type ScreenPoint
} from "./speech-bubble-layout";

export {
  calculateBubblePosition,
  DEFAULT_BUBBLE_MARGIN,
  type BubblePlacement,
  type BubblePosition,
  type BubbleSize,
  type ScreenPoint
} from "./speech-bubble-layout";

export interface SpeechBubbleOverlayOptions {
  container: HTMLElement;
  margin?: number;
  doc?: Pick<Document, "createElement">;
}

const DEFAULT_FALLBACK_HEAD_OFFSET_Y = 1.3;
const DEFAULT_FALLBACK_BUBBLE_WIDTH = 160;
const DEFAULT_FALLBACK_BUBBLE_HEIGHT = 44;

const _headWorldPos = new THREE.Vector3();

/**
 * Projects a VRM's `head` bone (with clean fallback to `neck` or `vrm.scene`)
 * into CSS pixel coordinates inside the given viewport.
 * Reuses a pre-allocated module scratch `THREE.Vector3` to avoid per-frame allocations.
 */
export function projectHeadToScreen(
  vrm: VRM | null | undefined,
  camera: THREE.Camera,
  viewportWidth: number,
  viewportHeight: number,
  out: ScreenPoint = { x: 0, y: 0 }
): ScreenPoint | null {
  if (
    !Number.isFinite(viewportWidth) ||
    !Number.isFinite(viewportHeight) ||
    viewportWidth <= 0 ||
    viewportHeight <= 0
  ) {
    return null;
  }

  if (!vrm) {
    out.x = viewportWidth * 0.5;
    out.y = viewportHeight * 0.25;
    return out;
  }

  const bone =
    vrm.humanoid?.getNormalizedBoneNode("head") ??
    vrm.humanoid?.getRawBoneNode("head") ??
    vrm.humanoid?.getNormalizedBoneNode("neck") ??
    vrm.humanoid?.getRawBoneNode("neck") ??
    null;

  if (bone) {
    bone.updateWorldMatrix(true, false);
    bone.getWorldPosition(_headWorldPos);
  } else {
    if (typeof vrm.scene.updateWorldMatrix === "function") {
      vrm.scene.updateWorldMatrix(true, false);
    }
    if (typeof vrm.scene.getWorldPosition === "function") {
      vrm.scene.getWorldPosition(_headWorldPos);
    } else {
      _headWorldPos.copy(vrm.scene.position);
    }
    const scaleY = Math.abs(vrm.scene.scale.y) || 1;
    _headWorldPos.y += DEFAULT_FALLBACK_HEAD_OFFSET_Y * scaleY;
  }

  camera.updateMatrixWorld();
  _headWorldPos.project(camera);

  if (
    !Number.isFinite(_headWorldPos.x) ||
    !Number.isFinite(_headWorldPos.y) ||
    _headWorldPos.z > 1
  ) {
    out.x = viewportWidth * 0.5;
    out.y = viewportHeight * 0.25;
    return out;
  }

  out.x = (_headWorldPos.x + 1) * 0.5 * viewportWidth;
  out.y = (1 - _headWorldPos.y) * 0.5 * viewportHeight;
  return out;
}

/**
 * Lightweight DOM speech bubble overlay anchored to the avatar's projected `head` bone.
 * Uses `textContent` exclusively, sets `pointer-events: none` and `user-select: none`
 * to keep click-through intact, and never resizes the native desktop window.
 */
export class SpeechBubbleOverlay {
  private readonly container: HTMLElement;
  private readonly margin: number;
  private readonly element: HTMLDivElement;

  private readonly headScreenScratch: ScreenPoint = { x: 0, y: 0 };
  private readonly bubbleSizeScratch: BubbleSize = { width: 0, height: 0 };

  private hasAnchor = false;
  private lastViewportWidth = 0;
  private lastViewportHeight = 0;
  private isVisibleState = false;
  private isDisposed = false;

  private lastAppliedX: number | null = null;
  private lastAppliedY: number | null = null;
  private lastPlacement: BubblePlacement | null = null;
  private lastTailCssValue: string | null = null;

  constructor(options: SpeechBubbleOverlayOptions) {
    this.container = options.container;
    this.margin =
      options.margin !== undefined && Number.isFinite(options.margin)
        ? Math.max(0, options.margin)
        : DEFAULT_BUBBLE_MARGIN;

    const doc =
      options.doc ??
      options.container.ownerDocument ??
      (typeof document !== "undefined" ? document : undefined);
    if (!doc) {
      throw new Error("SpeechBubbleOverlay requires a Document");
    }

    this.element = doc.createElement("div");
    this.element.className = "speech-bubble";
    this.element.style.pointerEvents = "none";
    this.element.style.userSelect = "none";
    this.element.setAttribute("role", "status");
    this.element.setAttribute("aria-live", "polite");
    this.element.setAttribute("aria-hidden", "true");
    this.setPlacementAttr("above");
    this.container.appendChild(this.element);
  }

  public get visible(): boolean {
    return this.isVisibleState;
  }

  public get domElement(): HTMLDivElement {
    return this.element;
  }

  public show(text: string): void {
    if (this.isDisposed) return;
    const normalized = text.trim();
    if (normalized.length === 0) {
      this.element.textContent = "";
      this.hide();
      return;
    }

    if (this.element.textContent !== normalized) {
      this.element.textContent = normalized;
    }
    this.isVisibleState = true;
    this.element.setAttribute("aria-hidden", "false");
    this.element.classList.add("is-visible");

    if (
      this.hasAnchor &&
      this.lastViewportWidth > 0 &&
      this.lastViewportHeight > 0
    ) {
      this.applyLayout(
        this.headScreenScratch,
        this.lastViewportWidth,
        this.lastViewportHeight
      );
    }
  }

  public hide(): void {
    if (this.isDisposed) return;
    this.isVisibleState = false;
    this.element.setAttribute("aria-hidden", "true");
    this.element.classList.remove("is-visible");
  }

  public updateAnchor(
    vrm: VRM | null | undefined,
    camera: THREE.Camera,
    viewportWidth: number,
    viewportHeight: number
  ): void {
    if (this.isDisposed) return;
    const projected = projectHeadToScreen(
      vrm,
      camera,
      viewportWidth,
      viewportHeight,
      this.headScreenScratch
    );
    if (!projected) return;

    this.hasAnchor = true;
    this.lastViewportWidth = viewportWidth;
    this.lastViewportHeight = viewportHeight;

    if (!this.isVisibleState) return;
    this.applyLayout(projected, viewportWidth, viewportHeight);
  }

  public dispose(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;
    this.isVisibleState = false;
    this.hasAnchor = false;
    this.element.textContent = "";
    this.element.classList.remove("is-visible");
    this.element.setAttribute("aria-hidden", "true");
    if (this.element.parentElement) {
      this.element.parentElement.removeChild(this.element);
    }
  }

  private setPlacementAttr(placement: BubblePlacement): void {
    if (this.element.dataset) {
      this.element.dataset.placement = placement;
    } else {
      this.element.setAttribute("data-placement", placement);
    }
  }

  private measureBubbleSize(): BubbleSize {
    let width = this.element.offsetWidth;
    let height = this.element.offsetHeight;
    if (
      (width <= 0 || height <= 0) &&
      typeof this.element.getBoundingClientRect === "function"
    ) {
      const rect = this.element.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
    }
    this.bubbleSizeScratch.width =
      width > 0 ? width : DEFAULT_FALLBACK_BUBBLE_WIDTH;
    this.bubbleSizeScratch.height =
      height > 0 ? height : DEFAULT_FALLBACK_BUBBLE_HEIGHT;
    return this.bubbleSizeScratch;
  }

  private applyLayout(
    headPos: ScreenPoint,
    viewportWidth: number,
    viewportHeight: number
  ): void {
    const size = this.measureBubbleSize();
    const pos = calculateBubblePosition(
      headPos,
      size,
      { width: viewportWidth, height: viewportHeight },
      this.margin
    );
    if (this.lastAppliedX !== pos.x) {
      this.element.style.left = `${pos.x}px`;
      this.lastAppliedX = pos.x;
    }
    if (this.lastAppliedY !== pos.y) {
      this.element.style.top = `${pos.y}px`;
      this.lastAppliedY = pos.y;
    }
    if (this.lastPlacement !== pos.placement) {
      this.setPlacementAttr(pos.placement);
      this.lastPlacement = pos.placement;
    }
    if (typeof this.element.style.setProperty === "function") {
      const isAbove = pos.placement === "above";
      const prop = isAbove ? "--bubble-tail-x" : "--bubble-tail-y";
      const offset = isAbove
        ? computeTailOffset(headPos.x, pos.x, size.width)
        : computeTailOffset(headPos.y, pos.y, size.height);
      const nextVal = `${prop}:${offset}`;
      if (this.lastTailCssValue !== nextVal) {
        this.element.style.setProperty(prop, `${offset}px`);
        this.lastTailCssValue = nextVal;
      }
    }
  }
}
