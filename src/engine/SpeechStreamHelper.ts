import type { AudioOutput } from "./AudioOutput";
import type { SpeechEndReason } from "./AvatarCommand";
import { estimatePcmDurationMs } from "./AvatarChannels";
import type { LipSyncController } from "./LipSyncController";
import { mixChannelsToMono } from "./PcmDecoder";
import type { PendingStreamChunk, StreamSpeechItem } from "./SpeechTypes";

export function scheduleChunkOnPlayback(
  stream: StreamSpeechItem,
  chunk: PendingStreamChunk,
  audioOutput: AudioOutput,
  lipSync: LipSyncController,
  onChunkAudioEnded: () => void
): void {
  if (!audioOutput.isSupported) {
    scheduleFallbackChunk(stream, chunk, lipSync);
    stream.bufferedBytes = Math.max(0, stream.bufferedBytes - chunk.byteLength);
    return;
  }

  const frameCount = chunk.channelsData?.[0]?.length ?? 0;
  if (chunk.channelsData && frameCount > 0) {
    stream.hasAudioChunks = true;
    stream.activeAudioChunks++;
    const scheduled = audioOutput.scheduleDecodedPcm(
      chunk.channelsData,
      chunk.sampleRate,
      () => {
        stream.bufferedBytes = Math.max(
          0,
          stream.bufferedBytes - chunk.byteLength
        );
        stream.activeAudioChunks = Math.max(0, stream.activeAudioChunks - 1);
        onChunkAudioEnded();
      }
    );
    stream.audioEndTimeSec = Math.max(
      stream.audioEndTimeSec,
      scheduled.endTime
    );
    stream.visemeCursorSec = scheduled.endTime;

    if (chunk.visemes && chunk.visemes.length > 0) {
      lipSync.scheduleVisemes(
        chunk.visemes,
        scheduled.startTime,
        scheduled.duration
      );
    } else {
      lipSync.schedulePcmSamples(
        mixChannelsToMono(chunk.channelsData),
        chunk.sampleRate,
        scheduled.startTime
      );
    }
    return;
  }

  if (chunk.visemes && chunk.visemes.length > 0) {
    const startSec = Math.max(audioOutput.currentTime, stream.visemeCursorSec);
    const maxVisemeT = chunk.visemes.reduce((m, k) => Math.max(m, k.t), 0);
    const endSec = lipSync.scheduleVisemes(
      chunk.visemes,
      startSec,
      maxVisemeT > 0 ? maxVisemeT / 1000 + 0.08 : 0.08
    );
    stream.visemeCursorSec = endSec;
    stream.audioEndTimeSec = Math.max(stream.audioEndTimeSec, endSec);
  }
}

export function onStreamChunkAudioEnded(
  stream: StreamSpeechItem,
  audioOutput: AudioOutput,
  streamsById: Map<string, StreamSpeechItem>,
  isCurrent: () => boolean,
  onFinished: () => void
): void {
  if (!isCurrent()) return;
  if (
    stream.ended &&
    stream.pendingChunks.length === 0 &&
    stream.activeAudioChunks === 0 &&
    audioOutput.currentTime >= stream.audioEndTimeSec - 1e-4
  ) {
    clearStreamState(stream, streamsById);
    audioOutput.endStream();
    onFinished();
  }
}

