import type { AvatarScope } from "../engine/AvatarCommand";

export interface RegisteredAnimationConfig {
  id: string;
  path: string;
  label?: string;
}

export const ALL_AVATAR_SCOPES: readonly AvatarScope[] = [
  "avatar:speak",
  "avatar:interrupt",
  "avatar:expression",
  "avatar:animation",
  "avatar:lookAt",
  "avatar:events",
  "desktop:events",
  "desktop:windowTitle"
];

const VALID_AVATAR_SCOPE_SET = new Set<string>(ALL_AVATAR_SCOPES);

export function toValidAvatarScopes(scopes: readonly string[]): AvatarScope[] {
  const out: AvatarScope[] = [];
  const seen = new Set<string>();
  for (const scope of scopes) {
    if (VALID_AVATAR_SCOPE_SET.has(scope) && !seen.has(scope)) {
      seen.add(scope);
      out.push(scope as AvatarScope);
    }
  }
  return out;
}

export const DEFAULT_BRIDGE_SCOPES: readonly string[] = [
  "avatar:speak",
  "avatar:expression",
  "avatar:animation",
  "avatar:lookAt",
  "avatar:events",
  "avatar:interrupt"
];

/**
 * Persisted application configuration schema.
 */
export interface AppConfig {
  /** Window X coordinate on desktop */
  windowX: number | null;
  /** Window Y coordinate on desktop */
  windowY: number | null;
  /** Target framerate limit */
  fpsCap: number;
  /** Active VRM avatar identifier or path */
  avatarPath: string | null;
  /** Active VRMA animation file path */
  vrmaPath: string | null;
  /** Launch application automatically on system startup */
  autostart: boolean;
  /** Avatar visual scale multiplier (0.5x - 2.0x, default 1.0) */
  avatarScale: number;
  /** Transparent window frame width in pixels (default 400) */
  frameWidth: number;
  /** Transparent window frame height in pixels (default 600) */
  frameHeight: number;
  /** Avatar horizontal offset in 3D world units (default 0) */
  avatarOffsetX?: number;
  /** Avatar vertical offset in 3D world units (default 0) */
  avatarOffsetY?: number;
  /** Developer mode / debugging overlay visible on desktop window (default false) */
  debugOverlay?: boolean;
  /** Automatically perch avatar atop the active window's titlebar (default false) */
  windowInteraction?: boolean;
  /** Enable local WebSocket bridge on loopback (default false) */
  bridgeEnabled: boolean;
  /** Global user-level bridge scopes (desktop:* scopes off by default) */
  bridgeScopes: string[];
  /** Enabled plugin IDs (capped at MAX_ACTIVE_PLUGINS = 3) */
  enabledPlugins: string[];
  /** Explicit per-plugin granted permission scopes */
  pluginPermissions: Record<string, string[]>;
  /** User-registered local .vrma animations mapped by logical ID */
  registeredAnimations: RegisteredAnimationConfig[];
}

/**
 * Default fallback configuration.
 */
export const DEFAULT_CONFIG: AppConfig = {
  windowX: null,
  windowY: null,
  fpsCap: 30,
  avatarPath: null,
  vrmaPath: null,
  autostart: false,
  avatarScale: 1.0,
  frameWidth: 400,
  frameHeight: 600,
  avatarOffsetX: 0,
  avatarOffsetY: 0,
  debugOverlay: false,
  windowInteraction: false,
  bridgeEnabled: false,
  bridgeScopes: [...DEFAULT_BRIDGE_SCOPES],
  enabledPlugins: [],
  pluginPermissions: {},
  registeredAnimations: []
};

function normalizeStringArray(val: unknown): string[] | undefined {
  if (!Array.isArray(val)) return undefined;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of val) {
    if (typeof item === "string" && item.length > 0 && !seen.has(item)) {
      seen.add(item);
      out.push(item);
    }
  }
  return out;
}

