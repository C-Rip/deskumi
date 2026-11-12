import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { SceneManager } from "./SceneManager";
import type { System } from "./types";

describe("SceneManager", () => {
  function createMockRenderer(): THREE.WebGLRenderer {
    return {
      domElement: { parentElement: null } as unknown as HTMLCanvasElement,
      render: vi.fn(),
      clear: vi.fn(),
      setSize: vi.fn(),
      setClearColor: vi.fn(),
      setPixelRatio: vi.fn(),
      dispose: vi.fn(),
      outputColorSpace: THREE.SRGBColorSpace
    } as unknown as THREE.WebGLRenderer;
  }

  it("initializes scene, camera, lights and renderer", () => {
    const mockRenderer = createMockRenderer();
    const sm = new SceneManager({
      renderer: mockRenderer,
      fpsCap: 30,
      cameraFov: 50,
      width: 1000,
      height: 500
    });

    expect(sm.scene).toBeInstanceOf(THREE.Scene);
    expect(sm.camera).toBeInstanceOf(THREE.PerspectiveCamera);
    expect(sm.camera.fov).toBe(50);
    expect(sm.camera.aspect).toBe(2);
    expect(sm.hemisphereLight).toBeInstanceOf(THREE.HemisphereLight);
    expect(sm.directionalLight).toBeInstanceOf(THREE.DirectionalLight);
    expect(sm.fpsCap).toBe(30);

    sm.dispose();
  });

  it("registers and unregisters systems", () => {
    const mockRenderer = createMockRenderer();
    const sm = new SceneManager({ renderer: mockRenderer });

    const system1: System = { update: vi.fn(), dispose: vi.fn() };
    const system2: System = { update: vi.fn(), dispose: vi.fn() };

    sm.registerSystem(system1);
    sm.registerSystem(system2);
    // Ignore duplicate register
    sm.registerSystem(system1);

    expect(sm.getSystems()).toEqual([system1, system2]);

    sm.unregisterSystem(system1);
    expect(sm.getSystems()).toEqual([system2]);

    sm.dispose();
  });

  it("updates registered systems and renders during tick when active", () => {
    const mockRenderer = createMockRenderer();
    const sm = new SceneManager({ renderer: mockRenderer, fpsCap: 30 });

    const system: System = { update: vi.fn(), dispose: vi.fn() };
    sm.registerSystem(system);

    // Before starting, tick should not execute
    expect(sm.tick(100)).toBe(false);
    expect(system.update).not.toHaveBeenCalled();

    sm.start();
    expect(sm.active).toBe(true);

    // First tick (initializes clock)
    const firstRendered = sm.tick(100);
    expect(firstRendered).toBe(true);
    expect(system.update).toHaveBeenCalledWith(0);
    expect(mockRenderer.render).toHaveBeenCalledWith(sm.scene, sm.camera);

    // Next tick 10ms later: skipped due to 30 FPS cap (~33.3ms)
    vi.clearAllMocks();
    const skipped = sm.tick(110);
    expect(skipped).toBe(false);
    expect(system.update).not.toHaveBeenCalled();
    expect(mockRenderer.render).not.toHaveBeenCalled();

    // Tick 40ms later: executed
    const rendered = sm.tick(140);
    expect(rendered).toBe(true);
    expect(system.update).toHaveBeenCalledTimes(1);
    expect(mockRenderer.render).toHaveBeenCalledTimes(1);

    sm.dispose();
  });

  it("pauses and resumes ticking", () => {
    const mockRenderer = createMockRenderer();
    const sm = new SceneManager({ renderer: mockRenderer, fpsCap: 30 });
    sm.start();

    sm.tick(0);
    sm.pause();
    expect(sm.isPaused).toBe(true);
    expect(sm.active).toBe(false);

    expect(sm.tick(100)).toBe(false);

    sm.resume();
    expect(sm.isPaused).toBe(false);
    expect(sm.active).toBe(true);

    expect(sm.tick(200)).toBe(true);

    sm.dispose();
  });

  it("updates camera aspect and renderer on resize()", () => {
    const mockRenderer = createMockRenderer();
    const sm = new SceneManager({
      renderer: mockRenderer,
      width: 800,
      height: 600
    });

    sm.resize(1920, 1080);
    expect(sm.camera.aspect).toBeCloseTo(1920 / 1080, 4);
    expect(mockRenderer.setSize).toHaveBeenCalledWith(1920, 1080);

    sm.dispose();
  });

  it("disposes systems and renderer on dispose()", () => {
    const mockRenderer = createMockRenderer();
    const sm = new SceneManager({ renderer: mockRenderer });

    const system: System = { update: vi.fn(), dispose: vi.fn() };
    sm.registerSystem(system);

    sm.start();
    sm.dispose();

    expect(system.dispose).toHaveBeenCalledTimes(1);
    expect(mockRenderer.dispose).toHaveBeenCalledTimes(1);
    expect(sm.getSystems().length).toBe(0);
    expect(sm.active).toBe(false);
  });
});
