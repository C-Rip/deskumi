import { describe, expect, it, vi } from "vitest";
import {
  isInteractiveElement,
  setupWindowDrag,
  shouldStartDrag,
  startDraggingWindow,
  type DragWindowApi
} from "./drag";

interface MockElement {
  tagName: string;
  parentElement: MockElement | null;
  attributes: Record<string, string>;
  hasAttribute(name: string): boolean;
  getAttribute(name: string): string | null;
}

function createMockElement(
  tagName: string,
  attrs: Record<string, string> = {},
  parent: MockElement | null = null
): MockElement {
  return {
    tagName: tagName.toUpperCase(),
    parentElement: parent,
    attributes: { ...attrs },
    hasAttribute(name: string) {
      return name in this.attributes;
    },
    getAttribute(name: string) {
      return this.attributes[name] ?? null;
    }
  };
}

describe("drag platform module", () => {
  describe("isInteractiveElement", () => {
    it("identifies standard interactive HTML elements", () => {
      const button = createMockElement("button") as unknown as Element;
      const link = createMockElement("a") as unknown as Element;
      const input = createMockElement("input") as unknown as Element;
      const select = createMockElement("select") as unknown as Element;
      const textarea = createMockElement("textarea") as unknown as Element;
      const div = createMockElement("div") as unknown as Element;

      expect(isInteractiveElement(button)).toBe(true);
      expect(isInteractiveElement(link)).toBe(true);
      expect(isInteractiveElement(input)).toBe(true);
      expect(isInteractiveElement(select)).toBe(true);
      expect(isInteractiveElement(textarea)).toBe(true);
      expect(isInteractiveElement(div)).toBe(false);
      expect(isInteractiveElement(null)).toBe(false);
    });

    it("identifies elements with interactive ARIA roles", () => {
      const roleButton = createMockElement("div", {
        role: "button"
      }) as unknown as Element;
      const roleLink = createMockElement("span", {
        role: "link"
      }) as unknown as Element;
      const roleHeading = createMockElement("div", {
        role: "heading"
      }) as unknown as Element;

      expect(isInteractiveElement(roleButton)).toBe(true);
      expect(isInteractiveElement(roleLink)).toBe(true);
      expect(isInteractiveElement(roleHeading)).toBe(false);
    });

    it("identifies elements with data-no-drag attribute or nested within interactive parent", () => {
      const parent = createMockElement("button");
      const child = createMockElement("span", {}, parent);

      const noDragParent = createMockElement("div", { "data-no-drag": "true" });
      const innerChild = createMockElement("span", {}, noDragParent);

      expect(isInteractiveElement(child as unknown as Element)).toBe(true);
      expect(isInteractiveElement(innerChild as unknown as Element)).toBe(true);
    });
  });

  describe("shouldStartDrag", () => {
    it("returns true only for primary mouse button (button 0)", () => {
      const target = createMockElement("canvas") as unknown as Element;

      const leftClick = {
        button: 0,
        target
      } as unknown as MouseEvent;
      const middleClick = {
        button: 1,
        target
      } as unknown as MouseEvent;
      const rightClick = {
        button: 2,
        target
      } as unknown as MouseEvent;

      expect(shouldStartDrag(leftClick)).toBe(true);
      expect(shouldStartDrag(middleClick)).toBe(false);
      expect(shouldStartDrag(rightClick)).toBe(false);
    });

    it("ignores interactive elements by default", () => {
      const button = createMockElement("button") as unknown as Element;
      const event = {
        button: 0,
        target: button
      } as unknown as MouseEvent;

      expect(shouldStartDrag(event)).toBe(false);
      expect(shouldStartDrag(event, { ignoreInteractive: false })).toBe(true);
    });
  });

  describe("startDraggingWindow", () => {
    it("gracefully falls back outside Tauri environment without throwing", async () => {
      const result = await startDraggingWindow();
      expect(result).toBe(false);
    });

    it("invokes startDragging on the provided DragWindowApi", async () => {
      const mockApi: DragWindowApi = {
        startDragging: vi.fn().mockResolvedValue(undefined)
      };

      const result = await startDraggingWindow(mockApi);
      expect(result).toBe(true);
      expect(mockApi.startDragging).toHaveBeenCalledOnce();
    });

    it("catches and handles errors from startDragging without throwing", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const mockApi: DragWindowApi = {
        startDragging: vi.fn().mockRejectedValue(new Error("IPC error"))
      };

      const result = await startDraggingWindow(mockApi);
      expect(result).toBe(false);
      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });
  });

  describe("setupWindowDrag", () => {
    type Listener = (event: unknown) => void;

    function createMockTarget() {
      const listeners: Record<string, Listener[]> = {};
      return {
        addEventListener(type: string, listener: Listener) {
          listeners[type] = listeners[type] || [];
          listeners[type].push(listener);
        },
        removeEventListener(type: string, listener: Listener) {
          if (listeners[type]) {
            listeners[type] = listeners[type].filter((l) => l !== listener);
          }
        },
        dispatch(type: string, event: unknown) {
          const list = listeners[type] || [];
          for (const l of list) {
            l(event);
          }
        },
        listenerCount(type: string) {
          return (listeners[type] || []).length;
        }
      };
    }

    it("triggers drag immediately on left mousedown when threshold is 0", () => {
      const target = createMockTarget();
      const mockApi: DragWindowApi = {
        startDragging: vi.fn().mockResolvedValue(undefined)
      };
      const onDragStart = vi.fn();

      const unbind = setupWindowDrag({
        target: target as unknown as EventTarget,
        windowApi: mockApi,
        onDragStart,
        threshold: 0
      });

      target.dispatch("mousedown", {
        button: 0,
        target: createMockElement("canvas")
      });

      expect(onDragStart).toHaveBeenCalledOnce();
      expect(mockApi.startDragging).toHaveBeenCalledOnce();

      unbind();
      expect(target.listenerCount("mousedown")).toBe(0);
    });

    it("does not trigger drag on right click or interactive elements", () => {
      const target = createMockTarget();
      const mockApi: DragWindowApi = {
        startDragging: vi.fn().mockResolvedValue(undefined)
      };
      const onDragStart = vi.fn();

      const unbind = setupWindowDrag({
        target: target as unknown as EventTarget,
        windowApi: mockApi,
        onDragStart
      });

      // Right click
      target.dispatch("mousedown", {
        button: 2,
        target: createMockElement("canvas")
      });
      expect(onDragStart).not.toHaveBeenCalled();

      // Left click on button
      target.dispatch("mousedown", {
        button: 0,
        target: createMockElement("button")
      });
      expect(onDragStart).not.toHaveBeenCalled();
      expect(mockApi.startDragging).not.toHaveBeenCalled();

      unbind();
    });

    it("supports threshold movement before drag triggers", () => {
      const target = createMockTarget();
      const mockApi: DragWindowApi = {
        startDragging: vi.fn().mockResolvedValue(undefined)
      };
      const onDragStart = vi.fn();

      const unbind = setupWindowDrag({
        target: target as unknown as EventTarget,
        windowApi: mockApi,
        onDragStart,
        threshold: 5
      });

      // mousedown at (10, 10)
      target.dispatch("mousedown", {
        button: 0,
        clientX: 10,
        clientY: 10,
        target: createMockElement("canvas")
      });
      expect(onDragStart).not.toHaveBeenCalled();

      // move small delta (dist = 2px)
      target.dispatch("mousemove", {
        clientX: 12,
        clientY: 10
      });
      expect(onDragStart).not.toHaveBeenCalled();

      // move large delta (dist = 10px >= 5px)
      target.dispatch("mousemove", {
        clientX: 20,
        clientY: 10
      });
      expect(onDragStart).toHaveBeenCalledOnce();
      expect(mockApi.startDragging).toHaveBeenCalledOnce();

      unbind();
    });

    it("unbinding removes event listeners", () => {
      const target = createMockTarget();
      const mockApi: DragWindowApi = {
        startDragging: vi.fn().mockResolvedValue(undefined)
      };
      const onDragStart = vi.fn();

      const unbind = setupWindowDrag({
        target: target as unknown as EventTarget,
        windowApi: mockApi,
        onDragStart
      });

      unbind();

      target.dispatch("mousedown", {
        button: 0,
        target: createMockElement("canvas")
      });
      expect(onDragStart).not.toHaveBeenCalled();
    });
  });
});
