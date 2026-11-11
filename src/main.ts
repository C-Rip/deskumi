import sampleAvatarUrl from "../assets/avatars/VRM1_Constraint_Twist_Sample.vrm";
import {
  centerAndGroundVRM,
  calculatePerspectiveFraming,
  loadVRM
} from "./engine/AvatarLoader";
import { AnimationSystem } from "./engine/AnimationSystem";
import { LookAtSystem } from "./engine/LookAtSystem";
import { SceneManager } from "./engine/SceneManager";
import { getPlatformCaps } from "./platform/caps";
import { setupWindowDrag } from "./platform/drag";
import { AvatarInputRegionSystem } from "./platform/input-region";
import "./styles/app.css";

console.log("[deskumi] Initializing Deskumi transparent window");

// Enable native window dragging with primary mouse button
setupWindowDrag();

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

    // Register dynamic click-through input region system
    const inputRegionSystem = new AvatarInputRegionSystem(
      vrm.scene,
      sceneManager.camera
    );
    sceneManager.registerSystem(inputRegionSystem);
  })
  .catch((err: unknown) => {
    console.error("[deskumi] Failed to load sample avatar:", err);
  });

sceneManager.start();
