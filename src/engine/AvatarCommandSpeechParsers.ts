import {
  estimateBase64Bytes,
  fail,
  parseSpeakAudio,
  parseVisemes,
  readOptionalBoundedString,
  readOptionalNumberInRange,
  readOptionalPolicy,
  readRequiredBoundedString,
  readRequiredNumberInRange,
  type ParseOutcome,
  type UnknownRecord
} from "./AvatarCommandFieldReaders";
import type { AvatarCommand, AvatarCommandLimits } from "./AvatarCommandSchema";

export function parseSpeak(
  cmd: UnknownRecord,
  limits: AvatarCommandLimits
): ParseOutcome<AvatarCommand> {
  const id = readOptionalBoundedString(cmd, "id", limits.maxIdLength, {
    requireNonBlank: true
  });
  if (!id.ok) return id;
  const text = readOptionalBoundedString(cmd, "text", limits.maxTextLength, {
    allowEmpty: true
  });
  if (!text.ok) return text;
  const audio = parseSpeakAudio(cmd.audio, limits);
  if (!audio.ok) return audio;
  const visemes = parseVisemes(cmd.visemes, limits);
  if (!visemes.ok) return visemes;
  const durationMs = readOptionalNumberInRange(
    cmd,
    "durationMs",
    0,
    limits.maxDurationMs
  );
  if (!durationMs.ok) return durationMs;
  const policy = readOptionalPolicy(cmd);
  if (!policy.ok) return policy;

  if (
    audio.value === undefined &&
    (visemes.value === undefined || visemes.value.length === 0) &&
    (text.value === undefined || text.value.trim().length === 0)
  ) {
    return fail(
      "invalid",
      "speak requires audio, non-empty visemes, or non-blank text"
    );
  }
  return {
    ok: true,
    value: {
      type: "speak",
      ...(id.value !== undefined ? { id: id.value } : {}),
      ...(text.value !== undefined ? { text: text.value } : {}),
      ...(audio.value !== undefined ? { audio: audio.value } : {}),
      ...(visemes.value !== undefined ? { visemes: visemes.value } : {}),
      ...(durationMs.value !== undefined
        ? { durationMs: durationMs.value }
        : {}),
      ...(policy.value !== undefined ? { policy: policy.value } : {})
    }
  };
}

export function parseSpeakStart(
  cmd: UnknownRecord,
  limits: AvatarCommandLimits
): ParseOutcome<AvatarCommand> {
  const streamId = readRequiredBoundedString(
    cmd,
    "streamId",
    limits.maxStreamIdLength
  );
  if (!streamId.ok) return streamId;
  const id = readOptionalBoundedString(cmd, "id", limits.maxIdLength, {
    requireNonBlank: true
  });
  if (!id.ok) return id;
  const text = readOptionalBoundedString(cmd, "text", limits.maxTextLength, {
    allowEmpty: true
  });
  if (!text.ok) return text;
  const sampleRate = readRequiredNumberInRange(
    cmd,
    "sampleRate",
    limits.minSampleRate,
    limits.maxSampleRate,
    true
  );
  if (!sampleRate.ok) return sampleRate;
  if (cmd.channels !== undefined && cmd.channels !== 1 && cmd.channels !== 2) {
    return fail("invalid", "channels must be 1 or 2");
  }
  if (
    cmd.format !== undefined &&
    cmd.format !== "pcm_s16le" &&
    cmd.format !== "pcm_f32le"
  ) {
    return fail("invalid", "format must be pcm_s16le or pcm_f32le");
  }
  const policy = readOptionalPolicy(cmd);
  if (!policy.ok) return policy;

  return {
    ok: true,
    value: {
      type: "speakStart",
      streamId: streamId.value,
      sampleRate: sampleRate.value,
      ...(id.value !== undefined ? { id: id.value } : {}),
      ...(text.value !== undefined ? { text: text.value } : {}),
      ...(cmd.channels !== undefined
        ? { channels: cmd.channels as 1 | 2 }
        : {}),
      ...(cmd.format !== undefined
        ? { format: cmd.format as "pcm_s16le" | "pcm_f32le" }
        : {}),
      ...(policy.value !== undefined ? { policy: policy.value } : {})
    }
  };
}

