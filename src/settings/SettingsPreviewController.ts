import type { AppConfig } from "../platform/store";
import { PreviewStage, type PreviewStageConfig } from "./PreviewStage";

export interface SettingsPreviewControllerOptions {
  onShowToast: (message: string) => void;
  onOffsetYChange: (offsetY: number) => void;
  onOffsetYCommit: (offsetY: number) => void;
}

/**
 * Coordinates the Settings live preview pane: frame guide overlays, quadrant lines,
 * LookAt SVG sightline reticle, pose testing, and vertical offset drag interactions.
 */
export class SettingsPreviewController {
  private readonly previewStage = new PreviewStage();
  private readonly options: SettingsPreviewControllerOptions;

  private previewGuide: HTMLElement | null = null;
  private previewGuideDimText: HTMLElement | null = null;
  private previewCanvas: HTMLCanvasElement | null = null;
  private guidesToggleBtn: HTMLButtonElement | null = null;
  private sightSvgEl: SVGSVGElement | null = null;
  private sightLineEl: SVGLineElement | null = null;
  private sightReticleCircleEl: SVGCircleElement | null = null;
  private sightReticleRingEl: SVGCircleElement | null = null;
  private guideLineVEl: HTMLElement | null = null;
  private guideLineHEl: HTMLElement | null = null;

  private showGuides = true;
  private isPoseTesting = false;
  private isPreviewDragging = false;
  private previewDragStartY = 0;
  private initialOffsetY = 0;
  private offsetDebounceTimeout: ReturnType<typeof setTimeout> | null = null;
  private windowMouseMoveHandler: ((e: MouseEvent) => void) | null = null;
  private windowMouseUpHandler: (() => void) | null = null;

  constructor(options: SettingsPreviewControllerOptions) {
    this.options = options;
  }

  public mount(
    container: HTMLElement,
    config: AppConfig,
    getOffsetY: () => number
  ): void {
    this.detachWindowListeners();

    this.previewGuide = container.querySelector("#preview-guide");
    this.previewGuideDimText = container.querySelector("#preview-dim-text");
    this.previewCanvas = container.querySelector("#preview-canvas");
    this.sightSvgEl = container.querySelector("#guide-sight-svg");
    this.sightLineEl = container.querySelector("#sight-laser-line");
    this.sightReticleCircleEl = container.querySelector(
      "#sight-reticle-circle"
    );
    this.sightReticleRingEl = container.querySelector("#sight-reticle-ring");
    this.guideLineVEl = container.querySelector("#guide-line-v");
    this.guideLineHEl = container.querySelector("#guide-line-h");
    this.guidesToggleBtn =
      container.querySelector<HTMLButtonElement>("#btn-toggle-guides");

    this.bindGuidesButton();
    this.bindPoseTestButton(
      container.querySelector<HTMLButtonElement>("#btn-pose-test")
    );
    this.bindPreviewCanvasEvents(getOffsetY);

    this.updateGuide(config);
    void this.previewStage.init(
      this.previewCanvas,
      this.previewGuide,
      this.previewGuideDimText,
      this.toStageConfig(config)
    );
  }

  public async loadModel(config: AppConfig): Promise<void> {
    await this.previewStage.loadModel(this.toStageConfig(config));
  }

  public setScale(scale: number): void {
    this.previewStage.setScale(scale);
  }

  public updateGuide(config: AppConfig): void {
    this.previewStage.updateGuide(
      config.frameWidth ?? 400,
      config.frameHeight ?? 600
    );
  }

  public dispose(): void {
    this.detachWindowListeners();
    if (this.offsetDebounceTimeout !== null) {
      clearTimeout(this.offsetDebounceTimeout);
      this.offsetDebounceTimeout = null;
    }
    this.previewStage.dispose();
  }

  private toStageConfig(config: AppConfig): PreviewStageConfig {
    return {
      avatarPath: config.avatarPath ?? null,
      avatarScale: config.avatarScale ?? 1.0,
      avatarOffsetY: config.avatarOffsetY ?? 0,
      frameWidth: config.frameWidth ?? 400,
      frameHeight: config.frameHeight ?? 600,
      isPoseTesting: this.isPoseTesting
    };
  }

  private bindGuidesButton(): void {
    if (!this.guidesToggleBtn) return;
    this.guidesToggleBtn.addEventListener("click", () => {
      this.showGuides = !this.showGuides;
      if (this.guidesToggleBtn) {
        this.guidesToggleBtn.textContent = this.showGuides
          ? "Guías ON"
          : "Guías OFF";
        this.guidesToggleBtn.classList.toggle("active", this.showGuides);
      }
      if (this.previewGuide) {
        this.previewGuide.style.display = this.showGuides ? "flex" : "none";
      }
      if (this.guideLineVEl) {
        this.guideLineVEl.style.display = this.showGuides ? "block" : "none";
      }
      if (this.guideLineHEl) {
        this.guideLineHEl.style.display = this.showGuides ? "block" : "none";
      }
      if (this.sightSvgEl && !this.showGuides) {
        this.sightSvgEl.style.display = "none";
      }
    });
  }

