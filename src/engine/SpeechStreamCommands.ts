import type { AudioOutput } from "./AudioOutput";
import type { ChannelSlot } from "./AvatarChannels";
import {
  buildAckResponse,
  buildErrorResponse,
  type AvatarCommand,
  type AvatarResponse,
  type SpeechEndReason
} from "./AvatarCommand";
import type { LipSyncController } from "./LipSyncController";
import {
  createStreamItem,
  enqueueOrScheduleStreamChunk,
  requireOwnedStream
} from "./SpeechCommandBuilders";
import { runEncodedSpeakPlayback } from "./SpeechSpeakHelper";
import { activateStreamPlayback, clearStreamState } from "./SpeechStreamHelper";
import type { SpeechQueueItem, StreamSpeechItem } from "./SpeechTypes";

export interface StreamCommandContext {
  streamsById: Map<string, StreamSpeechItem>;
  slot: ChannelSlot<SpeechQueueItem>;
  maxStreamBufferBytes: number;
  audioOutput: AudioOutput;
  lipSync: LipSyncController;
  isDisposed: () => boolean;
  finishActive: (interrupted: boolean, reason: SpeechEndReason) => void;
  nextPlaybackToken: () => number;
  isPlaybackTokenCurrent: (item: SpeechQueueItem, token: number) => boolean;
}

export function startStreamCommand(
  ctx: StreamCommandContext,
  cmd: Extract<AvatarCommand, { type: "speakStart" }>,
  ownerId: string,
  lockToken: string,
  arbitrate: (item: SpeechQueueItem) => AvatarResponse,
  ref?: string
): AvatarResponse {
  const existing = ctx.streamsById.get(cmd.streamId);
  if (existing) {
    return buildErrorResponse(
      existing.ownerId === ownerId ? "busy" : "forbidden",
      `streamId ${cmd.streamId} is already in use`,
      ref
    );
  }
  const stream = createStreamItem(cmd, ownerId, lockToken);
  const res = arbitrate(stream);
  if (res.type === "ack") ctx.streamsById.set(cmd.streamId, stream);
  return res;
}

export function chunkStreamCommand(
  ctx: StreamCommandContext,
  cmd: Extract<AvatarCommand, { type: "speakChunk" }>,
  ownerId: string,
  ref?: string
): AvatarResponse {
  const owned = requireOwnedStream(ctx.streamsById, cmd.streamId, ownerId, ref);
  if (!owned.ok) return owned.error;
  const stream = owned.stream;
  return enqueueOrScheduleStreamChunk(
    cmd,
    stream,
    ctx.slot.active,
    ctx.maxStreamBufferBytes,
    ctx.audioOutput,
    ctx.lipSync,
    ctx.streamsById,
    () => !ctx.isDisposed() && ctx.slot.active === stream,
    () => ctx.finishActive(false, "finished"),
    ref
  );
}

export function endStreamCommand(
  ctx: StreamCommandContext,
  streamId: string,
  ownerId: string,
  ref?: string
): AvatarResponse {
  const owned = requireOwnedStream(ctx.streamsById, streamId, ownerId, ref);
  if (!owned.ok) return owned.error;
  owned.stream.ended = true;
  owned.stream.idleMs = 0;
  if (
    ctx.slot.active === owned.stream &&
    owned.stream.audioReady &&
    owned.stream.pendingChunks.length === 0
  ) {
    ctx.audioOutput.endStream();
  }
  return buildAckResponse(ref);
}

export function cancelStreamCommand(
  ctx: StreamCommandContext,
  streamId: string,
  ownerId: string,
  ref?: string
): AvatarResponse {
  const owned = requireOwnedStream(ctx.streamsById, streamId, ownerId, ref);
  if (!owned.ok) return owned.error;
  clearStreamState(owned.stream, ctx.streamsById);
  if (ctx.slot.active === owned.stream) {
    ctx.finishActive(true, "cancelled");
  } else {
    const idx = ctx.slot.queue.indexOf(owned.stream);
    if (idx !== -1) ctx.slot.queue.splice(idx, 1);
  }
  return buildAckResponse(ref);
}

export function startActivatedItemPlayback(
  ctx: StreamCommandContext,
  item: SpeechQueueItem
): void {
  if (item.kind === "speak") {
    if (item.audio) {
      item.usesAudioClock = true;
      item.audioState = "decoding";
      const token = (item.playbackToken = ctx.nextPlaybackToken());
      void runEncodedSpeakPlayback(item, ctx.audioOutput, ctx.lipSync, {
        isCurrent: () => ctx.isPlaybackTokenCurrent(item, token),
        onFinish: (i, r) => ctx.finishActive(i, r)
      });
    } else if (item.visemes.length > 0) {
      ctx.lipSync.scheduleVisemes(item.visemes, 0, item.durationMs / 1000);
    }
    return;
  }
  if (item.kind === "stream") {
    const token = (item.playbackToken = ctx.nextPlaybackToken());
    activateStreamPlayback(
      item,
      ctx.audioOutput,
      ctx.lipSync,
      ctx.streamsById,
      () => ctx.isPlaybackTokenCurrent(item, token),
      (i, r) => ctx.finishActive(i, r)
    );
  }
}
