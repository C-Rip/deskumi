import { describe, expect, it, vi } from "vitest";
import type { AvatarEvent } from "../engine/AvatarCommand";
import {
  computeFocusMetadataMode,
  getWindowFocusMetadata,
  listenWindowFocusMetadata,
  setFocusMetadataMode,
  WindowFocusBridge,
  type FocusMetadataMode,
  type WindowFocusMetadata
} from "./window-focus-bridge";

function createHarness(initialScopes: string[] = []) {
  const emitted: AvatarEvent[] = [];
  const modes: FocusMetadataMode[] = [];
  let listener: ((meta: WindowFocusMetadata) => void) | null = null;
  const unlisten = vi.fn();

  const setMode = vi.fn(async (mode: FocusMetadataMode) => {
    modes.push(mode);
  });
  const getMetadata = vi.fn<() => Promise<WindowFocusMetadata | null>>(
    async () => null
  );
  const listenFocus = vi.fn(
    async (handler: (meta: WindowFocusMetadata) => void) => {
      listener = handler;
      return unlisten;
    }
  );

  const bridge = new WindowFocusBridge({
    avatarController: {
      emitEvent: (event) => {
        emitted.push(event);
      }
    },
    grantedScopes: initialScopes,
    setMode,
    getMetadata,
    listenFocus
  });

  return {
    bridge,
    emitted,
    modes,
    setMode,
    getMetadata,
    listenFocus,
    unlisten,
    pushFocus: (meta: WindowFocusMetadata) => listener?.(meta)
  };
}

describe("computeFocusMetadataMode", () => {
  it("computes 0/1/2 strictly from desktop:events and desktop:windowTitle", () => {
    expect(computeFocusMetadataMode([])).toBe(0);
    expect(computeFocusMetadataMode(["avatar:speak", "avatar:events"])).toBe(0);
    expect(computeFocusMetadataMode(["desktop:windowTitle"])).toBe(0);
    expect(computeFocusMetadataMode(["desktop:events"])).toBe(1);
    expect(
      computeFocusMetadataMode(["desktop:events", "desktop:windowTitle"])
    ).toBe(2);
  });
});

describe("WindowFocusBridge", () => {
  it("stays silent in mode 0 and does not forward focus events", async () => {
    const h = createHarness(["avatar:events"]);

    await h.bridge.start();
    expect(h.bridge.isStarted).toBe(true);
    expect(h.bridge.mode).toBe(0);
    expect(h.modes).toEqual([0]);
    expect(h.getMetadata).not.toHaveBeenCalled();

    h.pushFocus({ appId: "org.mozilla.firefox", title: "Private" });
    expect(h.emitted).toHaveLength(0);

    h.bridge.dispose();
    expect(h.unlisten).toHaveBeenCalledTimes(1);
    expect(h.modes).toEqual([0]);
  });

  it("syncs mode 1 and 2 transitions, redacts title in mode 1, and deduplicates", async () => {
    const h = createHarness(["desktop:events"]);
    h.getMetadata.mockResolvedValueOnce({
      appId: "org.gnome.Terminal",
      title: "Secret Shell"
    });

    await h.bridge.start();
    expect(h.modes).toEqual([1]);
    expect(h.emitted).toEqual([
      { type: "windowFocus", appId: "org.gnome.Terminal" }
    ]);

    // Same appId with title in mode 1 -> title ignored and duplicate suppressed
    h.pushFocus({ appId: "org.gnome.Terminal", title: "Changed Title" });
    expect(h.emitted).toHaveLength(1);

    // Different appId -> emitted without title
    h.pushFocus({ appId: "org.mozilla.firefox", title: "Private Tab" });
    expect(h.emitted).toEqual([
      { type: "windowFocus", appId: "org.gnome.Terminal" },
      { type: "windowFocus", appId: "org.mozilla.firefox" }
    ]);

    // Upgrade to mode 2 -> includes title
    h.getMetadata.mockResolvedValueOnce({
      appId: "org.mozilla.firefox",
      title: "Docs"
    });
    await h.bridge.setGrantedScopes(["desktop:events", "desktop:windowTitle"]);
    expect(h.bridge.mode).toBe(2);
    expect(h.modes).toEqual([1, 2]);
    expect(h.emitted.at(-1)).toEqual({
      type: "windowFocus",
      appId: "org.mozilla.firefox",
      title: "Docs"
    });

    // Empty / whitespace-less payloads are ignored
    h.pushFocus({});
    h.pushFocus({ appId: "", title: "" });
    expect(h.emitted).toHaveLength(3);

    // Downgrade to mode 0 -> clears cache & stops forwarding
    await h.bridge.setGrantedScopes([]);
    expect(h.modes).toEqual([1, 2, 0]);
    h.pushFocus({ appId: "code", title: "Repo" });
    expect(h.emitted).toHaveLength(3);

    // Re-enable mode 1 -> same appId is emitted again cleanly
    await h.bridge.setGrantedScopes(["desktop:events"]);
    h.pushFocus({ appId: "org.mozilla.firefox", title: "Docs" });
    expect(h.emitted.at(-1)).toEqual({
      type: "windowFocus",
      appId: "org.mozilla.firefox"
    });

    // Dispose resets mode back to 0 when active
    h.bridge.dispose();
    expect(h.bridge.isDisposed).toBe(true);
    expect(h.modes.at(-1)).toBe(0);
    expect(h.unlisten).toHaveBeenCalledTimes(1);
  });

  it("provides safe no-op IPC fallbacks outside Tauri runtime", async () => {
    await expect(setFocusMetadataMode(1)).resolves.toBeUndefined();
    await expect(getWindowFocusMetadata()).resolves.toBeNull();
    const unlisten = await listenWindowFocusMetadata(() => {});
    expect(typeof unlisten).toBe("function");
    unlisten();
  });
});
