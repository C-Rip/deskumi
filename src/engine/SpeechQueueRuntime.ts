import type { AudioOutput } from "./AudioOutput";
import { arbitrateChannel, type ChannelSlot } from "./AvatarChannels";
import type {
  AvatarEvent,
  AvatarResponse,
  CommandPolicy,
  SpeechEndReason
} from "./AvatarCommand";
import type { LipSyncController } from "./LipSyncController";
import type { PowerSaveController } from "./PowerSaveController";
import { removeMatchingFromSlot } from "./SpeechCommandBuilders";
import { stepSpeakItem } from "./SpeechSpeakHelper";
import {
  startActivatedItemPlayback,
  type StreamCommandContext
} from "./SpeechStreamCommands";
import { clearStreamState, stepStreamPlayback } from "./SpeechStreamHelper";
import type {
  SpeechBubbleState,
  SpeechQueueItem,
  StreamSpeechItem
} from "./SpeechTypes";

export interface SpeechRuntimeHooks {
  powerSaveController: PowerSaveController;
  heldLocks: Set<string>;
  slot: ChannelSlot<SpeechQueueItem>;
  streamsById: Map<string, StreamSpeechItem>;
  audioOutput: AudioOutput;
  lipSync: LipSyncController;
  streamCtx: StreamCommandContext;
  maxQueueSize: number;
  streamTimeoutMs: number;
  isDisposed: () => boolean;
  bumpPlaybackSeq: () => void;
  setBubble: (bubble: SpeechBubbleState | null) => void;
  emitEvent: (event: AvatarEvent) => void;
}

export function buildSpeechStreamContext(
  streamsById: Map<string, StreamSpeechItem>,
  slot: ChannelSlot<SpeechQueueItem>,
  maxStreamBufferBytes: number,
  audioOutput: AudioOutput,
  lipSync: LipSyncController,
  isDisposed: () => boolean,
  nextPlaybackToken: () => number,
  finishActive: (interrupted: boolean, reason: SpeechEndReason) => void
): StreamCommandContext {
  return {
    streamsById,
    slot,
    maxStreamBufferBytes,
    audioOutput,
    lipSync,
    isDisposed,
    finishActive,
    nextPlaybackToken,
    isPlaybackTokenCurrent: (item, token) =>
      !isDisposed() &&
      slot.active === item &&
      (item.kind === "speak" || item.kind === "stream") &&
      item.playbackToken === token
  };
}

export function arbitrateSpeechItem(
  rt: SpeechRuntimeHooks,
  item: SpeechQueueItem,
  policy: CommandPolicy,
  ref?: string
): AvatarResponse {
  return arbitrateChannel(
    rt.slot,
    item,
    policy,
    rt.maxQueueSize,
    "mouth",
    ref,
    {
      onInterruptActive: (prev) => {
        rt.bumpPlaybackSeq();
        rt.audioOutput.stopAll();
        rt.lipSync.clear();
        if (prev.kind === "stream") clearStreamState(prev, rt.streamsById);
        finalizeStoppedSpeechItem(rt, prev, true, "interrupted");
      },
      onActivate: (next) => activateSpeechItem(rt, next),
      onDropQueued: (queued) => {
        if (queued.kind === "stream") clearStreamState(queued, rt.streamsById);
      }
    }
  );
}

export function activateSpeechItem(
  rt: SpeechRuntimeHooks,
  item: SpeechQueueItem
): void {
  rt.heldLocks.add(item.lockToken);
  rt.powerSaveController.acquireActiveLock(item.lockToken);
  rt.lipSync.clear();
  rt.setBubble(
    item.text && item.text.trim().length > 0
      ? { id: item.id, text: item.text, kind: item.kind }
      : null
  );
  rt.emitEvent(
    item.id !== undefined
      ? { type: "speechStart", id: item.id }
      : { type: "speechStart" }
  );
  startActivatedItemPlayback(rt.streamCtx, item);
}

export function finishActiveSpeechItem(
  rt: SpeechRuntimeHooks,
  interrupted: boolean,
  reason: SpeechEndReason
): void {
  const active = rt.slot.active;
  if (!active) return;
  teardownActiveSpeechState(rt);
  finalizeStoppedSpeechItem(rt, active, interrupted, reason);
  if (!rt.isDisposed() && !rt.slot.active) {
    const next = rt.slot.queue.shift() ?? null;
    rt.slot.active = next;
    if (next) activateSpeechItem(rt, next);
  }
}

export function stepActiveSpeechSlot(
  rt: SpeechRuntimeHooks,
  dtMs: number
): void {
  if (rt.isDisposed() || !rt.slot.active) return;
  const active = rt.slot.active;
  active.elapsedMs += dtMs;
  if (active.kind === "say") {
    if (active.elapsedMs >= active.durationMs) {
      finishActiveSpeechItem(rt, false, "finished");
    }
  } else if (active.kind === "speak") {
    stepSpeakItem(active, rt.audioOutput, rt.lipSync, (i, r) =>
      finishActiveSpeechItem(rt, i, r)
    );
  } else {
    stepStreamPlayback(
      active,
      dtMs,
      rt.streamTimeoutMs,
      rt.audioOutput,
      rt.lipSync,
      rt.streamsById,
      (i, r) => finishActiveSpeechItem(rt, i, r)
    );
  }
}

export function cancelMatchingSpeechItems(
  rt: SpeechRuntimeHooks,
  predicate: (item: SpeechQueueItem) => boolean
): void {
  removeMatchingFromSlot(rt.slot.queue, rt.streamsById, predicate);
  if (rt.slot.active && predicate(rt.slot.active)) {
    if (rt.slot.active.kind === "stream") {
      clearStreamState(rt.slot.active, rt.streamsById);
    }
    finishActiveSpeechItem(rt, true, "cancelled");
  }
}

export function clearAllSpeechSlotItems(
  rt: SpeechRuntimeHooks,
  reason: SpeechEndReason
): void {
  for (const q of rt.slot.queue) {
    if (q.kind === "stream") clearStreamState(q, rt.streamsById);
  }
  rt.slot.queue.length = 0;
  const prev = rt.slot.active;
  teardownActiveSpeechState(rt);
  if (prev) {
    if (prev.kind === "stream") clearStreamState(prev, rt.streamsById);
    finalizeStoppedSpeechItem(rt, prev, true, reason);
  }
}

function teardownActiveSpeechState(rt: SpeechRuntimeHooks): void {
  rt.bumpPlaybackSeq();
  rt.slot.active = null;
  rt.audioOutput.stopAll();
  rt.lipSync.clear();
}

function finalizeStoppedSpeechItem(
  rt: SpeechRuntimeHooks,
  item: SpeechQueueItem,
  interrupted: boolean,
  reason: SpeechEndReason
): void {
  if (rt.heldLocks.delete(item.lockToken)) {
    rt.powerSaveController.releaseActiveLock(item.lockToken);
  }
  rt.setBubble(null);
  rt.emitEvent(
    item.id !== undefined
      ? { type: "speechEnd", id: item.id, interrupted, reason }
      : { type: "speechEnd", interrupted, reason }
  );
}
