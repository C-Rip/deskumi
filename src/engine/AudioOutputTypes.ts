export type AudioContextLifecycleState = "uninitialized" | AudioContextState;

export interface AudioBufferLike {
  readonly sampleRate: number;
  readonly length: number;
  readonly duration: number;
  readonly numberOfChannels: number;
  getChannelData(channel: number): Float32Array;
}

export interface AudioBufferSourceNodeLike {
  buffer: AudioBufferLike | null;
  onended: ((ev: Event) => unknown) | null;
  connect(destinationNode: unknown): unknown;
  disconnect(): void;
  start(when?: number, offset?: number, duration?: number): void;
  stop(when?: number): void;
}

export interface AudioContextLike {
  readonly state: AudioContextState;
  readonly currentTime: number;
  readonly sampleRate: number;
  readonly destination: unknown;
  resume(): Promise<void>;
  suspend(): Promise<void>;
  close(): Promise<void>;
  createBuffer(
    numberOfChannels: number,
    length: number,
    sampleRate: number
  ): AudioBufferLike;
  createBufferSource(): AudioBufferSourceNodeLike;
  decodeAudioData(audioData: ArrayBuffer): Promise<AudioBufferLike>;
}

export type AudioContextFactory = () => AudioContextLike;

export interface AudioOutputOptions {
  /** Injectable AudioContext factory. Defaults to `() => new AudioContext()`. */
  createContext?: AudioContextFactory;
  /** Pre-buffer lead time in seconds for streamed PCM chunks. @default 0.12 */
  preBufferSec?: number;
  /** Inactivity delay before auto-suspending AudioContext. @default 4000 */
  inactivitySuspendMs?: number;
  /** Callback invoked when an open stream drains before new PCM arrives. */
  onUnderrun?: () => void;
  /** Callback invoked when AudioContext state transitions via AudioOutput. */
  onStateChange?: (state: AudioContextLifecycleState) => void;
}

export type PlayEncodedAudioResult =
  | { cancelled: true }
  | {
      cancelled: false;
      startTime: number;
      endTime: number;
      duration: number;
      buffer: AudioBufferLike;
      stop: () => void;
    };

export interface ScheduledPcmResult {
  startTime: number;
  endTime: number;
  duration: number;
  hadUnderrun: boolean;
  stop: () => void;
}

export interface ActiveSourceEntry {
  node: AudioBufferSourceNodeLike;
  onEnded?: () => void;
}
