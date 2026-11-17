import { getCurrentWindow } from "@tauri-apps/api/window";
import type { AvatarController } from "../engine/AvatarController";
import type { SceneManager } from "../engine/SceneManager";
import {
  clearAvatar,
  loadAvatarModel,
  pickAndPlayVRMA,
  pickAndSwitchAvatar,
  setupAvatarInScene,
  stopVRMA,
  teardownAvatarContext,
  type LoadedAvatarContext
} from "./avatar-picker";
import type { DebugOverlay } from "./DebugOverlay";
import { listenTauriEvent } from "./ipc";
import { defaultConfigManager, type AppConfig } from "./store";
import {
  applyAvatarTransform,
  applyWindowFrameSize,
  getEffectiveFrameSize,
  type FrameSize
} from "./window-frame";
import type { WindowPerchController } from "./window-perch";

export interface AppRuntimeState {
  avatarContext: LoadedAvatarContext | null;
  avatarController?: AvatarController;
  activeAvatarPath: string | null;
  configuredFrameSize: FrameSize;
  activeScale: number;
  activeOffsetY: number;
}

export interface AppListenersDeps {
  sceneManager: SceneManager;
  debugOverlay: DebugOverlay;
  windowPerchController: WindowPerchController;
  setActiveFps: (fps: number) => void;
  state: AppRuntimeState;
}

async function applySettingsUpdate(
  deps: AppListenersDeps,
  newConfig: AppConfig
): Promise<void> {
  const {
    sceneManager,
    debugOverlay,
    windowPerchController,
    setActiveFps,
    state
  } = deps;

  // Ensure main scene is running in case settings window was open
  sceneManager.resume();
  console.log("[deskumi] Received settings-updated event:", newConfig);

  // 1. Update FPS Cap
  if (typeof newConfig.fpsCap === "number") {
    setActiveFps(newConfig.fpsCap);
  }

  // 2. Update Avatar Scale & Offset Position (keep horizontally centered at X = 0)
  const nextScale =
    typeof newConfig.avatarScale === "number"
      ? newConfig.avatarScale
      : state.activeScale;
  const nextOffsetY =
    typeof newConfig.avatarOffsetY === "number"
      ? newConfig.avatarOffsetY
      : state.activeOffsetY;
  state.activeScale = nextScale;
  state.activeOffsetY = nextOffsetY;
  if (state.avatarContext) {
    applyAvatarTransform(state.avatarContext, nextScale, nextOffsetY);
  }

  // 3. Update Transparent Window Dimensions (Frame Size)
  if (
    typeof newConfig.frameWidth === "number" &&
    typeof newConfig.frameHeight === "number"
  ) {
    state.configuredFrameSize = {
      width: newConfig.frameWidth,
      height: newConfig.frameHeight
    };
    const effective = getEffectiveFrameSize(
      state.configuredFrameSize,
      windowPerchController.perched
    );
    await applyWindowFrameSize(sceneManager, effective.width, effective.height);
  }

  // 4. Update Avatar Model only if path actually changed
  if (
    newConfig.avatarPath !== undefined &&
    newConfig.avatarPath !== state.activeAvatarPath
  ) {
    state.activeAvatarPath = newConfig.avatarPath;
    if (newConfig.avatarPath === null) {
      void clearAvatar(
        sceneManager,
        () => state.avatarContext,
        (ctx) => {
          state.avatarContext = ctx;
        },
        state.avatarController
      );
    } else {
      try {
        const { vrm, blobUrl } = await loadAvatarModel(newConfig.avatarPath);
        if (state.avatarContext) {
          teardownAvatarContext(state.avatarContext, sceneManager);
        }
        state.avatarContext = setupAvatarInScene(
          vrm,
          sceneManager,
          blobUrl,
          state.avatarController
        );
        applyAvatarTransform(state.avatarContext, nextScale, nextOffsetY);
      } catch (err) {
        console.warn(
          "[deskumi] Failed to load updated avatar from settings:",
          err
        );
      }
    }
  }

  // 5. Reset Window Position if requested
  if (newConfig.windowX === null && newConfig.windowY === null) {
    try {
      const win = getCurrentWindow();
      await win.center();
      console.log("[deskumi] Window position centered on reset");
    } catch (err) {
      console.warn("[deskumi] Failed to center window on reset:", err);
    }
  }

  // 6. Update Developer Debug Overlay
  if (typeof newConfig.debugOverlay === "boolean") {
    debugOverlay.setEnabled(newConfig.debugOverlay);
  }

  // 7. Update Window Interaction (perch atop active window)
  if (typeof newConfig.windowInteraction === "boolean") {
    windowPerchController.setEnabled(newConfig.windowInteraction);
  }
}

/**
 * Registers Tauri IPC event listeners for tray actions, settings window visibility,
 * and live settings updates. Returns a cleanup function that unsubscribes all listeners.
 */
export function setupAppListeners(deps: AppListenersDeps): () => void {
  const { sceneManager, state } = deps;
  const unlistenPromises: Array<Promise<() => void>> = [];

  unlistenPromises.push(
    listenTauriEvent("tray-request-load-avatar", () => {
      console.log("[deskumi] Received tray-request-load-avatar event");
      void pickAndSwitchAvatar(
        sceneManager,
        () => state.avatarContext,
        (ctx) => {
          state.avatarContext = ctx;
        },
        state.avatarController
      );
    })
  );

  unlistenPromises.push(
    listenTauriEvent("tray-request-clear-avatar", () => {
      console.log("[deskumi] Received tray-request-clear-avatar event");
      void clearAvatar(
        sceneManager,
        () => state.avatarContext,
        (ctx) => {
          state.avatarContext = ctx;
        },
        state.avatarController
      );
    })
  );

  unlistenPromises.push(
    listenTauriEvent("tray-request-load-vrma", () => {
      console.log("[deskumi] Received tray-request-load-vrma event");
      if (state.avatarContext) {
        void pickAndPlayVRMA(state.avatarContext);
      }
    })
  );

  unlistenPromises.push(
    listenTauriEvent("tray-request-stop-vrma", () => {
      console.log("[deskumi] Received tray-request-stop-vrma event");
      if (state.avatarContext) {
        void stopVRMA(state.avatarContext);
      }
    })
  );

  unlistenPromises.push(
    listenTauriEvent<boolean>("tray-autostart-changed", (enabled) => {
      console.log(
        `[deskumi] Received tray-autostart-changed event: ${String(enabled)}`
      );
      void defaultConfigManager.set("autostart", enabled);
    })
  );

  unlistenPromises.push(
    listenTauriEvent<boolean>(
      "settings-window-visibility",
      (isSettingsOpen) => {
        console.log(
          `[deskumi] Settings window visibility changed: ${String(isSettingsOpen)} (main avatar stays active)`
        );
        sceneManager.resume();
      }
    )
  );

  unlistenPromises.push(
    listenTauriEvent<AppConfig>("settings-updated", (newConfig) => {
      void applySettingsUpdate(deps, newConfig);
    })
  );

  return () => {
    for (const promise of unlistenPromises) {
      void promise.then((unlisten) => unlisten()).catch(() => {});
    }
  };
}
