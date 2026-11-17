export const AVATAR_PROTOCOL_VERSION = 1 as const;

export type AvatarErrorCode =
  | "invalid"
  | "rate_limited"
  | "too_large"
  | "forbidden"
  | "busy"
  | "hidden"
  | "unknown_expression"
  | "unknown_animation";

export type CommandPolicy = "interrupt" | "queue" | "drop";

export type MouthVisemeName = "aa" | "ih" | "ou" | "ee" | "oh";
export type VisemeName = MouthVisemeName | "neutral";
export type ReactionName = "happy" | "surprised" | "relaxed" | "wink";
export type ClickRegion = "head" | "body";
export type SpeechEndReason =
  "finished" | "interrupted" | "timeout" | "hidden" | "cancelled";

export type AvatarScope =
  | "avatar:speak"
  | "avatar:interrupt"
  | "avatar:expression"
  | "avatar:animation"
  | "avatar:lookAt"
  | "avatar:events"
  | "desktop:events"
  | "desktop:windowTitle";

export const AVATAR_EVENT_TYPES = [
  "click",
  "speechStart",
  "speechEnd",
  "idleChange",
  "avatarChange",
  "windowFocus"
] as const;

export type AvatarEventType = (typeof AVATAR_EVENT_TYPES)[number];

export interface VisemeKeyframe {
  t: number;
  v: VisemeName;
  w?: number;
}

export interface SpeakAudioBase64 {
  base64: string;
  mime: string;
  sampleRate?: number;
}

export interface HelloCommand {
  type: "hello";
  token?: string;
  clientName?: string;
  clientVersion?: string;
  events?: AvatarEventType[];
}

export interface SpeakCommand {
  type: "speak";
  id?: string;
  text?: string;
  audio?: SpeakAudioBase64;
  visemes?: VisemeKeyframe[];
  durationMs?: number;
  policy?: CommandPolicy;
}

export interface SpeakStartCommand {
  type: "speakStart";
  streamId: string;
  id?: string;
  text?: string;
  sampleRate: number;
  channels?: 1 | 2;
  format?: "pcm_s16le" | "pcm_f32le";
  policy?: CommandPolicy;
}

export interface SpeakChunkCommand {
  type: "speakChunk";
  streamId: string;
  pcm?: Uint8Array | ArrayBuffer;
  pcmBase64?: string;
  visemes?: VisemeKeyframe[];
  sampleRate?: number;
}

export interface SpeakEndCommand {
  type: "speakEnd";
  streamId: string;
}

export interface SpeakCancelCommand {
  type: "speakCancel";
  streamId: string;
}

export interface SayCommand {
  type: "say";
  id?: string;
  text: string;
  durationMs?: number;
  policy?: CommandPolicy;
}

export interface StopSpeakingCommand {
  type: "stopSpeaking";
  id?: string;
}

export interface ExpressionCommand {
  type: "expression";
  name: string;
  intensity?: number;
  durationMs?: number;
  policy?: CommandPolicy;
}

export interface AnimationCommand {
  type: "animation";
  vrma: string;
  loop?: boolean;
  durationMs?: number;
  fadeInMs?: number;
  policy?: CommandPolicy;
}

export interface LookAtCommand {
  type: "lookAt";
  x: number;
  y: number;
  durationMs?: number;
  policy?: CommandPolicy;
}

export interface ReactionCommand {
  type: "reaction";
  name: ReactionName;
  durationMs?: number;
  intensity?: number;
  policy?: CommandPolicy;
}

export type AvatarCommand =
  | HelloCommand
  | SpeakCommand
  | SpeakStartCommand
  | SpeakChunkCommand
  | SpeakEndCommand
  | SpeakCancelCommand
  | SayCommand
  | StopSpeakingCommand
  | ExpressionCommand
  | AnimationCommand
  | LookAtCommand
  | ReactionCommand;

export interface AvatarCommandEnvelope {
  v: 1;
  id?: string;
  cmd: AvatarCommand;
}

export interface AvatarAckResponse {
  v: 1;
  type: "ack";
  ref?: string;
}

export interface AvatarErrorResponse {
  v: 1;
  type: "error";
  ref?: string;
  code: AvatarErrorCode;
  message: string;
}

export interface AvatarCommandLimits {
  maxTextLength: number;
  maxVisemes: number;
  minSampleRate: number;
  maxSampleRate: number;
  maxDurationMs: number;
  maxAudioBytes: number;
  maxStreamIdLength: number;
  maxIdLength: number;
}

export const DEFAULT_AVATAR_COMMAND_LIMITS: Readonly<AvatarCommandLimits> = {
  maxTextLength: 500,
  maxVisemes: 256,
  minSampleRate: 8_000,
  maxSampleRate: 48_000,
  maxDurationMs: 30_000,
  maxAudioBytes: 5 * 1024 * 1024,
  maxStreamIdLength: 128,
  maxIdLength: 128
};

export interface AvatarHelloResponse {
  v: 1;
  type: "hello";
  ref?: string;
  protocolVersion: 1;
  limits: AvatarCommandLimits;
  scopes: string[];
  expressions: string[];
  animations: string[];
  subscribedEvents: AvatarEventType[];
}

export type AvatarResponse =
  AvatarAckResponse | AvatarErrorResponse | AvatarHelloResponse;

export type AvatarEvent =
  | { type: "click"; region: ClickRegion }
  | { type: "speechStart"; id?: string }
  | {
      type: "speechEnd";
      id?: string;
      interrupted: boolean;
      reason: SpeechEndReason;
    }
  | { type: "idleChange"; idle: boolean }
  | { type: "avatarChange"; expressions: string[] }
  | { type: "windowFocus"; appId?: string; title?: string };

export type AvatarEventEnvelope = { v: 1 } & AvatarEvent;

export interface AvatarValidationContext {
  isWindowVisible?: boolean;
  availableExpressions?: readonly string[];
  availableAnimations?: readonly string[];
  grantedScopes?: readonly string[];
}

export type AvatarValidationResult =
  | { ok: true; value: AvatarCommandEnvelope }
  | { ok: false; error: AvatarErrorResponse };

export interface BuildHelloResponseOptions {
  ref?: string;
  limits?: Partial<AvatarCommandLimits>;
  scopes: readonly string[];
  expressions: readonly string[];
  animations: readonly string[];
  subscribedEvents?: readonly AvatarEventType[];
}
