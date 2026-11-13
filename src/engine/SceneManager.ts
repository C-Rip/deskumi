import * as THREE from "three";
import { FrameTicker } from "./FrameTicker";
import type { SceneManagerOptions, System } from "./types";

/**
 * Creates a minimal fallback renderer for headless/Node environments (e.g. testing)
 * where WebGL and DOM canvas are not available.
 */
function createFallbackRenderer(): THREE.WebGLRenderer {
  const dummyCanvas = {
    parentElement: null,
    style: {},
    width: 0,
    height: 0,
    clientWidth: 0,
    clientHeight: 0,
    addEventListener: () => {},
    removeEventListener: () => {}
  } as unknown as HTMLCanvasElement;

  return {
    domElement: dummyCanvas,
    render: () => {},
    setSize: () => {},
    setClearColor: () => {},
    setPixelRatio: () => {},
    dispose: () => {},
    outputColorSpace: THREE.SRGBColorSpace
  } as unknown as THREE.WebGLRenderer;
}

/**
 * SceneManager orchestrates the Three.js transparent scene, camera, lights,
 * rendering loop with FPS cap and delta time, responsive window resizing,
 * visibility change pausing, and engine systems.
 */
export class SceneManager {
  public readonly scene: THREE.Scene;
  public readonly camera: THREE.PerspectiveCamera;
  public readonly renderer: THREE.WebGLRenderer;
  public readonly hemisphereLight: THREE.HemisphereLight;
  public readonly directionalLight: THREE.DirectionalLight;

  private readonly systems: System[] = [];
  private readonly ticker: FrameTicker;
  private readonly pauseOnHidden: boolean;

  private rafId: number | null = null;
  private isRunning = false;
  private isDisposed = false;

  /** Reference height used to keep visual 3D scale invariant across window resizes (default: 600px) */
  public referenceHeight = 600;
  public readonly baseFov: number;

