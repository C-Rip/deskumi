import { isTauri } from "@tauri-apps/api/core";
import type { AvatarController } from "../engine/AvatarController";
import type { SceneManager } from "../engine/SceneManager";
import type { AppRuntimeState } from "./app-listeners";
import { BridgeClient } from "./bridge/BridgeClient";
import { getPlatformCaps, type PlatformCaps } from "./caps";
import {
  listPlugins,
  listRegisteredAnimations,
  registerAnimation,
  startLocalBridge,
  stopLocalBridge,
  unregisterAnimation,
  type BridgeStatus,
  type PluginInfo,
  type RegisteredAnimation
} from "./ipc";
import { MAX_ACTIVE_PLUGINS, PluginHost } from "./plugins/PluginHost";
import type { PluginMountConfig } from "./plugins/PluginHostTypes";
import { RegisteredAnimationResolver } from "./plugins/RegisteredAnimationResolver";
import { syncRegisteredAnimations } from "./plugins/sync-animations";
import { SpeechBubbleOverlay } from "./SpeechBubbleOverlay";
import {
  DEFAULT_BRIDGE_SCOPES,
  toValidAvatarScopes,
  type AppConfig,
  type RegisteredAnimationConfig
} from "./store-schema";
import { WindowFocusBridge } from "./window-focus-bridge";

export interface RuntimeIntegrations {
  speechBubble: SpeechBubbleOverlay;
  animationResolver: RegisteredAnimationResolver;
  bridgeClient: BridgeClient;
  pluginHost: PluginHost;
  windowFocusBridge: WindowFocusBridge;
  syncConfig: (config: AppConfig) => Promise<void>;
  dispose: () => void;
}

export interface RuntimeSyncDeps {
  isTauri?: () => boolean;
  getPlatformCaps?: () => Promise<PlatformCaps>;
  startLocalBridge?: () => Promise<BridgeStatus>;
  stopLocalBridge?: () => Promise<BridgeStatus>;
  listPlugins?: () => Promise<PluginInfo[]>;
  listRegisteredAnimations?: () => Promise<RegisteredAnimation[]>;
  registerAnimation?: (
    id: string,
    path: string,
    label?: string
  ) => Promise<RegisteredAnimation | null>;
  unregisterAnimation?: (id: string) => Promise<boolean>;
}

export interface SetupRuntimeIntegrationsOptions {
  container: HTMLElement;
  sceneManager: SceneManager;
  avatarController: AvatarController;
  animationResolver: RegisteredAnimationResolver;
  state: AppRuntimeState;
  deps?: RuntimeSyncDeps;
  speechBubble?: SpeechBubbleOverlay;
  bridgeClient?: BridgeClient;
  pluginHost?: PluginHost;
  windowFocusBridge?: WindowFocusBridge;
}

/**
 * Wires speech bubble overlay, registered VRMA resolver, local WebSocket
 * bridge client, and sandboxed plugin host into the main application runtime.
 */
