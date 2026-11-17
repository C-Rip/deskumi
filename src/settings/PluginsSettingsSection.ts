import { pickVRMAFile } from "../platform/avatar-picker";
import type { PlatformCaps } from "../platform/caps";
import {
  listPlugins,
  listRegisteredAnimations,
  registerAnimation,
  unregisterAnimation,
  type PluginInfo,
  type RegisteredAnimation
} from "../platform/ipc";
import { MAX_ACTIVE_PLUGINS } from "../platform/plugins/PluginHostTypes";
import type {
  AppConfig,
  RegisteredAnimationConfig
} from "../platform/store-schema";
import { bindPluginsSectionEvents } from "./PluginsDomBinder";
import {
  buildPluginsSectionHtml,
  type AnimationDraftState
} from "./PluginsSettingsTemplate";
import { suggestAnimationIdFromPath } from "./section-utils";

export interface PluginsSectionDeps {
  listPlugins?: () => Promise<PluginInfo[]>;
  listRegisteredAnimations?: () => Promise<RegisteredAnimation[]>;
  registerAnimation?: (
    id: string,
    path: string,
    label?: string
  ) => Promise<RegisteredAnimation | null>;
  unregisterAnimation?: (id: string) => Promise<boolean>;
  pickVrmaFile?: () => Promise<string | null>;
}

export interface PluginsSectionOptions {
  container: HTMLElement;
  caps: PlatformCaps;
  getConfig: () => AppConfig;
  updateConfig: (patch: Partial<AppConfig>) => Promise<void>;
  showToast: (msg: string) => void;
  deps?: PluginsSectionDeps;
}

export class PluginsSettingsSection {
  private readonly container: HTMLElement;
  private caps: PlatformCaps;
  private readonly getConfig: () => AppConfig;
  private readonly updateConfig: (patch: Partial<AppConfig>) => Promise<void>;
  private readonly showToast: (msg: string) => void;
  private readonly deps: Required<PluginsSectionDeps>;

  private plugins: PluginInfo[] = [];
  private discoveredAnimations: RegisteredAnimation[] = [];
  private loadError: string | null = null;
  private draft: AnimationDraftState = { id: "", label: "", path: "" };
  private disposed = false;

  constructor(options: PluginsSectionOptions) {
    this.container = options.container;
    this.caps = options.caps;
    this.getConfig = options.getConfig;
    this.updateConfig = options.updateConfig;
    this.showToast = options.showToast;
    this.deps = {
      listPlugins: options.deps?.listPlugins ?? listPlugins,
      listRegisteredAnimations:
        options.deps?.listRegisteredAnimations ?? listRegisteredAnimations,
      registerAnimation: options.deps?.registerAnimation ?? registerAnimation,
      unregisterAnimation:
        options.deps?.unregisterAnimation ?? unregisterAnimation,
      pickVrmaFile: options.deps?.pickVrmaFile ?? pickVRMAFile
    };
  }

  public getDiscoveredPlugins(): PluginInfo[] {
    return [...this.plugins];
  }

  public async mount(): Promise<void> {
    this.render();
    if (this.caps.plugins) {
      await this.refresh();
    }
  }

  public sync(caps = this.caps): void {
    this.caps = caps;
    this.render();
    if (this.caps.plugins) {
      void this.refresh();
    }
  }

  public render(): void {
    this.container.innerHTML = buildPluginsSectionHtml({
      caps: this.caps,
      config: this.getConfig(),
      plugins: this.plugins,
      discoveredAnimations: this.discoveredAnimations,
      draft: this.draft,
      loadError: this.loadError
    });
    if (!this.caps.plugins) return;

    bindPluginsSectionEvents(this.container, {
      onRefresh: () => void this.refresh(),
      onTogglePlugin: (pluginId) => void this.togglePlugin(pluginId),
      onPermissionChange: (pluginId, permission, checked) =>
        void this.setPluginPermission(pluginId, permission, checked),
      onAnimIdInput: (value) => {
        this.draft.id = value;
        return value.trim().length > 0 && this.draft.path.trim().length > 0;
      },
      onAnimLabelInput: (value) => {
        this.draft.label = value;
      },
      onPickVrma: () => void this.pickAnimationFile(),
      onRegisterAnim: () => void this.registerUserAnimation(),
      onUnregisterAnim: (animId) => void this.unregisterUserAnimation(animId)
    });
  }

  public async refresh(): Promise<void> {
    if (!this.caps.plugins || this.disposed) return;
    this.loadError = null;
    try {
      const [plugins, anims] = await Promise.all([
        this.deps.listPlugins(),
        this.deps.listRegisteredAnimations()
      ]);
      if (this.disposed) return;
      this.plugins = plugins;
      this.discoveredAnimations = anims;
    } catch (err: unknown) {
      this.loadError =
        err instanceof Error ? err.message : "Error cargando plugins";
    }
    this.render();
  }

