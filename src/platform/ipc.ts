import { invoke, isTauri } from "@tauri-apps/api/core";
import type { PlatformCaps } from "./caps";

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
