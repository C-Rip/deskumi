import { describe, it, expect, vi, beforeEach } from "vitest";
import { SettingsPanel } from "./SettingsPanel";
import { ConfigManager, type AppConfig } from "../platform/store";

class MockElement {
  public tagName: string;
  public textContent: string = "";
  public title: string = "";
  public value: string = "";
  public disabled: boolean = false;
  public classList: {
    classes: Set<string>;
    add: (...c: string[]) => void;
    remove: (...c: string[]) => void;
    contains: (c: string) => boolean;
  };
  public attributes: Record<string, string> = {};
  public eventListeners: Record<string, ((e: unknown) => void)[]> = {};

  constructor(tagName: string) {
    this.tagName = tagName.toUpperCase();
    const classes = new Set<string>();
    this.classList = {
      classes,
      add: (...c: string[]) => c.forEach((cls) => classes.add(cls)),
      remove: (...c: string[]) => c.forEach((cls) => classes.delete(cls)),
      contains: (c: string) => classes.has(c)
    };
  }

  getAttribute(attr: string): string | null {
    return this.attributes[attr] ?? null;
  }

  setAttribute(attr: string, val: string): void {
    this.attributes[attr] = val;
  }

  addEventListener(event: string, handler: (e: unknown) => void): void {
    if (!this.eventListeners[event]) {
      this.eventListeners[event] = [];
    }
    this.eventListeners[event].push(handler);
  }

  trigger(event: string, eventData: unknown = {}): void {
    const handlers = this.eventListeners[event] || [];
    handlers.forEach((h) => h(eventData));
  }
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

    // Create known elements queried by SettingsPanel
    const avatarPath = new MockElement("div");
    this.elementsById.set("avatar-path-text", avatarPath);

    const pickBtn = new MockElement("button");
    this.elementsById.set("btn-pick-avatar", pickBtn);

    const clearBtn = new MockElement("button");
    this.elementsById.set("btn-clear-avatar", clearBtn);

    const slider = new MockElement("input");
    this.elementsById.set("slider-avatar-scale", slider);

    const scaleVal = new MockElement("span");
    this.elementsById.set("avatar-scale-value", scaleVal);

    const resetBtn = new MockElement("button");
    this.elementsById.set("btn-reset-position", resetBtn);

    const toast = new MockElement("div");
    this.elementsById.set("settings-status-toast", toast);

    // Create 3 fps buttons
    for (const fps of ["15", "30", "60"]) {
      const btn = new MockElement("button");
      btn.setAttribute("data-fps", fps);
      btn.classList.add("fps-btn");
      this.fpsButtons.push(btn);
    }
  }

  querySelector<T = unknown>(selector: string): T | null {
    if (selector.startsWith("#")) {
      const id = selector.slice(1);
      return (this.elementsById.get(id) as unknown as T) ?? null;
    }
    return null;
  }

  querySelectorAll<T = unknown>(selector: string): T[] {
    if (selector === ".fps-btn") {
      return this.fpsButtons as unknown as T[];
    }
    return [];
  }
}

describe("SettingsPanel", () => {
  let container: MockContainer;
  let configManager: ConfigManager;
  let emittedEvents: Array<{ event: string; payload: AppConfig }>;
  let mockPickFile: () => Promise<string | null>;

  beforeEach(() => {
    container = new MockContainer();
    configManager = new ConfigManager();
    emittedEvents = [];
    mockPickFile = vi.fn().mockResolvedValue("/path/to/custom_avatar.vrm");
  });

  function createPanel() {
    return new SettingsPanel({
      container: container as unknown as HTMLElement,
      configManager,
      onEmit: (event, payload) => {
        emittedEvents.push({ event, payload });
      },
      pickFile: mockPickFile
    });
  }

  it("initializes with default config and renders default state", async () => {
    const panel = createPanel();
    await panel.init();

    const config = panel.getConfig();
    expect(config.fpsCap).toBe(30);
    expect(config.avatarScale).toBe(1.0);
    expect(config.avatarPath).toBeNull();

    const avatarPathEl =
      container.querySelector<MockElement>("#avatar-path-text");
    expect(avatarPathEl?.textContent).toContain(
      "Avatar de muestra por defecto"
    );

    const clearBtn = container.querySelector<MockElement>("#btn-clear-avatar");
    expect(clearBtn?.disabled).toBe(true);

    const scaleVal = container.querySelector<MockElement>(
      "#avatar-scale-value"
    );
    expect(scaleVal?.textContent).toBe("1.00x");
  });

  it("handles picking a new avatar and emits settings-updated", async () => {
    const panel = createPanel();
    await panel.init();

    await panel.handlePickAvatar();

    const config = panel.getConfig();
    expect(config.avatarPath).toBe("/path/to/custom_avatar.vrm");

    const avatarPathEl =
      container.querySelector<MockElement>("#avatar-path-text");
    expect(avatarPathEl?.textContent).toBe("/path/to/custom_avatar.vrm");

    const clearBtn = container.querySelector<MockElement>("#btn-clear-avatar");
    expect(clearBtn?.disabled).toBe(false);

    expect(emittedEvents).toHaveLength(1);
    expect(emittedEvents[0].event).toBe("settings-updated");
    expect(emittedEvents[0].payload.avatarPath).toBe(
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
    const avatarPathEl =
      container.querySelector<MockElement>("#avatar-path-text");
    expect(avatarPathEl?.textContent).toContain(
      "Avatar de muestra por defecto"
    );

    const clearBtn = container.querySelector<MockElement>("#btn-clear-avatar");
    expect(clearBtn?.disabled).toBe(true);

    expect(emittedEvents).toHaveLength(1);
    expect(emittedEvents[0].payload.avatarPath).toBeNull();
  });

  it("clamps avatar scale to range [0.5, 2.0] and updates UI", async () => {
    const panel = createPanel();
    await panel.init();

    // Valid scale
    await panel.handleScaleChange(1.4);
    expect(panel.getConfig().avatarScale).toBe(1.4);
    expect(emittedEvents[0].payload.avatarScale).toBe(1.4);

    // Below minimum
    await panel.handleScaleChange(0.2);
    expect(panel.getConfig().avatarScale).toBe(0.5);

    // Above maximum
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
    expect(emittedEvents[0].payload.fpsCap).toBe(60);
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
    expect(emittedEvents[0].payload.windowX).toBeNull();
    expect(emittedEvents[0].payload.windowY).toBeNull();
  });
});
