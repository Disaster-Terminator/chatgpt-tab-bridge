import { DEFAULT_SETTINGS, otherRole } from "./constants.mjs";

export function normalizeAssistantText(value) {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\u00a0/g, " ")
    .trim();
}

export function hashText(value) {
  const text = normalizeAssistantText(value);
  let hash = 2166136261;

  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return `h${(hash >>> 0).toString(16)}`;
}

export function buildRelayEnvelope({
  sourceRole,
  round,
  message,
  continueMarker = DEFAULT_SETTINGS.continueMarker
}) {
  return [
    continueMarker,
    `source: ${sourceRole}`,
    `round: ${round}`,
    "",
    normalizeAssistantText(message)
  ].join("\n");
}

export function containsStopMarker(text, stopMarker = DEFAULT_SETTINGS.stopMarker) {
  return normalizeAssistantText(text).includes(stopMarker);
}

export function evaluatePreSendGuard({
  sourceText,
  sourceHash,
  lastForwardedSourceHash,
  stopMarker = DEFAULT_SETTINGS.stopMarker
}) {
  const normalized = normalizeAssistantText(sourceText);

  if (!normalized) {
    return {
      shouldStop: false,
      reason: null,
      isEmpty: true
    };
  }

  if (containsStopMarker(normalized, stopMarker)) {
    return {
      shouldStop: true,
      reason: "stop_marker",
      isEmpty: false
    };
  }

  if (sourceHash && lastForwardedSourceHash && sourceHash === lastForwardedSourceHash) {
    return {
      shouldStop: true,
      reason: "duplicate_output",
      isEmpty: false
    };
  }

  return {
    shouldStop: false,
    reason: null,
    isEmpty: false
  };
}

export function evaluatePostHopGuard({
  assistantText,
  round,
  maxRounds,
  stopMarker = DEFAULT_SETTINGS.stopMarker
}) {
  if (containsStopMarker(assistantText, stopMarker)) {
    return {
      shouldStop: true,
      reason: "stop_marker"
    };
  }

  if (round >= maxRounds) {
    return {
      shouldStop: true,
      reason: "max_rounds_reached"
    };
  }

  return {
    shouldStop: false,
    reason: null
  };
}

export function guardReasonToStopReason(reason) {
  switch (reason) {
    case "stop_marker":
      return "stop_marker";
    case "duplicate_output":
      return "duplicate_output";
    case "max_rounds_reached":
      return "max_rounds_reached";
    default:
      return "user_stop";
  }
}

export function formatNextHop(sourceRole) {
  return `${sourceRole} -> ${otherRole(sourceRole)}`;
}
