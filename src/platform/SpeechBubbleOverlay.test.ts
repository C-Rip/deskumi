import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import type { VRM } from "@pixiv/three-vrm";
import {
  calculateBubblePosition,
  projectHeadToScreen,
  SpeechBubbleOverlay
} from "./SpeechBubbleOverlay";

class MockBubbleElement {
  public className = "";
  public textContent = "";
  public parentElement: MockContainer | null = null;
  public offsetWidth = 140;
  public offsetHeight = 44;
  public dataset: Record<string, string> = {};
  public attributes: Record<string, string> = {};
  public innerHtmlSetCount = 0;
  private readonly classes = new Set<string>();
  public readonly style = {
    pointerEvents: "",
    userSelect: "",
    left: "",
    top: "",
    cssVars: {} as Record<string, string>,
    setProperty: (k: string, v: string) => {
      this.style.cssVars[k] = v;
    }
  };
  public readonly classList = {
    add: (...c: string[]) => c.forEach((cls) => this.classes.add(cls)),
    remove: (...c: string[]) => c.forEach((cls) => this.classes.delete(cls)),
    contains: (c: string) => this.classes.has(c)
  };
  public get innerHTML(): string {
    return this.textContent;
  }
  public set innerHTML(_val: string) {
    this.innerHtmlSetCount += 1;
  }
  public setAttribute(name: string, value: string): void {
    this.attributes[name] = value;
  }
  public getAttribute(name: string): string | null {
    return this.attributes[name] ?? null;
  }
  public getBoundingClientRect(): { width: number; height: number } {
    return { width: this.offsetWidth, height: this.offsetHeight };
  }
}

class MockContainer {
  public children: MockBubbleElement[] = [];
  public appendChild(child: MockBubbleElement): MockBubbleElement {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }
  public removeChild(child: MockBubbleElement): MockBubbleElement {
    this.children = this.children.filter((c) => c !== child);
    child.parentElement = null;
    return child;
  }
}

function createMockContext(): {
  container: HTMLElement;
  mockContainer: MockContainer;
  doc: Pick<Document, "createElement">;
} {
  const mockContainer = new MockContainer();
  const doc = {
    createElement: () => new MockBubbleElement() as unknown as HTMLElement
  };
  return {
    container: mockContainer as unknown as HTMLElement,
    mockContainer,
    doc
  };
}

function createTestCamera(): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(45, 400 / 600, 0.1, 100);
  camera.position.set(0, 0.85, 3);
  camera.lookAt(0, 0.85, 0);
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();
  return camera;
}

describe("calculateBubblePosition", () => {
  it("places bubble centered above head when sufficient top headroom exists", () => {
    const pos = calculateBubblePosition(
      { x: 200, y: 180 },
      { width: 160, height: 48 },
      { width: 400, height: 600 },
      12
    );
    expect(pos).toEqual({ x: 120, y: 114, placement: "above" });
  });

  it("clamps horizontal position inside left and right margins", () => {
    const left = calculateBubblePosition(
      { x: 30, y: 180 },
      { width: 160, height: 48 },
      { width: 400, height: 600 },
      12
    );
    expect(left).toEqual({ x: 12, y: 114, placement: "above" });

    const right = calculateBubblePosition(
      { x: 380, y: 180 },
      { width: 160, height: 48 },
      { width: 400, height: 600 },
      12
    );
    expect(right).toEqual({ x: 228, y: 114, placement: "above" });
  });

  it("switches to right or left comic-style near top edge (e.g. perched)", () => {
    const rightSide = calculateBubblePosition(
      { x: 140, y: 50 },
      { width: 150, height: 48 },
      { width: 400, height: 504 },
      12
    );
    expect(rightSide).toEqual({ x: 166, y: 26, placement: "right" });

    const leftSide = calculateBubblePosition(
      { x: 280, y: 40 },
      { width: 150, height: 48 },
      { width: 400, height: 504 },
      12
    );
    expect(leftSide).toEqual({ x: 104, y: 16, placement: "left" });
  });

  it("strictly clamps oversized or edge bubbles inside tight viewports", () => {
    const tight = calculateBubblePosition(
      { x: -40, y: -20 },
      { width: 190, height: 60 },
      { width: 200, height: 100 },
      16
    );
    expect(tight.x).toBeGreaterThanOrEqual(0);
    expect(tight.x + 190).toBeLessThanOrEqual(200);
    expect(tight.y).toBeGreaterThanOrEqual(0);
    expect(tight.y + 60).toBeLessThanOrEqual(100);

    const oversized = calculateBubblePosition(
      { x: 100, y: 50 },
      { width: 260, height: 140 },
      { width: 200, height: 100 },
      12
    );
    expect(oversized).toEqual({ x: 0, y: 0, placement: "right" });
  });

  it("handles zero viewport and non-finite coordinates without NaN", () => {
    expect(
      calculateBubblePosition(
        { x: Number.NaN, y: Number.POSITIVE_INFINITY },
        { width: 120, height: 40 },
        { width: 0, height: 400 },
        12
      )
    ).toEqual({ x: 0, y: 0, placement: "above" });
  });
});

