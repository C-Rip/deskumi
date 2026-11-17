import { Channel, invoke, isTauri } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import type { PlatformCaps } from "./caps";
import type { Rect } from "./input-region";

export interface BridgeStatus {
  running: boolean;
  port: number | null;
  bridgeFilePath: string | null;
  token: string | null;
  connectedClients: number;
  maxClients: number;
}

export type BridgeInboundControl =
  | {
      kind: "command";
      clientId: string;
      envelope: unknown;
    }
  | {
      kind: "clientDisconnected";
      clientId: string;
    };

export type BridgeInboundPayload = ArrayBuffer | BridgeInboundControl;

export interface BridgeOutboundMessage {
  targetClientIds?: string[];
  payload: unknown;
}

const DEFAULT_STOPPED_BRIDGE_STATUS: BridgeStatus = {
  running: false,
  port: null,
  bridgeFilePath: null,
  token: null,
  connectedClients: 0,
  maxClients: 4
};

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

/**
 * Starts the local loopback WebSocket bridge (`127.0.0.1:0`) and returns its status.
 */
export async function startLocalBridge(): Promise<BridgeStatus> {
  if (!isTauri()) {
    return { ...DEFAULT_STOPPED_BRIDGE_STATUS };
  }
  return await invoke<BridgeStatus>("start_local_bridge");
}

/**
 * Stops the local WebSocket bridge, closes client sockets, and removes `bridge.json`.
 */
export async function stopLocalBridge(): Promise<BridgeStatus> {
  if (!isTauri()) {
    return { ...DEFAULT_STOPPED_BRIDGE_STATUS };
  }
  return await invoke<BridgeStatus>("stop_local_bridge");
}

/**
 * Queries current local WebSocket bridge status and connected client count.
 */
export async function getBridgeStatus(): Promise<BridgeStatus> {
  if (!isTauri()) {
    return { ...DEFAULT_STOPPED_BRIDGE_STATUS };
  }
  return await invoke<BridgeStatus>("get_bridge_status");
}

/**
 * Rotates the 256-bit bridge token, atomically rewrites `bridge.json`,
 * and disconnects active clients authenticated with the previous token.
 */
export async function regenerateBridgeToken(): Promise<BridgeStatus> {
  if (!isTauri()) {
    return { ...DEFAULT_STOPPED_BRIDGE_STATUS };
  }
  return await invoke<BridgeStatus>("regenerate_bridge_token");
}

/**
 * Subscribes to inbound local WebSocket bridge messages via a Tauri v2 `Channel`,
 * receiving JSON control objects and binary `ArrayBuffer` frames for `speakChunk`.
 */
export async function subscribeBridgeInbound(
  onMessage: (payload: BridgeInboundPayload) => void
): Promise<() => void> {
  if (!isTauri()) {
    return () => {};
  }
  let active = true;
  const channel = new Channel<BridgeInboundPayload>((payload) => {
    if (active) {
      onMessage(payload);
    }
  });
  await invoke("subscribe_bridge_inbound", { channel });
  return () => {
    active = false;
    channel.onmessage = () => {};
  };
}

/**
 * Sends a command response (`ack` / `error` / `hello`) or subscribed `AvatarEvent`
 * back to connected WebSocket bridge clients.
 */
export async function sendBridgeEvent(
  message: BridgeOutboundMessage
): Promise<void> {
  if (!isTauri()) {
    return;
  }
  await invoke("send_bridge_event", { message });
}