export function setupRuntimeIntegrations(
  options: SetupRuntimeIntegrationsOptions
): RuntimeIntegrations {
  const {
    container,
    sceneManager,
    avatarController,
    animationResolver,
    state
  } = options;
  const runtimeDeps: Required<RuntimeSyncDeps> = {
    isTauri: options.deps?.isTauri ?? isTauri,
    getPlatformCaps: options.deps?.getPlatformCaps ?? getPlatformCaps,
    startLocalBridge: options.deps?.startLocalBridge ?? startLocalBridge,
    stopLocalBridge: options.deps?.stopLocalBridge ?? stopLocalBridge,
    listPlugins: options.deps?.listPlugins ?? listPlugins,
    listRegisteredAnimations:
      options.deps?.listRegisteredAnimations ?? listRegisteredAnimations,
    registerAnimation: options.deps?.registerAnimation ?? registerAnimation,
    unregisterAnimation:
      options.deps?.unregisterAnimation ?? unregisterAnimation
  };

  const speechBubble =
    options.speechBubble ?? new SpeechBubbleOverlay({ container });
  const unlistenBubble = avatarController.onSpeechBubbleChange((bubble) => {
    if (bubble) speechBubble.show(bubble.text);
    else speechBubble.hide();
  });

  sceneManager.registerSystem({
    update: () => {
      if (!speechBubble.visible) return;
      const width = container.clientWidth || window.innerWidth || 400;
      const height = container.clientHeight || window.innerHeight || 600;
      speechBubble.updateAnchor(
        state.avatarContext?.vrm,
        sceneManager.camera,
        width,
        height
      );
    },
    dispose: () => speechBubble.dispose()
  });

  const bridgeClient =
    options.bridgeClient ??
    new BridgeClient({
      avatarController,
      grantedScopes: toValidAvatarScopes(DEFAULT_BRIDGE_SCOPES)
    });
  const pluginHost =
    options.pluginHost ??
    new PluginHost({
      avatarController,
      animationResolver
    });
  const windowFocusBridge =
    options.windowFocusBridge ??
    new WindowFocusBridge({
      avatarController,
      grantedScopes: toValidAvatarScopes(DEFAULT_BRIDGE_SCOPES)
    });

  let cachedCapsPromise: Promise<PlatformCaps> | null = null;
  let bridgeRunning = false;
  let hasSyncedOnce = false;
  let disposed = false;
  const syncedAnimations = new Map<string, string>();
  let pendingConfig: AppConfig | null = null;
  let activeSync: Promise<void> | null = null;

  const getCaps = (): Promise<PlatformCaps> => {
    if (!cachedCapsPromise) {
      cachedCapsPromise = runtimeDeps.getPlatformCaps();
    }
    return cachedCapsPromise;
  };

  const syncAnimations = (
    items: readonly RegisteredAnimationConfig[]
  ): Promise<void> =>
    syncRegisteredAnimations(
      items,
      syncedAnimations,
      animationResolver,
      runtimeDeps
    );

  const applyConfig = async (config: AppConfig): Promise<void> => {
    if (disposed) return;

    bridgeClient.setGrantedScopes(toValidAvatarScopes(config.bridgeScopes));

    if (!runtimeDeps.isTauri()) {
      hasSyncedOnce = true;
      return;
    }

    const caps = await getCaps();
    if (disposed) return;

    if (caps.localBridge) {
      if (config.bridgeEnabled) {
        try {
          await bridgeClient.start();
          await runtimeDeps.startLocalBridge();
          bridgeRunning = true;
        } catch (err: unknown) {
          console.warn("[deskumi] Failed to start local bridge:", err);
        }
      } else if (bridgeRunning || hasSyncedOnce) {
        try {
          await runtimeDeps.stopLocalBridge();
          bridgeRunning = false;
        } catch (err: unknown) {
          console.warn("[deskumi] Failed to stop local bridge:", err);
        }
      }
    }

    if (caps.plugins || caps.localBridge) {
      try {
        await syncAnimations(config.registeredAnimations);
      } catch (err: unknown) {
        console.warn("[deskumi] Failed to sync registered animations:", err);
      }
    }

    const effectiveFocusScopes = new Set<string>(
      config.bridgeEnabled && caps.localBridge ? config.bridgeScopes : []
    );

    if (caps.plugins) {
      if (config.enabledPlugins.length === 0) {
        pluginHost.syncPlugins([]);
      } else {
        try {
          const discovered = await runtimeDeps.listPlugins();
          if (disposed) return;
          const byId = new Map(discovered.map((p) => [p.id, p]));
          const mountConfigs: PluginMountConfig[] = [];
          for (const pluginId of config.enabledPlugins) {
            if (mountConfigs.length >= MAX_ACTIVE_PLUGINS) break;
            const plugin = byId.get(pluginId);
            if (!plugin) continue;
            const grantedPermissions = config.pluginPermissions[pluginId] ?? [];
            for (const perm of grantedPermissions) {
              effectiveFocusScopes.add(perm);
            }
            mountConfigs.push({
              plugin,
              grantedPermissions
            });
          }
          pluginHost.syncPlugins(mountConfigs);
        } catch (err: unknown) {
          console.warn("[deskumi] Failed to sync plugins:", err);
        }
      }
    } else {
      pluginHost.syncPlugins([]);
    }

    try {
      await windowFocusBridge.start();
      await windowFocusBridge.setGrantedScopes(effectiveFocusScopes);
    } catch (err: unknown) {
      console.warn("[deskumi] Failed to sync window focus metadata:", err);
    }

    hasSyncedOnce = true;
  };

  const syncConfig = async (config: AppConfig): Promise<void> => {
    pendingConfig = config;
    if (activeSync) {
      return await activeSync;
    }
    activeSync = (async () => {
      while (pendingConfig && !disposed) {
        const next = pendingConfig;
        pendingConfig = null;
        await applyConfig(next);
      }
    })().finally(() => {
      activeSync = null;
    });
    return await activeSync;
  };

  const integrations: RuntimeIntegrations = {
    speechBubble,
    animationResolver,
    bridgeClient,
    pluginHost,
    windowFocusBridge,
    syncConfig,
    dispose: () => {
      disposed = true;
      unlistenBubble();
      speechBubble.dispose();
      bridgeClient.dispose();
      pluginHost.dispose();
      windowFocusBridge.dispose();
    }
  };
  state.runtimeIntegrations = integrations;
  return integrations;
}
