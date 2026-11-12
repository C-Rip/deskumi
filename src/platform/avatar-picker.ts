import { isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";
import type { VRM } from "@pixiv/three-vrm";
import {
  centerAndGroundVRM,
  calculatePerspectiveFraming,
  loadVRM
} from "../engine/AvatarLoader";
import { AnimationSystem } from "../engine/AnimationSystem";
import { LookAtSystem } from "../engine/LookAtSystem";
import { ReactionSystem } from "../engine/ReactionSystem";
import { AvatarInputRegionSystem } from "./input-region";
import { defaultConfigManager } from "./store";
import { pickVRMAFile } from "../engine/VRMAPlayer";
import type { SceneManager } from "../engine/SceneManager";

export interface LoadedAvatarContext {
  vrm: VRM;
  lookAtSystem: LookAtSystem;
  animationSystem: AnimationSystem;
  reactionSystem: ReactionSystem;
  inputRegionSystem: AvatarInputRegionSystem;
  blobUrl?: string;
}

/**
 * Loads a VRM from a local binary file path or URL, converting local files
 * to an in-memory Blob URL for three-vrm GLTFLoader compatibility.
 */
export async function loadAvatarModel(
  pathOrUrl: string
): Promise<{ vrm: VRM; blobUrl?: string }> {
  if (
    isTauri() &&
    !pathOrUrl.startsWith("http") &&
    !pathOrUrl.startsWith("blob:") &&
    !pathOrUrl.startsWith("data:")
  ) {
    // Read local file through Tauri FS plugin and convert to ObjectURL
    const bytes = await readFile(pathOrUrl);
    const blob = new Blob([bytes], { type: "application/octet-stream" });
    const blobUrl = URL.createObjectURL(blob);
    const vrm = await loadVRM(blobUrl);
    return { vrm, blobUrl };
  }

  const vrm = await loadVRM(pathOrUrl);
  return { vrm };
}

/**
 * Attaches all engine systems and camera framing to the loaded VRM avatar.
 */
export function setupAvatarInScene(
  vrm: VRM,
  sceneManager: SceneManager,
  blobUrl?: string
): LoadedAvatarContext {
  sceneManager.scene.add(vrm.scene);

  // Center horizontally and ground feet at y=0
  const bounds = centerAndGroundVRM(vrm);

  // Framed snug perspective camera
  const framing = calculatePerspectiveFraming(
    bounds,
    sceneManager.camera.fov,
    1.15
  );
  sceneManager.camera.position.copy(framing.cameraPosition);
  sceneManager.camera.lookAt(framing.target);

  // Register look-at system
  const lookAtSystem = new LookAtSystem(vrm, {
    camera: sceneManager.camera,
    scene: sceneManager.scene
  });
  sceneManager.registerSystem(lookAtSystem);

  // Register procedural animation system
  const animationSystem = new AnimationSystem(vrm);
  sceneManager.registerSystem(animationSystem);

  // Register pixel-perfect silhouette hit testing
  const inputRegionSystem = new AvatarInputRegionSystem(
    vrm,
    sceneManager.camera,
    {
      renderer: sceneManager.renderer,
      scene: sceneManager.scene,
      downscale: 4,
      padding: 2
    }
  );
  sceneManager.registerSystem(inputRegionSystem);

  // Register reaction system
  const reactionSystem = new ReactionSystem(vrm, {
    duration: 1.5,
    bounceAmplitude: 0.04
  });
  sceneManager.registerSystem(reactionSystem);

  return {
    vrm,
    lookAtSystem,
    animationSystem,
    reactionSystem,
    inputRegionSystem,
    blobUrl
  };
}

/**
 * Disposes an existing avatar and its registered engine systems.
 */
export function teardownAvatarContext(
  context: LoadedAvatarContext,
  sceneManager: SceneManager
): void {
  sceneManager.unregisterSystem(context.lookAtSystem);
  sceneManager.unregisterSystem(context.animationSystem);
  sceneManager.unregisterSystem(context.inputRegionSystem);
  sceneManager.unregisterSystem(context.reactionSystem);

  context.lookAtSystem.dispose();
  context.animationSystem.dispose();
  context.inputRegionSystem.dispose();
  context.reactionSystem.dispose();

  sceneManager.scene.remove(context.vrm.scene);

  if (context.blobUrl) {
    URL.revokeObjectURL(context.blobUrl);
  }
}

/**
 * Opens native file dialog for selecting a .vrm file.
 */
export async function pickVRMFile(): Promise<string | null> {
  if (!isTauri()) {
    console.warn("[deskumi] pickVRMFile is only available in Tauri runtime");
    return null;
  }

  const selected = await open({
    multiple: false,
    directory: false,
    filters: [
      {
        name: "VRM Avatar",
        extensions: ["vrm"]
      }
    ]
  });

  if (typeof selected === "string") {
    return selected;
  }
  return null;
}

/**
 * Prompt user to select a VRM file, switch the avatar in scene, and save setting.
 */
export async function pickAndSwitchAvatar(
  sceneManager: SceneManager,
  getCurrentContext: () => LoadedAvatarContext | null,
  setCurrentContext: (ctx: LoadedAvatarContext) => void
): Promise<boolean> {
  const selectedPath = await pickVRMFile();
  if (!selectedPath) {
    return false;
  }

  try {
    const { vrm, blobUrl } = await loadAvatarModel(selectedPath);
    const prevContext = getCurrentContext();
    if (prevContext) {
      teardownAvatarContext(prevContext, sceneManager);
    }

    const newContext = setupAvatarInScene(vrm, sceneManager, blobUrl);
    setCurrentContext(newContext);

    // Save to configuration store
    await defaultConfigManager.set("avatarPath", selectedPath);
    console.log(`[deskumi] Switched avatar to: ${selectedPath}`);

    // Replay saved VRMA animation on new avatar if configured
    const savedVrma = defaultConfigManager.get().vrmaPath;
    if (savedVrma) {
      try {
        await newContext.animationSystem.vrmaPlayer.loadAndPlay(savedVrma, {
          loop: true,
          fadeInDuration: 0.25
        });
      } catch (err) {
        console.warn(
          `[deskumi] Failed to replay VRMA ${savedVrma} on new avatar:`,
          err
        );
      }
    }

    return true;
  } catch (err: unknown) {
    console.error("[deskumi] Failed to load chosen VRM model:", err);
    return false;
  }
}

/**
 * Clears the current avatar, empties the scene, and resets the input region to passthrough.
 */
export async function clearAvatar(
  sceneManager: SceneManager,
  getCurrentContext: () => LoadedAvatarContext | null,
  setCurrentContext: (ctx: LoadedAvatarContext | null) => void
): Promise<void> {
  const prevContext = getCurrentContext();
  if (prevContext) {
    teardownAvatarContext(prevContext, sceneManager);
    setCurrentContext(null);
  }

  // Remove saved avatarPath from store
  await defaultConfigManager.delete("avatarPath");
  console.log("[deskumi] Avatar cleared from scene and store");
}

/**
 * Prompt user to select a .vrma file, play it on current avatar, and save to store.
 */
export async function pickAndPlayVRMA(
  context: LoadedAvatarContext
): Promise<boolean> {
  const selectedPath = await pickVRMAFile();
  if (!selectedPath) {
    return false;
  }

  try {
    console.log(`[deskumi] Loading chosen VRMA animation: ${selectedPath}`);
    await context.animationSystem.vrmaPlayer.loadAndPlay(selectedPath, {
      loop: true,
      fadeInDuration: 0.25
    });
    await defaultConfigManager.set("vrmaPath", selectedPath);
    console.log(`[deskumi] VRMA animation playing and saved: ${selectedPath}`);
    return true;
  } catch (err: unknown) {
    console.error("[deskumi] Failed to load chosen VRMA animation:", err);
    return false;
  }
}

/**
 * Stops any currently playing VRMA animation and clears vrmaPath from store.
 */
export async function stopVRMA(context: LoadedAvatarContext): Promise<void> {
  context.animationSystem.vrmaPlayer.stop(0.25);
  await defaultConfigManager.delete("vrmaPath");
  console.log("[deskumi] Stopped VRMA animation and cleared from store");
}

export { pickVRMAFile };
