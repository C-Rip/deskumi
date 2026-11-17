import type {
  AvatarCommandLimits,
  AvatarErrorCode,
  CommandPolicy,
  SpeakAudioBase64,
  VisemeKeyframe,
  VisemeName
} from "./AvatarCommandSchema";

const POLICIES = new Set<CommandPolicy>(["interrupt", "queue", "drop"]);
const VISEMES = new Set<VisemeName>(["aa", "ih", "ou", "ee", "oh", "neutral"]);

export type UnknownRecord = Record<string, unknown>;

export type ParseOutcome<T> =
  | { ok: true; value: T }
  | { ok: false; code: AvatarErrorCode; message: string };

export function isRecord(value: unknown): value is UnknownRecord {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof Uint8Array) &&
    !(value instanceof ArrayBuffer)
  );
}

export function fail(
  code: AvatarErrorCode,
  message: string
): ParseOutcome<never> {
  return { ok: false, code, message };
}

export function readOptionalBoundedString(
  record: UnknownRecord,
  field: string,
  maxLen: number,
  options: { allowEmpty?: boolean; requireNonBlank?: boolean } = {}
): ParseOutcome<string | undefined> {
  const value = record[field];
  if (value === undefined) return { ok: true, value: undefined };
  if (typeof value !== "string") {
    return fail("invalid", `${field} must be a string`);
  }
  if (!options.allowEmpty && value.length === 0) {
    return fail("invalid", `${field} must not be empty`);
  }
  if (options.requireNonBlank && value.trim().length === 0) {
    return fail("invalid", `${field} must not be blank`);
  }
  if (value.length > maxLen) {
    return fail("too_large", `${field} exceeds maximum length of ${maxLen}`);
  }
  return { ok: true, value };
}

export function readRequiredBoundedString(
  record: UnknownRecord,
  field: string,
  maxLen: number,
  requireNonBlank = true
): ParseOutcome<string> {
  const res = readOptionalBoundedString(record, field, maxLen, {
    allowEmpty: false,
    requireNonBlank
  });
  if (!res.ok) return res;
  if (res.value === undefined) return fail("invalid", `${field} is required`);
  return { ok: true, value: res.value };
}

export function readOptionalNumberInRange(
  record: UnknownRecord,
  field: string,
  min: number,
  max: number,
  integerOnly = false
): ParseOutcome<number | undefined> {
  const value = record[field];
  if (value === undefined) return { ok: true, value: undefined };
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fail("invalid", `${field} must be a finite number`);
  }
  if (integerOnly && !Number.isInteger(value)) {
    return fail("invalid", `${field} must be an integer`);
  }
  if (value < min || value > max) {
    return fail("invalid", `${field} must be between ${min} and ${max}`);
  }
  return { ok: true, value };
}

export function readRequiredNumberInRange(
  record: UnknownRecord,
  field: string,
  min: number,
  max: number,
  integerOnly = false
): ParseOutcome<number> {
  const res = readOptionalNumberInRange(record, field, min, max, integerOnly);
  if (!res.ok) return res;
  if (res.value === undefined) return fail("invalid", `${field} is required`);
  return { ok: true, value: res.value };
}

export function readOptionalPolicy(
  record: UnknownRecord
): ParseOutcome<CommandPolicy | undefined> {
  const value = record.policy;
  if (value === undefined) return { ok: true, value: undefined };
  if (typeof value !== "string" || !POLICIES.has(value as CommandPolicy)) {
    return fail("invalid", "policy must be interrupt, queue, or drop");
  }
  return { ok: true, value: value as CommandPolicy };
}

export function estimateBase64Bytes(base64: string): number {
  const trimmed = base64.trim();
  const len = trimmed.length;
  let padding = 0;
  if (trimmed.endsWith("==")) padding = 2;
  else if (trimmed.endsWith("=")) padding = 1;
  return Math.max(0, Math.floor((len * 3) / 4) - padding);
}

export function parseVisemes(
  raw: unknown,
  limits: AvatarCommandLimits
): ParseOutcome<VisemeKeyframe[] | undefined> {
  if (raw === undefined) return { ok: true, value: undefined };
  if (!Array.isArray(raw)) return fail("invalid", "visemes must be an array");
  if (raw.length > limits.maxVisemes) {
    return fail(
      "too_large",
      `visemes length exceeds maximum of ${limits.maxVisemes}`
    );
  }
  const out: VisemeKeyframe[] = [];
  for (let i = 0; i < raw.length; i++) {
    const entry = raw[i];
    if (!isRecord(entry)) {
      return fail("invalid", `visemes[${i}] must be an object`);
    }
    const t = readRequiredNumberInRange(entry, "t", 0, Number.MAX_SAFE_INTEGER);
    if (!t.ok) return t;
    if (typeof entry.v !== "string" || !VISEMES.has(entry.v as VisemeName)) {
      return fail("invalid", `visemes[${i}].v is not a valid viseme`);
    }
    const w = readOptionalNumberInRange(entry, "w", 0, 1);
    if (!w.ok) return w;
    out.push(
      w.value !== undefined
        ? { t: t.value, v: entry.v as VisemeName, w: w.value }
        : { t: t.value, v: entry.v as VisemeName }
    );
  }
  return { ok: true, value: out };
}

export function parseSpeakAudio(
  raw: unknown,
  limits: AvatarCommandLimits
): ParseOutcome<SpeakAudioBase64 | undefined> {
  if (raw === undefined) return { ok: true, value: undefined };
  if (!isRecord(raw)) return fail("invalid", "audio must be an object");
  if ("url" in raw && raw.url !== undefined) {
    return fail("invalid", "audio.url is not supported in v1");
  }
  if (typeof raw.base64 !== "string" || raw.base64.trim().length === 0) {
    return fail("invalid", "audio.base64 must be a non-empty string");
  }
  if (estimateBase64Bytes(raw.base64) > limits.maxAudioBytes) {
    return fail(
      "too_large",
      `audio.base64 exceeds maximum of ${limits.maxAudioBytes} bytes`
    );
  }
  if (typeof raw.mime !== "string" || !raw.mime.startsWith("audio/")) {
    return fail("invalid", "audio.mime must be an audio/* MIME type");
  }
  const sampleRate = readOptionalNumberInRange(
    raw,
    "sampleRate",
    limits.minSampleRate,
    limits.maxSampleRate,
    true
  );
  if (!sampleRate.ok) return sampleRate;
  return {
    ok: true,
    value: {
      base64: raw.base64,
      mime: raw.mime,
      ...(sampleRate.value !== undefined
        ? { sampleRate: sampleRate.value }
        : {})
    }
  };
}
