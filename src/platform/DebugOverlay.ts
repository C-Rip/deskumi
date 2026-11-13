import type { Rect } from "./input-region";
import type { LookAtSystem } from "../engine/LookAtSystem";
import type { VRM } from "@pixiv/three-vrm";
import * as THREE from "three";

export interface DebugOverlayOptions {
  container: HTMLElement;
  camera: THREE.Camera;
}

export class DebugOverlay {
  private readonly container: HTMLElement;
  private readonly camera: THREE.Camera;

  private overlayEl: HTMLDivElement | null = null;
  private hitboxCanvas: HTMLCanvasElement | null = null;
  private hitboxCtx: CanvasRenderingContext2D | null = null;
  private sightSvg: SVGSVGElement | null = null;
  private sightLaserLine: SVGLineElement | null = null;
  private sightReticleCircle: SVGCircleElement | null = null;
  private sightReticleRing: SVGCircleElement | null = null;
  private badgeInfo: HTMLDivElement | null = null;

  private isEnabled = false;
  private currentRects: Rect[] | null = null;
  private currentVrm: VRM | null = null;
  private currentLookAt: LookAtSystem | null = null;

  private cursorX = 0;
  private cursorY = 0;
  private hasCursor = false;

  private readonly _tempHeadPos = new THREE.Vector3();
  private readonly _tempProjected = new THREE.Vector3();

  constructor(options: DebugOverlayOptions) {
    this.container = options.container;
    this.camera = options.camera;
  }

  public init(): void {
    if (this.overlayEl) return;

    this.overlayEl = document.createElement("div");
    this.overlayEl.id = "debug-overlay-container";
    this.overlayEl.style.display = "none";

    this.overlayEl.innerHTML = `
      <div class="debug-frame-border"></div>
      <div class="debug-quadrant-v"></div>
      <div class="debug-quadrant-h"></div>
      <canvas class="debug-hitbox-canvas" id="debug-hitbox-canvas"></canvas>
      <svg class="lookat-sight-line" id="debug-sight-svg" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none;">
        <line id="debug-laser-line" x1="0" y1="0" x2="0" y2="0" stroke="#38bdf8" stroke-width="2" stroke-dasharray="4 3" opacity="0.9" />
        <circle id="debug-reticle-circle" cx="0" cy="0" r="5" fill="#38bdf8" opacity="0.95" />
        <circle id="debug-reticle-ring" cx="0" cy="0" r="10" fill="none" stroke="#38bdf8" stroke-width="1.5" opacity="0.7" />
      </svg>
      <div class="debug-badge-info" id="debug-badge-info">DEV OVERLAY</div>
    `;

    this.container.appendChild(this.overlayEl);

    this.hitboxCanvas = this.overlayEl.querySelector<HTMLCanvasElement>(
      "#debug-hitbox-canvas"
    );
    if (this.hitboxCanvas) {
      this.hitboxCtx = this.hitboxCanvas.getContext("2d");
    }

    this.sightSvg =
      this.overlayEl.querySelector<SVGSVGElement>("#debug-sight-svg");
    this.sightLaserLine =
      this.overlayEl.querySelector<SVGLineElement>("#debug-laser-line");
    this.sightReticleCircle = this.overlayEl.querySelector<SVGCircleElement>(
      "#debug-reticle-circle"
    );
    this.sightReticleRing = this.overlayEl.querySelector<SVGCircleElement>(
      "#debug-reticle-ring"
    );
    this.badgeInfo =
      this.overlayEl.querySelector<HTMLDivElement>("#debug-badge-info");

    // Track mouse on window
    window.addEventListener("mousemove", (e: MouseEvent) => {
      this.cursorX = e.clientX;
      this.cursorY = e.clientY;
      this.hasCursor = true;
    });

    window.addEventListener("mouseleave", () => {
      this.hasCursor = false;
    });
  }

  public setCursor(x: number, y: number, inside: boolean): void {
    this.cursorX = x;
    this.cursorY = y;
    this.hasCursor = inside;
  }