function normalizePluginPermissions(
  val: unknown
): Record<string, string[]> | undefined {
  if (typeof val !== "object" || val === null || Array.isArray(val)) {
    return undefined;
  }
  const out: Record<string, string[]> = {};
  for (const [pluginId, perms] of Object.entries(val)) {
    const normalized = normalizeStringArray(perms);
    if (pluginId.length > 0 && normalized) {
      out[pluginId] = normalized;
    }
  }
  return out;
}

function normalizeRegisteredAnimations(
  val: unknown
): RegisteredAnimationConfig[] | undefined {
  if (!Array.isArray(val)) return undefined;
  const byId = new Map<string, RegisteredAnimationConfig>();
  for (const entry of val) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      continue;
    }
    const rec = entry as Record<string, unknown>;
    if (
      typeof rec.id !== "string" ||
      rec.id.trim().length === 0 ||
      typeof rec.path !== "string" ||
      rec.path.trim().length === 0
    ) {
      continue;
    }
    const item: RegisteredAnimationConfig = {
      id: rec.id.trim(),
      path: rec.path
    };
    if (typeof rec.label === "string" && rec.label.trim().length > 0) {
      item.label = rec.label.trim();
    }
    byId.set(item.id, item);
  }
  return Array.from(byId.values());
}

export function cloneAppConfig(config: AppConfig): AppConfig {
  const pluginPermissions: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(config.pluginPermissions ?? {})) {
    pluginPermissions[k] = [...v];
  }
  return {
    ...config,
    bridgeScopes: [...(config.bridgeScopes ?? DEFAULT_BRIDGE_SCOPES)],
    enabledPlugins: [...(config.enabledPlugins ?? [])],
    pluginPermissions,
    registeredAnimations: (config.registeredAnimations ?? []).map((item) => ({
      ...item
    }))
  };
}

/**
 * Migrates partial or legacy `settings.json` records onto `DEFAULT_CONFIG`,
 * tolerating absent or malformed Phase 6 fields without failing.
 */
export function migrateAppConfig(raw: Record<string, unknown>): AppConfig {
  const base = cloneAppConfig(DEFAULT_CONFIG);
  if (raw.windowX === null || typeof raw.windowX === "number") {
    base.windowX = raw.windowX;
  }
  if (raw.windowY === null || typeof raw.windowY === "number") {
    base.windowY = raw.windowY;
  }
  if (typeof raw.fpsCap === "number") base.fpsCap = raw.fpsCap;
  if (raw.avatarPath === null || typeof raw.avatarPath === "string") {
    base.avatarPath = raw.avatarPath;
  }
  if (raw.vrmaPath === null || typeof raw.vrmaPath === "string") {
    base.vrmaPath = raw.vrmaPath;
  }
  if (typeof raw.autostart === "boolean") base.autostart = raw.autostart;
  if (typeof raw.avatarScale === "number") base.avatarScale = raw.avatarScale;
  if (typeof raw.frameWidth === "number") base.frameWidth = raw.frameWidth;
  if (typeof raw.frameHeight === "number") base.frameHeight = raw.frameHeight;
  if (typeof raw.avatarOffsetX === "number") {
    base.avatarOffsetX = raw.avatarOffsetX;
  }
  if (typeof raw.avatarOffsetY === "number") {
    base.avatarOffsetY = raw.avatarOffsetY;
  }
  if (typeof raw.debugOverlay === "boolean") {
    base.debugOverlay = raw.debugOverlay;
  }
  if (typeof raw.windowInteraction === "boolean") {
    base.windowInteraction = raw.windowInteraction;
  }
  if (typeof raw.bridgeEnabled === "boolean") {
    base.bridgeEnabled = raw.bridgeEnabled;
  }
  base.bridgeScopes = normalizeStringArray(raw.bridgeScopes) ?? [
    ...DEFAULT_BRIDGE_SCOPES
  ];
  base.enabledPlugins = normalizeStringArray(raw.enabledPlugins) ?? [];
  base.pluginPermissions =
    normalizePluginPermissions(raw.pluginPermissions) ?? {};
  base.registeredAnimations =
    normalizeRegisteredAnimations(raw.registeredAnimations) ?? [];
  return base;
}
