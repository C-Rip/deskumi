import { invoke, isTauri } from "@tauri-apps/api/core";

export interface PluginAnimationDecl {
  id: string;
  path: string;
  label?: string;
}

export interface PluginInfo {
  id: string;
  name: string;
  version: string;
  description?: string;
  entry: string;
  entryUrl: string;
  permissions: string[];
  animations: PluginAnimationDecl[];
}

export interface RegisteredAnimation {
  id: string;
  label?: string;
  source: "user" | "plugin";
  pluginId?: string;
}

/**
 * Lists valid plugins discovered under `$APPDATA/plugins/<pluginId>/manifest.json`.
 */
export async function listPlugins(): Promise<PluginInfo[]> {
  if (!isTauri()) {
    return [];
  }
  return await invoke<PluginInfo[]>("list_plugins");
}

/**
 * Lists logical `.vrma` animations registered by the user or plugin manifests
 * without exposing underlying disk paths.
 */
export async function listRegisteredAnimations(): Promise<
  RegisteredAnimation[]
> {
  if (!isTauri()) {
    return [];
  }
  return await invoke<RegisteredAnimation[]>("list_registered_animations");
}

/**
 * Registers a local `.vrma` file under a validated logical animation ID.
 */
export async function registerAnimation(
  id: string,
  path: string,
  label?: string
): Promise<RegisteredAnimation | null> {
  if (!isTauri()) {
    return null;
  }
  return await invoke<RegisteredAnimation>("register_animation", {
    id,
    path,
    label: label ?? null
  });
}

/**
 * Unregisters a user-registered `.vrma` animation by logical ID.
 */
export async function unregisterAnimation(id: string): Promise<boolean> {
  if (!isTauri()) {
    return false;
  }
  return await invoke<boolean>("unregister_animation", { id });
}

/**
 * Reads binary `.vrma` contents for a validated registered animation ID.
 */
export async function readRegisteredAnimationBytes(
  id: string
): Promise<Uint8Array> {
  if (!isTauri()) {
    throw new Error("Registered animations can only be read in Tauri runtime");
  }
  const raw = await invoke<ArrayBuffer | Uint8Array | number[]>(
    "read_registered_animation_bytes",
    { id }
  );
  if (raw instanceof Uint8Array) {
    return raw;
  }
  if (raw instanceof ArrayBuffer) {
    return new Uint8Array(raw);
  }
  if (Array.isArray(raw)) {
    return new Uint8Array(raw);
  }
  throw new Error("Unexpected response payload for registered animation bytes");
}
