import type { PlatformCaps } from "../platform/caps";
import {
  getBridgeStatus,
  regenerateBridgeToken,
  startLocalBridge,
  stopLocalBridge,
  type BridgeStatus
} from "../platform/ipc";
import type { AppConfig } from "../platform/store-schema";
import {
  applyBridgeStatusToDom,
  buildBridgeSectionHtml
} from "./BridgeSettingsTemplate";
import {
  copyTextWithClipboard,
  DEFAULT_STOPPED_BRIDGE_STATUS
} from "./section-utils";

export interface BridgeSectionDeps {
  getBridgeStatus?: () => Promise<BridgeStatus>;
  startLocalBridge?: () => Promise<BridgeStatus>;
  stopLocalBridge?: () => Promise<BridgeStatus>;
  regenerateBridgeToken?: () => Promise<BridgeStatus>;
  copyText?: (text: string) => Promise<void>;
}

export interface BridgeSectionOptions {
  container: HTMLElement;
  caps: PlatformCaps;
  getConfig: () => AppConfig;
  updateConfig: (patch: Partial<AppConfig>) => Promise<void>;
  showToast: (msg: string) => void;
  deps?: BridgeSectionDeps;
}

const STATUS_POLL_INTERVAL_MS = 2500;

export class BridgeSettingsSection {
  private readonly container: HTMLElement;
  private caps: PlatformCaps;
  private readonly getConfig: () => AppConfig;
  private readonly updateConfig: (patch: Partial<AppConfig>) => Promise<void>;
  private readonly showToast: (msg: string) => void;
  private readonly deps: Required<BridgeSectionDeps>;

  private status: BridgeStatus = { ...DEFAULT_STOPPED_BRIDGE_STATUS };
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private disposed = false;

  constructor(options: BridgeSectionOptions) {
    this.container = options.container;
    this.caps = options.caps;
    this.getConfig = options.getConfig;
    this.updateConfig = options.updateConfig;
    this.showToast = options.showToast;
    this.deps = {
      getBridgeStatus: options.deps?.getBridgeStatus ?? getBridgeStatus,
      startLocalBridge: options.deps?.startLocalBridge ?? startLocalBridge,
      stopLocalBridge: options.deps?.stopLocalBridge ?? stopLocalBridge,
      regenerateBridgeToken:
        options.deps?.regenerateBridgeToken ?? regenerateBridgeToken,
      copyText: options.deps?.copyText ?? copyTextWithClipboard
    };
  }

  public getStatus(): BridgeStatus {
    return { ...this.status };
  }

  public async mount(): Promise<void> {
    this.render();
    if (this.caps.localBridge) {
      await this.refreshStatus();
    }
  }

  public sync(caps = this.caps): void {
    this.caps = caps;
    this.render();
    if (this.caps.localBridge) {
      void this.refreshStatus();
    } else {
      this.stopPolling();
    }
  }

  public render(): void {
    this.container.innerHTML = buildBridgeSectionHtml(
      this.caps,
      this.getConfig(),
      this.status
    );
    if (!this.caps.localBridge) {
      this.stopPolling();
      return;
    }
    this.bindEvents();
    this.updatePollState();
  }

  public async refreshStatus(): Promise<void> {
    if (!this.caps.localBridge || this.disposed) return;
    try {
      this.status = await this.deps.getBridgeStatus();
      applyBridgeStatusToDom(this.container, this.status);
      this.updatePollState();
    } catch (err: unknown) {
      console.warn("[deskumi-settings] Failed to query bridge status:", err);
    }
  }

  public async toggleBridge(): Promise<void> {
    if (!this.caps.localBridge || this.disposed) return;
    const nextEnabled = !this.getConfig().bridgeEnabled;
    await this.updateConfig({ bridgeEnabled: nextEnabled });
    try {
      this.status = nextEnabled
        ? await this.deps.startLocalBridge()
        : await this.deps.stopLocalBridge();
      this.render();
      this.showToast(
        nextEnabled ? "Puente WebSocket activado" : "Puente WebSocket detenido"
      );
    } catch (err: unknown) {
      console.warn("[deskumi-settings] Failed to toggle local bridge:", err);
      this.showToast("Error al cambiar el estado del puente");
      await this.refreshStatus();
    }
  }

