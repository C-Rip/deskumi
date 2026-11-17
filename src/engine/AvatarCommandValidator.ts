import {
  buildErrorResponse,
  getRequiredScopeForCommand
} from "./AvatarCommand";
import {
  fail,
  isRecord,
  readOptionalBoundedString,
  readOptionalNumberInRange,
  readOptionalPolicy,
  readRequiredBoundedString,
  readRequiredNumberInRange,
  type ParseOutcome,
  type UnknownRecord
} from "./AvatarCommandFieldReaders";
import {
  AVATAR_EVENT_TYPES,
  AVATAR_PROTOCOL_VERSION,
  DEFAULT_AVATAR_COMMAND_LIMITS,
  type AvatarCommand,
  type AvatarCommandLimits,
  type AvatarEventType,
  type AvatarValidationContext,
  type AvatarValidationResult,
  type ReactionName
} from "./AvatarCommandSchema";
import {
  parseSay,
  parseSpeak,
  parseSpeakChunk,
  parseSpeakStart
} from "./AvatarCommandSpeechParsers";

const REACTIONS = new Set<ReactionName>([
  "happy",
  "surprised",
  "relaxed",
  "wink"
]);
const EVENT_TYPES = new Set<string>(AVATAR_EVENT_TYPES);

function parseHello(cmd: UnknownRecord): ParseOutcome<AvatarCommand> {
  const token = readOptionalBoundedString(cmd, "token", 512, {
    requireNonBlank: true
  });
  if (!token.ok) return token;
  const clientName = readOptionalBoundedString(cmd, "clientName", 128);
  if (!clientName.ok) return clientName;
  const clientVersion = readOptionalBoundedString(cmd, "clientVersion", 64);
  if (!clientVersion.ok) return clientVersion;

  let events: AvatarEventType[] | undefined;
  if (cmd.events !== undefined) {
    if (!Array.isArray(cmd.events)) {
      return fail("invalid", "hello.events must be an array");
    }
    if (cmd.events.length > 32) {
      return fail("too_large", "hello.events exceeds maximum length");
    }
    events = [];
    for (const ev of cmd.events) {
      if (typeof ev !== "string" || !EVENT_TYPES.has(ev)) {
        return fail(
          "invalid",
          `Unknown event type in hello.events: ${String(ev)}`
        );
      }
      events.push(ev as AvatarEventType);
    }
  }
  return {
    ok: true,
    value: {
      type: "hello",
      ...(token.value !== undefined ? { token: token.value } : {}),
      ...(clientName.value !== undefined
        ? { clientName: clientName.value }
        : {}),
      ...(clientVersion.value !== undefined
        ? { clientVersion: clientVersion.value }
        : {}),
      ...(events !== undefined ? { events } : {})
    }
  };
}

function parseExpressionOrReaction(
  cmd: UnknownRecord,
  limits: AvatarCommandLimits,
  isReaction: boolean
): ParseOutcome<AvatarCommand> {
  const durationMs = readOptionalNumberInRange(
    cmd,
    "durationMs",
    0,
    limits.maxDurationMs
  );
  if (!durationMs.ok) return durationMs;
  const intensity = readOptionalNumberInRange(cmd, "intensity", 0, 1);
  if (!intensity.ok) return intensity;
  const policy = readOptionalPolicy(cmd);
  if (!policy.ok) return policy;

  if (isReaction) {
    if (
      typeof cmd.name !== "string" ||
      !REACTIONS.has(cmd.name as ReactionName)
    ) {
      return fail(
        "invalid",
        "reaction.name must be happy, surprised, relaxed, or wink"
      );
    }
    return {
      ok: true,
      value: {
        type: "reaction",
        name: cmd.name as ReactionName,
        ...(durationMs.value !== undefined
          ? { durationMs: durationMs.value }
          : {}),
        ...(intensity.value !== undefined
          ? { intensity: intensity.value }
          : {}),
        ...(policy.value !== undefined ? { policy: policy.value } : {})
      }
    };
  }
  const name = readRequiredBoundedString(cmd, "name", 128);
  if (!name.ok) return name;
  return {
    ok: true,
    value: {
      type: "expression",
      name: name.value,
      ...(intensity.value !== undefined ? { intensity: intensity.value } : {}),
      ...(durationMs.value !== undefined
        ? { durationMs: durationMs.value }
        : {}),
      ...(policy.value !== undefined ? { policy: policy.value } : {})
    }
  };
}

function parseAnimation(
  cmd: UnknownRecord,
  limits: AvatarCommandLimits
): ParseOutcome<AvatarCommand> {
  const vrma = readRequiredBoundedString(cmd, "vrma", 256);
  if (!vrma.ok) return vrma;
  if (cmd.loop !== undefined && typeof cmd.loop !== "boolean") {
    return fail("invalid", "loop must be a boolean");
  }
  const durationMs = readOptionalNumberInRange(
    cmd,
    "durationMs",
    0,
    limits.maxDurationMs
  );
  if (!durationMs.ok) return durationMs;
  const fadeInMs = readOptionalNumberInRange(
    cmd,
    "fadeInMs",
    0,
    limits.maxDurationMs
  );
  if (!fadeInMs.ok) return fadeInMs;
  const policy = readOptionalPolicy(cmd);
  if (!policy.ok) return policy;
  return {
    ok: true,
    value: {
      type: "animation",
      vrma: vrma.value,
      ...(cmd.loop !== undefined ? { loop: cmd.loop } : {}),
      ...(durationMs.value !== undefined
        ? { durationMs: durationMs.value }
        : {}),
      ...(fadeInMs.value !== undefined ? { fadeInMs: fadeInMs.value } : {}),
      ...(policy.value !== undefined ? { policy: policy.value } : {})
    }
  };
}

