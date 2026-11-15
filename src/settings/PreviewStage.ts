import * as THREE from "three";
import type { VRM } from "@pixiv/three-vrm";
import {
  calcCenteredAvatarY,
  calculatePerspectiveFraming,
  centerAndGroundVRM
} from "../engine/AvatarLoader";
import { LookAtSystem } from "../engine/LookAtSystem";
import { loadAvatarModel } from "../platform/avatar-picker";
import sampleAvatarUrl from "../../assets/avatars/VRM1_Constraint_Twist_Sample.vrm";

export interface PreviewStageConfig {
  avatarPath: string | null;
  avatarScale: number;
  avatarOffsetY: number;
  frameWidth: number;
  frameHeight: number;
  isPoseTesting: boolean;
}

/**
 * Manages the interactive 3D preview viewport inside the Settings window,
 * including Three.js scene/camera/renderer lifecycle, VRM loading, LookAt
 * cursor tracking, and frame-aspect FOV adaptation.
 */
export class PreviewStage {
  private scene: THREE.Scene | null = null;
  private camera: THREE.PerspectiveCamera | null = null;
  private renderer: THREE.WebGLRenderer | null = null;
  private vrm: VRM | null = null;
  private lookAt: LookAtSystem | null = null;
  private blobUrl?: string;
  private rafId: number | null = null;

  private canvas: HTMLCanvasElement | null = null;
  private guideEl: HTMLElement | null = null;
  private guideDimTextEl: HTMLElement | null = null;
  private stageResizeObserver: ResizeObserver | null = null;
  private lastFrameWidth = 400;
  private lastFrameHeight = 600;
  private framingCenterY = 0;
  private currentScale = 1.0;
  private currentOffsetY = 0;

  private readonly headPosTemp = new THREE.Vector3();