  public async togglePlugin(
    pluginId: string,
    forceEnable?: boolean
  ): Promise<boolean> {
    if (!this.caps.plugins || this.disposed) return false;
    const config = this.getConfig();
    const currentlyEnabled = config.enabledPlugins.includes(pluginId);
    const shouldEnable = forceEnable ?? !currentlyEnabled;
    if (shouldEnable === currentlyEnabled) return true;

    if (shouldEnable && config.enabledPlugins.length >= MAX_ACTIVE_PLUGINS) {
      this.showToast(
        `Límite alcanzado: máximo ${MAX_ACTIVE_PLUGINS} plugins activos`
      );
      return false;
    }

    const nextEnabled = shouldEnable
      ? [...config.enabledPlugins, pluginId]
      : config.enabledPlugins.filter((id) => id !== pluginId);
    await this.updateConfig({ enabledPlugins: nextEnabled });
    this.render();
    this.showToast(
      shouldEnable
        ? `Plugin '${pluginId}' activado`
        : `Plugin '${pluginId}' desactivado`
    );
    return true;
  }

  public async setPluginPermission(
    pluginId: string,
    permission: string,
    granted: boolean
  ): Promise<void> {
    if (!this.caps.plugins || this.disposed) return;
    const config = this.getConfig();
    const currentMap = { ...config.pluginPermissions };
    const existing = new Set(currentMap[pluginId] ?? []);
    if (granted) existing.add(permission);
    else existing.delete(permission);

    currentMap[pluginId] = Array.from(existing);
    await this.updateConfig({ pluginPermissions: currentMap });
    this.render();
    this.showToast(
      granted
        ? `Permiso '${permission}' aprobado para '${pluginId}'`
        : `Permiso '${permission}' revocado`
    );
  }

  public async pickAnimationFile(): Promise<string | null> {
    if (!this.caps.plugins || this.disposed) return null;
    try {
      const selected = await this.deps.pickVrmaFile();
      if (!selected) return null;
      this.draft.path = selected;
      if (!this.draft.id.trim()) {
        this.draft.id = suggestAnimationIdFromPath(selected);
      }
      this.render();
      return selected;
    } catch (err: unknown) {
      console.warn("[deskumi-settings] Failed to pick .vrma file:", err);
      this.showToast("No se pudo seleccionar el archivo .vrma");
      return null;
    }
  }

  public async registerUserAnimation(
    id = this.draft.id,
    path = this.draft.path,
    label = this.draft.label
  ): Promise<boolean> {
    if (!this.caps.plugins || this.disposed) return false;
    const trimmedId = id.trim();
    const trimmedPath = path.trim();
    const trimmedLabel = label.trim();
    if (!trimmedId || !trimmedPath) {
      this.showToast("Indica un ID lógico y un archivo .vrma");
      return false;
    }

    try {
      await this.deps.registerAnimation(
        trimmedId,
        trimmedPath,
        trimmedLabel || undefined
      );
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Error registrando animación";
      this.showToast(msg);
      return false;
    }

    const entry: RegisteredAnimationConfig = {
      id: trimmedId,
      path: trimmedPath,
      ...(trimmedLabel ? { label: trimmedLabel } : {})
    };
    const existing = this.getConfig().registeredAnimations.filter(
      (a) => a.id !== trimmedId
    );
    await this.updateConfig({ registeredAnimations: [...existing, entry] });
    this.draft = { id: "", label: "", path: "" };
    await this.refresh();
    this.showToast(`Animación '${trimmedId}' registrada`);
    return true;
  }

  public async unregisterUserAnimation(id: string): Promise<void> {
    if (!this.caps.plugins || this.disposed) return;
    try {
      await this.deps.unregisterAnimation(id);
    } catch (err: unknown) {
      console.warn(
        `[deskumi-settings] Failed to unregister animation '${id}':`,
        err
      );
    }
    const next = this.getConfig().registeredAnimations.filter(
      (a) => a.id !== id
    );
    await this.updateConfig({ registeredAnimations: next });
    await this.refresh();
    this.showToast(`Animación '${id}' eliminada`);
  }

  public async resetToDefaults(
    prevAnimations: readonly RegisteredAnimationConfig[]
  ): Promise<void> {
    if (this.caps.plugins) {
      for (const anim of prevAnimations) {
        try {
          await this.deps.unregisterAnimation(anim.id);
        } catch {
          // Ignore individual cleanup error on reset
        }
      }
    }
    this.draft = { id: "", label: "", path: "" };
    this.render();
    if (this.caps.plugins) {
      await this.refresh();
    }
  }

  public dispose(): void {
    this.disposed = true;
  }
}
