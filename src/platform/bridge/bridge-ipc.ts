import { Channel, invoke, isTauri } from "@tauri-apps/api/core";

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
