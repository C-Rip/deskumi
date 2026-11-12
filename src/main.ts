import sampleAvatarUrl from "../assets/avatars/VRM1_Constraint_Twist_Sample.vrm";
import { SceneManager } from "./engine/SceneManager";
import { PowerSaveController } from "./engine/PowerSaveController";
import { getPlatformCaps } from "./platform/caps";
import { setupWindowDrag } from "./platform/drag";
import {
  defaultConfigManager,
  restoreWindowPosition,
  saveWindowPosition,
  type AppConfig
} from "./platform/store";
import { syncAutostartWithConfig } from "./platform/autostart";
import {
  loadAvatarModel,
  setupAvatarInScene,
  pickAndSwitchAvatar,
  clearAvatar,
  pickAndPlayVRMA,
  stopVRMA,
  teardownAvatarContext,
  type LoadedAvatarContext
} from "./platform/avatar-picker";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import "./styles/app.css";

console.log("[deskumi] Initializing Deskumi transparent window");

// Restore saved desktop position from store
void restoreWindowPosition();

// Synchronize OS autostart state with persisted configuration
void syncAutostartWithConfig();

// Disable default WebKit context menu (Inspect Element, Back, Reload, etc.)
window.addEventListener("contextmenu", (event) => {
  event.preventDefault();
});

let isDragging = false;
let savePositionTimeout: ReturnType<typeof setTimeout> | null = null;
let currentAvatarContext: LoadedAvatarContext | null = null;
let activeAvatarPath: string | null = null;

// Enable native window dragging with primary mouse button when dragging
setupWindowDrag({
  threshold: 5,
  onDragStart: () => {
    isDragging = true;
  }
});

window.addEventListener("mouseup", () => {
  if (isDragging) {
    // Debounce saving the window position on drag completion
    if (savePositionTimeout !== null) {
      clearTimeout(savePositionTimeout);
    }
    savePositionTimeout = setTimeout(() => {
      void saveWindowPosition();
    }, 200);
  }

  // Reset drag flag shortly after mouse up so click event can check it
  setTimeout(() => {
    isDragging = false;
  }, 50);
});

// Trigger reaction on avatar click (if not dragged)
window.addEventListener("click", (event) => {
  if (isDragging) {
    return;
  }
  if (event.button === 0 && currentAvatarContext) {
    console.log("[deskumi] Avatar clicked! Triggering reaction");
    currentAvatarContext.reactionSystem.triggerRandom();
  }
});

getPlatformCaps()
  .then((caps) => {
    console.log("[deskumi] Platform caps:", caps);
  })
  .catch((err: unknown) => {
    console.error("[deskumi] Failed to query platform caps:", err);
  });

const appContainer = document.querySelector<HTMLDivElement>("#app");
if (!appContainer) {
  throw new Error("Missing #app container element");
}

export const sceneManager = new SceneManager({
  container: appContainer,
  fpsCap: 30
});

export const powerSaveController = new PowerSaveController(sceneManager, {
  activeFps: 30,
  idleFps: 10,
  idleTimeoutMs: 15_000
});

/**
 * Updates active FPS dynamically (e.g. from settings window or IPC).
 */
export function setActiveFps(fps: number): void {
  powerSaveController.setActiveFps(fps);
}

if (typeof window !== "undefined") {
  (window as unknown as { setActiveFps?: typeof setActiveFps }).setActiveFps =
    setActiveFps;
}

// Listen for "tray-request-load-avatar" event from native tray menu
void listen("tray-request-load-avatar", () => {
  console.log("[deskumi] Received tray-request-load-avatar event");
  void pickAndSwitchAvatar(
    sceneManager,
    () => currentAvatarContext,
    (ctx) => {
      currentAvatarContext = ctx;
    }
  );
});

// Listen for "tray-request-clear-avatar" event from native tray menu
void listen("tray-request-clear-avatar", () => {
  console.log("[deskumi] Received tray-request-clear-avatar event");
  void clearAvatar(
    sceneManager,
    () => currentAvatarContext,
    (ctx) => {
      currentAvatarContext = ctx;
    }
  );
});

// Listen for "tray-request-load-vrma" event from native tray menu
void listen("tray-request-load-vrma", () => {
  console.log("[deskumi] Received tray-request-load-vrma event");
  if (currentAvatarContext) {
    void pickAndPlayVRMA(currentAvatarContext);
  }
});

// Listen for "tray-request-stop-vrma" event from native tray menu
void listen("tray-request-stop-vrma", () => {
  console.log("[deskumi] Received tray-request-stop-vrma event");
  if (currentAvatarContext) {
    void stopVRMA(currentAvatarContext);
  }
});

// Listen for "tray-autostart-changed" event from native tray menu
void listen<boolean>("tray-autostart-changed", (event) => {
  console.log(
    `[deskumi] Received tray-autostart-changed event: ${String(event.payload)}`
  );
  void defaultConfigManager.set("autostart", event.payload);
});

// Listen for "settings-window-visibility" to pause avatar rendering when settings is open
void listen<boolean>("settings-window-visibility", (event) => {
  const isSettingsOpen = event.payload;
  console.log(
    `[deskumi] Settings window visibility changed: ${String(isSettingsOpen)}`
  );
  if (isSettingsOpen) {
    sceneManager.pause();
  } else {
    sceneManager.resume();
  }
});