function parseLookAt(
  cmd: UnknownRecord,
  limits: AvatarCommandLimits
): ParseOutcome<AvatarCommand> {
  const x = readRequiredNumberInRange(cmd, "x", -1, 1);
  if (!x.ok) return x;
  const y = readRequiredNumberInRange(cmd, "y", -1, 1);
  if (!y.ok) return y;
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
      type: "lookAt",
      x: x.value,
      y: y.value,
      ...(durationMs.value !== undefined
        ? { durationMs: durationMs.value }
        : {}),
      ...(policy.value !== undefined ? { policy: policy.value } : {})
    }
  };
}

function parseCommandBody(
  cmd: UnknownRecord,
  limits: AvatarCommandLimits
): ParseOutcome<AvatarCommand> {
  const type = cmd.type;
  if (typeof type !== "string")
    return fail("invalid", "cmd.type must be a string");
  switch (type) {
    case "hello":
      return parseHello(cmd);
    case "speak":
      return parseSpeak(cmd, limits);
    case "speakStart":
      return parseSpeakStart(cmd, limits);
    case "speakChunk":
      return parseSpeakChunk(cmd, limits);
    case "speakEnd":
    case "speakCancel": {
      const streamId = readRequiredBoundedString(
        cmd,
        "streamId",
        limits.maxStreamIdLength
      );
      return streamId.ok
        ? { ok: true, value: { type, streamId: streamId.value } }
        : streamId;
    }
    case "say":
      return parseSay(cmd, limits);
    case "stopSpeaking": {
      const id = readOptionalBoundedString(cmd, "id", limits.maxIdLength, {
        requireNonBlank: true
      });
      return id.ok
        ? {
            ok: true,
            value: {
              type: "stopSpeaking",
              ...(id.value !== undefined ? { id: id.value } : {})
            }
          }
        : id;
    }
    case "expression":
      return parseExpressionOrReaction(cmd, limits, false);
    case "reaction":
      return parseExpressionOrReaction(cmd, limits, true);
    case "animation":
      return parseAnimation(cmd, limits);
    case "lookAt":
      return parseLookAt(cmd, limits);
    default:
      return fail("invalid", `Unknown command type: ${type}`);
  }
}

export function validateAvatarCommand(
  raw: unknown,
  limits?: Partial<AvatarCommandLimits>,
  context: AvatarValidationContext = {}
): AvatarValidationResult {
  const effectiveLimits: AvatarCommandLimits = {
    ...DEFAULT_AVATAR_COMMAND_LIMITS,
    ...limits
  };
  if (!isRecord(raw)) {
    return {
      ok: false,
      error: buildErrorResponse("invalid", "Command envelope must be an object")
    };
  }
  let ref: string | undefined;
  if (raw.id !== undefined) {
    const idCheck = readOptionalBoundedString(
      raw,
      "id",
      effectiveLimits.maxIdLength,
      { requireNonBlank: true }
    );
    if (!idCheck.ok)
      return {
        ok: false,
        error: buildErrorResponse(idCheck.code, idCheck.message)
      };
    ref = idCheck.value;
  }
  if (raw.v !== AVATAR_PROTOCOL_VERSION) {
    return {
      ok: false,
      error: buildErrorResponse(
        "invalid",
        `Unsupported protocol version: ${String(raw.v)}`,
        ref
      )
    };
  }
  if (!isRecord(raw.cmd)) {
    return {
      ok: false,
      error: buildErrorResponse(
        "invalid",
        "Envelope cmd must be an object",
        ref
      )
    };
  }
  const parsed = parseCommandBody(raw.cmd, effectiveLimits);
  if (!parsed.ok) {
    return {
      ok: false,
      error: buildErrorResponse(parsed.code, parsed.message, ref)
    };
  }
  const cmd = parsed.value;
  if (context.grantedScopes !== undefined) {
    const reqScope = getRequiredScopeForCommand(cmd);
    if (reqScope !== null && !context.grantedScopes.includes(reqScope)) {
      return {
        ok: false,
        error: buildErrorResponse(
          "forbidden",
          `Missing required scope: ${reqScope}`,
          ref
        )
      };
    }
  }
  if (context.isWindowVisible === false && cmd.type !== "hello") {
    return {
      ok: false,
      error: buildErrorResponse(
        "hidden",
        "Avatar window is hidden; command rejected",
        ref
      )
    };
  }
  if (
    cmd.type === "expression" &&
    context.availableExpressions !== undefined &&
    !context.availableExpressions.includes(cmd.name)
  ) {
    return {
      ok: false,
      error: buildErrorResponse(
        "unknown_expression",
        `Unknown expression: ${cmd.name}`,
        ref
      )
    };
  }
  if (
    cmd.type === "animation" &&
    context.availableAnimations !== undefined &&
    !context.availableAnimations.includes(cmd.vrma)
  ) {
    return {
      ok: false,
      error: buildErrorResponse(
        "unknown_animation",
        `Unknown animation: ${cmd.vrma}`,
        ref
      )
    };
  }
  return {
    ok: true,
    value:
      ref !== undefined
        ? { v: AVATAR_PROTOCOL_VERSION, id: ref, cmd }
        : { v: AVATAR_PROTOCOL_VERSION, cmd }
  };
}
