import { SettingsPanel } from "./SettingsPanel";
import "../styles/settings.css";

const container = document.querySelector<HTMLDivElement>("#settings-app");
if (container) {
  const panel = new SettingsPanel({ container });
  void panel.init();
} else {
  console.error(
    "[deskumi-settings] Failed to mount: #settings-app container not found"
  );
}
