import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PlatformCaps } from "../platform/caps";
import {
  SettingsPanel,
  type SettingsEmitPayload,
  type SettingsPanelOptions
} from "./SettingsPanel";
import { ConfigManager, type AppConfig } from "../platform/store";

class MockElement {
  public textContent = "";
  public innerHTML = "";
  public disabled = false;
  public attributes: Record<string, string> = {};
  private classes = new Set<string>();
  public classList = {
    add: (...c: string[]) => c.forEach((cls) => this.classes.add(cls)),
    remove: (...c: string[]) => c.forEach((cls) => this.classes.delete(cls)),
    contains: (c: string) => this.classes.has(c),
    toggle: (c: string, force?: boolean) => {
      const next = force ?? !this.classes.has(c);
      if (next) this.classes.add(c);
      else this.classes.delete(c);
      return next;
    }
  };
  getAttribute(attr: string): string | null {
    return this.attributes[attr] ?? null;
  }
  setAttribute(attr: string, val: string): void {
    this.attributes[attr] = val;
  }
  addEventListener = (): void => {};
  querySelector = (): null => null;
  querySelectorAll = (): never[] => [];
}

class MockContainer {
  private _html = "";
  public elementsById = new Map<string, MockElement>();
  public fpsButtons: MockElement[] = [];

  get innerHTML(): string {
    return this._html;
  }
  set innerHTML(html: string) {
    this._html = html;
    this.elementsById.clear();
    this.fpsButtons = [];
    for (const id of [
      "avatar-path-text",
      "btn-pick-avatar",
      "btn-clear-avatar",
      "slider-avatar-scale",
      "avatar-scale-value",
      "btn-reset-position",
      "settings-status-toast",
      "bridge-settings-section",
      "plugins-settings-section"
    ]) {
      this.elementsById.set(id, new MockElement());
    }
    for (const fps of ["15", "30", "60"]) {
      const btn = new MockElement();
      btn.setAttribute("data-fps", fps);
      btn.classList.add("fps-btn");
      this.fpsButtons.push(btn);
    }
  }
  querySelector<T = unknown>(selector: string): T | null {
    return selector.startsWith("#")
      ? ((this.elementsById.get(selector.slice(1)) as unknown as T) ?? null)
      : null;
  }
  querySelectorAll<T = unknown>(selector: string): T[] {
    return selector === ".fps-btn" ? (this.fpsButtons as unknown as T[]) : [];
  }
}

const LINUX_CAPS: PlatformCaps = {
  os: "linux",
  displayServer: "xwayland",
  globalCursor: true,
  inputRegion: true,
  alwaysOnTop: true,
  setPosition: true,
  localBridge: true,
  plugins: true
};

const STOPPED_BRIDGE = {
  running: false,
  port: null,
  bridgeFilePath: null,
  token: null,
  connectedClients: 0,
  maxClients: 4
};

