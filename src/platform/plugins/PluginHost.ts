import {
  AVATAR_PROTOCOL_VERSION,
  type AvatarCommandLimits,
  type AvatarEvent,
  type AvatarScope
} from "../../engine/AvatarCommand";
import type { AvatarController } from "../../engine/AvatarController";
import type { UnlistenFn } from "../../engine/PowerSaveController";
import type { PluginInfo } from "../ipc";
import {
  forwardAvatarEventToPlugins,
  postPluginEnvelope,
  postPluginInit,
  routePluginMessage
} from "./PluginHostBridge";
import {
  computeEffectiveScopes,
  configureHiddenSandboxIframe,
  DEFAULT_PLUGIN_RATE_LIMIT_PER_SEC,
  isValidPluginEntryUrl,
  MAX_ACTIVE_PLUGINS,
  PLUGIN_BRIDGE_CHANNEL,
  pluginOwnerId,
  type MountedPluginState,
  type PluginContainerLike,
  type PluginHostOptions,
  type PluginIframeLike,
  type PluginMessageTargetLike,
  type PluginMountConfig
} from "./PluginHostTypes";

export {
  computeEffectiveScopes,
  DEFAULT_PLUGIN_RATE_LIMIT_PER_SEC,
  MAX_ACTIVE_PLUGINS,
  PLUGIN_BRIDGE_CHANNEL,
  pluginOwnerId,
  type PluginContainerLike,
  type PluginHostOptions,
  type PluginIframeLike,
  type PluginMessageTargetLike,
  type PluginMountConfig,
  type PluginOutboundEnvelope
} from "./PluginHostTypes";

export {
  RegisteredAnimationResolver,
  type RegisteredAnimationResolverOptions
} from "./RegisteredAnimationResolver";

/**
 * Mounts up to `maxWorkers` (3) enabled plugins in isolated `<iframe sandbox="allow-scripts">`
 * elements served over `plugin://`, bridging `postMessage` commands through strict
 * channel verification, `validateAvatarCommand`, per-plugin permissions, and lifecycle cleanup.
 */
export class PluginHost {
  public readonly maxWorkers: number;
  private readonly avatarController: AvatarController;
  private readonly getAvailableAnimations?: () => readonly string[];
  private readonly container: PluginContainerLike | null;
  private readonly messageTarget: PluginMessageTargetLike | null;
  private readonly createIframe: () => PluginIframeLike;
  private readonly commandLimits?: Partial<AvatarCommandLimits>;
  private readonly rateLimitPerSec: number;
  private readonly now: () => number;
  private readonly onError?: (pluginId: string, error: Error) => void;
  private readonly mounted = new Map<string, MountedPluginState>();
  private readonly unlistenAvatarEvents: UnlistenFn;
  private readonly boundMessageHandler: (event: MessageEvent) => void;
  private isDisposed = false;

  constructor(options: PluginHostOptions) {
    this.avatarController = options.avatarController;
    this.getAvailableAnimations =
      options.getAvailableAnimations ??
      (options.animationResolver
        ? () => options.animationResolver!.getAvailableIds()
        : undefined);
    this.container =
      options.container ??
      (typeof document !== "undefined"
        ? (document.body as unknown as PluginContainerLike)
        : null);
    this.messageTarget =
      options.messageTarget !== undefined
        ? options.messageTarget
        : typeof window !== "undefined"
          ? window
          : null;
    this.createIframe =
      options.createIframe ??
      (() => {
        if (typeof document === "undefined") {
          throw new Error("DOM document is unavailable for creating iframe");
        }
        return document.createElement("iframe") as unknown as PluginIframeLike;
      });
    this.maxWorkers = Math.max(
      1,
      Math.min(options.maxWorkers ?? MAX_ACTIVE_PLUGINS, MAX_ACTIVE_PLUGINS)
    );
    this.commandLimits = options.commandLimits;
    this.rateLimitPerSec = Math.max(
      1,
      options.rateLimitPerSec ?? DEFAULT_PLUGIN_RATE_LIMIT_PER_SEC
    );
    this.now = options.now ?? (() => Date.now());
    this.onError = options.onError;
    this.boundMessageHandler = (event) => this.handleMessage(event);
    this.messageTarget?.addEventListener("message", this.boundMessageHandler);
    this.unlistenAvatarEvents = this.avatarController.onEvent((event) =>
      this.handleAvatarEvent(event)
    );
  }

  public get disposed(): boolean {
    return this.isDisposed;
  }

  public getActiveCount(): number {
    return this.mounted.size;
  }

  public getActivePluginIds(): string[] {
    return Array.from(this.mounted.keys());
  }

  public getPluginScopes(pluginId: string): AvatarScope[] {
    const entry = this.mounted.get(pluginId);
    return entry ? Array.from(entry.grantedScopes) : [];
  }

