import {
  buildErrorResponse,
  buildEventEnvelope,
  validateAvatarCommand,
  type AvatarCommandEnvelope,
  type AvatarCommandLimits,
  type AvatarEvent,
  type AvatarEventType,
  type AvatarScope
} from "../../engine/AvatarCommand";
import type { AvatarController } from "../../engine/AvatarController";
import type { UnlistenFn } from "../../engine/PowerSaveController";
import {
  sendBridgeEvent,
  subscribeBridgeInbound,
  type BridgeInboundPayload,
  type BridgeOutboundMessage
} from "../ipc";
import {
  decodeChannelBinarySpeakChunk,
  filterEventForScopes,
  type BinaryDecodeResult,
  type DecodedBinarySpeakChunk
} from "./BridgeProtocol";

export {
  decodeChannelBinarySpeakChunk,
  filterEventForScopes,
  type BinaryDecodeResult,
  type DecodedBinarySpeakChunk
};

export interface BridgeClientOptions {
  avatarController: AvatarController;
  grantedScopes?: readonly AvatarScope[];
  limits?: Partial<AvatarCommandLimits>;
  subscribeInbound?: (
    handler: (payload: BridgeInboundPayload) => void
  ) => Promise<() => void>;
  sendEvent?: (message: BridgeOutboundMessage) => Promise<void>;
}

/**
 * Connects the Rust local WebSocket bridge (`Channel` inbound + `invoke` outbound)
 * to `AvatarController` with strict command validation, scope enforcement, and
 * per-client stream/subscription lifecycle tracking.
 */
export class BridgeClient {
  private readonly avatarController: AvatarController;
  private readonly limits?: Partial<AvatarCommandLimits>;
  private readonly subscribeInboundFn: (
    handler: (payload: BridgeInboundPayload) => void
  ) => Promise<() => void>;
  private readonly sendEventFn: (
    message: BridgeOutboundMessage
  ) => Promise<void>;

  private grantedScopes: Set<AvatarScope>;
  private readonly clientSubscriptions = new Map<
    string,
    Set<AvatarEventType>
  >();
  private unlistenInbound: (() => void) | null = null;
  private unlistenAvatarEvents: UnlistenFn | null = null;
  private started = false;
  private disposed = false;

  constructor(options: BridgeClientOptions) {
    this.avatarController = options.avatarController;
    this.limits = options.limits;
    this.grantedScopes = new Set(options.grantedScopes ?? []);
    this.subscribeInboundFn =
      options.subscribeInbound ?? subscribeBridgeInbound;
    this.sendEventFn = options.sendEvent ?? sendBridgeEvent;
  }

  public get isDisposed(): boolean {
    return this.disposed;
  }

  public getGrantedScopes(): AvatarScope[] {
    return [...this.grantedScopes];
  }

  public setGrantedScopes(scopes: readonly AvatarScope[]): void {
    this.grantedScopes = new Set(scopes);
  }

  public getConnectedClientIds(): string[] {
    return [...this.clientSubscriptions.keys()];
  }

  public async start(): Promise<void> {
    if (this.disposed || this.started) return;
    this.started = true;
    this.unlistenAvatarEvents = this.avatarController.onEvent((event) => {
      this.publishEvent(event);
    });
    try {
      this.unlistenInbound = await this.subscribeInboundFn((payload) => {
        this.handleInbound(payload);
      });
    } catch (err: unknown) {
      this.started = false;
      this.unlistenAvatarEvents?.();
      this.unlistenAvatarEvents = null;
      throw err;
    }
  }

  /**
   * Processes a single inbound frame from the bridge `Channel` (`ArrayBuffer`
   * for binary `speakChunk` or JSON control envelope / disconnect notice).
   */
  public handleInbound(payload: BridgeInboundPayload): void {
    if (this.disposed) return;

    if (payload instanceof ArrayBuffer) {
      this.handleBinaryFrame(payload);
      return;
    }
    this.handleControlFrame(payload);
  }

  /**
   * Emits an `AvatarEvent` (including `windowFocus`) to clients subscribed to its
   * event type if allowed by active scopes.
   */
  public publishEvent(event: AvatarEvent): void {
    if (this.disposed) return;
    const filtered = filterEventForScopes(event, this.grantedScopes);
    if (!filtered) return;

    const targets: string[] = [];
    for (const [clientId, events] of this.clientSubscriptions) {
      if (events.has(filtered.type)) {
        targets.push(clientId);
      }
    }
    if (targets.length === 0) return;

    this.dispatchOutbound({
      targetClientIds: targets,
      payload: buildEventEnvelope(filtered)
    });
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.started = false;
    this.unlistenInbound?.();
    this.unlistenInbound = null;
    this.unlistenAvatarEvents?.();
    this.unlistenAvatarEvents = null;

    for (const clientId of this.clientSubscriptions.keys()) {
      this.avatarController.cancelByOwner(clientId);
    }
    this.clientSubscriptions.clear();
  }

  private handleControlFrame(payload: unknown): void {
    if (typeof payload !== "object" || payload === null) return;
    const msg = payload as Record<string, unknown>;
    if (typeof msg.clientId !== "string" || msg.clientId.length === 0) return;
    const clientId = msg.clientId;

    if (msg.kind === "clientDisconnected") {
      this.clientSubscriptions.delete(clientId);
      this.avatarController.cancelByOwner(clientId);
      return;
    }

    if (msg.kind !== "command") return;
    const granted = [...this.grantedScopes];
    const validation = validateAvatarCommand(msg.envelope, this.limits, {
      grantedScopes: granted
    });
    if (!validation.ok) {
      this.dispatchOutbound({
        targetClientIds: [clientId],
        payload: validation.error
      });
      return;
    }

    if (validation.value.cmd.type === "hello") {
      this.clientSubscriptions.set(
        clientId,
        new Set(validation.value.cmd.events ?? [])
      );
    }

    const response = this.avatarController.dispatch(validation.value, {
      ownerId: clientId,
      grantedScopes: granted
    });

    this.dispatchOutbound({
      targetClientIds: [clientId],
      payload: response
    });
  }

  private handleBinaryFrame(buffer: ArrayBuffer): void {
    const decoded = decodeChannelBinarySpeakChunk(buffer);
    if (!decoded.ok) {
      console.warn(`[deskumi] ${decoded.message}`);
      if (decoded.clientId) {
        this.dispatchOutbound({
          targetClientIds: [decoded.clientId],
          payload: buildErrorResponse("invalid", decoded.message)
        });
      }
      return;
    }

    const { clientId, streamId, sampleRate, pcm } = decoded.value;
    const envelope: AvatarCommandEnvelope = {
      v: 1,
      cmd: {
        type: "speakChunk",
        streamId,
        pcm,
        ...(sampleRate !== undefined ? { sampleRate } : {})
      }
    };

    const granted = [...this.grantedScopes];
    const validation = validateAvatarCommand(envelope, this.limits, {
      grantedScopes: granted
    });
    if (!validation.ok) {
      this.dispatchOutbound({
        targetClientIds: [clientId],
        payload: validation.error
      });
      return;
    }

    const response = this.avatarController.dispatch(validation.value, {
      ownerId: clientId,
      grantedScopes: granted
    });
    if (response.type === "error") {
      this.dispatchOutbound({
        targetClientIds: [clientId],
        payload: response
      });
    }
  }

  private dispatchOutbound(message: BridgeOutboundMessage): void {
    void this.sendEventFn(message).catch((err: unknown) => {
      console.warn("[deskumi] Failed to send bridge outbound message:", err);
    });
  }
}
