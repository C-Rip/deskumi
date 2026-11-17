import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { AvatarEvent, AvatarScope } from "../engine/AvatarCommand";
import type { AvatarController } from "../engine/AvatarController";

export type FocusMetadataMode = 0 | 1 | 2;

export interface WindowFocusMetadata {
  appId?: string;
  title?: string;
}

export const WINDOW_FOCUS_EVENT_NAME = "cursor-bridge-window-focus" as const;

/**
 * Computes the `org.deskumi.CursorBridge` `FocusMetadataMode` from granted scopes:
 * - `0`: `desktop:events` is not granted (compositors send neither `appId` nor `title`)
 * - `1`: `desktop:events` granted without `desktop:windowTitle` (`appId` only)
 * - `2`: both `desktop:events` and `desktop:windowTitle` granted (`appId` + `title`)
 */
export function computeFocusMetadataMode(
  grantedScopes: Iterable<AvatarScope | string>
): FocusMetadataMode {
  const scopeSet = new Set(grantedScopes);
  if (!scopeSet.has("desktop:events")) {
    return 0;
  }
  return scopeSet.has("desktop:windowTitle") ? 2 : 1;
}

/**
 * Updates the backend `FocusMetadataMode` (`0 | 1 | 2`), notifying GNOME Shell
 * and KDE KWin bridges so restricted metadata never crosses D-Bus.
 */
export async function setFocusMetadataMode(
  mode: FocusMetadataMode
): Promise<void> {
  if (!isTauri()) {
    return;
  }
  await invoke("set_focus_metadata_mode", { mode });
}

/**
 * Queries the latest sanitized active window focus metadata stored in Rust.
 */
export async function getWindowFocusMetadata(): Promise<WindowFocusMetadata | null> {
  if (!isTauri()) {
    return null;
  }
  return await invoke<WindowFocusMetadata | null>("get_window_focus_metadata");
}

/**
 * Subscribes to `"cursor-bridge-window-focus"` events emitted by `cursor_bridge.rs`.
 */
export async function listenWindowFocusMetadata(
  handler: (metadata: WindowFocusMetadata) => void
): Promise<() => void> {
  if (!isTauri()) {
    return () => {};
  }
  return await listen<WindowFocusMetadata>(WINDOW_FOCUS_EVENT_NAME, (event) => {
    handler(event.payload);
  });
}

export interface WindowFocusBridgeOptions {
  avatarController: Pick<AvatarController, "emitEvent">;
  grantedScopes?: Iterable<AvatarScope | string>;
  setMode?: (mode: FocusMetadataMode) => Promise<void>;
  getMetadata?: () => Promise<WindowFocusMetadata | null>;
  listenFocus?: (
    handler: (metadata: WindowFocusMetadata) => void
  ) => Promise<() => void>;
}

/**
 * Bridges sanitized `org.deskumi.CursorBridge` window focus updates into
 * `AvatarController.emitEvent({ type: "windowFocus", ... })` while keeping
 * backend `FocusMetadataMode` synchronized with active desktop scopes.
 */
export class WindowFocusBridge {
  private readonly avatarController: Pick<AvatarController, "emitEvent">;
  private readonly setModeFn: (mode: FocusMetadataMode) => Promise<void>;
  private readonly getMetadataFn: () => Promise<WindowFocusMetadata | null>;
  private readonly listenFocusFn: (
    handler: (metadata: WindowFocusMetadata) => void
  ) => Promise<() => void>;

  private activeMode: FocusMetadataMode;
  private unlisten: (() => void) | null = null;
  private lastForwardedKey: string | null = null;
  private started = false;
  private disposed = false;

  constructor(options: WindowFocusBridgeOptions) {
    this.avatarController = options.avatarController;
    this.activeMode = computeFocusMetadataMode(options.grantedScopes ?? []);
    this.setModeFn = options.setMode ?? setFocusMetadataMode;
    this.getMetadataFn = options.getMetadata ?? getWindowFocusMetadata;
    this.listenFocusFn = options.listenFocus ?? listenWindowFocusMetadata;
  }

  public get mode(): FocusMetadataMode {
    return this.activeMode;
  }

  public get isStarted(): boolean {
    return this.started;
  }

  public get isDisposed(): boolean {
    return this.disposed;
  }

  public async start(): Promise<void> {
    if (this.disposed || this.started) {
      return;
    }
    this.started = true;

    try {
      const unlisten = await this.listenFocusFn((metadata) => {
        this.handleMetadata(metadata);
      });
      if (this.disposed) {
        unlisten();
        return;
      }
      this.unlisten = unlisten;
      await this.setModeFn(this.activeMode);
      if (!this.disposed && this.activeMode > 0) {
        const current = await this.getMetadataFn();
        if (!this.disposed) {
          this.handleMetadata(current);
        }
      }
    } catch (err: unknown) {
      this.started = false;
      this.unlisten?.();
      this.unlisten = null;
      throw err;
    }
  }

  public async setGrantedScopes(
    scopes: Iterable<AvatarScope | string>
  ): Promise<void> {
    if (this.disposed) {
      return;
    }
    const nextMode = computeFocusMetadataMode(scopes);
    if (nextMode === this.activeMode) {
      return;
    }

    this.activeMode = nextMode;
    this.lastForwardedKey = null;
    await this.setModeFn(nextMode);

    if (this.started && !this.disposed && nextMode > 0) {
      const current = await this.getMetadataFn();
      if (!this.disposed) {
        this.handleMetadata(current);
      }
    }
  }

  public handleMetadata(raw: WindowFocusMetadata | null): void {
    if (this.disposed || this.activeMode === 0 || !raw) {
      return;
    }

    const appId =
      typeof raw.appId === "string" && raw.appId.length > 0
        ? raw.appId
        : undefined;
    const title =
      this.activeMode === 2 &&
      typeof raw.title === "string" &&
      raw.title.length > 0
        ? raw.title
        : undefined;

    if (appId === undefined && title === undefined) {
      return;
    }

    const key = JSON.stringify([appId ?? null, title ?? null]);
    if (key === this.lastForwardedKey) {
      return;
    }
    this.lastForwardedKey = key;

    const event: AvatarEvent = {
      type: "windowFocus",
      ...(appId !== undefined ? { appId } : {}),
      ...(title !== undefined ? { title } : {})
    };
    this.avatarController.emitEvent(event);
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.started = false;
    this.unlisten?.();
    this.unlisten = null;
    this.lastForwardedKey = null;

    if (this.activeMode !== 0) {
      this.activeMode = 0;
      void this.setModeFn(0).catch(() => {});
    }
  }
}
