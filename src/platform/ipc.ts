import { invoke, isTauri } from "@tauri-apps/api/core";
import type { PlatformCaps } from "./caps";
import type { Rect } from "./input-region";

export async function getPlatformCaps(): Promise<PlatformCaps> {
  if (!isTauri()) {
    return {
      os: "linux",
      displayServer: "x11",
      globalCursor: false,
      inputRegion: false,
      alwaysOnTop: false,
      setPosition: false
    };
  }
  return await invoke<PlatformCaps>("get_platform_caps");
}

export async function setInputRegion(rects: Rect[] | null): Promise<void> {
  if (!isTauri()) {
    return;
  }
  await invoke("set_input_region", { rects });
}