  public async init(
    canvas: HTMLCanvasElement | null,
    guideEl: HTMLElement | null,
    guideDimTextEl: HTMLElement | null,
    config: PreviewStageConfig
  ): Promise<void> {
    this.canvas = canvas;
    this.guideEl = guideEl;
    this.guideDimTextEl = guideDimTextEl;

    this.updateGuide(config.frameWidth, config.frameHeight);
    if (!this.canvas || !this.guideEl) {
      return;
    }

    const width = this.guideEl.clientWidth || 213;
    const height = this.guideEl.clientHeight || 320;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
    this.camera.position.set(0, 1.0, 4.0);

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      alpha: true,
      antialias: true
    });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(width, height);

    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 1.2);
    hemiLight.position.set(0, 20, 0);
    this.scene.add(hemiLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
    dirLight.position.set(1, 1, 1).normalize();
    this.scene.add(dirLight);

    await this.loadModel(config);
    this.updateGuide(config.frameWidth, config.frameHeight);

    const stageEl = this.guideEl.parentElement;
    if (stageEl && typeof ResizeObserver !== "undefined") {
      this.stageResizeObserver?.disconnect();
      this.stageResizeObserver = new ResizeObserver(() => {
        this.updateGuide(this.lastFrameWidth, this.lastFrameHeight);
      });
      this.stageResizeObserver.observe(stageEl);
    }

    const renderLoop = () => {
      if (this.renderer && this.scene && this.camera) {
        if (this.lookAt) {
          this.lookAt.update(0.016);
        }
        if (this.vrm) {
          this.vrm.update(0.016);
        }
        this.renderer.render(this.scene, this.camera);
      }
      this.rafId = requestAnimationFrame(renderLoop);
    };
    renderLoop();
  }

  public async loadModel(config: PreviewStageConfig): Promise<void> {
    if (!this.scene || !this.camera) return;

    if (this.lookAt) {
      this.lookAt.dispose();
      this.lookAt = null;
    }
    if (this.vrm) {
      this.scene.remove(this.vrm.scene);
      this.vrm = null;
    }
    if (this.blobUrl) {
      URL.revokeObjectURL(this.blobUrl);
      this.blobUrl = undefined;
    }

    const modelSource = config.avatarPath || sampleAvatarUrl;
    try {
      const { vrm, blobUrl } = await loadAvatarModel(modelSource);
      this.vrm = vrm;
      this.blobUrl = blobUrl;
      this.scene.add(vrm.scene);

      const bounds = centerAndGroundVRM(vrm);
      const framing = calculatePerspectiveFraming(bounds, 45, 1.15);
      this.camera.position.copy(framing.cameraPosition);
      this.camera.lookAt(framing.target);
      this.framingCenterY = framing.target.y;

      this.lookAt = new LookAtSystem(vrm, {
        camera: this.camera,
        targetElement: this.canvas ?? undefined,
        autoAttachListeners: false,
        damping: 10.0,
        maxYaw: (30 * Math.PI) / 180,
        maxPitch: (25 * Math.PI) / 180,
        enableHeadRotation: true
      });

      this.currentScale = config.avatarScale;
      this.currentOffsetY = config.avatarOffsetY;
      vrm.scene.scale.setScalar(this.currentScale);
      vrm.scene.position.x = 0;
      vrm.scene.position.y = calcCenteredAvatarY(
        this.framingCenterY,
        this.currentScale,
        this.currentOffsetY
      );
      this.applyPoseTest(config.isPoseTesting);
    } catch (err) {
      console.warn(
        "[deskumi-settings] Failed to load 3D model in preview, drawing fallback:",
        err
      );
      this.drawFallback(config.avatarScale);
    }
  }

  public updateGuide(frameWidth: number, frameHeight: number): void {
    this.lastFrameWidth = frameWidth;
    this.lastFrameHeight = frameHeight;
    if (!this.guideEl) return;

    const stage = this.guideEl.parentElement;
    const availW =
      stage && stage.clientWidth > 24 ? stage.clientWidth - 12 : 360;
    const availH =
      stage && stage.clientHeight > 24 ? stage.clientHeight - 12 : 300;

    const factor = Math.min(
      availW / Math.max(frameWidth, 1),
      availH / Math.max(frameHeight, 1)
    );
    const guideW = Math.max(24, Math.round(frameWidth * factor));
    const guideH = Math.max(24, Math.round(frameHeight * factor));

    this.guideEl.style.width = `${guideW}px`;
    this.guideEl.style.height = `${guideH}px`;

    if (this.guideDimTextEl) {
      this.guideDimTextEl.textContent = `${frameWidth} × ${frameHeight} px`;
    }

    if (this.renderer && this.camera && this.canvas) {
      this.camera.aspect = guideW / (guideH || 1);

      const baseFov = 45;
      const baseHalfFovRad = ((baseFov / 2) * Math.PI) / 180;
      const visibleHalfHeightWorld = Math.tan(baseHalfFovRad);
      const adaptedHalfFovRad = Math.atan(
        visibleHalfHeightWorld * (frameHeight / 600)
      );
      this.camera.fov = (adaptedHalfFovRad * 2 * 180) / Math.PI;

      this.camera.updateProjectionMatrix();
      this.renderer.setSize(guideW, guideH);
    }
  }

  public setScale(scale: number): void {
    this.currentScale = scale;
    if (this.vrm) {
      this.vrm.scene.scale.setScalar(scale);
      this.vrm.scene.position.y = calcCenteredAvatarY(
        this.framingCenterY,
        this.currentScale,
        this.currentOffsetY
      );
    }
  }

  public setOffsetY(offsetY: number): void {
    this.currentOffsetY = offsetY;
    if (this.vrm) {
      this.vrm.scene.position.x = 0;
      this.vrm.scene.position.y = calcCenteredAvatarY(
        this.framingCenterY,
        this.currentScale,
        this.currentOffsetY
      );
    }
  }

  public applyPoseTest(isTesting: boolean): void {
    if (!this.vrm?.humanoid) return;
    const leftArm = this.vrm.humanoid.getNormalizedBoneNode("leftUpperArm");
    const rightArm = this.vrm.humanoid.getNormalizedBoneNode("rightUpperArm");
    if (leftArm && rightArm) {
      if (isTesting) {
        leftArm.rotation.z = 0;
        rightArm.rotation.z = 0;
      } else {
        leftArm.rotation.z = -1.2;
        rightArm.rotation.z = 1.2;
      }
    }
  }

  public setCursorNdc(ndcX: number, ndcY: number): void {
    if (this.lookAt) {
      this.lookAt.setCursorNdc(ndcX, ndcY);
    }
  }

  public setMouseOutside(outside: boolean): void {
    if (this.lookAt) {
      this.lookAt.setMouseOutside(outside);
    }
  }

  public projectHeadToCanvas(
    rectWidth: number,
    rectHeight: number
  ): { x: number; y: number } | null {
    if (!this.vrm || !this.camera || rectWidth <= 0 || rectHeight <= 0) {
      return null;
    }

    const headBone = this.vrm.humanoid?.getNormalizedBoneNode("head");
    if (headBone) {
      headBone.getWorldPosition(this.headPosTemp);
    } else {
      this.headPosTemp.copy(this.vrm.scene.position);
      this.headPosTemp.y += 1.3;
    }

    const headNdc = this.headPosTemp.project(this.camera);
    return {
      x: ((headNdc.x + 1) / 2) * rectWidth,
      y: ((-headNdc.y + 1) / 2) * rectHeight
    };
  }

  public dispose(): void {
    if (this.stageResizeObserver) {
      this.stageResizeObserver.disconnect();
      this.stageResizeObserver = null;
    }
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this.lookAt) {
      this.lookAt.dispose();
      this.lookAt = null;
    }
    if (this.blobUrl) {
      URL.revokeObjectURL(this.blobUrl);
      this.blobUrl = undefined;
    }
    if (this.renderer) {
      this.renderer.dispose();
      this.renderer = null;
    }
  }

  private drawFallback(avatarScale: number): void {
    if (!this.canvas) return;
    const ctx = this.canvas.getContext("2d");
    if (!ctx) return;

    const w = (this.canvas.width = this.canvas.clientWidth);
    const h = (this.canvas.height = this.canvas.clientHeight);

    ctx.clearRect(0, 0, w, h);
    const centerX = w / 2;
    const centerY = h / 2 + 10;
    const scale = avatarScale * 0.9;

    ctx.save();
    ctx.translate(centerX, centerY);
    ctx.scale(scale, scale);

    ctx.beginPath();
    ctx.ellipse(0, 85, 35, 8, 0, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(0, 0, 0, 0.4)";
    ctx.fill();

    ctx.fillStyle = "#14b8a6";
    ctx.beginPath();
    ctx.ellipse(-38, -10, 16, 50, -0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(38, -10, 16, 50, 0.2, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    ctx.arc(0, -35, 24, 0, Math.PI * 2);
    ctx.fillStyle = "#fef08a";
    ctx.fill();

    ctx.restore();
  }
}
