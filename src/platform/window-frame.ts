import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import { calcCenteredAvatarY } from "../engine/AvatarLoader";
import type { SceneManager } from "../engine/SceneManager";
import type { LoadedAvatarContext } from "./avatar-picker";
import { setWindowDesktopSize } from "./ipc";

export interface FrameSize {
  width: number;
  height: number;
}

/**
 * Computes the effective window frame dimensions, shrinking height slightly
 * when the avatar is perched atop a target window titlebar.
 */
export function getEffectiveFrameSize(
  configuredSize: FrameSize,
  perched: boolean
): FrameSize {
  return {
    width: configuredSize.width,
    height: perched
      ? Math.max(220, Math.round(configuredSize.height * 0.84))
      : configuredSize.height
  };
}

/**
 * Updates the transparent desktop window dimensions via the native GTK resize
 * command (falling back to Tauri's standard window resize API) and syncs SceneManager.
 */
export async function applyWindowFrameSize(
  sceneManager: SceneManager,
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

/**
 * Applies uniform avatar scale and centered vertical offset to the loaded VRM scene
 * and updates the reaction system's resting Y baseline.
 */
export function applyAvatarTransform(
  context: LoadedAvatarContext,
  scale: number,
  offsetY: number
): void {
  context.vrm.scene.scale.setScalar(scale);
  context.vrm.scene.position.x = 0;
  const posY = calcCenteredAvatarY(context.framingCenterY, scale, offsetY);
  context.vrm.scene.position.y = posY;
  context.reactionSystem.setBasePositionY(posY);
}