export function activateStreamPlayback(
  stream: StreamSpeechItem,
  audioOutput: AudioOutput,
  lipSync: LipSyncController,
  streamsById: Map<string, StreamSpeechItem>,
  isCurrent: () => boolean,
  onFinish: (interrupted: boolean, reason: SpeechEndReason) => void
): void {
  const onChunkAudioEnded = (): void =>
    onStreamChunkAudioEnded(stream, audioOutput, streamsById, isCurrent, () =>
      onFinish(false, "finished")
    );

  const flush = (): void => {
    while (stream.pendingChunks.length > 0) {
      const chunk = stream.pendingChunks.shift()!;
      scheduleChunkOnPlayback(
        stream,
        chunk,
        audioOutput,
        lipSync,
        onChunkAudioEnded
      );
    }
  };

  if (!audioOutput.isSupported || audioOutput.isRunningNow) {
    if (audioOutput.isSupported) {
      audioOutput.startStream();
      stream.audioReady = true;
    }
    flush();
    return;
  }

  audioOutput.startStream();
  void audioOutput
    .ensureRunning()
    .then(() => {
      if (!isCurrent()) return;
      stream.audioReady = true;
      flush();
      if (stream.ended && stream.pendingChunks.length === 0) {
        audioOutput.endStream();
        if (
          stream.activeAudioChunks === 0 &&
          audioOutput.currentTime >= stream.audioEndTimeSec
        ) {
          clearStreamState(stream, streamsById);
          onFinish(false, "finished");
        }
      }
    })
    .catch(() => {
      if (isCurrent()) {
        clearStreamState(stream, streamsById);
        onFinish(true, "cancelled");
      }
    });
}

export function stepStreamPlayback(
  stream: StreamSpeechItem,
  dtMs: number,
  streamTimeoutMs: number,
  audioOutput: AudioOutput,
  lipSync: LipSyncController,
  streamsById: Map<string, StreamSpeechItem>,
  onFinish: (interrupted: boolean, reason: SpeechEndReason) => void
): void {
  if (audioOutput.isSupported && stream.audioReady) {
    audioOutput.checkUnderrun();
    lipSync.update();
  } else if (!audioOutput.isSupported) {
    lipSync.evaluateAt(stream.elapsedMs / 1000);
  }

  if (!stream.ended) {
    stream.idleMs += dtMs;
    if (stream.idleMs >= streamTimeoutMs) {
      clearStreamState(stream, streamsById);
      onFinish(true, "timeout");
    }
    return;
  }

  const doneAudio =
    audioOutput.isSupported &&
    stream.audioReady &&
    stream.pendingChunks.length === 0 &&
    stream.activeAudioChunks === 0 &&
    audioOutput.currentTime >= stream.audioEndTimeSec;
  const doneFallback =
    !audioOutput.isSupported && stream.elapsedMs >= stream.fallbackEndAtMs;

  if (doneAudio || doneFallback) {
    clearStreamState(stream, streamsById);
    onFinish(false, "finished");
  }
}

export function clearStreamState(
  stream: StreamSpeechItem,
  streamsById: Map<string, StreamSpeechItem>
): void {
  streamsById.delete(stream.streamId);
  stream.pendingChunks.length = 0;
  stream.bufferedBytes = 0;
}

function scheduleFallbackChunk(
  stream: StreamSpeechItem,
  chunk: PendingStreamChunk,
  lipSync: LipSyncController
): void {
  const baseMs = Math.max(stream.elapsedMs, stream.fallbackChunkCursorMs);
  const startSec = baseMs / 1000;
  let durMs = 0;
  if (chunk.byteLength > 0) {
    stream.hasAudioChunks = true;
    durMs = estimatePcmDurationMs(
      chunk.byteLength,
      chunk.sampleRate,
      stream.channels,
      stream.format
    );
  }
  const maxVisemeT = chunk.visemes
    ? chunk.visemes.reduce((m, k) => Math.max(m, k.t), 0)
    : 0;
  if (durMs === 0 && maxVisemeT > 0) durMs = maxVisemeT + 80;

  if (chunk.visemes && chunk.visemes.length > 0) {
    lipSync.scheduleVisemes(chunk.visemes, startSec, durMs / 1000);
  } else if (chunk.channelsData && chunk.channelsData[0]?.length > 0) {
    lipSync.schedulePcmSamples(
      mixChannelsToMono(chunk.channelsData),
      chunk.sampleRate,
      startSec
    );
  }
  stream.fallbackChunkCursorMs = baseMs + durMs;
  stream.fallbackEndAtMs = Math.max(
    stream.fallbackEndAtMs,
    stream.fallbackChunkCursorMs
  );
}
