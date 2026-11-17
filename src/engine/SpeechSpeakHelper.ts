import type { AudioOutput } from "./AudioOutput";
import type { SpeechEndReason } from "./AvatarCommand";
import type { LipSyncController } from "./LipSyncController";
import { mixChannelsToMono } from "./PcmDecoder";
import type { SpeakSpeechItem } from "./SpeechTypes";

export interface SpeakPlaybackCallbacks {
  isCurrent: () => boolean;
  onFinish: (interrupted: boolean, reason: SpeechEndReason) => void;
}

/**
 * Decodes and schedules encoded `speak.audio` onto `AudioOutput` and `LipSyncController`,
 * checking cancellation tokens across async `resume()` and `decodeAudioData()`.
 */
export async function runEncodedSpeakPlayback(
  item: SpeakSpeechItem,
  audioOutput: AudioOutput,
  lipSync: LipSyncController,
  callbacks: SpeakPlaybackCallbacks
): Promise<void> {
  if (!item.audio) return;
  try {
    const result = await audioOutput.playEncodedAudio(item.audio, {
      shouldCancel: () => !callbacks.isCurrent(),
      onEnded: () => {
        if (callbacks.isCurrent()) callbacks.onFinish(false, "finished");
      }
    });
    if (result.cancelled || !callbacks.isCurrent()) return;

    item.audioState = "playing";
    item.audioEndTimeSec = result.endTime;
    if (item.visemes.length > 0) {
      lipSync.scheduleVisemes(item.visemes, result.startTime, result.duration);
    } else if (result.buffer.length > 0) {
      const ch: Float32Array[] = [];
      for (let c = 0; c < result.buffer.numberOfChannels; c++) {
        ch.push(result.buffer.getChannelData(c));
      }
      lipSync.schedulePcmSamples(
        mixChannelsToMono(ch),
        result.buffer.sampleRate,
        result.startTime
      );
    }
  } catch {
    if (callbacks.isCurrent()) {
      callbacks.onFinish(true, "cancelled");
    }
  }
}

export function stepSpeakItem(
  item: SpeakSpeechItem,
  audioOutput: AudioOutput,
  lipSync: LipSyncController,
  onFinish: (interrupted: boolean, reason: SpeechEndReason) => void
): void {
  if (!item.usesAudioClock) {
    lipSync.evaluateAt(item.elapsedMs / 1000);
    if (item.elapsedMs >= item.durationMs) {
      onFinish(false, "finished");
    }
    return;
  }
  if (item.audioState === "playing") {
    lipSync.update();
    if (
      item.audioEndTimeSec !== null &&
      audioOutput.currentTime >= item.audioEndTimeSec + 0.02
    ) {
      onFinish(false, "finished");
    }
  }
}
