import { SceneManager } from "./engine/SceneManager";
import { getPlatformCaps } from "./platform/caps";
import "./styles/app.css";

console.log("[deskumi] Initializing Deskumi transparent window");

getPlatformCaps()
  .then((caps) => {
    console.log("[deskumi] Platform caps:", caps);
  })
  .catch((err: unknown) => {
    console.error("[deskumi] Failed to query platform caps:", err);
  });

const appContainer = document.querySelector<HTMLDivElement>("#app");
if (!appContainer) {
  throw new Error("Missing #app container element");
}

const sceneManager = new SceneManager({
  container: appContainer,
  fpsCap: 30
});

sceneManager.start();
