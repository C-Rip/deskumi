import type * as THREE from "three";
import type { VRMAnimation } from "@pixiv/three-vrm-animation";
import {
  loadVRMA,
  type VRMAPlayer,
  type VRMAPlayOptions
} from "../../engine/VRMAPlayer";
import {
  listRegisteredAnimations,
  readRegisteredAnimationBytes,
  type RegisteredAnimation
} from "../ipc";

export interface RegisteredAnimationResolverOptions {
  listAnimations?: () => Promise<RegisteredAnimation[]>;
  readAnimationBytes?: (id: string) => Promise<Uint8Array>;
  parseVrma?: (buffer: ArrayBuffer) => Promise<VRMAnimation>;
  initialAnimations?: readonly RegisteredAnimation[];
  cacheParsed?: boolean;
}

/**
 * Bridges logical `.vrma` animation IDs from the Rust registry to `AvatarController`
 * and `VRMAPlayer` without exposing disk paths to plugins or external clients.
 */
export class RegisteredAnimationResolver {
  private readonly listAnimations: () => Promise<RegisteredAnimation[]>;
  private readonly readAnimationBytes: (id: string) => Promise<Uint8Array>;
  private readonly parseVrma: (buffer: ArrayBuffer) => Promise<VRMAnimation>;
  private readonly cacheParsed: boolean;

  private readonly animationsById = new Map<string, RegisteredAnimation>();
  private readonly cache = new Map<string, VRMAnimation>();
  private readonly inFlight = new Map<string, Promise<VRMAnimation | null>>();

  constructor(options: RegisteredAnimationResolverOptions = {}) {
    this.listAnimations = options.listAnimations ?? listRegisteredAnimations;
    this.readAnimationBytes =
      options.readAnimationBytes ?? readRegisteredAnimationBytes;
    this.parseVrma = options.parseVrma ?? ((buffer) => loadVRMA(buffer));
    this.cacheParsed = options.cacheParsed ?? true;
    if (options.initialAnimations) {
      this.setAnimations(options.initialAnimations);
    }
  }

  public async refresh(): Promise<RegisteredAnimation[]> {
    const items = await this.listAnimations();
    this.setAnimations(items);
    return this.list();
  }

  public setAnimations(items: readonly RegisteredAnimation[]): void {
    const nextIds = new Set<string>();
    this.animationsById.clear();
    for (const item of items) {
      this.animationsById.set(item.id, { ...item });
      nextIds.add(item.id);
    }
    for (const cachedId of this.cache.keys()) {
      if (!nextIds.has(cachedId)) {
        this.cache.delete(cachedId);
      }
    }
  }

  public invalidate(id?: string): void {
    if (id !== undefined) {
      this.cache.delete(id);
      this.inFlight.delete(id);
      return;
    }
    this.cache.clear();
    this.inFlight.clear();
  }

  public has(id: string): boolean {
    return this.animationsById.has(id);
  }

  public list(): RegisteredAnimation[] {
    return Array.from(this.animationsById.values(), (item) => ({ ...item }));
  }

  public getAvailableIds(): string[] {
    return Array.from(this.animationsById.keys());
  }

  public async resolve(id: string): Promise<VRMAnimation | null> {
    if (!this.animationsById.has(id)) {
      return null;
    }
    if (this.cacheParsed) {
      const cached = this.cache.get(id);
      if (cached) {
        return cached;
      }
    }
    const existingPromise = this.inFlight.get(id);
    if (existingPromise) {
      return await existingPromise;
    }

    const loadPromise = this.loadAndParse(id).finally(() => {
      this.inFlight.delete(id);
    });
    this.inFlight.set(id, loadPromise);
    return await loadPromise;
  }

  public async playOn(
    vrmaPlayer: VRMAPlayer,
    id: string,
    options?: VRMAPlayOptions
  ): Promise<THREE.AnimationAction | null> {
    const vrmAnimation = await this.resolve(id);
    if (!vrmAnimation || vrmaPlayer.disposed) {
      return null;
    }
    return vrmaPlayer.play(vrmAnimation, options);
  }

  public dispose(): void {
    this.animationsById.clear();
    this.cache.clear();
    this.inFlight.clear();
  }

  private async loadAndParse(id: string): Promise<VRMAnimation | null> {
    if (!this.animationsById.has(id)) {
      return null;
    }
    const bytes = await this.readAnimationBytes(id);
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    const parsed = await this.parseVrma(copy.buffer);
    if (this.cacheParsed && this.animationsById.has(id)) {
      this.cache.set(id, parsed);
    }
    return parsed;
  }
}
