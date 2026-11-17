export interface ScreenPoint {
  x: number;
  y: number;
}

export interface BubbleSize {
  width: number;
  height: number;
}

export type BubblePlacement = "above" | "left" | "right";

export interface BubblePosition {
  x: number;
  y: number;
  placement: BubblePlacement;
}

export const DEFAULT_BUBBLE_MARGIN = 12;
const HEAD_TOP_GAP_PX = 18;
const HEAD_SIDE_GAP_PX = 26;
const TAIL_EDGE_INSET_PX = 16;

export function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function clampRoundedToBounds(
  raw: number,
  minBound: number,
  maxBound: number
): number {
  const ceilMin = Math.ceil(minBound);
  const floorMax = Math.floor(maxBound);
  if (ceilMin <= floorMax) {
    return clamp(Math.round(raw), ceilMin, floorMax);
  }
  return Math.round(clamp(raw, minBound, maxBound));
}

function computeAxisBounds(
  bubbleSpan: number,
  viewportSpan: number,
  margin: number
): { min: number; max: number } {
  if (viewportSpan <= 0 || bubbleSpan >= viewportSpan) {
    return { min: 0, max: 0 };
  }
  const effectiveMargin = Math.min(
    margin,
    Math.max(0, (viewportSpan - bubbleSpan) / 2)
  );
  return {
    min: effectiveMargin,
    max: Math.max(effectiveMargin, viewportSpan - bubbleSpan - effectiveMargin)
  };
}

/**
 * Pure layout and viewport-clamping helper for positioning the speech bubble
 * relative to the projected `head` bone. Places the bubble above `headScreenPos`
 * when top headroom allows, or comic-style to the left/right near the top edge,
 * clamped strictly inside the existing viewport.
 */
export function calculateBubblePosition(
  headScreenPos: ScreenPoint,
  bubbleSize: BubbleSize,
  viewportSize: BubbleSize,
  margin = DEFAULT_BUBBLE_MARGIN
): BubblePosition {
  const vw = Number.isFinite(viewportSize.width)
    ? Math.max(0, viewportSize.width)
    : 0;
  const vh = Number.isFinite(viewportSize.height)
    ? Math.max(0, viewportSize.height)
    : 0;
  if (vw === 0 || vh === 0) {
    return { x: 0, y: 0, placement: "above" };
  }

  const bw = Number.isFinite(bubbleSize.width)
    ? Math.max(0, bubbleSize.width)
    : 0;
  const bh = Number.isFinite(bubbleSize.height)
    ? Math.max(0, bubbleSize.height)
    : 0;
  const safeMargin = Number.isFinite(margin)
    ? Math.max(0, margin)
    : DEFAULT_BUBBLE_MARGIN;

  const headX = Number.isFinite(headScreenPos.x) ? headScreenPos.x : vw * 0.5;
  const headY = Number.isFinite(headScreenPos.y) ? headScreenPos.y : vh * 0.25;

  const xBounds = computeAxisBounds(bw, vw, safeMargin);
  const yBounds = computeAxisBounds(bh, vh, safeMargin);

  const idealAboveY = headY - bh - HEAD_TOP_GAP_PX;
  if (idealAboveY >= yBounds.min) {
    return {
      x: clampRoundedToBounds(headX - bw * 0.5, xBounds.min, xBounds.max),
      y: clampRoundedToBounds(idealAboveY, yBounds.min, yBounds.max),
      placement: "above"
    };
  }

  const rightSpace = vw - safeMargin - (headX + HEAD_SIDE_GAP_PX);
  const leftSpace = headX - HEAD_SIDE_GAP_PX - safeMargin;
  const placement: BubblePlacement = rightSpace >= leftSpace ? "right" : "left";

  const rawSideX =
    placement === "right"
      ? headX + HEAD_SIDE_GAP_PX
      : headX - HEAD_SIDE_GAP_PX - bw;

  return {
    x: clampRoundedToBounds(rawSideX, xBounds.min, xBounds.max),
    y: clampRoundedToBounds(headY - bh * 0.5, yBounds.min, yBounds.max),
    placement
  };
}

/**
 * Computes the clamped CSS pixel offset along the bubble's edge for the comic tail.
 */
export function computeTailOffset(
  headCoord: number,
  bubbleCoord: number,
  bubbleSpan: number
): number {
  const minInset = Math.min(TAIL_EDGE_INSET_PX, bubbleSpan * 0.5);
  const maxInset = Math.max(minInset, bubbleSpan - minInset);
  return Math.round(clamp(headCoord - bubbleCoord, minInset, maxInset));
}