export function parseSpeakChunk(
  cmd: UnknownRecord,
  limits: AvatarCommandLimits
): ParseOutcome<AvatarCommand> {
  const streamId = readRequiredBoundedString(
    cmd,
    "streamId",
    limits.maxStreamIdLength
  );
  if (!streamId.ok) return streamId;

  let pcm: Uint8Array | ArrayBuffer | undefined;
  if (cmd.pcm !== undefined) {
    if (!(cmd.pcm instanceof Uint8Array || cmd.pcm instanceof ArrayBuffer)) {
      return fail("invalid", "pcm must be Uint8Array or ArrayBuffer");
    }
    if (cmd.pcm.byteLength === 0)
      return fail("invalid", "pcm must not be empty");
    if (cmd.pcm.byteLength > limits.maxAudioBytes) {
      return fail("too_large", "pcm exceeds maxAudioBytes");
    }
    pcm = cmd.pcm;
  }

  let pcmBase64: string | undefined;
  if (cmd.pcmBase64 !== undefined) {
    if (
      typeof cmd.pcmBase64 !== "string" ||
      cmd.pcmBase64.trim().length === 0
    ) {
      return fail("invalid", "pcmBase64 must be a non-empty string");
    }
    if (estimateBase64Bytes(cmd.pcmBase64) > limits.maxAudioBytes) {
      return fail("too_large", "pcmBase64 exceeds maxAudioBytes");
    }
    pcmBase64 = cmd.pcmBase64;
  }

  const visemes = parseVisemes(cmd.visemes, limits);
  if (!visemes.ok) return visemes;
  const sampleRate = readOptionalNumberInRange(
    cmd,
    "sampleRate",
    limits.minSampleRate,
    limits.maxSampleRate,
    true
  );
  if (!sampleRate.ok) return sampleRate;

  if (
    pcm === undefined &&
    pcmBase64 === undefined &&
    (visemes.value === undefined || visemes.value.length === 0)
  ) {
    return fail(
      "invalid",
      "speakChunk requires pcm, pcmBase64, or non-empty visemes"
    );
  }
  return {
    ok: true,
    value: {
      type: "speakChunk",
      streamId: streamId.value,
      ...(pcm !== undefined ? { pcm } : {}),
      ...(pcmBase64 !== undefined ? { pcmBase64 } : {}),
      ...(visemes.value !== undefined ? { visemes: visemes.value } : {}),
      ...(sampleRate.value !== undefined
        ? { sampleRate: sampleRate.value }
        : {})
    }
  };
}

export function parseSay(
  cmd: UnknownRecord,
  limits: AvatarCommandLimits
): ParseOutcome<AvatarCommand> {
  const id = readOptionalBoundedString(cmd, "id", limits.maxIdLength, {
    requireNonBlank: true
  });
  if (!id.ok) return id;
  const text = readRequiredBoundedString(cmd, "text", limits.maxTextLength);
  if (!text.ok) return text;
  const durationMs = readOptionalNumberInRange(
    cmd,
    "durationMs",
    0,
    limits.maxDurationMs
  );
  if (!durationMs.ok) return durationMs;
  const policy = readOptionalPolicy(cmd);
  if (!policy.ok) return policy;
  return {
    ok: true,
    value: {
      type: "say",
      text: text.value,
      ...(id.value !== undefined ? { id: id.value } : {}),
      ...(durationMs.value !== undefined
        ? { durationMs: durationMs.value }
        : {}),
      ...(policy.value !== undefined ? { policy: policy.value } : {})
    }
  };
}
