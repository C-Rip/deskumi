import type { AudioOutput } from "./AudioOutput";
import { clearMouthVisemesMap } from "./AvatarChannels";
import type {
  AvatarCommand,
  AvatarEvent,
  AvatarResponse,
  MouthVisemeName,
  SpeechEndReason
} from "./AvatarCommand";
import type { LipSyncController } from "./LipSyncController";
import type { PowerSaveController, UnlistenFn } from "./PowerSaveController";
import { SpeechController } from "./SpeechController";

export interface AvatarMouthChannelOptions {
  powerSaveController: PowerSaveController;
  emitEvent: (event: AvatarEvent) => void;
  audioOutput?: AudioOutput;
  lipSyncController?: LipSyncController;
  speechController?: SpeechController;
  maxQueueSize?: number;
  maxStreamBufferBytes?: number;
  streamTimeoutMs?: number;
}

export class AvatarMouthChannel {
  public readonly speech: SpeechController;

  private readonly externalVisemes: Partial<Record<MouthVisemeName, number>> =
    {};
  private readonly unlistenSpeechEvent: UnlistenFn | null = null;
  private externalActive = false;
  private hasExternalVisemes = false;

  constructor(options: AvatarMouthChannelOptions) {
    if (options.speechController) {
      this.speech = options.speechController;
      this.unlistenSpeechEvent = this.speech.onEvent(options.emitEvent);
    } else {
      this.speech = new SpeechController({
        powerSaveController: options.powerSaveController,
        audioOutput: options.audioOutput,
        lipSyncController: options.lipSyncController,
        emitEvent: options.emitEvent,
        maxQueueSize: options.maxQueueSize,
        maxStreamBufferBytes: options.maxStreamBufferBytes,
        streamTimeoutMs: options.streamTimeoutMs
      });
    }
  }

  public getState(): {
    busy: boolean;
    queueLength: number;
    ownerId: string | null;
  } {
    return this.speech.getState();
  }

  public get isActive(): boolean {
    return this.externalActive || this.speech.isActive;
  }

  public get visemeWeights(): Partial<Record<MouthVisemeName, number>> {
    if (
      this.externalActive ||
      (!this.speech.isActive && this.hasExternalVisemes)
    ) {
      return this.externalVisemes;
    }
    return this.speech.lipSync.visemeWeights;
  }

  public setVisemes(weights: Partial<Record<MouthVisemeName, number>>): void {
    clearMouthVisemesMap(this.externalVisemes);
    this.hasExternalVisemes = true;
    for (const key of ["aa", "ih", "ou", "ee", "oh"] as const) {
      if (weights[key] !== undefined) this.externalVisemes[key] = weights[key];
    }
  }

  public clearVisemes(): void {
    clearMouthVisemesMap(this.externalVisemes);
    this.hasExternalVisemes = false;
  }

  public setExternalActive(active: boolean): void {
    this.externalActive = active;
  }

  public handleSay(
    cmd: Extract<AvatarCommand, { type: "say" }>,
    ownerId: string,
    ref?: string
  ): AvatarResponse {
    return this.speech.handleSay(cmd, ownerId, ref);
  }

  public handleSpeak(
    cmd: Extract<AvatarCommand, { type: "speak" }>,
    ownerId: string,
    ref?: string
  ): AvatarResponse {
    return this.speech.handleSpeak(cmd, ownerId, ref);
  }

  public handleSpeakStart(
    cmd: Extract<AvatarCommand, { type: "speakStart" }>,
    ownerId: string,
    ref?: string
  ): AvatarResponse {
    return this.speech.handleSpeakStart(cmd, ownerId, ref);
  }

  public handleSpeakChunk(
    cmd: Extract<AvatarCommand, { type: "speakChunk" }>,
    ownerId: string,
    ref?: string
  ): AvatarResponse {
    return this.speech.handleSpeakChunk(cmd, ownerId, ref);
  }

  public handleSpeakEnd(
    streamId: string,
    ownerId: string,
    ref?: string
  ): AvatarResponse {
    return this.speech.handleSpeakEnd(streamId, ownerId, ref);
  }

  public handleSpeakCancel(
    streamId: string,
    ownerId: string,
    ref?: string
  ): AvatarResponse {
    return this.speech.handleSpeakCancel(streamId, ownerId, ref);
  }

  public handleStopSpeaking(id?: string): void {
    this.speech.stopSpeaking(id);
  }

  public step(dtMs: number): void {
    this.speech.step(dtMs);
  }

  public interruptAll(reason: SpeechEndReason): void {
    this.speech.cancelAll(reason);
  }

  public cancelByOwner(ownerId: string): void {
    this.speech.cancelByOwner(ownerId);
  }

  public dispose(): void {
    this.unlistenSpeechEvent?.();
    this.speech.dispose();
  }
}