  public async toggleScope(scope: string, enabled?: boolean): Promise<void> {
    if (!this.caps.localBridge || this.disposed) return;
    const current = new Set(this.getConfig().bridgeScopes);
    const shouldEnable = enabled ?? !current.has(scope);
    if (shouldEnable) current.add(scope);
    else current.delete(scope);

    await this.updateConfig({ bridgeScopes: Array.from(current) });
    this.render();
    this.showToast(
      shouldEnable
        ? `Scope '${scope}' habilitado`
        : `Scope '${scope}' desactivado`
    );
  }

  public async copyToken(): Promise<void> {
    if (!this.status.token) return;
    try {
      await this.deps.copyText(this.status.token);
      this.showToast("Token copiado al portapapeles");
    } catch (err: unknown) {
      console.warn("[deskumi-settings] Failed to copy bridge token:", err);
      this.showToast("No se pudo copiar el token");
    }
  }

  public async copyPath(): Promise<void> {
    if (!this.status.bridgeFilePath) return;
    try {
      await this.deps.copyText(this.status.bridgeFilePath);
      this.showToast("Ruta de bridge.json copiada");
    } catch (err: unknown) {
      console.warn("[deskumi-settings] Failed to copy bridge path:", err);
      this.showToast("No se pudo copiar la ruta");
    }
  }

  public async regenerateToken(): Promise<void> {
    if (!this.caps.localBridge || !this.status.running || this.disposed) {
      return;
    }
    try {
      this.status = await this.deps.regenerateBridgeToken();
      applyBridgeStatusToDom(this.container, this.status);
      this.showToast("Token regenerado (clientes previos desconectados)");
    } catch (err: unknown) {
      console.warn("[deskumi-settings] Failed to regenerate token:", err);
      this.showToast("No se pudo regenerar el token");
    }
  }

  public async resetToDefaults(): Promise<void> {
    if (!this.caps.localBridge) {
      this.render();
      return;
    }
    try {
      this.status = await this.deps.stopLocalBridge();
    } catch (err: unknown) {
      console.warn("[deskumi-settings] Failed to stop bridge on reset:", err);
    }
    this.render();
  }

  public dispose(): void {
    this.disposed = true;
    this.stopPolling();
  }

  private bindEvents(): void {
    const bindBtn = (sel: string, fn: () => Promise<void>) => {
      this.container
        .querySelector<HTMLButtonElement>(sel)
        ?.addEventListener("click", () => {
          void fn();
        });
    };

    bindBtn("#btn-toggle-bridge", () => this.toggleBridge());
    bindBtn("#btn-bridge-refresh", () => this.refreshStatus());
    bindBtn("#btn-bridge-copy-token", () => this.copyToken());
    bindBtn("#btn-bridge-copy-path", () => this.copyPath());
    bindBtn("#btn-bridge-regenerate-token", () => this.regenerateToken());

    const checkboxes = Array.from(
      this.container.querySelectorAll<HTMLInputElement>(
        ".bridge-scope-checkbox"
      )
    );
    for (const checkbox of checkboxes) {
      checkbox.addEventListener("change", () => {
        const scope = checkbox.getAttribute("data-scope");
        if (scope) {
          void this.toggleScope(scope, checkbox.checked);
        }
      });
    }
  }

  private updatePollState(): void {
    if (this.caps.localBridge && this.status.running && !this.disposed) {
      if (this.pollTimer === null) {
        this.pollTimer = setInterval(() => {
          void this.refreshStatus();
        }, STATUS_POLL_INTERVAL_MS);
      }
    } else {
      this.stopPolling();
    }
  }

  private stopPolling(): void {
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }
}