// Listen for "settings-updated" event from settings window
void listen<AppConfig>("settings-updated", async (event) => {
  const newConfig = event.payload;
  console.log("[deskumi] Received settings-updated event:", newConfig);

  // 1. Update FPS Cap
  if (typeof newConfig.fpsCap === "number") {
    setActiveFps(newConfig.fpsCap);
  }

  // 2. Update Avatar Scale
  if (typeof newConfig.avatarScale === "number" && currentAvatarContext) {
    currentAvatarContext.vrm.scene.scale.setScalar(newConfig.avatarScale);
  }

  // 3. Update Transparent Window Dimensions (Frame Size)
  if (
    typeof newConfig.frameWidth === "number" &&
    typeof newConfig.frameHeight === "number"
  ) {
    try {
      const win = getCurrentWindow();
      await win.setSize(
        new LogicalSize(newConfig.frameWidth, newConfig.frameHeight)
      );
      sceneManager.resize(newConfig.frameWidth, newConfig.frameHeight);
      console.log(
        `[deskumi] Resized transparent window frame to ${newConfig.frameWidth}x${newConfig.frameHeight}`
      );
    } catch (err) {
      console.warn("[deskumi] Failed to resize transparent window:", err);
    }
  }

  // 4. Update Avatar Model only if path actually changed
  if (
    newConfig.avatarPath !== undefined &&
    newConfig.avatarPath !== activeAvatarPath
  ) {
    activeAvatarPath = newConfig.avatarPath;
    if (newConfig.avatarPath === null) {
      void clearAvatar(
        sceneManager,
        () => currentAvatarContext,
        (ctx) => {
          currentAvatarContext = ctx;
        }
      );
    } else {
      try {
        const { vrm, blobUrl } = await loadAvatarModel(newConfig.avatarPath);
        if (currentAvatarContext) {
          teardownAvatarContext(currentAvatarContext, sceneManager);
        }
        currentAvatarContext = setupAvatarInScene(vrm, sceneManager, blobUrl);
        if (typeof newConfig.avatarScale === "number") {
          currentAvatarContext.vrm.scene.scale.setScalar(newConfig.avatarScale);
        }
      } catch (err) {
        console.warn(
          "[deskumi] Failed to load updated avatar from settings:",
          err
        );
      }
    }
  }

  // 4. Reset Window Position if requested
  if (newConfig.windowX === null && newConfig.windowY === null) {
    try {
      const win = getCurrentWindow();
      await win.center();
      console.log("[deskumi] Window position centered on reset");
    } catch (err) {
      console.warn("[deskumi] Failed to center window on reset:", err);
    }
  }
});

// Load configured avatar or fallback to official sample avatar
async function initAvatar(): Promise<void> {
  const config = await defaultConfigManager.load();
  if (config.fpsCap && config.fpsCap > 0) {
    powerSaveController.setActiveFps(config.fpsCap);
  }

  const avatarPath = config.avatarPath;
  const avatarScale = config.avatarScale ?? 1.0;
  const frameWidth = config.frameWidth ?? 400;
  const frameHeight = config.frameHeight ?? 600;

  if (frameWidth !== 400 || frameHeight !== 600) {
    try {
      const win = getCurrentWindow();
      await win.setSize(new LogicalSize(frameWidth, frameHeight));
      sceneManager.resize(frameWidth, frameHeight);
    } catch (err) {
      console.warn(
        "[deskumi] Failed to set initial transparent window size:",
        err
      );
    }
  }

  if (config.fpsCap) {
    sceneManager.fpsCap = config.fpsCap;
  }

  if (avatarPath) {
    try {
      console.log(`[deskumi] Attempting to load saved avatar: ${avatarPath}`);
      const { vrm, blobUrl } = await loadAvatarModel(avatarPath);
      currentAvatarContext = setupAvatarInScene(vrm, sceneManager, blobUrl);
      currentAvatarContext.vrm.scene.scale.setScalar(avatarScale);
      activeAvatarPath = avatarPath;
      console.log("[deskumi] Loaded saved avatar successfully");
    } catch (err) {
      console.warn(
        `[deskumi] Failed to load saved avatar at ${avatarPath}, falling back to sample:`,
        err
      );
    }
  }

  // Fallback to sample avatar if saved avatar wasn't loaded
  if (!currentAvatarContext) {
    console.log("[deskumi] Loading default sample VRM");
    const { vrm } = await loadAvatarModel(sampleAvatarUrl);
    currentAvatarContext = setupAvatarInScene(vrm, sceneManager);
    currentAvatarContext.vrm.scene.scale.setScalar(avatarScale);
    console.log("[deskumi] Default sample VRM loaded successfully");
  }

  // Load configured VRMA animation if present
  if (config.vrmaPath && currentAvatarContext) {
    try {
      console.log(`[deskumi] Loading saved VRMA animation: ${config.vrmaPath}`);
      await currentAvatarContext.animationSystem.vrmaPlayer.loadAndPlay(
        config.vrmaPath,
        {
          loop: true,
          fadeInDuration: 0
        }
      );
      console.log("[deskumi] Loaded saved VRMA animation successfully");
    } catch (err) {
      console.warn(
        `[deskumi] Failed to load saved VRMA animation at ${config.vrmaPath}:`,
        err
      );
    }
  }
}

initAvatar().catch((err: unknown) => {
  console.error("[deskumi] Failed to initialize avatar:", err);
});

sceneManager.start();
