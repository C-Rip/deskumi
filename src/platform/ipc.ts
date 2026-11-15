import { invoke, isTauri } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import type { PlatformCaps } from "./caps";
import type { Rect } from "./input-region";

/**
 * Queries the Rust backend for platform capabilities (OS, display server,
 * global cursor, input region, always-on-top, and window positioning support).
 */
export async function getPlatformCaps(): Promise<PlatformCaps> {
  if (!isTauri()) {
    return {
      os: "linux",
      displayServer: "x11",
      globalCursor: false,
      inputRegion: false,
      alwaysOnTop: false,
      setPosition: false
    };
  }
  return await invoke<PlatformCaps>("get_platform_caps");
}

/**
 * Applies interactive input region rectangles on the native desktop window.
 * Passing `null` resets the input region to the full window.
 */
export async function setInputRegion(rects: Rect[] | null): Promise<void> {
  if (!isTauri()) {
    return;
  }
  await invoke("set_input_region", { rects });
}

/**
 * Resizes the native desktop window using platform-specific handling
 * (including GTK size request workarounds on Linux).
 */
export async function setWindowDesktopSize(
  width: number,
  height: number
): Promise<void> {
  if (!isTauri()) {
    return;
  }
  await invoke("set_window_desktop_size", { width, height });
}

/**
 * Moves the native desktop window to the specified desktop coordinates.
 */
export async function setWindowDesktopPosition(
  x: number,
  y: number
): Promise<void> {
  if (!isTauri()) {
    return;
  }
  await invoke("set_window_desktop_position", { x, y });
}

/**
 * Queries the pointer position relative to the Deskumi window origin.
 * Returns `null` outside Tauri or on platforms that restrict pointer queries.
 */
export async function getWindowCursorPosition(): Promise<
  [number, number] | null
> {
  if (!isTauri()) {
    return null;
  }
  return await invoke<[number, number] | null>("get_window_cursor_position");
}

/**
 * Returns the active desktop window geometry `[x, y, width, height]` in
 * platform/GTK coordinates when provided by the compositor bridge.
 */
export async function getActiveWindowRect(): Promise<
  [number, number, number, number] | null
> {
  if (!isTauri()) {
    return null;
  }
  return await invoke<[number, number, number, number] | null>(
    "get_active_window_rect"
  );
}

/**
 * Opens or focuses the secondary Settings window.
 */
export async function openSettingsWindow(): Promise<void> {
  if (!isTauri()) {
    return;
  }
  await invoke("open_settings_window");
}

/**
 * Subscribes to a Tauri event with a safe no-op fallback outside Tauri runtime.
 */
export async function listenTauriEvent<T>(
  eventName: string,
  handler: (payload: T) => void
): Promise<() => void> {
  if (!isTauri()) {
    return () => {};
  }
  return await listen<T>(eventName, (event) => {
    handler(event.payload);
  });
}

/**
 * Emits a Tauri event with a safe no-op fallback outside Tauri runtime.
 */
export async function emitTauriEvent(
  eventName: string,
  payload?: unknown
): Promise<void> {
  if (!isTauri()) {
    return;
  }
  await emit(eventName, payload);
}
