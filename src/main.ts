import sampleAvatarUrl from "../assets/avatars/VRM1_Constraint_Twist_Sample.vrm";
import {
  centerAndGroundVRM,
  calculatePerspectiveFraming,
  loadVRM
} from "./engine/AvatarLoader";
import { AnimationSystem } from "./engine/AnimationSystem";
import { LookAtSystem } from "./engine/LookAtSystem";
import { ReactionSystem } from "./engine/ReactionSystem";
import { SceneManager } from "./engine/SceneManager";
import { getPlatformCaps } from "./platform/caps";
import { setupWindowDrag } from "./platform/drag";
import { AvatarInputRegionSystem } from "./platform/input-region";
import "./styles/app.css";

console.log("[deskumi] Initializing Deskumi transparent window");

// Disable default WebKit context menu (Inspect Element, Back, Reload, etc.)
window.addEventListener("contextmenu", (event) => {
  event.preventDefault();
});

let isDragging = false;

// Enable native window dragging with primary mouse button when dragging
setupWindowDrag({
  threshold: 5,
  onDragStart: () => {
    isDragging = true;
  }
});

window.addEventListener("mouseup", () => {
  // Reset drag flag shortly after mouse up so click event can check it
  setTimeout(() => {
    isDragging = false;
  }, 50);
});

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

// Load the official sample avatar and register the procedural AnimationSystem
loadVRM(sampleAvatarUrl)
  .then((vrm) => {
    console.log("[deskumi] Official sample VRM loaded successfully");
    sceneManager.scene.add(vrm.scene);

    // Center avatar horizontally and ground its feet at y=0
    const bounds = centerAndGroundVRM(vrm);

    // Adjust perspective camera to snugly frame full body
    const framing = calculatePerspectiveFraming(
      bounds,
      sceneManager.camera.fov,
      1.15
    );
    sceneManager.camera.position.copy(framing.cameraPosition);
    sceneManager.camera.lookAt(framing.target);

    // Register LookAtSystem (gaze and head/neck tracking with damping and clamp)
    const lookAtSystem = new LookAtSystem(vrm, {
      camera: sceneManager.camera,
      scene: sceneManager.scene
    });
    sceneManager.registerSystem(lookAtSystem);

    // Register procedural animation system (idle breathing, sway, relaxed arms, blinking)
    const animationSystem = new AnimationSystem(vrm);
    sceneManager.registerSystem(animationSystem);

    // Register dynamic click-through input region system using pixel-perfect silhouette hit-testing
    const inputRegionSystem = new AvatarInputRegionSystem(
      vrm,
      sceneManager.camera,
      {
        renderer: sceneManager.renderer,
        scene: sceneManager.scene,
        downscale: 4,
        padding: 2
      }
    );
    sceneManager.registerSystem(inputRegionSystem);

    // Register ReactionSystem for click/touch feedback
    const reactionSystem = new ReactionSystem(vrm, {
      duration: 1.5,
      bounceAmplitude: 0.04
    });
    sceneManager.registerSystem(reactionSystem);

    // Trigger reaction on avatar click (if not dragged)
    window.addEventListener("click", (event) => {
      if (isDragging) {
        return;
      }
      if (event.button === 0) {
        console.log("[deskumi] Avatar clicked! Triggering reaction");
        reactionSystem.triggerRandom();
      }
    });
  })
  .catch((err: unknown) => {
    console.error("[deskumi] Failed to load sample avatar:", err);
  });

sceneManager.start();