describe("SettingsPanel", () => {
  let container: MockContainer;
  let configManager: ConfigManager;
  let emittedEvents: Array<{ event: string; payload: SettingsEmitPayload }>;
  let mockPickFile: () => Promise<string | null>;

  beforeEach(() => {
    container = new MockContainer();
    configManager = new ConfigManager();
    emittedEvents = [];
    mockPickFile = vi.fn().mockResolvedValue("/path/to/custom_avatar.vrm");
  });

  function createPanel(extra: Partial<SettingsPanelOptions> = {}) {
    return new SettingsPanel({
      container: container as unknown as HTMLElement,
      configManager,
      onEmit: (event, payload) => {
        emittedEvents.push({ event, payload });
      },
      pickFile: mockPickFile,
      ...extra
    });
  }

  it("initializes with default config and renders default state", async () => {
    const panel = createPanel();
    await panel.init();

    const config = panel.getConfig();
    expect(config.fpsCap).toBe(30);
    expect(config.avatarScale).toBe(1.0);
    expect(config.avatarPath).toBeNull();
    expect(
      container.querySelector<MockElement>("#avatar-path-text")?.textContent
    ).toContain("Avatar de muestra por defecto");
    expect(
      container.querySelector<MockElement>("#btn-clear-avatar")?.disabled
    ).toBe(true);
    expect(
      container.querySelector<MockElement>("#avatar-scale-value")?.textContent
    ).toBe("1.00x");
  });

  it("handles picking a new avatar and emits settings-updated", async () => {
    const panel = createPanel();
    await panel.init();
    await panel.handlePickAvatar();

    expect(panel.getConfig().avatarPath).toBe("/path/to/custom_avatar.vrm");
    expect(
      container.querySelector<MockElement>("#avatar-path-text")?.textContent
    ).toBe("/path/to/custom_avatar.vrm");
    expect(
      container.querySelector<MockElement>("#btn-clear-avatar")?.disabled
    ).toBe(false);
    expect(emittedEvents).toHaveLength(1);
    expect(emittedEvents[0].event).toBe("settings-updated");
    expect((emittedEvents[0].payload as AppConfig).avatarPath).toBe(
      "/path/to/custom_avatar.vrm"
    );
  });

  it("handles clearing an avatar and emits settings-updated", async () => {
    await configManager.set("avatarPath", "/existing/path.vrm");
    const panel = createPanel();
    await panel.init();
    expect(panel.getConfig().avatarPath).toBe("/existing/path.vrm");

    await panel.handleClearAvatar();

    expect(panel.getConfig().avatarPath).toBeNull();
    expect(
      container.querySelector<MockElement>("#avatar-path-text")?.textContent
    ).toContain("Avatar de muestra por defecto");
    expect(
      container.querySelector<MockElement>("#btn-clear-avatar")?.disabled
    ).toBe(true);
    expect(emittedEvents).toHaveLength(1);
    expect((emittedEvents[0].payload as AppConfig).avatarPath).toBeNull();
  });

  it("clamps avatar scale to range [0.5, 2.0] and updates UI", async () => {
    const panel = createPanel();
    await panel.init();

    await panel.handleScaleChange(1.4);
    expect(panel.getConfig().avatarScale).toBe(1.4);
    expect((emittedEvents[0].payload as AppConfig).avatarScale).toBe(1.4);

    await panel.handleScaleChange(0.2);
    expect(panel.getConfig().avatarScale).toBe(0.5);

    await panel.handleScaleChange(3.5);
    expect(panel.getConfig().avatarScale).toBe(2.0);
  });

  it("updates FPS cap setting and emits update", async () => {
    const panel = createPanel();
    await panel.init();
    await panel.handleFpsCapChange(60);

    expect(panel.getConfig().fpsCap).toBe(60);
    const btn60 = container.fpsButtons.find(
      (b) => b.getAttribute("data-fps") === "60"
    );
    const btn30 = container.fpsButtons.find(
      (b) => b.getAttribute("data-fps") === "30"
    );
    expect(btn60?.classList.contains("selected")).toBe(true);
    expect(btn30?.classList.contains("selected")).toBe(false);
    expect(emittedEvents).toHaveLength(1);
    expect((emittedEvents[0].payload as AppConfig).fpsCap).toBe(60);
  });

  it("resets window position to center and emits update", async () => {
    await configManager.set("windowX", 400);
    await configManager.set("windowY", 500);
    const panel = createPanel();
    await panel.init();
    expect(panel.getConfig().windowX).toBe(400);

    await panel.handleResetPosition();
    expect(panel.getConfig().windowX).toBeNull();
    expect(panel.getConfig().windowY).toBeNull();
    expect(emittedEvents).toHaveLength(1);
    expect((emittedEvents[0].payload as AppConfig).windowX).toBeNull();
    expect((emittedEvents[0].payload as AppConfig).windowY).toBeNull();
  });

  it("renders unavailable notices when localBridge and plugins caps are false", async () => {
    const panel = createPanel();
    await panel.init();
    expect(
      container.querySelector<MockElement>("#bridge-settings-section")
        ?.innerHTML
    ).toContain("bridge-unavailable-notice");
    expect(
      container.querySelector<MockElement>("#plugins-settings-section")
        ?.innerHTML
    ).toContain("plugins-unavailable-notice");
    panel.dispose();
  });

  it("integrates bridge and plugins sections on Linux caps and resets F6 defaults", async () => {
    const stopLocalBridge = vi.fn(async () => STOPPED_BRIDGE);
    const unregisterAnimation = vi.fn(async () => true);
    const panel = createPanel({
      getCaps: async () => LINUX_CAPS,
      bridgeDeps: {
        getBridgeStatus: async () => ({
          ...STOPPED_BRIDGE,
          running: true,
          port: 49100,
          token: "tok123456"
        }),
        stopLocalBridge
      },
      pluginsDeps: {
        listPlugins: async () => [
          {
            id: "echo",
            name: "Echo",
            version: "1.0.0",
            entry: "index.html",
            entryUrl: "plugin://echo/index.html",
            permissions: ["avatar:speak"],
            animations: []
          }
        ],
        listRegisteredAnimations: async () => [],
        registerAnimation: async (id, _p, label) => ({
          id,
          label,
          source: "user"
        }),
        unregisterAnimation
      }
    });

    await panel.init();
    const pluginsSec = panel.getPluginsSection()!;
    await pluginsSec.setPluginPermission("echo", "avatar:speak", true);
    await pluginsSec.togglePlugin("echo", true);
    await pluginsSec.registerUserAnimation("wave", "/tmp/wave.vrma");
    expect(panel.getConfig().enabledPlugins).toEqual(["echo"]);
    expect(panel.getConfig().pluginPermissions).toEqual({
      echo: ["avatar:speak"]
    });
    expect(panel.getConfig().registeredAnimations).toHaveLength(1);

    await panel.handleResetDefaults();
    expect(stopLocalBridge).toHaveBeenCalled();
    expect(unregisterAnimation).toHaveBeenCalledWith("wave");
    expect(panel.getConfig().enabledPlugins).toEqual([]);
    expect(panel.getConfig().registeredAnimations).toEqual([]);
    panel.dispose();
  });
});
