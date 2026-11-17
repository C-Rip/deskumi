import type { AvatarEvent, AvatarScope } from "../../engine/AvatarCommand";

const BINARY_MAGIC_0 = 0x44; // 'D'
const BINARY_MAGIC_1 = 0x53; // 'S'
const BINARY_MAGIC_2 = 0x4b; // 'K'
const BINARY_MAGIC_3 = 0x31; // '1'
const BINARY_KIND_SPEAK_CHUNK = 0x01;
const CHANNEL_BINARY_HEADER_BYTES = 14;
const MAX_STREAM_ID_BYTES = 128;
const MIN_SAMPLE_RATE = 8_000;
const MAX_SAMPLE_RATE = 48_000;

const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

export interface DecodedBinarySpeakChunk {
  clientId: string;
  streamId: string;
  sampleRate?: number;
  pcm: Uint8Array;
}

export type BinaryDecodeResult =
  | { ok: true; value: DecodedBinarySpeakChunk }
  | { ok: false; message: string; clientId?: string };

/**
 * Decodes a binary `speakChunk` frame delivered via `tauri::ipc::Channel` (`InvokeResponseBody::Raw`).
 * Layout: `[0..4] "DSK1"`, `[4] kind=1`, `[5] flags=0`, `[6..8] clientIdLen (u16 BE)`,
 * `[8..10] streamIdLen (u16 BE)`, `[10..14] sampleRate (u32 BE, 0 = omitted)`,
 * `clientId`, `streamId`, `pcm`.
 */
export function decodeChannelBinarySpeakChunk(
  buffer: ArrayBuffer
): BinaryDecodeResult {
  if (buffer.byteLength <= CHANNEL_BINARY_HEADER_BYTES) {
    return { ok: false, message: "Binary speakChunk frame is too short" };
  }
  const bytes = new Uint8Array(buffer);
  if (
    bytes[0] !== BINARY_MAGIC_0 ||
    bytes[1] !== BINARY_MAGIC_1 ||
    bytes[2] !== BINARY_MAGIC_2 ||
    bytes[3] !== BINARY_MAGIC_3
  ) {
    return { ok: false, message: "Invalid binary speakChunk magic" };
  }
  if (bytes[4] !== BINARY_KIND_SPEAK_CHUNK || bytes[5] !== 0x00) {
    return {
      ok: false,
      message: "Unsupported binary speakChunk frame kind or flags"
    };
  }

  const view = new DataView(buffer);
  const clientIdLen = view.getUint16(6, false);
  const streamIdLen = view.getUint16(8, false);
  const sampleRate = view.getUint32(10, false);

  if (clientIdLen === 0) {
    return { ok: false, message: "Missing clientId in binary speakChunk" };
  }

  const clientEnd = CHANNEL_BINARY_HEADER_BYTES + clientIdLen;
  if (clientEnd > buffer.byteLength) {
    return { ok: false, message: "Truncated clientId in binary speakChunk" };
  }

  let clientId: string;
  try {
    clientId = utf8Decoder.decode(
      bytes.subarray(CHANNEL_BINARY_HEADER_BYTES, clientEnd)
    );
  } catch {
    return { ok: false, message: "Invalid UTF-8 clientId in binary frame" };
  }

  if (streamIdLen === 0 || streamIdLen > MAX_STREAM_ID_BYTES) {
    return {
      ok: false,
      clientId,
      message: "Invalid streamId length in binary speakChunk"
    };
  }

  const streamEnd = clientEnd + streamIdLen;
  if (streamEnd >= buffer.byteLength) {
    return {
      ok: false,
      clientId,
      message: "Binary speakChunk frame is missing PCM bytes"
    };
  }

  if (
    sampleRate !== 0 &&
    (sampleRate < MIN_SAMPLE_RATE || sampleRate > MAX_SAMPLE_RATE)
  ) {
    return {
      ok: false,
      clientId,
      message: "Binary speakChunk sampleRate out of 8000..48000 range"
    };
  }

  let streamId: string;
  try {
    streamId = utf8Decoder.decode(bytes.subarray(clientEnd, streamEnd));
  } catch {
    return {
      ok: false,
      clientId,
      message: "Invalid UTF-8 streamId in binary frame"
    };
  }

  if (streamId.trim().length === 0) {
    return {
      ok: false,
      clientId,
      message: "Binary speakChunk streamId must not be blank"
    };
  }

  const pcm = new Uint8Array(buffer, streamEnd);
  return {
    ok: true,
    value: {
      clientId,
      streamId,
      ...(sampleRate > 0 ? { sampleRate } : {}),
      pcm
    }
  };
}

/**
 * Filters an `AvatarEvent` against active global bridge scopes (`avatar:events`,
 * `desktop:events`, `desktop:windowTitle`).
 */
export function filterEventForScopes(
  event: AvatarEvent,
  grantedScopes: ReadonlySet<AvatarScope>
): AvatarEvent | null {
  if (event.type === "windowFocus") {
    if (!grantedScopes.has("desktop:events")) {
      return null;
    }
    if (grantedScopes.has("desktop:windowTitle")) {
      return event;
    }
    return event.appId !== undefined
      ? { type: "windowFocus", appId: event.appId }
      : { type: "windowFocus" };
  }
  if (!grantedScopes.has("avatar:events")) {
    return null;
  }
  return event;
}