  public mountPlugin(
    plugin: PluginInfo,
    grantedPermissions: readonly string[]
  ): void {
    if (this.isDisposed) throw new Error("PluginHost is disposed");
    if (!isValidPluginEntryUrl(plugin.id, plugin.entryUrl)) {
      throw new Error(`Invalid plugin entry URL for '${plugin.id}'`);
    }
    if (this.mounted.has(plugin.id)) this.unmountPlugin(plugin.id);
    if (this.mounted.size >= this.maxWorkers) {
      throw new Error(
        `Maximum active plugins limit (${this.maxWorkers}) reached`
      );
    }
    const effectiveScopes = computeEffectiveScopes(
      plugin.permissions,
      grantedPermissions
    );
    const iframe = this.createIframe();
    configureHiddenSandboxIframe(iframe, plugin.id);
    const entry: MountedPluginState = {
      plugin,
      iframe,
      grantedScopes: new Set(effectiveScopes),
      subscribedEvents: new Set(),
      onLoad: () =>
        postPluginInit(
          entry,
          this.avatarController,
          this.getAvailableAnimations
        ),
      rateTimestamps: []
    };
    iframe.addEventListener("load", entry.onLoad);
    iframe.src = plugin.entryUrl;
    this.container?.appendChild(iframe);
    this.mounted.set(plugin.id, entry);
  }

  public unmountPlugin(pluginId: string): boolean {
    const entry = this.mounted.get(pluginId);
    if (!entry) return false;
    this.mounted.delete(pluginId);
    this.avatarController.cancelByOwner(pluginOwnerId(pluginId));
    entry.iframe.removeEventListener("load", entry.onLoad);
    entry.iframe.src = "about:blank";
    entry.iframe.remove();
    entry.subscribedEvents.clear();
    return true;
  }

  public reloadPlugin(
    plugin: PluginInfo,
    grantedPermissions: readonly string[]
  ): void {
    this.unmountPlugin(plugin.id);
    this.mountPlugin(plugin, grantedPermissions);
  }

  public updatePluginPermissions(
    pluginId: string,
    grantedPermissions: readonly string[]
  ): boolean {
    const entry = this.mounted.get(pluginId);
    if (!entry) return false;
    const nextScopes = computeEffectiveScopes(
      entry.plugin.permissions,
      grantedPermissions
    );
    entry.grantedScopes = new Set(nextScopes);
    postPluginEnvelope(entry, {
      channel: PLUGIN_BRIDGE_CHANNEL,
      pluginId,
      v: AVATAR_PROTOCOL_VERSION,
      type: "permissionsChanged",
      scopes: nextScopes
    });
    return true;
  }

  public syncPlugins(configs: readonly PluginMountConfig[]): void {
    if (this.isDisposed) return;
    const desiredById = new Map(configs.map((c) => [c.plugin.id, c]));
    for (const [id, active] of Array.from(this.mounted.entries())) {
      const next = desiredById.get(id);
      if (!next || next.plugin.entryUrl !== active.plugin.entryUrl) {
        this.unmountPlugin(id);
      }
    }
    for (const cfg of desiredById.values()) {
      if (this.mounted.has(cfg.plugin.id)) {
        this.updatePluginPermissions(cfg.plugin.id, cfg.grantedPermissions);
        continue;
      }
      if (this.mounted.size >= this.maxWorkers) {
        const msg = `Cannot mount plugin '${cfg.plugin.id}': max active limit (${this.maxWorkers}) reached`;
        this.reportError(cfg.plugin.id, new Error(msg));
        continue;
      }
      try {
        this.mountPlugin(cfg.plugin, cfg.grantedPermissions);
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        this.reportError(cfg.plugin.id, e);
      }
    }
  }

  public handleMessage(event: MessageEvent): void {
    if (this.isDisposed) return;
    routePluginMessage(
      {
        mounted: this.mounted,
        avatarController: this.avatarController,
        getAvailableAnimations: this.getAvailableAnimations,
        commandLimits: this.commandLimits,
        rateLimitPerSec: this.rateLimitPerSec,
        now: this.now
      },
      event
    );
  }

  public dispose(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;
    this.unlistenAvatarEvents();
    this.messageTarget?.removeEventListener(
      "message",
      this.boundMessageHandler
    );
    for (const id of Array.from(this.mounted.keys())) this.unmountPlugin(id);
  }

  private handleAvatarEvent(event: AvatarEvent): void {
    if (this.isDisposed) return;
    forwardAvatarEventToPlugins(this.mounted, event);
  }

  private reportError(pluginId: string, error: Error): void {
    if (this.onError) this.onError(pluginId, error);
    else console.warn(`[deskumi] PluginHost error (${pluginId}):`, error);
  }
}
