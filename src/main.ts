import * as THREE from "three";
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

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(
  45,
  window.innerWidth / window.innerHeight,
  0.1,
  100
);
camera.position.set(0, 0, 4);

const renderer = new THREE.WebGLRenderer({
  alpha: true,
  antialias: true,
  premultipliedAlpha: true
});
renderer.setClearColor(0x000000, 0);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;

appContainer.appendChild(renderer.domElement);

const geometry = new THREE.BoxGeometry(1.2, 1.2, 1.2);
const material = new THREE.MeshNormalMaterial();
const cube = new THREE.Mesh(geometry, material);
scene.add(cube);

function onWindowResize(): void {
  const width = window.innerWidth;
  const height = window.innerHeight;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
}

window.addEventListener("resize", onWindowResize);

function animate(): void {
  requestAnimationFrame(animate);
  cube.rotation.x += 0.01;
  cube.rotation.y += 0.015;
  renderer.render(scene, camera);
}

animate();
