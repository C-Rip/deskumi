import type { VRM } from "@pixiv/three-vrm";
import { AvatarAuxChannels } from "./AvatarAuxChannels";
import {
  buildAckResponse,
  buildErrorResponse,
  validateAvatarCommand,
  type AvatarCommand,
  type AvatarCommandLimits,
  type AvatarEvent,
  type AvatarEventType,
  type AvatarHelloResponse,
  type AvatarResponse
} from "./AvatarCommand";
import type {
  AvatarControllerOptions,
  DispatchOptions
} from "./AvatarControllerTypes";
import { AvatarMouthChannel } from "./AvatarMouthChannel";
import { AvatarPoseChannel } from "./AvatarPoseChannel";
import type { PowerSaveController } from "./PowerSaveController";

export interface ControllerChannelsBundle {
  mouthChannel: AvatarMouthChannel;
  auxChannels: AvatarAuxChannels;
  poseChannel: AvatarPoseChannel;
}

export function createAvatarChannels(
  options: AvatarControllerOptions,
  powerSaveController: PowerSaveController,
  host: {
    acquireLock: (token: string) => void;
    releaseLock: (token: string) => void;
    nextLockToken: (prefix: string) => string;
    emitEvent: (event: AvatarEvent) => void;
    isDisposed: () => boolean;
  }
): ControllerChannelsBundle {
  const maxQueueSize = Math.max(1, options.maxQueueSize ?? 8);
  const streamTimeoutMs = Math.max(100, options.streamTimeoutMs ?? 5_000);
  return {
    mouthChannel: new AvatarMouthChannel({
      powerSaveController,
      emitEvent: host.emitEvent,
      audioOutput: options.audioOutput,
      lipSyncController: options.lipSyncController,
      speechController: options.speechController,
      maxQueueSize,
      maxStreamBufferBytes: options.maxStreamBufferBytes,
      streamTimeoutMs
    }),
    auxChannels: new AvatarAuxChannels(host, maxQueueSize),
    poseChannel: new AvatarPoseChannel(
      host,
      maxQueueSize,
      options.resolveAnimation
    )
  };
}

export interface CommandExecutionTargets {
  auxChannels: AvatarAuxChannels;
  mouthChannel: AvatarMouthChannel;
  poseChannel: AvatarPoseChannel;
  buildHello: (options: {
    ref?: string;
    scopes: readonly string[];
    subscribedEvents?: readonly AvatarEventType[];
  }) => AvatarHelloResponse;
}

export function validateAndDispatchAvatarCommand(
  rawOrEnvelope: unknown,
  options: DispatchOptions,
  context: {
    isDisposed: boolean;
    vrm: VRM | null;
    limits?: Partial<AvatarCommandLimits>;
    isWindowVisible: boolean;
    availableAnimations?: readonly string[];
  },
  targets: CommandExecutionTargets
): AvatarResponse {
  if (context.isDisposed) {
    return buildErrorResponse("invalid", "AvatarController is disposed");
  }
  const em = context.vrm?.expressionManager as
    { expressionMap?: Record<string, unknown> } | undefined;
  const hasExprMap = Boolean(em && "expressionMap" in em && em.expressionMap);
  const res = validateAvatarCommand(rawOrEnvelope, context.limits, {
    isWindowVisible: context.isWindowVisible,
    grantedScopes: options.grantedScopes,
    availableExpressions: hasExprMap
      ? Object.keys(em!.expressionMap!)
      : undefined,
    availableAnimations: context.availableAnimations
  });
  if (!res.ok) return res.error;
  return routeAvatarCommand(
    targets,
    res.value.cmd,
    options.ownerId ?? "default",
    res.value.id,
    options.grantedScopes ?? []
  );
}

export function routeAvatarCommand(
  targets: CommandExecutionTargets,
  cmd: AvatarCommand,
  ownerId: string,
  ref: string | undefined,
  scopes: readonly string[]
): AvatarResponse {
  switch (cmd.type) {
    case "hello":
      return targets.buildHello({ ref, scopes, subscribedEvents: cmd.events });
    case "lookAt":
      return targets.auxChannels.handleLookAt(cmd, ownerId, ref);
    case "expression":
      return targets.auxChannels.handleExpression(cmd, ownerId, ref);
    case "reaction":
      return targets.auxChannels.handleReaction(cmd, ownerId, ref);
    case "animation":
      return targets.poseChannel.handlePose(cmd, ownerId, ref);
    case "say":
      return targets.mouthChannel.handleSay(cmd, ownerId, ref);
    case "speak":
      return targets.mouthChannel.handleSpeak(cmd, ownerId, ref);
    case "speakStart":
      return targets.mouthChannel.handleSpeakStart(cmd, ownerId, ref);
    case "speakChunk":
      return targets.mouthChannel.handleSpeakChunk(cmd, ownerId, ref);
    case "speakEnd":
      return targets.mouthChannel.handleSpeakEnd(cmd.streamId, ownerId, ref);
    case "speakCancel":
      return targets.mouthChannel.handleSpeakCancel(cmd.streamId, ownerId, ref);
    case "stopSpeaking":
      targets.mouthChannel.handleStopSpeaking(cmd.id);
      return buildAckResponse(ref);
  }
}
