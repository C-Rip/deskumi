import type { AudioOutput } from "./AudioOutput";
import {
  buildAckResponse,
  buildErrorResponse,
  type AvatarCommand,
  type AvatarResponse
} from "./AvatarCommand";
import type { LipSyncController } from "./LipSyncController";
import { decodeBase64ToBytes, decodePcmToFloat32Channels } from "./PcmDecoder";
import {
  clearStreamState,
  onStreamChunkAudioEnded,
  scheduleChunkOnPlayback
} from "./SpeechStreamHelper";
import type {
  PendingStreamChunk,
  SaySpeechItem,
  SpeakSpeechItem,
  SpeechQueueItem,
  StreamSpeechItem
} from "./SpeechTypes";

export function createSayItem(
  cmd: Extract<AvatarCommand, { type: "say" }>,
  ownerId: string,
  defaultDurationMs: number,
  lockToken: string
): SaySpeechItem {
  return {
    kind: "say",
    ownerId,
    id: cmd.id,
    text: cmd.text,
    durationMs: cmd.durationMs ?? defaultDurationMs,
    elapsedMs: 0,
    lockToken
  };
}

export function createSpeakItem(
  cmd: Extract<AvatarCommand, { type: "speak" }>,
  ownerId: string,
  lockToken: string
): SpeakSpeechItem {
  const visemes = cmd.visemes ?? [];
  const lastT = visemes.reduce((m, k) => Math.max(m, k.t), 0);
  return {
    kind: "speak",
    ownerId,
    id: cmd.id,
    text: cmd.text,
    audio: cmd.audio,
    visemes: [...visemes],
    durationMs: cmd.durationMs ?? (visemes.length > 0 ? lastT + 200 : 3_000),
    elapsedMs: 0,
    usesAudioClock: Boolean(cmd.audio),
    audioState: "idle",
    audioEndTimeSec: null,
    playbackToken: 0,
    lockToken
  };
}

export function createStreamItem(
  cmd: Extract<AvatarCommand, { type: "speakStart" }>,
  ownerId: string,
  lockToken: string
): StreamSpeechItem {
  return {
    kind: "stream",
    ownerId,
    streamId: cmd.streamId,
    id: cmd.id,
    text: cmd.text,
    sampleRate: cmd.sampleRate,
    channels: cmd.channels ?? 1,
    format: cmd.format ?? "pcm_s16le",
    ended: false,
    idleMs: 0,
    elapsedMs: 0,
    fallbackEndAtMs: 0,
    fallbackChunkCursorMs: 0,
    bufferedBytes: 0,
    pendingChunks: [],
    visemeCursorSec: 0,
    audioEndTimeSec: 0,
    activeAudioChunks: 0,
    audioReady: false,
    hasAudioChunks: false,
    playbackToken: 0,
    lockToken
  };
}

export function requireOwnedStream(
  streamsById: Map<string, StreamSpeechItem>,
  streamId: string,
  ownerId: string,
  ref?: string
):
  | { ok: true; stream: StreamSpeechItem }
  | { ok: false; error: AvatarResponse } {
  const stream = streamsById.get(streamId);
  if (!stream) {
    return {
      ok: false,
      error: buildErrorResponse("invalid", `Unknown streamId: ${streamId}`, ref)
    };
  }
  if (stream.ownerId !== ownerId) {
    return {
      ok: false,
      error: buildErrorResponse(
        "forbidden",
        "Stream owned by another client",
        ref
      )
    };
  }
  return { ok: true, stream };
}

export function decodeStreamChunk(
  cmd: Extract<AvatarCommand, { type: "speakChunk" }>,
  stream: StreamSpeechItem,
  maxStreamBufferBytes: number,
  ref?: string
):
  | { ok: true; chunk: PendingStreamChunk }
  | { ok: false; error: AvatarResponse } {
  let pcmBytes: Uint8Array | undefined;
  if (cmd.pcm !== undefined) {
    pcmBytes =
      cmd.pcm instanceof Uint8Array ? cmd.pcm : new Uint8Array(cmd.pcm);
  } else if (cmd.pcmBase64 !== undefined) {
    try {
      pcmBytes = decodeBase64ToBytes(cmd.pcmBase64);
    } catch {
      return {
        ok: false,
        error: buildErrorResponse(
          "invalid",
          "Invalid base64 payload in speakChunk.pcmBase64",
          ref
        )
      };
    }
  }

  const byteLength = pcmBytes?.byteLength ?? 0;
  if (stream.bufferedBytes + byteLength > maxStreamBufferBytes) {
    return {
      ok: false,
      error: buildErrorResponse(
        "too_large",
        `Stream buffer exceeds limit of ${maxStreamBufferBytes} bytes`,
        ref
      )
    };
  }

  const channelsData =
    pcmBytes && byteLength > 0
      ? decodePcmToFloat32Channels(pcmBytes, stream.format, stream.channels)
      : undefined;

  return {
    ok: true,
    chunk: {
      channelsData,
      byteLength,
      sampleRate: cmd.sampleRate ?? stream.sampleRate,
      visemes: cmd.visemes ? [...cmd.visemes] : undefined
    }
  };
}

export function enqueueOrScheduleStreamChunk(
  cmd: Extract<AvatarCommand, { type: "speakChunk" }>,
  stream: StreamSpeechItem,
  activeItem: SpeechQueueItem | null,
  maxStreamBufferBytes: number,
  audioOutput: AudioOutput,
  lipSync: LipSyncController,
  streamsById: Map<string, StreamSpeechItem>,
  isCurrent: () => boolean,
  onFinish: () => void,
  ref?: string
): AvatarResponse {
  if (stream.ended)
    return buildErrorResponse("invalid", "Stream already ended", ref);
  const decoded = decodeStreamChunk(cmd, stream, maxStreamBufferBytes, ref);
  if (!decoded.ok) return decoded.error;

  stream.idleMs = 0;
  stream.bufferedBytes += decoded.chunk.byteLength;
  if (
    activeItem === stream &&
    (stream.audioReady || !audioOutput.isSupported)
  ) {
    scheduleChunkOnPlayback(stream, decoded.chunk, audioOutput, lipSync, () =>
      onStreamChunkAudioEnded(
        stream,
        audioOutput,
        streamsById,
        isCurrent,
        onFinish
      )
    );
  } else {
    stream.pendingChunks.push(decoded.chunk);
  }
  return buildAckResponse(ref);
}

export function removeMatchingFromSlot(
  queue: SpeechQueueItem[],
  streamsById: Map<string, StreamSpeechItem>,
  predicate: (item: SpeechQueueItem) => boolean
): void {
  for (let i = queue.length - 1; i >= 0; i--) {
    const q = queue[i];
    if (predicate(q)) {
      queue.splice(i, 1);
      if (q.kind === "stream") clearStreamState(q, streamsById);
    }
  }
}
