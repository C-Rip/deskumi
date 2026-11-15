import sampleAvatarUrl from "../assets/avatars/VRM1_Constraint_Twist_Sample.vrm";
import { calcCenteredAvatarY } from "./engine/AvatarLoader";
import { SceneManager } from "./engine/SceneManager";
import { PowerSaveController } from "./engine/PowerSaveController";
import { getPlatformCaps } from "./platform/caps";
import { setupWindowDrag } from "./platform/drag";
import { defaultInputRegionManager } from "./platform/input-region";
import { DebugOverlay } from "./platform/DebugOverlay";
import { WindowPerchController } from "./platform/window-perch";
import {
  defaultConfigManager,
  restoreWindowPosition,
  saveWindowPosition,
  type AppConfig
} from "./platform/store";
import { syncAutostartWithConfig } from "./platform/autostart";
import {
  pickAndPlayVRMA,
  pickAndSwitchAvatar,
  readPlatformFileBytes,
  clearAvatar,
  loadAvatarModel,
  setupAvatarInScene,
  stopVRMA,
  teardownAvatarContext,
  type LoadedAvatarContext
} from "./platform/avatar-picker";
import { listenTauriEvent, setWindowDesktopSize } from "./platform/ipc";
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

// Enable native window dragging with primary mouse button ONLY when dragging on avatar silhouette
setupWindowDrag({
  threshold: 5,
  canDragAt: (clientX, clientY) => {
    if (!currentAvatarContext) return false;
    return currentAvatarContext.inputRegionSystem.isPointOnAvatar(
      clientX,
      clientY
    );
  },
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

// Trigger reaction on avatar click ONLY if clicked inside avatar silhouette (and not dragged)
window.addEventListener("click", (event) => {
  if (isDragging) {
    return;
  }
  if (event.button === 0 && currentAvatarContext) {
    const isHit = currentAvatarContext.inputRegionSystem.isPointOnAvatar(
      event.clientX,
      event.clientY
    );
    if (!isHit) {
      return;
    }
    console.log("[deskumi] Avatar silhouette clicked! Triggering reaction");
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

export const debugOverlay = new DebugOverlay({
  container: appContainer,
  camera: sceneManager.camera
});
debugOverlay.init();

// Register debug overlay update hook in SceneManager render loop
sceneManager.registerSystem({
  update: () => {
    if (debugOverlay.enabled) {
      if (currentAvatarContext) {
        debugOverlay.updateContext(
          currentAvatarContext.vrm,
          currentAvatarContext.lookAtSystem
        );
        const globalPos =
          currentAvatarContext.globalCursorSystem?.getLastCursorPosition();
        if (globalPos) {
          debugOverlay.setCursor(globalPos.x, globalPos.y, true);
        }
        debugOverlay.updateHitboxes(
          currentAvatarContext.inputRegionSystem.getHitRects()
        );
      } else {
        debugOverlay.updateHitboxes(
          defaultInputRegionManager.getLastAppliedRects()
        );
      }
      debugOverlay.update();
    }
  },
  dispose: () => {
    debugOverlay.dispose();
  }
});

export const powerSaveController = new PowerSaveController(sceneManager, {
  activeFps: 30,
  idleFps: 10,
  idleTimeoutMs: 15_000,
  listenTauriVisibility: (handler) =>
    listenTauriEvent<boolean>("tray-visibility-changed", handler)
});

let configuredFrameSize = { width: 400, height: 600 };

function getEffectiveFrameSize(perched: boolean): {
  width: number;
  height: number;
} {
  return {
    width: configuredFrameSize.width,
    height: perched
      ? Math.max(180, Math.round(configuredFrameSize.height * 0.72))
      : configuredFrameSize.height
  };
}

export const windowPerchController = new WindowPerchController({
  getDeskumiSize: () =>
    sceneManager.getTargetFrameSize() ?? {
      width: window.innerWidth,
      height: window.innerHeight
    },
  onPerchStateChange: (perched) => {
    currentAvatarContext?.animationSystem.setSitting(perched);
    const target = getEffectiveFrameSize(perched);
    sceneManager.setTargetFrameSize(target.width, target.height);
    void applyWindowFrameSize(target.width, target.height);
  }
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
void listenTauriEvent("tray-request-load-avatar", () => {
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
void listenTauriEvent("tray-request-clear-avatar", () => {
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
void listenTauriEvent("tray-request-load-vrma", () => {
  console.log("[deskumi] Received tray-request-load-vrma event");
  if (currentAvatarContext) {
    void pickAndPlayVRMA(currentAvatarContext);
  }
});

// Listen for "tray-request-stop-vrma" event from native tray menu
void listenTauriEvent("tray-request-stop-vrma", () => {
  console.log("[deskumi] Received tray-request-stop-vrma event");
  if (currentAvatarContext) {
    void stopVRMA(currentAvatarContext);
  }
});

// Listen for "tray-autostart-changed" event from native tray menu
void listenTauriEvent<boolean>("tray-autostart-changed", (enabled) => {
  console.log(
    `[deskumi] Received tray-autostart-changed event: ${String(enabled)}`
  );
  void defaultConfigManager.set("autostart", enabled);
});

// Listen for "settings-window-visibility" (keep main avatar running continuously without pausing)
void listenTauriEvent<boolean>(
  "settings-window-visibility",
  (isSettingsOpen) => {
    console.log(
      `[deskumi] Settings window visibility changed: ${String(isSettingsOpen)} (main avatar stays active)`
    );
    sceneManager.resume();
  }
);

async function applyWindowFrameSize(
  width: number,
  height: number
): Promise<void> {
  sceneManager.setTargetFrameSize(width, height);
  try {
    await setWindowDesktopSize(Math.round(width), Math.round(height));
    sceneManager.resize();
    requestAnimationFrame(() => sceneManager.resize());
    console.log(
      `[deskumi] Resized transparent window frame via native GTK to ${width}x${height}`
    );
  } catch {
    try {
      const win = getCurrentWindow();
      await win.setResizable(true);
      await win.setSize(new LogicalSize(width, height));
      await win.setResizable(false);
      sceneManager.resize();
      requestAnimationFrame(() => sceneManager.resize());
      console.log(
        `[deskumi] Resized transparent window frame to ${width}x${height}`
      );
    } catch (err) {
      console.warn("[deskumi] Failed to resize transparent window:", err);
    }
  }
}

let activeScale = 1.0;
let activeOffsetY = 0;

function applyAvatarTransform(
  context: LoadedAvatarContext,
  scale: number,
  offsetY: number
): void {
  activeScale = scale;
  activeOffsetY = offsetY;
  context.vrm.scene.scale.setScalar(scale);
  context.vrm.scene.position.x = 0;
  const posY = calcCenteredAvatarY(context.framingCenterY, scale, offsetY);
  context.vrm.scene.position.y = posY;
  context.reactionSystem.setBasePositionY(posY);
}

// Listen for "settings-updated" event from settings window
void listenTauriEvent<AppConfig>("settings-updated", async (newConfig) => {
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
      : activeScale;
  const nextOffsetY =
    typeof newConfig.avatarOffsetY === "number"
      ? newConfig.avatarOffsetY
      : activeOffsetY;
  if (currentAvatarContext) {
    applyAvatarTransform(currentAvatarContext, nextScale, nextOffsetY);
  } else {
    activeScale = nextScale;
    activeOffsetY = nextOffsetY;
  }

  // 3. Update Transparent Window Dimensions (Frame Size)
  if (
    typeof newConfig.frameWidth === "number" &&
    typeof newConfig.frameHeight === "number"
  ) {
    configuredFrameSize = {
      width: newConfig.frameWidth,
      height: newConfig.frameHeight
    };
    const effective = getEffectiveFrameSize(windowPerchController.perched);
    await applyWindowFrameSize(effective.width, effective.height);
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
        applyAvatarTransform(currentAvatarContext, nextScale, nextOffsetY);
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

  // 5. Update Developer Debug Overlay
  if (typeof newConfig.debugOverlay === "boolean") {
    debugOverlay.setEnabled(newConfig.debugOverlay);
  }

  // 6. Update Window Interaction (perch atop active window)
  if (typeof newConfig.windowInteraction === "boolean") {
    windowPerchController.setEnabled(newConfig.windowInteraction);
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
  configuredFrameSize = { width: frameWidth, height: frameHeight };

  sceneManager.setTargetFrameSize(frameWidth, frameHeight);
  if (frameWidth !== 400 || frameHeight !== 600) {
    await applyWindowFrameSize(frameWidth, frameHeight);
  }

  if (config.fpsCap) {
    sceneManager.fpsCap = config.fpsCap;
  }

  if (typeof config.debugOverlay === "boolean") {
    debugOverlay.setEnabled(config.debugOverlay);
  }

  windowPerchController.setEnabled(Boolean(config.windowInteraction));

  if (avatarPath) {
    try {
      console.log(`[deskumi] Attempting to load saved avatar: ${avatarPath}`);
      const { vrm, blobUrl } = await loadAvatarModel(avatarPath);
      currentAvatarContext = setupAvatarInScene(vrm, sceneManager, blobUrl);
      applyAvatarTransform(
        currentAvatarContext,
        avatarScale,
        config.avatarOffsetY ?? 0
      );
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
    applyAvatarTransform(
      currentAvatarContext,
      avatarScale,
      config.avatarOffsetY ?? 0
    );
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
          fadeInDuration: 0,
          readLocalFileBytes: readPlatformFileBytes
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