describe("projectHeadToScreen", () => {
  it("projects the normalized head bone to viewport coordinates", () => {
    const scene = new THREE.Group();
    const head = new THREE.Object3D();
    head.position.set(0, 0.85, 0);
    scene.add(head);
    scene.updateMatrixWorld(true);

    const vrm = {
      scene,
      humanoid: {
        getNormalizedBoneNode: (name: string) =>
          name === "head" ? head : null,
        getRawBoneNode: () => null
      }
    } as unknown as VRM;

    const pt = projectHeadToScreen(vrm, createTestCamera(), 400, 600);
    expect(pt).not.toBeNull();
    expect(pt!.x).toBeCloseTo(200, 1);
    expect(pt!.y).toBeCloseTo(300, 1);
  });

  it("falls back cleanly when no head bone or VRM exists", () => {
    const camera = createTestCamera();
    const sceneOnlyVrm = { scene: new THREE.Group() } as unknown as VRM;

    const fallbackVrm = projectHeadToScreen(sceneOnlyVrm, camera, 400, 600);
    expect(fallbackVrm).not.toBeNull();
    expect(Number.isFinite(fallbackVrm!.x)).toBe(true);
    expect(Number.isFinite(fallbackVrm!.y)).toBe(true);

    expect(projectHeadToScreen(null, camera, 400, 600)).toEqual({
      x: 200,
      y: 150
    });
    expect(projectHeadToScreen(null, camera, 0, 600)).toBeNull();
  });
});

describe("SpeechBubbleOverlay", () => {
  it("initializes with pointer-events none, user-select none, and hidden state", () => {
    const { container, mockContainer, doc } = createMockContext();
    const overlay = new SpeechBubbleOverlay({ container, doc });
    const el = overlay.domElement as unknown as MockBubbleElement;

    expect(mockContainer.children).toHaveLength(1);
    expect(el.className).toBe("speech-bubble");
    expect(el.style.pointerEvents).toBe("none");
    expect(el.style.userSelect).toBe("none");
    expect(el.getAttribute("aria-hidden")).toBe("true");
    expect(overlay.visible).toBe(false);
  });

  it("renders text via textContent only and hides cleanly on blank or hide()", () => {
    const { container, doc } = createMockContext();
    const overlay = new SpeechBubbleOverlay({ container, doc });
    const el = overlay.domElement as unknown as MockBubbleElement;

    const payload = '<img src=x onerror="alert(1)"> & hello';
    overlay.show(payload);
    expect(overlay.visible).toBe(true);
    expect(el.textContent).toBe(payload);
    expect(el.innerHtmlSetCount).toBe(0);
    expect(el.classList.contains("is-visible")).toBe(true);
    expect(el.getAttribute("aria-hidden")).toBe("false");

    overlay.hide();
    expect(overlay.visible).toBe(false);
    expect(el.classList.contains("is-visible")).toBe(false);
    expect(el.getAttribute("aria-hidden")).toBe("true");

    overlay.show("   ");
    expect(overlay.visible).toBe(false);
    expect(el.textContent).toBe("");
  });

  it("anchors to head bone above or beside head without touching DOM while hidden", () => {
    const { container, doc } = createMockContext();
    const overlay = new SpeechBubbleOverlay({ container, doc });
    const el = overlay.domElement as unknown as MockBubbleElement;
    const getRectSpy = vi.spyOn(el, "getBoundingClientRect");

    const scene = new THREE.Group();
    const head = new THREE.Object3D();
    head.position.set(0, 0.85, 0);
    scene.add(head);
    scene.updateMatrixWorld(true);
    const vrm = {
      scene,
      humanoid: {
        getNormalizedBoneNode: (name: string) => (name === "head" ? head : null)
      }
    } as unknown as VRM;
    const camera = createTestCamera();

    overlay.updateAnchor(vrm, camera, 400, 600);
    expect(el.style.left).toBe("");
    expect(getRectSpy).not.toHaveBeenCalled();

    overlay.show("Hello Deskumi!");
    expect(el.dataset.placement).toBe("above");
    expect(el.style.left).toBe("130px");
    expect(el.style.top).toBe("238px");
    expect(el.style.cssVars["--bubble-tail-x"]).toBe("70px");

    head.position.set(0, 1.9, 0);
    scene.updateMatrixWorld(true);
    overlay.updateAnchor(vrm, camera, 400, 504);
    expect(el.dataset.placement).toBe("right");
    expect(Number.parseInt(el.style.top, 10)).toBeGreaterThanOrEqual(12);
    expect(Number.parseInt(el.style.left, 10) + 140).toBeLessThanOrEqual(388);
  });

  it("disposes DOM node and ignores subsequent calls", () => {
    const { container, mockContainer, doc } = createMockContext();
    const overlay = new SpeechBubbleOverlay({ container, doc });

    overlay.show("Bye!");
    overlay.dispose();
    expect(mockContainer.children).toHaveLength(0);
    expect(overlay.visible).toBe(false);

    overlay.show("Ignored");
    overlay.updateAnchor(null, createTestCamera(), 400, 600);
    expect(overlay.visible).toBe(false);
    expect(mockContainer.children).toHaveLength(0);
  });
});
