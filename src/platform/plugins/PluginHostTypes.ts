import type {
  AVATAR_PROTOCOL_VERSION,
  AvatarCommandLimits,
  AvatarEvent,
  AvatarEventEnvelope,
  AvatarEventType,
  AvatarResponse,
  AvatarScope
} from "../../engine/AvatarCommand";
import type { AvatarController } from "../../engine/AvatarController";
import type { PluginInfo } from "../ipc";
import type { RegisteredAnimationResolver } from "./RegisteredAnimationResolver";

export const PLUGIN_BRIDGE_CHANNEL = "deskumi:plugin" as const;
export const MAX_ACTIVE_PLUGINS = 3;
export const DEFAULT_PLUGIN_RATE_LIMIT_PER_SEC = 30;

const KNOWN_SCOPES = new Set<string>([
  "avatar:speak",
  "avatar:interrupt",
  "avatar:expression",
  "avatar:animation",
  "avatar:lookAt",
  "avatar:events",
  "desktop:events",
  "desktop:windowTitle"
]);

export interface PluginMountConfig {
  plugin: PluginInfo;
  grantedPermissions: readonly string[];
}

export interface PluginIframeLike {
  src: string;
  hidden: boolean;
  tabIndex: number;
  style: {
    display: string;
    width: string;
    height: string;
    border: string;
  };
  readonly contentWindow: {
    postMessage: (message: unknown, targetOrigin: string) => void;
  } | null;
  setAttribute: (name: string, value: string) => void;
  addEventListener: (type: "load", listener: () => void) => void;
  removeEventListener: (type: "load", listener: () => void) => void;
  remove: () => void;
}

export interface PluginContainerLike {
  appendChild: (node: PluginIframeLike) => unknown;
}

export interface PluginMessageTargetLike {
  addEventListener: (
    type: "message",
    listener: (event: MessageEvent) => void
  ) => void;
  removeEventListener: (
    type: "message",
    listener: (event: MessageEvent) => void
  ) => void;
}

export interface PluginHostOptions {
  avatarController: AvatarController;
  animationResolver?: RegisteredAnimationResolver;
  getAvailableAnimations?: () => readonly string[];
  container?: PluginContainerLike;
  messageTarget?: PluginMessageTargetLike | null;
  createIframe?: () => PluginIframeLike;
  maxWorkers?: number;
  commandLimits?: Partial<AvatarCommandLimits>;
  rateLimitPerSec?: number;
  now?: () => number;
  onError?: (pluginId: string, error: Error) => void;
}

export type PluginOutboundEnvelope =
  | ({ channel: typeof PLUGIN_BRIDGE_CHANNEL; pluginId: string } & (
      AvatarResponse | AvatarEventEnvelope
    ))
  | {
      channel: typeof PLUGIN_BRIDGE_CHANNEL;
      pluginId: string;
      v: typeof AVATAR_PROTOCOL_VERSION;
      type: "init" | "permissionsChanged";
      scopes: string[];
      expressions?: string[];
      animations?: string[];
    };

export function pluginOwnerId(pluginId: string): string {
  return `plugin:${pluginId}`;
}

export function computeEffectiveScopes(
  requestedPermissions: readonly string[],
  grantedPermissions: readonly string[]
): AvatarScope[] {
  const grantedSet = new Set(grantedPermissions);
  const out: AvatarScope[] = [];
  const seen = new Set<string>();
  for (const perm of requestedPermissions) {
    if (KNOWN_SCOPES.has(perm) && grantedSet.has(perm) && !seen.has(perm)) {
      seen.add(perm);
      out.push(perm as AvatarScope);
    }
  }
  return out;
}

export function isValidPluginEntryUrl(
  pluginId: string,
  entryUrl: string
): boolean {
  const prefix = `plugin://${pluginId}/`;
  if (!entryUrl.startsWith(prefix)) {
    return false;
  }
  const suffix = entryUrl.slice(prefix.length);
  return (
    suffix.length > 0 &&
    !suffix.includes("..") &&
    !suffix.includes("\\") &&
    !suffix.includes("\0")
  );
}

export function configureHiddenSandboxIframe(
  iframe: PluginIframeLike,
  pluginId: string
): void {
  // Enforce opaque origin sandbox strictly without allow-same-origin
  iframe.setAttribute("sandbox", "allow-scripts");
  iframe.setAttribute("aria-hidden", "true");
  iframe.setAttribute("data-plugin-id", pluginId);
  iframe.hidden = true;
  iframe.tabIndex = -1;
  iframe.style.display = "none";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
}

export function filterEventForScopes(
  grantedScopes: ReadonlySet<AvatarScope>,
  event: AvatarEvent
): AvatarEvent | null {
  if (event.type === "windowFocus") {
    if (!grantedScopes.has("desktop:events")) {
      return null;
    }
    if (grantedScopes.has("desktop:windowTitle")) {
      return event;
    }
    return event.appId !== undefined
      ? { type: "windowFocus", appId: event.appId }
      : { type: "windowFocus" };
  }
  return grantedScopes.has("avatar:events") ? event : null;
}

export interface MountedPluginState {
  plugin: PluginInfo;
  iframe: PluginIframeLike;
  grantedScopes: Set<AvatarScope>;
  subscribedEvents: Set<AvatarEventType>;
  onLoad: () => void;
  rateTimestamps: number[];
}

export function isPlainRecord(
  value: unknown
): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function extractOptionalRef(
  data: Record<string, unknown>
): string | undefined {
  return typeof data.id === "string" && data.id.trim().length > 0
    ? data.id
    : undefined;
}

export function consumeRateLimitSlot(
  timestamps: number[],
  nowMs: number,
  maxPerSec: number
): boolean {
  const cutoff = nowMs - 1_000;
  while (timestamps.length > 0 && timestamps[0] <= cutoff) {
    timestamps.shift();
  }
  if (timestamps.length >= maxPerSec) {
    return false;
  }
  timestamps.push(nowMs);
  return true;
}

export function findMountedPluginBySource(
  mounted: ReadonlyMap<string, MountedPluginState>,
  source: MessageEventSource | null
): MountedPluginState | null {
  if (!source) return null;
  for (const entry of mounted.values()) {
    if (
      entry.iframe.contentWindow !== null &&
      entry.iframe.contentWindow === (source as unknown)
    ) {
      return entry;
    }
  }
  return null;
}
