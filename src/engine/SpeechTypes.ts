import type { AudioOutput } from "./AudioOutput";
import type {
  AvatarEvent,
  SpeakAudioBase64,
  VisemeKeyframe
} from "./AvatarCommand";
import type { LipSyncController } from "./LipSyncController";
import type { PowerSaveController } from "./PowerSaveController";

export const DEFAULT_MAX_SPEECH_QUEUE = 8;
export const DEFAULT_MAX_STREAM_BUFFER_BYTES = 10 * 1024 * 1024;
export const DEFAULT_STREAM_TIMEOUT_MS = 5_000;
export const DEFAULT_SAY_DURATION_MS = 3_000;

export interface SpeechBubbleState {
  readonly id?: string;
  readonly text: string;
  readonly kind: "say" | "speak" | "stream";
}

export type SpeechBubbleListener = (bubble: SpeechBubbleState | null) => void;

export interface SpeechControllerOptions {
  powerSaveController: PowerSaveController;
  audioOutput?: AudioOutput;
  lipSyncController?: LipSyncController;
  emitEvent?: (event: AvatarEvent) => void;
  onBubbleChange?: SpeechBubbleListener;
  /** Maximum queued utterances behind active speech. @default 8 */
  maxQueueSize?: number;
  /** Maximum buffered PCM bytes per stream. @default 10485760 (10 MB) */
  maxStreamBufferBytes?: number;
  /** Stream inactivity timeout in milliseconds. @default 5000 */
  streamTimeoutMs?: number;
  /** Default duration in ms for `say` when `durationMs` is omitted. @default 3000 */
  defaultSayDurationMs?: number;
}

export interface PendingStreamChunk {
  channelsData?: Float32Array[];
  byteLength: number;
  sampleRate: number;
  visemes?: VisemeKeyframe[];
}

export interface SaySpeechItem {
  kind: "say";
  ownerId: string;
  id?: string;
  text: string;
  durationMs: number;
  elapsedMs: number;
  lockToken: string;
}

export interface SpeakSpeechItem {
  kind: "speak";
  ownerId: string;
  id?: string;
  text?: string;
  audio?: SpeakAudioBase64;
  visemes: VisemeKeyframe[];
  durationMs: number;
  elapsedMs: number;
  usesAudioClock: boolean;
  audioState: "idle" | "decoding" | "playing";
  audioEndTimeSec: number | null;
  playbackToken: number;
  lockToken: string;
}

export interface StreamSpeechItem {
  kind: "stream";
  ownerId: string;
  streamId: string;
  id?: string;
  text?: string;
  sampleRate: number;
  channels: 1 | 2;
  format: "pcm_s16le" | "pcm_f32le";
  ended: boolean;
  idleMs: number;
  elapsedMs: number;
  fallbackEndAtMs: number;
  fallbackChunkCursorMs: number;
  bufferedBytes: number;
  pendingChunks: PendingStreamChunk[];
  visemeCursorSec: number;
  audioEndTimeSec: number;
  activeAudioChunks: number;
  audioReady: boolean;
  hasAudioChunks: boolean;
  playbackToken: number;
  lockToken: string;
}

export type SpeechQueueItem =
  SaySpeechItem | SpeakSpeechItem | StreamSpeechItem;
