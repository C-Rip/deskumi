export type OsType = "linux" | "windows" | "macos";

export type DisplayServer = "x11" | "xwayland" | "wayland" | "win32" | "quartz";

export interface PlatformCaps {
  os: OsType;
  displayServer: DisplayServer;
  globalCursor: boolean;
  inputRegion: boolean;
  alwaysOnTop: boolean;
  setPosition: boolean;
  localBridge: boolean;
  plugins: boolean;
}

export { getPlatformCaps } from "./ipc";
