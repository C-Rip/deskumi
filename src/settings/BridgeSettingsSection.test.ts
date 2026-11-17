import { afterEach, describe, expect, it, vi } from "vitest";
import type { PlatformCaps } from "../platform/caps";
import type { BridgeStatus } from "../platform/ipc";
import { cloneAppConfig, DEFAULT_CONFIG } from "../platform/store";
import { BridgeSettingsSection } from "./BridgeSettingsSection";

class HtmlTestEl {
  public classList: {
    has: (c: string) => boolean;
    toggle: (c: string, force?: boolean) => boolean;
    contains: (c: string) => boolean;
  };
  public tag: string;
  public textContent = "";
  public disabled = false;
  public checked = false;
  public value = "";
  public attrs: Record<string, string> = {};
  private classes = new Set<string>();
  private listeners: Record<string, Array<(e: unknown) => void>> = {};

  constructor(tag: string, attrsStr: string, text: string) {
    this.tag = tag;
    this.textContent = text;
    this.disabled = /\bdisabled\b/.test(attrsStr);
    this.checked = /\bchecked\b/.test(attrsStr);
    for (const m of attrsStr.matchAll(/([a-zA-Z0-9_-]+)="([^"]*)"/g)) {
      this.attrs[m[1]] = m[2];
    }
    this.value = this.attrs.value ?? "";
    for (const cls of (this.attrs.class ?? "").split(/\s+/).filter(Boolean)) {
      this.classes.add(cls);
    }
    this.classList = {
      has: (c) => this.classes.has(c),
      contains: (c) => this.classes.has(c),
      toggle: (c, force) => {
        const next = force ?? !this.classes.has(c);
        if (next) this.classes.add(c);
        else this.classes.delete(c);
        return next;
      }
    };
  }
  getAttribute(k: string): string | null {
    return this.attrs[k] ?? null;
  }
  addEventListener(ev: string, fn: (e: unknown) => void): void {
    (this.listeners[ev] ??= []).push(fn);
  }
  trigger(ev: string): void {
    for (const fn of this.listeners[ev] ?? []) fn({ target: this });
  }
}