  constructor(options: SceneManagerOptions = {}) {
    const width =
      options.width ??
      (typeof window !== "undefined" ? window.innerWidth : 800);
    const height =
      options.height ??
      (typeof window !== "undefined" ? window.innerHeight : 600);
    const aspect = width / (height || 1);

    this.pauseOnHidden = options.pauseOnHidden ?? true;
    this.referenceHeight = options.height ?? 600;

    // 1. Scene
    this.scene = new THREE.Scene();

    // 2. Camera
    const fov = options.cameraFov ?? 45;
    this.baseFov = fov;
    if (options.camera) {
      this.camera = options.camera;
    } else {
      const near = options.cameraNear ?? 0.1;
      const far = options.cameraFar ?? 100;
      this.camera = new THREE.PerspectiveCamera(fov, aspect, near, far);
      const [px, py, pz] = options.cameraPosition ?? [0, 0, 4];
      this.camera.position.set(px, py, pz);
    }

    // 3. Renderer (Transparency setup per frontend-threejs.md)
    if (options.renderer) {
      this.renderer = options.renderer;
    } else if (typeof document !== "undefined") {
      this.renderer = new THREE.WebGLRenderer({
        alpha: true,
        antialias: true,
        premultipliedAlpha: false,
        canvas: options.canvas
      });
      this.renderer.setClearColor(0x000000, 0);
      this.renderer.autoClear = true;
      const pixelRatio =
        options.pixelRatio ??
        (typeof window !== "undefined"
          ? Math.min(window.devicePixelRatio || 1, 2)
          : 1);
      this.renderer.setPixelRatio(pixelRatio);
      this.renderer.setSize(width, height);
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    } else {
      this.renderer = createFallbackRenderer();
    }

    if (options.container && this.renderer.domElement) {
      options.container.appendChild(this.renderer.domElement);
    }

    // 4. Lighting (HemisphereLight + DirectionalLight)
    this.hemisphereLight = new THREE.HemisphereLight(0xffffff, 0x444444, 1.0);
    this.hemisphereLight.position.set(0, 20, 0);
    this.scene.add(this.hemisphereLight);

    this.directionalLight = new THREE.DirectionalLight(0xffffff, 1.0);
    this.directionalLight.position.set(1, 1, 1).normalize();
    this.scene.add(this.directionalLight);

    // 5. Ticker & Loop
    this.ticker = new FrameTicker({
      fpsCap: options.fpsCap ?? 30
    });

    // 6. Event listeners
    if (typeof window !== "undefined") {
      window.addEventListener("resize", this.onWindowResize);
    }
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", this.onVisibilityChange);
    }
  }

  public get fpsCap(): number {
    return this.ticker.fpsCap;
  }

  public set fpsCap(value: number) {
    this.ticker.setFpsCap(value);
  }

  public get isPaused(): boolean {
    return this.ticker.isPaused;
  }

  public get active(): boolean {
    return this.isRunning && !this.ticker.isPaused;
  }

  /**
   * Registers a new System to receive frame updates.
   */
  public registerSystem(system: System): void {
    if (!this.systems.includes(system)) {
      this.systems.push(system);
    }
  }

  /**
   * Unregisters a System from receiving frame updates.
   */
  public unregisterSystem(system: System): void {
    const index = this.systems.indexOf(system);
    if (index !== -1) {
      this.systems.splice(index, 1);
    }
  }

  /**
   * Returns a copy of the currently registered systems.
   */
  public getSystems(): readonly System[] {
    return [...this.systems];
  }

  /**
   * Starts the animation loop.
   */
  public start(): void {
    if (this.isRunning || this.isDisposed) return;
    this.isRunning = true;
    this.ticker.resume();
    if (typeof requestAnimationFrame !== "undefined") {
      this.rafId = requestAnimationFrame(this.onAnimationFrame);
    }
  }

  /**
   * Stops the animation loop completely.
   */
  public stop(): void {
    this.isRunning = false;
    if (this.rafId !== null && typeof cancelAnimationFrame !== "undefined") {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.ticker.pause();
  }

  /**
   * Pauses frame updates without killing the RAF loop.
   */
  public pause(): void {
    this.ticker.pause();
  }

  /**
   * Resumes frame updates.
   */
  public resume(): void {
    this.ticker.resume();
  }

  /**
   * Triggers a resize update for the camera and renderer.
   * Keeps visual scale constant by adapting FOV relative to reference height (600px).
   */
  public resize(width?: number, height?: number): void {
    const w =
      width ?? (typeof window !== "undefined" ? window.innerWidth : 800);
    const h =
      height ?? (typeof window !== "undefined" ? window.innerHeight : 600);

    this.camera.aspect = w / (h || 1);

    // Keep world-space height visual size invariant:
    // tan(fov / 2) * h = constant
    if (h > 0 && this.referenceHeight > 0) {
      const baseHalfFovRad = ((this.baseFov / 2) * Math.PI) / 180;
      const visibleHalfHeightWorld = Math.tan(baseHalfFovRad);
      const adaptedHalfFovRad = Math.atan(
        visibleHalfHeightWorld * (h / this.referenceHeight)
      );
      this.camera.fov = (adaptedHalfFovRad * 2 * 180) / Math.PI;
    }

    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  /**
   * Step the engine forward. Updates systems and renders if the FPS cap allows it.
   * @param now Current timestamp in milliseconds.
   * @returns Whether a frame was rendered.
   */
  public tick(now: number): boolean {
    if (!this.isRunning || this.isDisposed) {
      return false;
    }

    const { shouldRender, dt } = this.ticker.tick(now);
    if (!shouldRender) {
      return false;
    }

    for (let i = 0; i < this.systems.length; i++) {
      this.systems[i].update(dt);
    }

    this.render();
    return true;
  }

  /**
   * Immediately renders the scene with the camera.
   */
  public render(): void {
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
  }

  /**
   * Disposes of all resources, systems, listeners, and renderer.
   */
  public dispose(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;

    this.stop();

    if (typeof window !== "undefined") {
      window.removeEventListener("resize", this.onWindowResize);
    }
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this.onVisibilityChange);
    }

    for (const system of this.systems) {
      try {
        system.dispose();
      } catch (err: unknown) {
        console.error("[SceneManager] Error disposing system:", err);
      }
    }
    this.systems.length = 0;

    if (this.renderer.domElement && this.renderer.domElement.parentElement) {
      this.renderer.domElement.parentElement.removeChild(
        this.renderer.domElement
      );
    }

    this.renderer.dispose();
  }

  private onAnimationFrame = (now: number): void => {
    if (!this.isRunning) return;
    this.rafId = requestAnimationFrame(this.onAnimationFrame);
    this.tick(now);
  };

  private onWindowResize = (): void => {
    this.resize();
  };

  private onVisibilityChange = (): void => {
    if (typeof document === "undefined" || !this.pauseOnHidden) return;
    if (document.visibilityState === "hidden") {
      this.pause();
    } else if (document.visibilityState === "visible") {
      this.resume();
    }
  };
}
