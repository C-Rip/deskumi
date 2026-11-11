import * as THREE from "three";
import type { Rect } from "./input-region";

/**
 * Options for configuring silhouette extraction.
 */
export interface SilhouetteExtractorOptions {
  /**
   * Downscale factor relative to logical viewport size.
   * Default is 4 (e.g. 400x600 -> 100x150).
   */
  downscale?: number;

  /**
   * Alpha threshold (0-255). Pixels with alpha > threshold are considered solid.
   * Default is 10.
   */
  alphaThreshold?: number;

  /**
   * Optional padding in logical pixels added to rects.
   * Default is 2.
   */
  padding?: number;
}

/**
 * Encodes consecutive solid spans of pixels on horizontal rows (Run-Length Encoding)
 * and merges identical adjacent rows into multi-row rectangles.
 *
 * @param pixelAlpha Uint8Array of alpha values (size = width * height), row-major.
 * @param width Width of the downscaled mask.
 * @param height Height of the downscaled mask.
 * @param scaleFactor Scale factor to map mask coordinates back to target/viewport space.
 * @param padding Padding in target units to slightly dilate rects.
 * @param targetWidth Max target width for clamping.
 * @param targetHeight Max target height for clamping.
 */
export function extractSpansFromAlpha(
  pixelAlpha: Uint8Array,
  width: number,
  height: number,
  scaleFactor: number,
  padding = 0,
  targetWidth = Infinity,
  targetHeight = Infinity
): Rect[] {
  if (width <= 0 || height <= 0 || pixelAlpha.length < width * height) {
    return [];
  }

  // Row-level horizontal spans: rowSpans[y] = Array of [xStart, xEnd] (both inclusive)
  const rowSpans: Array<Array<[number, number]>> = new Array(height);

  for (let y = 0; y < height; y++) {
    const rowOffset = y * width;
    const spans: Array<[number, number]> = [];
    let inSpan = false;
    let spanStart = 0;

    for (let x = 0; x < width; x++) {
      const isSolid = pixelAlpha[rowOffset + x] > 0;
      if (isSolid) {
        if (!inSpan) {
          inSpan = true;
          spanStart = x;
        }
      } else {
        if (inSpan) {
          spans.push([spanStart, x - 1]);
          inSpan = false;
        }
      }
    }
    if (inSpan) {
      spans.push([spanStart, width - 1]);
    }
    rowSpans[y] = spans;
  }

  // Active rectangles waiting to be merged downwards:
  // { xStart, xEnd, yStart, yEnd } in mask coordinates
  interface MaskRect {
    xStart: number;
    xEnd: number;
    yStart: number;
    yEnd: number;
  }

  const finishedRects: MaskRect[] = [];
  let activeRects: MaskRect[] = [];

  for (let y = 0; y < height; y++) {
    const currentSpans = rowSpans[y];
    const nextActive: MaskRect[] = [];
    const spanMatched = new Array<boolean>(currentSpans.length).fill(false);

    // Try to extend existing active rectangles if identical span matches
    for (const rect of activeRects) {
      let matchedIndex = -1;
      for (let s = 0; s < currentSpans.length; s++) {
        if (!spanMatched[s]) {
          const span = currentSpans[s];
          if (span[0] === rect.xStart && span[1] === rect.xEnd) {
            matchedIndex = s;
            break;
          }
        }
      }

      if (matchedIndex !== -1) {
        // Extend rectangle height by 1 row
        rect.yEnd = y;
        nextActive.push(rect);
        spanMatched[matchedIndex] = true;
      } else {
        finishedRects.push(rect);
      }
    }

    // Unmatched spans in current row become new active rects
    for (let s = 0; s < currentSpans.length; s++) {
      if (!spanMatched[s]) {
        const span = currentSpans[s];
        nextActive.push({
          xStart: span[0],
          xEnd: span[1],
          yStart: y,
          yEnd: y
        });
      }
    }

    activeRects = nextActive;
  }

  // Push remaining active rects
  for (const rect of activeRects) {
    finishedRects.push(rect);
  }

  // Convert MaskRects to logical CSS coordinates
  // Note: Three.js readRenderTargetPixels reads from bottom-to-top (OpenGL convention, row 0 is bottom),
  // while screen/CSS Y coordinates have row 0 at the top!
  // If the input buffer is already flipped or standard OpenGL, we map y accordingly:
  // For WebGL standard (row 0 = bottom): screenY = height - 1 - maskYEnd.
  const result: Rect[] = [];

  for (const r of finishedRects) {
    // Map mask X [xStart .. xEnd]
    const rawX = r.xStart * scaleFactor - padding;
    const rawW = (r.xEnd - r.xStart + 1) * scaleFactor + padding * 2;

    // Map mask Y: In Three.js readRenderTargetPixels, y=0 is the bottom row.
    // So the top-most row in screen coordinates corresponds to mask row yEnd!
    // screenTop = (height - 1 - r.yEnd) * scaleFactor
    const screenY = (height - 1 - r.yEnd) * scaleFactor - padding;
    const screenH = (r.yEnd - r.yStart + 1) * scaleFactor + padding * 2;

    // Clamp to [0, targetWidth] and [0, targetHeight]
    const clampedX = Math.max(0, Math.floor(rawX));
    const clampedY = Math.max(0, Math.floor(screenY));
    const maxX = Math.min(targetWidth, Math.ceil(rawX + rawW));
    const maxY = Math.min(targetHeight, Math.ceil(screenY + screenH));

    const finalW = maxX - clampedX;
    const finalH = maxY - clampedY;

    if (finalW > 0 && finalH > 0) {
      result.push({
        x: clampedX,
        y: clampedY,
        w: finalW,
        h: finalH
      });
    }
  }

  return result;
}