  public setEnabled(enabled: boolean): void {
    this.isEnabled = enabled;
    if (this.overlayEl) {
      this.overlayEl.style.display = enabled ? "block" : "none";
    }
  }

  public get enabled(): boolean {
    return this.isEnabled;
  }

  public updateContext(vrm: VRM | null, lookAt: LookAtSystem | null): void {
    this.currentVrm = vrm;
    this.currentLookAt = lookAt;
  }

  public updateHitboxes(rects: Rect[] | null): void {
    this.currentRects = rects;
  }

  public update(): void {
    if (!this.isEnabled || !this.overlayEl) return;

    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;

    // 1. Sync hitbox canvas size
    if (this.hitboxCanvas && this.hitboxCtx) {
      if (this.hitboxCanvas.width !== w || this.hitboxCanvas.height !== h) {
        this.hitboxCanvas.width = w;
        this.hitboxCanvas.height = h;
      }

      this.hitboxCtx.clearRect(0, 0, w, h);

      // Render hitboxes / input region
      if (this.currentRects && this.currentRects.length > 0) {
        this.hitboxCtx.strokeStyle = "rgba(16, 185, 129, 0.85)"; // emerald green
        this.hitboxCtx.fillStyle = "rgba(16, 185, 129, 0.15)";
        this.hitboxCtx.lineWidth = 1.5;

        for (const rect of this.currentRects) {
          this.hitboxCtx.fillRect(rect.x, rect.y, rect.w, rect.h);
          this.hitboxCtx.strokeRect(rect.x, rect.y, rect.w, rect.h);
        }
      }
    }

    // 2. Render LookAt laser ray & reticle
    if (this.currentVrm && this.hasCursor && this.sightLaserLine) {
      const headBone = this.currentVrm.humanoid?.getNormalizedBoneNode("head");
      if (headBone) {
        headBone.getWorldPosition(this._tempHeadPos);
      } else {
        this._tempHeadPos.copy(this.currentVrm.scene.position);
        this._tempHeadPos.y += 1.3;
      }

      // Project head to 2D
      this._tempProjected.copy(this._tempHeadPos).project(this.camera);
      const eyeScreenX = ((this._tempProjected.x + 1) / 2) * w;
      const eyeScreenY = ((-this._tempProjected.y + 1) / 2) * h;

      this.sightLaserLine.setAttribute("x1", String(eyeScreenX));
      this.sightLaserLine.setAttribute("y1", String(eyeScreenY));
      this.sightLaserLine.setAttribute("x2", String(this.cursorX));
      this.sightLaserLine.setAttribute("y2", String(this.cursorY));

      if (this.sightReticleCircle && this.sightReticleRing) {
        this.sightReticleCircle.setAttribute("cx", String(this.cursorX));
        this.sightReticleCircle.setAttribute("cy", String(this.cursorY));
        this.sightReticleRing.setAttribute("cx", String(this.cursorX));
        this.sightReticleRing.setAttribute("cy", String(this.cursorY));
      }

      if (this.sightSvg) {
        this.sightSvg.style.display = "block";
      }
    } else if (this.sightSvg) {
      this.sightSvg.style.display = "none";
    }

    // 3. Update debug badge
    if (this.badgeInfo && this.currentLookAt) {
      const yawDeg = ((this.currentLookAt.lastYaw * 180) / Math.PI).toFixed(1);
      const pitchDeg = ((this.currentLookAt.lastPitch * 180) / Math.PI).toFixed(
        1
      );
      const quadX = this.cursorX > w / 2 ? "DERECHA" : "IZQUIERDA";
      const quadY = this.cursorY > h / 2 ? "ABAJO" : "ARRIBA";
      const hitboxesCount = this.currentRects ? this.currentRects.length : 0;
      this.badgeInfo.textContent = `${w}×${h} | ${quadX}-${quadY} | Yaw: ${yawDeg}° | Pitch: ${pitchDeg}° | Hitboxes: ${hitboxesCount}`;
    }
  }

  public dispose(): void {
    if (this.overlayEl && this.overlayEl.parentElement) {
      this.overlayEl.parentElement.removeChild(this.overlayEl);
    }
    this.overlayEl = null;
  }
}
