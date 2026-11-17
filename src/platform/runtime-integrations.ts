import { isTauri } from "@tauri-apps/api/core";
import type { AvatarController } from "../engine/AvatarController";
import type { SceneManager } from "../engine/SceneManager";
import type { AppRuntimeState } from "./app-listeners";
import { BridgeClient } from "./bridge/BridgeClient";
import { PluginHost } from "./plugins/PluginHost";
import { RegisteredAnimationResolver } from "./plugins/RegisteredAnimationResolver";
import { SpeechBubbleOverlay } from "./SpeechBubbleOverlay";

export interface RuntimeIntegrations {
  speechBubble: SpeechBubbleOverlay;
  animationResolver: RegisteredAnimationResolver;
  bridgeClient: BridgeClient;
  pluginHost: PluginHost;
  dispose: () => void;
}

export interface SetupRuntimeIntegrationsOptions {
  container: HTMLElement;
  sceneManager: SceneManager;
  avatarController: AvatarController;
  animationResolver: RegisteredAnimationResolver;
  state: AppRuntimeState;
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

  const speechBubble = new SpeechBubbleOverlay({ container });
  const unlistenBubble = avatarController.onSpeechBubbleChange((bubble) => {
    if (bubble) {
      speechBubble.show(bubble.text);
      return;
    }
    speechBubble.hide();
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

  const bridgeClient = new BridgeClient({
    avatarController,
    grantedScopes: [
      "avatar:speak",
      "avatar:expression",
      "avatar:animation",
      "avatar:lookAt",
      "avatar:events",
      "avatar:interrupt"
    ]
  });
  const pluginHost = new PluginHost({
    avatarController,
    animationResolver
  });

  if (isTauri()) {
    void animationResolver.refresh().catch((err: unknown) => {
      console.warn("[deskumi] Failed to refresh registered animations:", err);
    });
    void bridgeClient.start().catch((err: unknown) => {
      console.warn("[deskumi] Failed to subscribe to bridge inbound:", err);
    });
  }

  return {
    speechBubble,
    animationResolver,
    bridgeClient,
    pluginHost,
    dispose: () => {
      unlistenBubble();
      speechBubble.dispose();
      bridgeClient.dispose();
      pluginHost.dispose();
    }
  };
}
