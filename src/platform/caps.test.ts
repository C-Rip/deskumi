import { describe, expect, it } from "vitest";
import { getPlatformCaps } from "./caps";

describe("Platform capabilities", () => {
  it("returns fallback capabilities outside Tauri environment", async () => {
    const caps = await getPlatformCaps();
    expect(caps).toBeDefined();
    expect(caps.os).toBe("linux");
    expect(caps.displayServer).toBe("x11");
    expect(typeof caps.alwaysOnTop).toBe("boolean");
    expect(typeof caps.globalCursor).toBe("boolean");
    expect(typeof caps.inputRegion).toBe("boolean");
    expect(typeof caps.setPosition).toBe("boolean");
  });
});
