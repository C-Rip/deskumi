import sampleAvatarUrl from "../assets/avatars/VRM1_Constraint_Twist_Sample.vrm";
import { getBoneScreenBottomFraction } from "./engine/AvatarLoader";
import { PowerSaveController } from "./engine/PowerSaveController";
import { SceneManager } from "./engine/SceneManager";
import {
  setupAppListeners,
  type AppRuntimeState
} from "./platform/app-listeners";
import { syncAutostartWithConfig } from "./platform/autostart";
import {
  loadAvatarModel,
  readPlatformFileBytes,
  setupAvatarInScene
} from "./platform/avatar-picker";
import { getPlatformCaps } from "./platform/caps";
import { DebugOverlay } from "./platform/DebugOverlay";
import { setupWindowDrag } from "./platform/drag";
import { defaultInputRegionManager } from "./platform/input-region";
import { listenTauriEvent } from "./platform/ipc";
import {
  defaultConfigManager,
  restoreWindowPosition,
  saveWindowPosition
} from "./platform/store";
import {
  applyAvatarTransform,
  applyWindowFrameSize,
  getEffectiveFrameSize
} from "./platform/window-frame";
import { WindowPerchController } from "./platform/window-perch";
import "./styles/app.css";

console.log("[deskumi] Initializing Deskumi transparent window");

void restoreWindowPosition();
void syncAutostartWithConfig();

// Disable default WebKit context menu (Inspect Element, Back, Reload, etc.)
window.addEventListener("contextmenu", (event) => event.preventDefault());

const state: AppRuntimeState = {
  avatarContext: null,
  activeAvatarPath: null,
  configuredFrameSize: { width: 400, height: 600 },
  activeScale: 1.0,
  activeOffsetY: 0
};

let isDragging = false;
let savePositionTimeout: ReturnType<typeof setTimeout> | null = null;

// Enable native window dragging with primary mouse button ONLY when dragging on avatar silhouette
setupWindowDrag({
  threshold: 5,
  canDragAt: (clientX, clientY) =>
    state.avatarContext?.inputRegionSystem.isPointOnAvatar(clientX, clientY) ??
    false,
  onDragStart: () => {
    isDragging = true;
    windowPerchController.notifyManualDrag();
  }
});

window.addEventListener("mouseup", () => {
  if (isDragging) {
    if (savePositionTimeout !== null) clearTimeout(savePositionTimeout);
    savePositionTimeout = setTimeout(() => {
      void saveWindowPosition();
    }, 200);
  }
  setTimeout(() => {
    isDragging = false;
  }, 50);
});

// Trigger reaction on avatar click ONLY if clicked inside avatar silhouette (and not dragged)
window.addEventListener("click", (event) => {
  if (isDragging || event.button !== 0) return;
  const hit = state.avatarContext?.inputRegionSystem.isPointOnAvatar(
    event.clientX,
    event.clientY
  );
  if (!hit) return;
  console.log("[deskumi] Avatar silhouette clicked! Triggering reaction");
  state.avatarContext?.reactionSystem.triggerRandom();
});

getPlatformCaps()
  .then((caps) => console.log("[deskumi] Platform caps:", caps))
  .catch((err: unknown) =>
    console.error("[deskumi] Failed to query platform caps:", err)
  );

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

sceneManager.registerSystem({
  update: () => {
    if (!debugOverlay.enabled) return;
    const ctx = state.avatarContext;
    if (ctx) {
      debugOverlay.updateContext(ctx.vrm, ctx.lookAtSystem);
      const pos = ctx.globalCursorSystem?.getLastCursorPosition();
      if (pos) debugOverlay.setCursor(pos.x, pos.y, true);
      debugOverlay.updateHitboxes(ctx.inputRegionSystem.getHitRects());
    } else {
      debugOverlay.updateHitboxes(
        defaultInputRegionManager.getLastAppliedRects()
      );
    }
    debugOverlay.update();
  },
  dispose: () => debugOverlay.dispose()
});

export const powerSaveController = new PowerSaveController(sceneManager, {
  activeFps: 30,
  idleFps: 10,
  idleTimeoutMs: 15_000,
  listenTauriVisibility: (handler) =>
    listenTauriEvent<boolean>("tray-visibility-changed", handler)
});

export const windowPerchController = new WindowPerchController({
  getDeskumiSize: () =>
    sceneManager.getTargetFrameSize() ?? {
      width: window.innerWidth,
      height: window.innerHeight
    },
  getSeatOverlapPx: (deskumiSize) => {
    if (!state.avatarContext) return null;
    const fraction = getBoneScreenBottomFraction(
      state.avatarContext.vrm,
      sceneManager.camera,
      "hips"
    );
    return fraction !== null ? Math.round(deskumiSize.height * fraction) : null;
  },
  onPerchStateChange: (perched) => {
    state.avatarContext?.animationSystem.setSitting(perched);
    const target = getEffectiveFrameSize(state.configuredFrameSize, perched);
    sceneManager.setTargetFrameSize(target.width, target.height);
    void applyWindowFrameSize(sceneManager, target.width, target.height);
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

setupAppListeners({
  sceneManager,
  debugOverlay,
  windowPerchController,
  setActiveFps,
  state
});

async function initAvatar(): Promise<void> {
  const config = await defaultConfigManager.load();
  if (config.fpsCap && config.fpsCap > 0) {
    powerSaveController.setActiveFps(config.fpsCap);
  }

  const avatarScale = config.avatarScale ?? 1.0;
  const frameWidth = config.frameWidth ?? 400;
  const frameHeight = config.frameHeight ?? 600;
  state.configuredFrameSize = { width: frameWidth, height: frameHeight };

  sceneManager.setTargetFrameSize(frameWidth, frameHeight);
  if (frameWidth !== 400 || frameHeight !== 600) {
    await applyWindowFrameSize(sceneManager, frameWidth, frameHeight);
  }
  if (config.fpsCap) sceneManager.fpsCap = config.fpsCap;
  if (typeof config.debugOverlay === "boolean") {
    debugOverlay.setEnabled(config.debugOverlay);
  }
  windowPerchController.setEnabled(Boolean(config.windowInteraction));

  if (config.avatarPath) {
    try {
      console.log(
        `[deskumi] Attempting to load saved avatar: ${config.avatarPath}`
      );
      const { vrm, blobUrl } = await loadAvatarModel(config.avatarPath);
      state.avatarContext = setupAvatarInScene(vrm, sceneManager, blobUrl);
      state.activeAvatarPath = config.avatarPath;
      console.log("[deskumi] Loaded saved avatar successfully");
    } catch (err) {
      console.warn(
        `[deskumi] Failed to load saved avatar at ${config.avatarPath}, falling back to sample:`,
        err
      );
    }
  }

  if (!state.avatarContext) {
    console.log("[deskumi] Loading default sample VRM");
    const { vrm } = await loadAvatarModel(sampleAvatarUrl);
    state.avatarContext = setupAvatarInScene(vrm, sceneManager);
    console.log("[deskumi] Default sample VRM loaded successfully");
  }

  const offsetY = config.avatarOffsetY ?? 0;
  state.activeScale = avatarScale;
  state.activeOffsetY = offsetY;
  applyAvatarTransform(state.avatarContext, avatarScale, offsetY);

  if (config.vrmaPath && state.avatarContext) {
    try {
      console.log(`[deskumi] Loading saved VRMA animation: ${config.vrmaPath}`);
      await state.avatarContext.animationSystem.vrmaPlayer.loadAndPlay(
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

void initAvatar().catch((err: unknown) =>
  console.error("[deskumi] Failed to initialize avatar:", err)
);

sceneManager.start();
