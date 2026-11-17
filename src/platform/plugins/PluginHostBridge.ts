import {
  AVATAR_PROTOCOL_VERSION,
  buildErrorResponse,
  buildEventEnvelope,
  validateAvatarCommand,
  type AvatarCommandLimits,
  type AvatarEvent,
  type AvatarResponse
} from "../../engine/AvatarCommand";
import type { AvatarController } from "../../engine/AvatarController";
import {
  consumeRateLimitSlot,
  extractOptionalRef,
  filterEventForScopes,
  findMountedPluginBySource,
  isPlainRecord,
  PLUGIN_BRIDGE_CHANNEL,
  pluginOwnerId,
  type MountedPluginState,
  type PluginOutboundEnvelope
} from "./PluginHostTypes";

export interface PluginBridgeContext {
  mounted: ReadonlyMap<string, MountedPluginState>;
  avatarController: AvatarController;
  getAvailableAnimations?: () => readonly string[];
  commandLimits?: Partial<AvatarCommandLimits>;
  rateLimitPerSec: number;
  now: () => number;
}

export function postPluginEnvelope(
  entry: MountedPluginState,
  payload: PluginOutboundEnvelope
): void {
  entry.iframe.contentWindow?.postMessage(payload, "*");
}

export function postPluginResponse(
  entry: MountedPluginState,
  response: AvatarResponse
): void {
  postPluginEnvelope(entry, {
    channel: PLUGIN_BRIDGE_CHANNEL,
    pluginId: entry.plugin.id,
    ...response
  });
}

export function postPluginInit(
  entry: MountedPluginState,
  avatarController: AvatarController,
  getAvailableAnimations?: () => readonly string[]
): void {
  postPluginEnvelope(entry, {
    channel: PLUGIN_BRIDGE_CHANNEL,
    pluginId: entry.plugin.id,
    v: AVATAR_PROTOCOL_VERSION,
    type: "init",
    scopes: Array.from(entry.grantedScopes),
    expressions: avatarController.getAvailableExpressions(),
    animations: getAvailableAnimations
      ? [...getAvailableAnimations()]
      : avatarController.getAvailableAnimations()
  });
}

export function routePluginMessage(
  ctx: PluginBridgeContext,
  event: MessageEvent
): void {
  if (event.origin !== "null") return;
  const entry = findMountedPluginBySource(ctx.mounted, event.source);
  if (!entry || !isPlainRecord(event.data)) return;
  if (event.data.channel !== PLUGIN_BRIDGE_CHANNEL) return;

  const ref = extractOptionalRef(event.data);
  if (
    event.data.pluginId !== undefined &&
    event.data.pluginId !== entry.plugin.id
  ) {
    postPluginResponse(
      entry,
      buildErrorResponse("forbidden", "Plugin ID mismatch", ref)
    );
    return;
  }

  if (
    !consumeRateLimitSlot(entry.rateTimestamps, ctx.now(), ctx.rateLimitPerSec)
  ) {
    postPluginResponse(
      entry,
      buildErrorResponse(
        "rate_limited",
        "Plugin command rate limit exceeded",
        ref
      )
    );
    return;
  }

  const envelope: Record<string, unknown> = {
    v: event.data.v,
    cmd: event.data.cmd,
    ...(event.data.id !== undefined ? { id: event.data.id } : {})
  };
  const grantedScopes = Array.from(entry.grantedScopes);
  const preCheck = validateAvatarCommand(envelope, ctx.commandLimits, {
    grantedScopes,
    ...(ctx.getAvailableAnimations
      ? { availableAnimations: ctx.getAvailableAnimations() }
      : {})
  });
  if (!preCheck.ok) {
    postPluginResponse(entry, preCheck.error);
    return;
  }

  const response = ctx.avatarController.dispatch(preCheck.value, {
    ownerId: pluginOwnerId(entry.plugin.id),
    grantedScopes
  });
  if (preCheck.value.cmd.type === "hello" && response.type === "hello") {
    entry.subscribedEvents = new Set(response.subscribedEvents);
  }
  postPluginResponse(entry, response);
}

export function forwardAvatarEventToPlugins(
  mounted: ReadonlyMap<string, MountedPluginState>,
  event: AvatarEvent
): void {
  for (const entry of mounted.values()) {
    if (!entry.subscribedEvents.has(event.type)) continue;
    const filtered = filterEventForScopes(entry.grantedScopes, event);
    if (!filtered) continue;
    postPluginEnvelope(entry, {
      channel: PLUGIN_BRIDGE_CHANNEL,
      pluginId: entry.plugin.id,
      ...buildEventEnvelope(filtered)
    });
  }
}
