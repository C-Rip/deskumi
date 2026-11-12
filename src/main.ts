import sampleAvatarUrl from "../assets/avatars/VRM1_Constraint_Twist_Sample.vrm";
import { SceneManager } from "./engine/SceneManager";
import { getPlatformCaps } from "./platform/caps";
import { setupWindowDrag } from "./platform/drag";
import {
  defaultConfigManager,
  restoreWindowPosition,
  saveWindowPosition
} from "./platform/store";
import {
  loadAvatarModel,
  setupAvatarInScene,
  pickAndSwitchAvatar,
  type LoadedAvatarContext
} from "./platform/avatar-picker";
import { listen } from "@tauri-apps/api/event";
import "./styles/app.css";

console.log("[deskumi] Initializing Deskumi transparent window");

// Restore saved desktop position from store
void restoreWindowPosition();

// Disable default WebKit context menu (Inspect Element, Back, Reload, etc.)
window.addEventListener("contextmenu", (event) => {
  event.preventDefault();
});

let isDragging = false;
let savePositionTimeout: ReturnType<typeof setTimeout> | null = null;
let currentAvatarContext: LoadedAvatarContext | null = null;

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

const sceneManager = new SceneManager({
  container: appContainer,
  fpsCap: 30
});

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

// Load configured avatar or fallback to official sample avatar
async function initAvatar(): Promise<void> {
  const config = await defaultConfigManager.load();
  const avatarPath = config.avatarPath;

  if (avatarPath) {
    try {
      console.log(`[deskumi] Attempting to load saved avatar: ${avatarPath}`);
      const { vrm, blobUrl } = await loadAvatarModel(avatarPath);
      currentAvatarContext = setupAvatarInScene(vrm, sceneManager, blobUrl);
      console.log("[deskumi] Loaded saved avatar successfully");
      return;
    } catch (err) {
      console.warn(
        `[deskumi] Failed to load saved avatar at ${avatarPath}, falling back to sample:`,
        err
      );
    }
  }

  // Fallback to sample avatar
  console.log("[deskumi] Loading default sample VRM");
  const { vrm } = await loadAvatarModel(sampleAvatarUrl);
  currentAvatarContext = setupAvatarInScene(vrm, sceneManager);
  console.log("[deskumi] Default sample VRM loaded successfully");
}

initAvatar().catch((err: unknown) => {
  console.error("[deskumi] Failed to initialize avatar:", err);
});

sceneManager.start();
