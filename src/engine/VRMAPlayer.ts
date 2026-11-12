import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { VRM } from "@pixiv/three-vrm";
import {
  VRMAnimationLoaderPlugin,
  createVRMAnimationClip,
  type VRMAnimation
} from "@pixiv/three-vrm-animation";
import { isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";

/**
 * Options for loading a VRM Animation (.vrma) file.
 */
export interface VRMALoadOptions {
  /** Optional loading progress callback */
  onProgress?: (event: ProgressEvent<EventTarget>) => void;
  /** Optional custom Three.js LoadingManager */
  loadingManager?: THREE.LoadingManager;
}

/**
 * Options for playing a VRMAnimation clip on the avatar.
 */
export interface VRMAPlayOptions {
  /**
   * Whether the animation should loop indefinitely or play once (`LoopOnce`).
   * @default true
   */
  loop?: boolean;

  /**
   * Crossfade-in duration in seconds.
   * @default 0.25
   */
  fadeInDuration?: number;

  /**
   * Playback speed multiplier.
   * @default 1.0
   */
  timeScale?: number;
}

/**
 * Loads a VRMAnimation (.vrma) from a URL string or an ArrayBuffer using
 * `GLTFLoader` registered with `VRMAnimationLoaderPlugin`.
 *
 * @param source URL string or ArrayBuffer containing `.vrma` data.
 * @param options Optional loading configuration.
 * @returns The first parsed `VRMAnimation` in the file.
 */
export async function loadVRMA(
  source: string | ArrayBuffer,
  options: VRMALoadOptions = {}
): Promise<VRMAnimation> {
  const loader = new GLTFLoader(options.loadingManager);
  loader.register((parser) => new VRMAnimationLoaderPlugin(parser));

  const gltf =
    typeof source === "string"
      ? await loader.loadAsync(source, options.onProgress)
      : await loader.parseAsync(source, "");

  const vrmAnimations = gltf.userData.vrmAnimations as
    VRMAnimation[] | undefined;
  const firstAnimation = vrmAnimations?.[0];

  if (!firstAnimation) {
    throw new Error(
      typeof source === "string"
        ? `Not a valid VRMA file: ${source}`
        : "Not a valid VRMA file: GLTF does not contain VRMAnimation data"
    );
  }

  return firstAnimation;
}

/**
 * Loads a `.vrma` file from a local binary file path or URL, converting local
 * files in the Tauri runtime to an in-memory Blob URL for GLTFLoader compatibility.
 */
export async function loadVRMAFromPathOrUrl(
  pathOrUrl: string,
  options: VRMALoadOptions = {}
): Promise<{ vrmAnimation: VRMAnimation; blobUrl?: string }> {
  if (
    isTauri() &&
    !pathOrUrl.startsWith("http") &&
    !pathOrUrl.startsWith("blob:") &&
    !pathOrUrl.startsWith("data:")
  ) {
    const bytes = await readFile(pathOrUrl);
    const blob = new Blob([bytes], { type: "application/octet-stream" });
    const blobUrl = URL.createObjectURL(blob);
    try {
      const vrmAnimation = await loadVRMA(blobUrl, options);
      return { vrmAnimation, blobUrl };
    } finally {
      URL.revokeObjectURL(blobUrl);
    }
  }

  const vrmAnimation = await loadVRMA(pathOrUrl, options);
  return { vrmAnimation };
}

/**
 * Opens native file dialog for selecting a `.vrma` animation file.
 */
export async function pickVRMAFile(): Promise<string | null> {
  if (!isTauri()) {
    console.warn("[deskumi] pickVRMAFile is only available in Tauri runtime");
    return null;
  }

  const selected = await open({
    multiple: false,
    directory: false,
    filters: [
      {
        name: "VRM Animation",
        extensions: ["vrma"]
      }
    ]
  });

  if (typeof selected === "string") {
    return selected;
  }
  return null;
}

/**
 * VRMAPlayer manages a `THREE.AnimationMixer` bound to a VRM's scene to play,
 * crossfade (`fadeIn` / `fadeOut`), loop or play one-shot `.vrma` clips, and
 * cleanly stop to return control back to procedural idle motion.
 */
export class VRMAPlayer {
  public readonly vrm: VRM;
  public readonly mixer: THREE.AnimationMixer;

  private currentAction: THREE.AnimationAction | null = null;
  private currentClip: THREE.AnimationClip | null = null;
  private currentAnimation: VRMAnimation | null = null;
  private fadeOutRemaining = 0;
  private isDisposed = false;

  private readonly onFinishedListener: (event: {
    action: THREE.AnimationAction;
  }) => void;

  constructor(vrm: VRM, mixer?: THREE.AnimationMixer) {
    this.vrm = vrm;
    this.mixer = mixer ?? new THREE.AnimationMixer(vrm.scene);

    this.onFinishedListener = (event) => {
      if (event.action === this.currentAction) {
        this.clearCurrentAction();
      }
    };
    this.mixer.addEventListener("finished", this.onFinishedListener);
  }

  /**
   * Whether a `.vrma` animation clip is currently active (playing or fading out).
   */
  public get isPlaying(): boolean {
    return (
      !this.isDisposed &&
      this.currentAction !== null &&
      this.currentAction.isRunning()
    );
  }

  /**
   * Currently active `THREE.AnimationAction`, if any.
   */
  public get activeAction(): THREE.AnimationAction | null {
    return this.currentAction;
  }

  /**
   * Currently active `VRMAnimation`, if any.
   */
  public get activeAnimation(): VRMAnimation | null {
    return this.currentAnimation;
  }

  /**
   * Whether this player has been disposed.
   */
  public get disposed(): boolean {
    return this.isDisposed;
  }

  /**
   * Creates an `AnimationClip` for `this.vrm` from the given `VRMAnimation` and
   * plays it on the mixer with optional crossfading and loop mode.
   */
  public play(
    vrmAnimation: VRMAnimation,
    options: VRMAPlayOptions = {}
  ): THREE.AnimationAction {
    const clip = createVRMAnimationClip(vrmAnimation, this.vrm);
    this.currentAnimation = vrmAnimation;
    return this.playClip(clip, options);
  }

  /**
   * Plays a pre-built `THREE.AnimationClip` on the mixer with smooth crossfading.
   */
  public playClip(
    clip: THREE.AnimationClip,
    options: VRMAPlayOptions = {}
  ): THREE.AnimationAction {
    if (this.isDisposed) {
      throw new Error("Cannot play animation on a disposed VRMAPlayer");
    }

    const { loop = true, fadeInDuration = 0.25, timeScale = 1.0 } = options;

    const prevAction = this.currentAction;
    const prevClip = this.currentClip;

    this.fadeOutRemaining = 0;

    // If re-playing the exact same clip instance, stop and uncache it first
    if (prevAction && prevClip === clip) {
      prevAction.stop();
      this.mixer.uncacheAction(prevClip, this.vrm.scene);
    }

    const nextAction = this.mixer.clipAction(clip);
    nextAction.reset();
    nextAction.timeScale = timeScale;

    if (loop) {
      nextAction.setLoop(THREE.LoopRepeat, Infinity);
      nextAction.clampWhenFinished = false;
    } else {
      nextAction.setLoop(THREE.LoopOnce, 1);
      nextAction.clampWhenFinished = true;
    }

    if (prevAction && prevAction !== nextAction && prevAction.isRunning()) {
      if (fadeInDuration > 0) {
        prevAction.fadeOut(fadeInDuration);
        nextAction.fadeIn(fadeInDuration);
      } else {
        prevAction.stop();
      }
    } else if (fadeInDuration > 0) {
      nextAction.fadeIn(fadeInDuration);
    }

    nextAction.play();

    this.currentAction = nextAction;
    this.currentClip = clip;

    return nextAction;
  }

  /**
   * Loads a `.vrma` file from a local path or URL and plays it on the VRM.
   */
  public async loadAndPlay(
    pathOrUrl: string,
    options: VRMAPlayOptions = {}
  ): Promise<THREE.AnimationAction> {
    const { vrmAnimation } = await loadVRMAFromPathOrUrl(pathOrUrl);
    return this.play(vrmAnimation, options);
  }

  /**
   * Stops the currently playing `.vrma` animation.
   *
   * @param fadeOutDuration Optional fade-out duration in seconds (default 0 = immediate stop).
   */
  public stop(fadeOutDuration = 0): void {
    if (this.isDisposed || !this.currentAction) {
      return;
    }

    if (fadeOutDuration > 0 && this.currentAction.isRunning()) {
      this.currentAction.fadeOut(fadeOutDuration);
      this.fadeOutRemaining = fadeOutDuration;
    } else {
      this.clearCurrentAction();
    }
  }

  /**
   * Advances the internal `THREE.AnimationMixer` by `dt` seconds.
   */
  public update(dt: number): void {
    if (this.isDisposed || dt <= 0 || !this.currentAction) {
      return;
    }

    this.mixer.update(dt);

    if (this.fadeOutRemaining > 0) {
      this.fadeOutRemaining -= dt;
      if (this.fadeOutRemaining <= 0) {
        this.clearCurrentAction();
      }
    }
  }

  /**
   * Stops all actions, removes event listeners, and releases mixer cache.
   */
  public dispose(): void {
    if (this.isDisposed) {
      return;
    }
    this.isDisposed = true;
    this.clearCurrentAction();
    this.mixer.removeEventListener("finished", this.onFinishedListener);
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.vrm.scene);
  }

  private clearCurrentAction(): void {
    this.fadeOutRemaining = 0;
    if (this.currentAction) {
      this.currentAction.stop();
    }
    if (this.currentClip) {
      this.mixer.uncacheAction(this.currentClip, this.vrm.scene);
      this.mixer.uncacheClip(this.currentClip);
    }
    this.currentAction = null;
    this.currentClip = null;
    this.currentAnimation = null;
  }
}
