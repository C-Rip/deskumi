import {
  AVATAR_PROTOCOL_VERSION,
  DEFAULT_AVATAR_COMMAND_LIMITS,
  type AvatarAckResponse,
  type AvatarCommand,
  type AvatarCommandLimits,
  type AvatarErrorCode,
  type AvatarErrorResponse,
  type AvatarEvent,
  type AvatarEventEnvelope,
  type AvatarHelloResponse,
  type AvatarScope,
  type BuildHelloResponseOptions
} from "./AvatarCommandSchema";

export * from "./AvatarCommandSchema";
export { validateAvatarCommand } from "./AvatarCommandValidator";

export function buildAckResponse(ref?: string): AvatarAckResponse {
  return ref !== undefined
    ? { v: AVATAR_PROTOCOL_VERSION, type: "ack", ref }
    : { v: AVATAR_PROTOCOL_VERSION, type: "ack" };
}

export function buildErrorResponse(
  code: AvatarErrorCode,
  message: string,
  ref?: string
): AvatarErrorResponse {
  return ref !== undefined
    ? { v: AVATAR_PROTOCOL_VERSION, type: "error", ref, code, message }
    : { v: AVATAR_PROTOCOL_VERSION, type: "error", code, message };
}

export function buildHelloResponse(
  options: BuildHelloResponseOptions
): AvatarHelloResponse {
  const limits: AvatarCommandLimits = {
    ...DEFAULT_AVATAR_COMMAND_LIMITS,
    ...options.limits
  };
  const subscribedEvents = Array.from(new Set(options.subscribedEvents ?? []));
  const res: AvatarHelloResponse = {
    v: AVATAR_PROTOCOL_VERSION,
    type: "hello",
    protocolVersion: AVATAR_PROTOCOL_VERSION,
    limits,
    scopes: [...options.scopes],
    expressions: [...options.expressions],
    animations: [...options.animations],
    subscribedEvents
  };
  if (options.ref !== undefined) res.ref = options.ref;
  return res;
}

export function buildEventEnvelope(event: AvatarEvent): AvatarEventEnvelope {
  return { v: AVATAR_PROTOCOL_VERSION, ...event };
}

export function getRequiredScopeForCommand(
  cmd: AvatarCommand
): AvatarScope | null {
  switch (cmd.type) {
    case "hello":
      return null;
    case "speak":
    case "speakStart":
    case "speakChunk":
    case "speakEnd":
    case "speakCancel":
    case "say":
      return "avatar:speak";
    case "stopSpeaking":
      return "avatar:interrupt";
    case "expression":
    case "reaction":
      return "avatar:expression";
    case "animation":
      return "avatar:animation";
    case "lookAt":
      return "avatar:lookAt";
  }
}