  private bindPoseTestButton(poseTestBtn: HTMLButtonElement | null): void {
    if (!poseTestBtn) return;
    poseTestBtn.addEventListener("click", () => {
      this.isPoseTesting = !this.isPoseTesting;
      poseTestBtn.classList.toggle("active", this.isPoseTesting);
      this.previewStage.applyPoseTest(this.isPoseTesting);
      this.options.onShowToast(
        this.isPoseTesting
          ? "Pose Test (Brazos extendidos)"
          : "Pose Test OFF (Reposo)"
      );
    });
  }

  private bindPreviewCanvasEvents(getOffsetY: () => number): void {
    const canvas = this.previewCanvas;
    if (!canvas) return;

    canvas.style.cursor = "ns-resize";
    canvas.addEventListener("mousedown", (e: MouseEvent) => {
      if (e.button !== 0) return;
      this.isPreviewDragging = true;
      this.previewDragStartY = e.clientY;
      this.initialOffsetY = getOffsetY();
      if (this.previewCanvas) {
        this.previewCanvas.style.cursor = "ns-resize";
      }
    });

    if (typeof window !== "undefined") {
      this.windowMouseMoveHandler = (e: MouseEvent) => {
        if (!this.isPreviewDragging) return;
        const dy = e.clientY - this.previewDragStartY;
        const newOffsetY = this.initialOffsetY - dy * 0.005;

        this.previewStage.setOffsetY(newOffsetY);
        this.options.onOffsetYChange(newOffsetY);

        if (this.offsetDebounceTimeout !== null) {
          clearTimeout(this.offsetDebounceTimeout);
        }
        this.offsetDebounceTimeout = setTimeout(() => {
          this.options.onOffsetYCommit(newOffsetY);
        }, 200);
      };

      this.windowMouseUpHandler = () => {
        if (this.isPreviewDragging) {
          this.isPreviewDragging = false;
          if (this.previewCanvas) {
            this.previewCanvas.style.cursor = "ns-resize";
          }
        }
      };

      window.addEventListener("mousemove", this.windowMouseMoveHandler);
      window.addEventListener("mouseup", this.windowMouseUpHandler);
    }

    canvas.addEventListener("mousemove", (e: MouseEvent) => {
      this.handleCanvasHover(e);
    });

    canvas.addEventListener("mouseleave", () => {
      this.previewStage.setMouseOutside(true);
      if (this.sightSvgEl) {
        this.sightSvgEl.style.display = "none";
      }
    });
  }

  private handleCanvasHover(e: MouseEvent): void {
    if (this.isPreviewDragging || !this.showGuides || !this.previewCanvas) {
      return;
    }

    const rect = this.previewCanvas.getBoundingClientRect();
    const mouseCanvasX = e.clientX - rect.left;
    const mouseCanvasY = e.clientY - rect.top;

    if (rect.width > 0 && rect.height > 0) {
      const ndcX = (mouseCanvasX / rect.width) * 2 - 1;
      const ndcY = -(mouseCanvasY / rect.height) * 2 + 1;
      this.previewStage.setCursorNdc(ndcX, ndcY);
    }

    if (this.sightSvgEl) {
      this.sightSvgEl.style.display = "block";
    }
    if (this.sightReticleCircleEl && this.sightReticleRingEl) {
      this.sightReticleCircleEl.setAttribute("cx", String(mouseCanvasX));
      this.sightReticleCircleEl.setAttribute("cy", String(mouseCanvasY));
      this.sightReticleRingEl.setAttribute("cx", String(mouseCanvasX));
      this.sightReticleRingEl.setAttribute("cy", String(mouseCanvasY));
    }

    if (this.sightLineEl) {
      const headCanvas = this.previewStage.projectHeadToCanvas(
        rect.width,
        rect.height
      );
      if (headCanvas) {
        this.sightLineEl.setAttribute("x1", String(headCanvas.x));
        this.sightLineEl.setAttribute("y1", String(headCanvas.y));
        this.sightLineEl.setAttribute("x2", String(mouseCanvasX));
        this.sightLineEl.setAttribute("y2", String(mouseCanvasY));
      }
    }
  }

  private detachWindowListeners(): void {
    if (typeof window === "undefined") return;
    if (this.windowMouseMoveHandler) {
      window.removeEventListener("mousemove", this.windowMouseMoveHandler);
      this.windowMouseMoveHandler = null;
    }
    if (this.windowMouseUpHandler) {
      window.removeEventListener("mouseup", this.windowMouseUpHandler);
      this.windowMouseUpHandler = null;
    }
  }
}
