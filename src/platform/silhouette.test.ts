import { describe, it, expect, vi } from "vitest";
import * as THREE from "three";
import { extractSpansFromAlpha, SilhouetteExtractor } from "./silhouette";

describe("extractSpansFromAlpha", () => {
  it("returns empty array for empty or zero dimensions", () => {
    expect(extractSpansFromAlpha(new Uint8Array(0), 0, 0, 4)).toEqual([]);
    expect(extractSpansFromAlpha(new Uint8Array(16), 4, 0, 4)).toEqual([]);
    expect(extractSpansFromAlpha(new Uint8Array(16), 0, 4, 4)).toEqual([]);
  });

  it("returns empty array when all pixels are transparent", () => {
    const alpha = new Uint8Array(4 * 4).fill(0);
    const rects = extractSpansFromAlpha(alpha, 4, 4, 4, 0, 16, 16);
    expect(rects).toEqual([]);
  });

  it("extracts a single full rectangle when all pixels are solid", () => {
    const width = 4;
    const height = 4;
    const alpha = new Uint8Array(width * height).fill(255);
    const scale = 4;
    const rects = extractSpansFromAlpha(alpha, width, height, scale, 0, 16, 16);

    expect(rects).toHaveLength(1);
    expect(rects[0]).toEqual({
      x: 0,
      y: 0,
      w: 16,
      h: 16
    });
  });

  it("extracts disjoint vertical legs with empty space between them", () => {
    // 6 columns, 4 rows
    // Row 0..3: [solid, 0, 0, 0, 0, solid] -> two legs at left (x=0) and right (x=5)
    const width = 6;
    const height = 4;
    const alpha = new Uint8Array(width * height).fill(0);

    for (let y = 0; y < height; y++) {
      alpha[y * width + 0] = 255; // Left leg
      alpha[y * width + 5] = 255; // Right leg
    }

    const scale = 10;
    const rects = extractSpansFromAlpha(
      alpha,
      width,
      height,
      scale,
      0,
      width * scale,
      height * scale
    );

    // Should produce exactly 2 column rects merged vertically
    expect(rects).toHaveLength(2);

    const leftLeg = rects.find((r) => r.x === 0);
    const rightLeg = rects.find((r) => r.x === 50);

    expect(leftLeg).toBeDefined();
    expect(leftLeg?.w).toBe(10);
    expect(leftLeg?.h).toBe(40);
    expect(leftLeg?.y).toBe(0);

    expect(rightLeg).toBeDefined();
    expect(rightLeg?.w).toBe(10);
    expect(rightLeg?.h).toBe(40);
    expect(rightLeg?.y).toBe(0);
  });

  it("applies padding and clamps to target bounds", () => {
    // 4x4 with 1 pixel at center (x=1, y=1)
    const width = 4;
    const height = 4;
    const alpha = new Uint8Array(width * height).fill(0);
    alpha[1 * width + 1] = 255; // y=1 in OpenGL (which is y=2 in screen space since height=4: 4 - 1 - 1 = 2)

    const scale = 10;
    const padding = 2;
    const rects = extractSpansFromAlpha(
      alpha,
      width,
      height,
      scale,
      padding,
      40,
      40
    );

    expect(rects).toHaveLength(1);
    const r = rects[0];
    // xStart=1, scale=10 -> rawX = 10 - 2 = 8, rawW = 10 + 4 = 14
    expect(r.x).toBe(8);
    expect(r.w).toBe(14);
    // yStart=1, yEnd=1 -> screenY = (4 - 1 - 1)*10 - 2 = 20 - 2 = 18, screenH = 10 + 4 = 14
    expect(r.y).toBe(18);
    expect(r.h).toBe(14);
  });
});

describe("SilhouetteExtractor", () => {
  it("initializes with options", () => {
    const extractor = new SilhouetteExtractor({
      downscale: 8,
      alphaThreshold: 20,
      padding: 4
    });

    expect(extractor.downscale).toBe(8);
    expect(extractor.alphaThreshold).toBe(20);
    expect(extractor.padding).toBe(4);
    extractor.dispose();
  });

  it("returns empty array for invalid viewport dimensions", () => {
    const extractor = new SilhouetteExtractor();
    const renderer = {} as THREE.WebGLRenderer;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();

    expect(extractor.extract(renderer, scene, camera, 0, 100)).toEqual([]);
    expect(extractor.extract(renderer, scene, camera, 100, 0)).toEqual([]);
    extractor.dispose();
  });

  it("extracts rectangles from mock WebGLRenderer", () => {
    const extractor = new SilhouetteExtractor({
      downscale: 2,
      alphaThreshold: 10,
      padding: 0
    });

    const mockPixels = new Uint8Array(2 * 2 * 4).fill(0);
    // Set 1 pixel solid RGBA at bottom-left (x=0, y=0)
    mockPixels[0] = 255;
    mockPixels[1] = 255;
    mockPixels[2] = 255;
    mockPixels[3] = 255; // Alpha = 255

    const mockRenderer = {
      getRenderTarget: vi.fn().mockReturnValue(null),
      getClearAlpha: vi.fn().mockReturnValue(0),
      getClearColor: vi.fn().mockReturnValue(new THREE.Color(0, 0, 0)),
      setRenderTarget: vi.fn(),
      setClearColor: vi.fn(),
      clear: vi.fn(),
      render: vi.fn(),
      readRenderTargetPixels: vi
        .fn()
        .mockImplementation((_target, _x, _y, _w, _h, buffer: Uint8Array) => {
          buffer.set(mockPixels);
        })
    } as unknown as THREE.WebGLRenderer;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();

    const rects = extractor.extract(mockRenderer, scene, camera, 4, 4);

    expect(mockRenderer.render).toHaveBeenCalledWith(scene, camera);
    expect(mockRenderer.readRenderTargetPixels).toHaveBeenCalled();
    expect(rects.length).toBeGreaterThan(0);

    extractor.dispose();
  });
});
