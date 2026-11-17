import { afterEach, describe, expect, it, vi } from "vitest";
import type { PlatformCaps } from "../platform/caps";
import type { PluginInfo, RegisteredAnimation } from "../platform/ipc";
import {
  cloneAppConfig,
  DEFAULT_CONFIG,
  type AppConfig
} from "../platform/store";
import {
  PluginsSettingsSection,
  type PluginsSectionDeps
} from "./PluginsSettingsSection";

class HtmlTestEl {
  public tag: string;
  public textContent = "";
  public disabled = false;
  public checked = false;
  public value = "";
  public attrs: Record<string, string> = {};
  private classes = new Set<string>();
  private listeners: Record<string, Array<(e: unknown) => void>> = {};
  public classList = { contains: (c: string) => this.classes.has(c) };

  constructor(tag: string, attrsStr: string) {
    this.tag = tag;
    this.disabled = /\bdisabled\b/.test(attrsStr);
    this.checked = /\bchecked\b/.test(attrsStr);
    for (const m of attrsStr.matchAll(/([a-zA-Z0-9_-]+)="([^"]*)"/g)) {
      this.attrs[m[1]] = m[2];
    }
    this.value = this.attrs.value ?? "";
    for (const cls of (this.attrs.class ?? "").split(/\s+/).filter(Boolean)) {
      this.classes.add(cls);
    }
  }
  getAttribute = (k: string): string | null => this.attrs[k] ?? null;
  addEventListener = (ev: string, fn: (e: unknown) => void): void => {
    (this.listeners[ev] ??= []).push(fn);
  };
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
    for (const m of html.matchAll(/<(\/?)([a-z0-9]+)([^>]*?)(\/?)>/gi)) {
      const tag = m[2].toLowerCase();
      const idx = m.index ?? 0;
      if (m[1] === "/") {
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
        const el = new HtmlTestEl(tag, m[3]);
        this.nodes.push(el);
        if (m[4] !== "/" && tag !== "input") {
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
      return this.nodes.filter(
        (n) => n.attrs.id === sel.slice(1)
      ) as unknown as T[];
    }
    if (sel.startsWith(".")) {
      return this.nodes.filter((n) =>
        n.classList.contains(sel.slice(1))
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

const MAC_CAPS: PlatformCaps = {
  ...LINUX_CAPS,
  os: "macos",
  displayServer: "quartz",
  localBridge: false,
  plugins: false
};

function makePlugin(id: string, permissions: string[]): PluginInfo {
  return {
    id,
    name: `Plugin ${id}`,
    version: "1.0.0",
    description: id === "p1" ? "Echo <script>xss</script>" : `Desc ${id}`,
    entry: "index.html",
    entryUrl: `plugin://${id}/index.html`,
    permissions,
    animations: []
  };
}

describe("PluginsSettingsSection", () => {
  const sections: PluginsSettingsSection[] = [];
  afterEach(() => {
    for (const s of sections.splice(0)) s.dispose();
  });

  function setupSection(caps: PlatformCaps, deps: PluginsSectionDeps) {
    const container = new HtmlTestContainer();
    let config: AppConfig = cloneAppConfig(DEFAULT_CONFIG);
    const toasts: string[] = [];
    const section = new PluginsSettingsSection({
      container: container as unknown as HTMLElement,
      caps,
      getConfig: () => config,
      updateConfig: async (patch) => {
        config = { ...config, ...patch };
      },
      showToast: (m) => toasts.push(m),
      deps
    });
    sections.push(section);
    return { container, section, getConfig: () => config, toasts };
  }

  it("hides controls with notice and skips IPC when plugins cap is false", async () => {
    const listPlugins = vi.fn();
    const { container, section } = setupSection(MAC_CAPS, { listPlugins });
    await section.mount();

    expect(listPlugins).not.toHaveBeenCalled();
    expect(
      container.querySelector("#plugins-unavailable-notice")
    ).not.toBeNull();
    expect(container.querySelector("#btn-plugins-refresh")).toBeNull();
  });

  it("requires explicit permission consent and enforces MAX_ACTIVE_PLUGINS = 3", async () => {
    const plugins = [
      makePlugin("p1", ["avatar:speak", "desktop:windowTitle"]),
      makePlugin("p2", ["avatar:expression"]),
      makePlugin("p3", []),
      makePlugin("p4", ["avatar:lookAt"])
    ];
    const { container, section, getConfig } = setupSection(LINUX_CAPS, {
      listPlugins: async () => plugins,
      listRegisteredAnimations: async () => []
    });
    await section.mount();

    expect(container.innerHTML).toContain("&lt;script&gt;xss&lt;/script&gt;");
    expect(container.innerHTML).not.toContain("<script>xss</script>");

    const permCbs = container.querySelectorAll<HtmlTestEl>(
      ".plugin-perm-checkbox"
    );
    expect(permCbs.every((cb) => !cb.checked)).toBe(true);

    const speakCb = permCbs.find(
      (cb) =>
        cb.getAttribute("data-plugin-id") === "p1" &&
        cb.getAttribute("data-permission") === "avatar:speak"
    );
    if (speakCb) {
      speakCb.checked = true;
      speakCb.trigger("change");
    }
    await vi.waitFor(() =>
      expect(getConfig().pluginPermissions.p1).toEqual(["avatar:speak"])
    );

    expect(await section.togglePlugin("p1", true)).toBe(true);
    expect(await section.togglePlugin("p2", true)).toBe(true);
    expect(await section.togglePlugin("p3", true)).toBe(true);
    expect(await section.togglePlugin("p4", true)).toBe(false);

    expect(getConfig().enabledPlugins).toEqual(["p1", "p2", "p3"]);
    const p4ToggleBtn = container
      .querySelectorAll<HtmlTestEl>(".plugin-toggle-btn")
      .find((b) => b.getAttribute("data-plugin-id") === "p4");
    expect(p4ToggleBtn?.disabled).toBe(true);
    expect(container.querySelector("#plugins-limit-banner")).not.toBeNull();
  });

  it("picks, registers, lists, and unregisters logical .vrma animations", async () => {
    const registry: RegisteredAnimation[] = [
      {
        id: "plugin_wave",
        label: "Plugin Wave",
        source: "plugin",
        pluginId: "p1"
      }
    ];
    const registerAnimation = vi.fn(
      async (id: string, _path: string, label?: string) => {
        const item: RegisteredAnimation = { id, label, source: "user" };
        registry.push(item);
        return item;
      }
    );
    const unregisterAnimation = vi.fn(async (id: string) => {
      const idx = registry.findIndex((a) => a.id === id);
      if (idx >= 0) registry.splice(idx, 1);
      return true;
    });

    const { container, section, getConfig } = setupSection(LINUX_CAPS, {
      listPlugins: async () => [],
      listRegisteredAnimations: async () => [...registry],
      registerAnimation,
      unregisterAnimation,
      pickVrmaFile: async () => "/home/user/animations/happy_dance.vrma"
    });
    await section.mount();

    container
      .querySelector<HtmlTestEl>("#btn-pick-anim-vrma")
      ?.trigger("click");
    await vi.waitFor(() =>
      expect(container.querySelector<HtmlTestEl>("#input-anim-id")?.value).toBe(
        "happy_dance"
      )
    );

    const labelInput = container.querySelector<HtmlTestEl>("#input-anim-label");
    if (labelInput) {
      labelInput.value = "Baile feliz";
      labelInput.trigger("input");
    }

    container.querySelector<HtmlTestEl>("#btn-register-anim")?.trigger("click");
    await vi.waitFor(() =>
      expect(
        container.querySelectorAll<HtmlTestEl>(".btn-unregister-anim")
      ).toHaveLength(1)
    );
    expect(registerAnimation).toHaveBeenCalledWith(
      "happy_dance",
      "/home/user/animations/happy_dance.vrma",
      "Baile feliz"
    );
    expect(getConfig().registeredAnimations).toEqual([
      {
        id: "happy_dance",
        path: "/home/user/animations/happy_dance.vrma",
        label: "Baile feliz"
      }
    ]);

    container
      .querySelectorAll<HtmlTestEl>(".btn-unregister-anim")
      .find((b) => b.getAttribute("data-anim-id") === "happy_dance")
      ?.trigger("click");
    await vi.waitFor(() =>
      expect(unregisterAnimation).toHaveBeenCalledWith("happy_dance")
    );
    expect(getConfig().registeredAnimations).toEqual([]);
  });
});
