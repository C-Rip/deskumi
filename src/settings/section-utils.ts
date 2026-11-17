import type { AvatarScope } from "../engine/AvatarCommand";
import type { BridgeStatus } from "../platform/ipc";

export interface ScopeMetadata {
  label: string;
  description: string;
  privacyWarning?: string;
}

export const SCOPE_METADATA: Record<AvatarScope, ScopeMetadata> = {
  "avatar:speak": {
    label: "Habla y audio (avatar:speak)",
    description: "Reproducir voz PCM, texto en globo y lip-sync."
  },
  "avatar:interrupt": {
    label: "Interrumpir habla (avatar:interrupt)",
    description: "Detener la locución o cola de habla en curso."
  },
  "avatar:expression": {
    label: "Expresiones y reacciones (avatar:expression)",
    description: "Activar expresiones faciales y reacciones breves."
  },
  "avatar:animation": {
    label: "Animaciones .vrma (avatar:animation)",
    description: "Reproducir animaciones registradas por ID lógico."
  },
  "avatar:lookAt": {
    label: "Mirada (avatar:lookAt)",
    description: "Dirigir temporalmente la mirada del personaje."
  },
  "avatar:events": {
    label: "Eventos del avatar (avatar:events)",
    description: "Recibir clics, cambios de estado y modelo activo."
  },
  "desktop:events": {
    label: "Eventos de escritorio (desktop:events)",
    description: "Recibir identificador de aplicación activa (sin título)."
  },
  "desktop:windowTitle": {
    label: "Título de ventana activa (desktop:windowTitle)",
    description: "Incluir el título completo de la ventana enfocada.",
    privacyWarning:
      "Privacidad (apagado por defecto): expone el título de ventanas activas de otras apps."
  }
};

export const DEFAULT_STOPPED_BRIDGE_STATUS: BridgeStatus = {
  running: false,
  port: null,
  bridgeFilePath: null,
  token: null,
  connectedClients: 0,
  maxClients: 4
};

export function getScopeMetadata(scope: string): ScopeMetadata {
  if (scope in SCOPE_METADATA) {
    return SCOPE_METADATA[scope as AvatarScope];
  }
  return {
    label: scope,
    description: "Permiso de integración externa."
  };
}

/**
 * Escapes HTML special characters for safe interpolation inside `innerHTML`.
 */
export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * Copies text using the Web Clipboard API when available.
 */
export async function copyTextWithClipboard(text: string): Promise<void> {
  if (
    typeof navigator === "undefined" ||
    !navigator.clipboard ||
    typeof navigator.clipboard.writeText !== "function"
  ) {
    throw new Error("Portapapeles no disponible en este entorno");
  }
  await navigator.clipboard.writeText(text);
}

/**
 * Derives a valid logical animation ID suggestion from a `.vrma` file path.
 */
export function suggestAnimationIdFromPath(path: string): string {
  const base = path.split(/[\\/]/).pop() ?? "";
  const stem = base.replace(/\.vrma$/i, "");
  const cleaned = stem
    .replace(/[^a-zA-Z0-9-_.:]+/g, "_")
    .replace(/^[^a-zA-Z0-9]+/, "");
  return cleaned.slice(0, 64);
}