/**
 * Extracts pixel-perfect silhouette hit-test rectangles of a 3D scene / avatar
 * using offscreen WebGLRenderTarget downsampling and RLE stripe decomposition.
 */
export class SilhouetteExtractor {
  public readonly downscale: number;
  public readonly alphaThreshold: number;
  public readonly padding: number;

  private renderTarget: THREE.WebGLRenderTarget | null = null;
  private currentWidth = 0;
  private currentHeight = 0;
  private pixelBuffer: Uint8Array | null = null;
  private alphaBuffer: Uint8Array | null = null;

  constructor(options: SilhouetteExtractorOptions = {}) {
    this.downscale = options.downscale ?? 4;
    this.alphaThreshold = options.alphaThreshold ?? 10;
    this.padding = options.padding ?? 2;
  }

  /**
   * Resizes or initializes the downscaled WebGLRenderTarget.
   */
  private ensureRenderTarget(
    maskWidth: number,
    maskHeight: number
  ): THREE.WebGLRenderTarget {
    if (
      !this.renderTarget ||
      this.currentWidth !== maskWidth ||
      this.currentHeight !== maskHeight
    ) {
      if (this.renderTarget) {
        this.renderTarget.dispose();
      }
      this.renderTarget = new THREE.WebGLRenderTarget(maskWidth, maskHeight, {
        format: THREE.RGBAFormat,
        type: THREE.UnsignedByteType,
        depthBuffer: true,
        stencilBuffer: false
      });
      this.currentWidth = maskWidth;
      this.currentHeight = maskHeight;
      this.pixelBuffer = new Uint8Array(maskWidth * maskHeight * 4);
      this.alphaBuffer = new Uint8Array(maskWidth * maskHeight);
    }
    return this.renderTarget;
  }

  /**
   * Extracts silhouette rectangles by rendering the scene to an offscreen buffer.
   *
   * @param renderer Three.js WebGLRenderer.
   * @param scene Scene containing the avatar.
   * @param camera Main camera framing the avatar.
   * @param targetWidth Full viewport width in CSS pixels.
   * @param targetHeight Full viewport height in CSS pixels.
   * @returns Array of Cairo-friendly Rect bounding strips.
   */
  extract(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    targetWidth: number,
    targetHeight: number
  ): Rect[] {
    if (targetWidth <= 0 || targetHeight <= 0) {
      return [];
    }

    const maskWidth = Math.max(1, Math.floor(targetWidth / this.downscale));
    const maskHeight = Math.max(1, Math.floor(targetHeight / this.downscale));

    const target = this.ensureRenderTarget(maskWidth, maskHeight);
    const pixelBuffer = this.pixelBuffer!;
    const alphaBuffer = this.alphaBuffer!;

    // Save previous renderer state
    const prevRenderTarget = renderer.getRenderTarget();
    const prevClearColor = renderer.getClearColor(new THREE.Color());
    const prevClearAlpha = renderer.getClearAlpha();

    try {
      renderer.setRenderTarget(target);
      renderer.setClearColor(0x000000, 0);
      renderer.clear(true, true, false);

      // Render scene into downscaled offscreen target
      renderer.render(scene, camera);

      // Read RGBA pixels back from GPU
      renderer.readRenderTargetPixels(
        target,
        0,
        0,
        maskWidth,
        maskHeight,
        pixelBuffer
      );

      // Extract alpha channel with threshold
      const totalPixels = maskWidth * maskHeight;
      for (let i = 0; i < totalPixels; i++) {
        const a = pixelBuffer[i * 4 + 3];
        alphaBuffer[i] = a > this.alphaThreshold ? 255 : 0;
      }

      // Convert alpha mask to horizontal run-length encoded rectangles
      return extractSpansFromAlpha(
        alphaBuffer,
        maskWidth,
        maskHeight,
        this.downscale,
        this.padding,
        targetWidth,
        targetHeight
      );
    } finally {
      renderer.setRenderTarget(prevRenderTarget);
      renderer.setClearColor(prevClearColor, prevClearAlpha);
    }
  }

  /**
   * Disposes the WebGLRenderTarget and frees memory.
   */
  dispose(): void {
    if (this.renderTarget) {
      this.renderTarget.dispose();
      this.renderTarget = null;
    }
    this.pixelBuffer = null;
    this.alphaBuffer = null;
  }
}
