import type * as THREE from "three";

/**
 * Standard interface for engine systems managed by SceneManager.
 */
export interface System {
  /**
   * Called on each frame update with elapsed delta time in seconds.
   * @param dt Delta time since the last rendered frame, in seconds.
   */
  update(dt: number): void;

  /**
   * Disposes of any resources, geometry, materials, or listeners owned by the system.
   */
  dispose(): void;
}

/**
 * Configuration options for SceneManager.
 */
export interface SceneManagerOptions {
  /**
   * Container element where the WebGL canvas will be appended.
   */
  container?: HTMLElement;

  /**
   * Optional pre-existing HTMLCanvasElement to render into.
   */
  canvas?: HTMLCanvasElement;

  /**
   * Target maximum frames per second. Defaults to 30.
   */
  fpsCap?: number;

  /**
   * Field of view for the perspective camera. Defaults to 45.
   */
  cameraFov?: number;

  /**
   * Near clipping plane for the camera. Defaults to 0.1.
   */
  cameraNear?: number;

  /**
   * Far clipping plane for the camera. Defaults to 100.
   */
  cameraFar?: number;

  /**
   * Initial camera position [x, y, z]. Defaults to [0, 0, 4].
   */
  cameraPosition?: [number, number, number];

  /**
   * Optional custom camera instance (e.g. PerspectiveCamera or OrthographicCamera).
   */
  camera?: THREE.PerspectiveCamera;

  /**
   * Automatically pause rendering loop when document.visibilityState is 'hidden'.
   * Defaults to true.
   */
  pauseOnHidden?: boolean;

  /**
   * Optional custom WebGLRenderer, allowing injection for testing or custom configuration.
   */
  renderer?: THREE.WebGLRenderer;

  /**
   * Initial width (defaults to window.innerWidth or 800).
   */
  width?: number;

  /**
   * Initial height (defaults to window.innerHeight or 600).
   */
  height?: number;

  /**
   * Device pixel ratio (defaults to Math.min(window.devicePixelRatio, 2) or 1).
   */
  pixelRatio?: number;
}
