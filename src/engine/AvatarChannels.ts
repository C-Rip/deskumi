import {
  buildAckResponse,
  buildErrorResponse,
  type AvatarResponse,
  type CommandPolicy,
  type MouthVisemeName,
  type ReactionName,
  type SpeakAudioBase64,
  type VisemeKeyframe
} from "./AvatarCommand";

export type AvatarChannel = "lookAt" | "expression" | "mouth" | "pose";

export interface LookAtChannelItem {
  kind: "lookAt";
  ownerId: string;
  x: number;
  y: number;
  durationMs: number;
  elapsedMs: number;
  lockToken: string;
}

export type ExpressionChannelItem =
  | {
      kind: "expression";
      ownerId: string;
      name: string;
      intensity: number;
      durationMs: number | undefined;
      elapsedMs: number;
      lockToken: string | null;
    }
  | {
      kind: "reaction";
      ownerId: string;
      name: ReactionName;
      intensity: number;
      durationMs: number;
      elapsedMs: number;
      lockToken: string;
    };

export type MouthChannelItem =
  | {
      kind: "say";
      ownerId: string;
      id?: string;
      text: string;
      durationMs: number;
      elapsedMs: number;
      lockToken: string;
    }
  | {
      kind: "speak";
      ownerId: string;
      id?: string;
      text?: string;
      audio?: SpeakAudioBase64;
      visemes: VisemeKeyframe[];
      durationMs: number;
      elapsedMs: number;
      lockToken: string;
    }
  | {
      kind: "stream";
      ownerId: string;
      streamId: string;
      id?: string;
      text?: string;
      sampleRate: number;
      channels: 1 | 2;
      format: "pcm_s16le" | "pcm_f32le";
      ended: boolean;
      endAtMs: number;
      idleMs: number;
      elapsedMs: number;
      chunkCursorMs: number;
      visemes: VisemeKeyframe[];
      lockToken: string;
    };

export interface PoseChannelItem {
  kind: "pose";
  ownerId: string;
  vrma: string;
  loop: boolean;
  durationMs: number | undefined;
  fadeInMs: number;
  elapsedMs: number;
  lockToken: string;
  loadToken: number;
  loadSettled: boolean;
  startedPlaying: boolean;
}

export interface ChannelSlot<T> {
  active: T | null;
  queue: T[];
}

export function createChannelSlot<T>(): ChannelSlot<T> {
  return { active: null, queue: [] };
}

export function arbitrateChannel<T>(
  slot: ChannelSlot<T>,
  item: T,
  policy: CommandPolicy,
  maxQueueSize: number,
  channelName: AvatarChannel,
  ref: string | undefined,
  callbacks: {
    onInterruptActive: (prev: T) => void;
    onActivate: (next: T) => void;
    onDropQueued?: (queued: T) => void;
  }
): AvatarResponse {
  if (!slot.active) {
    slot.active = item;
    callbacks.onActivate(item);
    return buildAckResponse(ref);
  }
  if (policy === "drop") {
    return buildErrorResponse("busy", `${channelName} channel is busy`, ref);
  }
  if (policy === "queue") {
    if (slot.queue.length >= maxQueueSize) {
      return buildErrorResponse(
        "busy",
        `${channelName} channel queue is full`,
        ref
      );
    }
    slot.queue.push(item);
    return buildAckResponse(ref);
  }
  callbacks.onInterruptActive(slot.active);
  if (callbacks.onDropQueued) {
    for (const q of slot.queue) callbacks.onDropQueued(q);
  }
  slot.queue.length = 0;
  slot.active = item;
  callbacks.onActivate(item);
  return buildAckResponse(ref);
}

export function clearMouthVisemesMap(
  out: Partial<Record<MouthVisemeName, number>>
): void {
  out.aa = 0;
  out.ih = 0;
  out.ou = 0;
  out.ee = 0;
  out.oh = 0;
}

export function sampleVisemeWeights(
  visemes: readonly VisemeKeyframe[],
  elapsedMs: number,
  out: Partial<Record<MouthVisemeName, number>>
): void {
  clearMouthVisemesMap(out);
  let chosen: VisemeKeyframe | null = null;
  for (let i = 0; i < visemes.length; i++) {
    const kf = visemes[i];
    if (kf.t <= elapsedMs && (chosen === null || kf.t >= chosen.t)) {
      chosen = kf;
    }
  }
  if (chosen && chosen.v !== "neutral") {
    out[chosen.v] = chosen.w ?? 1;
  }
}

export function estimatePcmDurationMs(
  byteLength: number,
  sampleRate: number,
  channels: 1 | 2,
  format: "pcm_s16le" | "pcm_f32le"
): number {
  const bytesPerSample = format === "pcm_f32le" ? 4 : 2;
  const frameCount = byteLength / (bytesPerSample * channels);
  return Math.max(0, (frameCount / sampleRate) * 1000);
}

export function reactionPresetForName(name: ReactionName): string {
  return name === "wink" ? "blinkLeft" : name;
}
