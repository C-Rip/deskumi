import type { VRM } from "@pixiv/three-vrm";
import type { VRMAnimation } from "@pixiv/three-vrm-animation";
import type { AnimationSystem } from "./AnimationSystem";
import type { AudioOutput } from "./AudioOutput";
import type { AvatarCommandLimits } from "./AvatarCommand";
import type { LipSyncController } from "./LipSyncController";
import type { LookAtSystem } from "./LookAtSystem";
import type { PowerSaveController } from "./PowerSaveController";
import type { ReactionSystem } from "./ReactionSystem";
import type { SpeechController } from "./SpeechController";

export interface AvatarControllerAvatar {
  vrm: VRM;
  animationSystem?: AnimationSystem;
  reactionSystem?: ReactionSystem;
  lookAtSystem?: LookAtSystem;
}

export interface AvatarControllerOptions {
  powerSaveController: PowerSaveController;
  vrm?: VRM;
  animationSystem?: AnimationSystem;
  reactionSystem?: ReactionSystem;
  lookAtSystem?: LookAtSystem;
  limits?: Partial<AvatarCommandLimits>;
  resolveAnimation?: (
    vrmaId: string
  ) => Promise<VRMAnimation | null> | VRMAnimation | null;
  getAvailableAnimations?: () => readonly string[];
  audioOutput?: AudioOutput;
  lipSyncController?: LipSyncController;
  speechController?: SpeechController;
  maxQueueSize?: number;
  maxStreamBufferBytes?: number;
  streamTimeoutMs?: number;
}

export interface DispatchOptions {
  ownerId?: string;
  grantedScopes?: readonly string[];
}
