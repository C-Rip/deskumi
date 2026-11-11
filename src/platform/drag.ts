import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

export interface DragWindowApi {
  startDragging(): Promise<void>;
}

const INTERACTIVE_TAGS = new Set([
  "A",
  "BUTTON",
  "INPUT",
  "SELECT",
  "TEXTAREA",
  "LABEL",
  "SUMMARY"
]);

const INTERACTIVE_ROLES = new Set([
  "button",
  "link",
  "menuitem",
  "tab",
  "checkbox",
  "radio",
  "switch",
  "option"
]);

/**
 * Determines whether a DOM element is interactive (button, input, link, etc.)
 * or has `data-no-drag` explicitly set.
 */
export function isInteractiveElement(element: Element | null): boolean {
  let current: Element | null = element;
  while (current) {
    if (
      typeof document !== "undefined" &&
      current === document.documentElement
    ) {
      break;
    }
    if (
      typeof current.hasAttribute === "function" &&
      current.hasAttribute("data-no-drag")
    ) {
      return true;
    }
    if (current.tagName && INTERACTIVE_TAGS.has(current.tagName)) {
      return true;
    }
    const role =
      typeof current.getAttribute === "function"
        ? current.getAttribute("role")
        : null;
    if (role && INTERACTIVE_ROLES.has(role)) {
      return true;
    }
    if (
      typeof current.hasAttribute === "function" &&
      current.hasAttribute("contenteditable") &&
      current.getAttribute("contenteditable") !== "false"
    ) {
      return true;
    }
    current = current.parentElement;
  }
  return false;
}

export interface DragConditionOptions {
  /** Whether to ignore clicks on interactive elements. Default true. */
  ignoreInteractive?: boolean;
}

/**
 * Checks if a MouseEvent represents a valid primary (left) button click that should trigger window drag.
 */
export function shouldStartDrag(
  event: MouseEvent,
  options: DragConditionOptions = { ignoreInteractive: true }
): boolean {
  // Only primary button (left click)
  if (event.button !== 0) {
    return false;
  }

  if (options.ignoreInteractive) {
    const target = (event.target as Element | null) ?? null;
    if (isInteractiveElement(target)) {
      return false;
    }
  }

  return true;
}

/**
 * Initiates native OS window dragging via Tauri's getCurrentWindow().startDragging().
 * If running outside Tauri and no custom windowApi is provided, gracefully falls back (no-op).
 *
 * @param windowApi Optional window API instance (useful for unit tests or custom targets).
 * @returns Promise resolving to true if startDragging was called successfully, false otherwise.
 */
export async function startDraggingWindow(
  windowApi?: DragWindowApi
): Promise<boolean> {
  if (!isTauri() && !windowApi) {
    return false;
  }

  try {
    const win = windowApi ?? getCurrentWindow();
    await win.startDragging();
    return true;
  } catch (error: unknown) {
    console.warn("[deskumi] Failed to start window dragging:", error);
    return false;
  }
}

export interface WindowDragSetupOptions {
  /** Target element to bind events to (defaults to window). */
  target?: EventTarget;
  /** Whether to ignore clicks originating from interactive elements. Defaults to true. */
  ignoreInteractive?: boolean;
  /** Custom window API (mock/test support). */
  windowApi?: DragWindowApi;
  /** Optional callback fired when drag initiation is attempted. */
  onDragStart?: () => void;
  /** Optional distance in pixels before triggering drag. If 0 (default), triggers immediately on mousedown. */
  threshold?: number;
}

/**
 * Sets up window drag listeners on the specified target (window by default).
 * Returns an unbind function to remove listeners.
 */
export function setupWindowDrag(
  options: WindowDragSetupOptions = {}
): () => void {
  const {
    target = typeof window !== "undefined" ? window : undefined,
    ignoreInteractive = true,
    windowApi,
    onDragStart,
    threshold = 0
  } = options;

  if (!target) {
    return () => {};
  }

  let startPos: { x: number; y: number } | null = null;
  let dragStarted = false;

  const onMouseDown = (event: Event): void => {
    const mouseEvent = event as MouseEvent;
    if (typeof mouseEvent?.button !== "number") return;

    if (!shouldStartDrag(mouseEvent, { ignoreInteractive })) {
      return;
    }

    if (threshold <= 0) {
      dragStarted = true;
      onDragStart?.();
      void startDraggingWindow(windowApi);
    } else {
      startPos = { x: mouseEvent.clientX, y: mouseEvent.clientY };
      dragStarted = false;
    }
  };

  const onMouseMove = (event: Event): void => {
    if (threshold <= 0 || !startPos || dragStarted) return;
    const mouseEvent = event as MouseEvent;
    if (typeof mouseEvent?.clientX !== "number") return;

    const dx = mouseEvent.clientX - startPos.x;
    const dy = mouseEvent.clientY - startPos.y;
    const distSq = dx * dx + dy * dy;

    if (distSq >= threshold * threshold) {
      dragStarted = true;
      startPos = null;
      onDragStart?.();
      void startDraggingWindow(windowApi);
    }
  };

  const onMouseUp = (): void => {
    startPos = null;
    dragStarted = false;
  };

  target.addEventListener("mousedown", onMouseDown as EventListener);
  if (threshold > 0) {
    target.addEventListener("mousemove", onMouseMove as EventListener);
    target.addEventListener("mouseup", onMouseUp as EventListener);
  }

  return () => {
    target.removeEventListener("mousedown", onMouseDown as EventListener);
    if (threshold > 0) {
      target.removeEventListener("mousemove", onMouseMove as EventListener);
      target.removeEventListener("mouseup", onMouseUp as EventListener);
    }
  };
}