class HtmlTestContainer {
  private _html = "";
  private nodes: HtmlTestEl[] = [];
  get innerHTML(): string {
    return this._html;
  }
  set innerHTML(html: string) {
    this._html = html;
    this.nodes = [];
    const stack: Array<{ el: HtmlTestEl; start: number }> = [];
    const voidTags = new Set(["input", "br", "hr", "img"]);
    for (const m of html.matchAll(/<(\/?)([a-z0-9]+)([^>]*?)(\/?)>/gi)) {
      const isClose = m[1] === "/";
      const tag = m[2].toLowerCase();
      const idx = m.index ?? 0;
      if (isClose) {
        for (let i = stack.length - 1; i >= 0; i--) {
          if (stack[i].el.tag === tag) {
            const popped = stack.splice(i, 1)[0];
            popped.el.textContent = html
              .slice(popped.start, idx)
              .replace(/<[^>]+>/g, " ")
              .replace(/\s+/g, " ")
              .trim();
            break;
          }
        }
      } else {
        const el = new HtmlTestEl(tag, m[3], "");
        this.nodes.push(el);
        if (m[4] !== "/" && !voidTags.has(tag)) {
          stack.push({ el, start: idx + m[0].length });
        }
      }
    }
  }
  querySelector<T>(sel: string): T | null {
    return (this.querySelectorAll<T>(sel)[0] ?? null) as T | null;
  }
  querySelectorAll<T>(sel: string): T[] {
    if (sel.startsWith("#")) {
      const id = sel.slice(1);
      return this.nodes.filter((n) => n.attrs.id === id) as unknown as T[];
    }
    if (sel.startsWith(".")) {
      const cls = sel.slice(1);
      return this.nodes.filter((n) =>
        n.classList.contains(cls)
      ) as unknown as T[];
    }
    return [];
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

const WINDOWS_CAPS: PlatformCaps = {
  ...LINUX_CAPS,
  os: "windows",
  displayServer: "win32",
  localBridge: false,
  plugins: false
};

describe("BridgeSettingsSection", () => {
  const sections: BridgeSettingsSection[] = [];
  afterEach(() => {
    for (const s of sections.splice(0)) s.dispose();
  });

  it("hides controls with informative notice when localBridge cap is false", async () => {
    const container = new HtmlTestContainer();
    const getBridgeStatus = vi.fn();
    let config = cloneAppConfig(DEFAULT_CONFIG);
    const section = new BridgeSettingsSection({
      container: container as unknown as HTMLElement,
      caps: WINDOWS_CAPS,
      getConfig: () => config,
      updateConfig: async (patch) => {
        config = { ...config, ...patch };
      },
      showToast: vi.fn(),
      deps: { getBridgeStatus }
    });
    sections.push(section);

    await section.mount();

    expect(getBridgeStatus).not.toHaveBeenCalled();
    expect(
      container.querySelector("#bridge-unavailable-notice")
    ).not.toBeNull();
    expect(container.querySelector("#btn-toggle-bridge")).toBeNull();
  });

  it("toggles bridge, renders live status, copies token/path, and regenerates token", async () => {
    const container = new HtmlTestContainer();
    let config = cloneAppConfig(DEFAULT_CONFIG);
    const toasts: string[] = [];
    const stoppedStatus: BridgeStatus = {
      running: false,
      port: null,
      bridgeFilePath: null,
      token: null,
      connectedClients: 0,
      maxClients: 4
    };
    const runningStatus: BridgeStatus = {
      running: true,
      port: 45123,
      bridgeFilePath: "/run/user/1000/deskumi/bridge.json",
      token: "abcdef1234567890",
      connectedClients: 1,
      maxClients: 4
    };
    const copyText = vi.fn(async () => {});
    const regenerateBridgeToken = vi.fn(async () => ({
      ...runningStatus,
      token: "newtoken999999"
    }));

    const section = new BridgeSettingsSection({
      container: container as unknown as HTMLElement,
      caps: LINUX_CAPS,
      getConfig: () => config,
      updateConfig: async (patch) => {
        config = { ...config, ...patch };
      },
      showToast: (m) => toasts.push(m),
      deps: {
        getBridgeStatus: async () => stoppedStatus,
        startLocalBridge: async () => runningStatus,
        stopLocalBridge: async () => stoppedStatus,
        regenerateBridgeToken,
        copyText
      }
    });
    sections.push(section);

    await section.mount();

    expect(
      container.querySelector<HtmlTestEl>("#bridge-status-badge")?.textContent
    ).toBe("Inactivo");
    expect(
      container.querySelector<HtmlTestEl>("#btn-bridge-copy-token")?.disabled
    ).toBe(true);
    expect(
      container.querySelector<HtmlTestEl>("#btn-bridge-regenerate-token")
        ?.disabled
    ).toBe(true);
    expect(container.innerHTML).toContain("bridge.json");
    expect(container.innerHTML).toContain("desktop:windowTitle");

    const titleScopeCb = container
      .querySelectorAll<HtmlTestEl>(".bridge-scope-checkbox")
      .find((cb) => cb.getAttribute("data-scope") === "desktop:windowTitle");
    expect(titleScopeCb?.checked).toBe(false);

    container.querySelector<HtmlTestEl>("#btn-toggle-bridge")?.trigger("click");
    await vi.waitFor(() => expect(config.bridgeEnabled).toBe(true));
    await vi.waitFor(() =>
      expect(
        container.querySelector<HtmlTestEl>("#bridge-endpoint-text")
          ?.textContent
      ).toBe("127.0.0.1:45123")
    );

    expect(
      container.querySelector<HtmlTestEl>("#bridge-clients-text")?.textContent
    ).toBe("1 / 4 clientes");
    expect(
      container.querySelector<HtmlTestEl>("#btn-bridge-copy-token")?.disabled
    ).toBe(false);
    expect(
      container.querySelector<HtmlTestEl>("#btn-bridge-copy-path")?.disabled
    ).toBe(false);
    expect(
      container.querySelector<HtmlTestEl>("#btn-bridge-regenerate-token")
        ?.disabled
    ).toBe(false);

    container
      .querySelector<HtmlTestEl>("#btn-bridge-copy-token")
      ?.trigger("click");
    await vi.waitFor(() =>
      expect(copyText).toHaveBeenCalledWith("abcdef1234567890")
    );

    container
      .querySelector<HtmlTestEl>("#btn-bridge-copy-path")
      ?.trigger("click");
    await vi.waitFor(() =>
      expect(copyText).toHaveBeenCalledWith(
        "/run/user/1000/deskumi/bridge.json"
      )
    );

    container
      .querySelector<HtmlTestEl>("#btn-bridge-regenerate-token")
      ?.trigger("click");
    await vi.waitFor(() =>
      expect(regenerateBridgeToken).toHaveBeenCalledTimes(1)
    );
    expect(
      container.querySelector<HtmlTestEl>("#bridge-token-preview")?.textContent
    ).toContain("999999");

    // Toggle desktop:windowTitle scope explicitly
    if (titleScopeCb) {
      titleScopeCb.checked = true;
      titleScopeCb.trigger("change");
    }
    await vi.waitFor(() =>
      expect(config.bridgeScopes).toContain("desktop:windowTitle")
    );
  });
});
