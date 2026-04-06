import { DEFAULT_SETTINGS, otherRole } from "./constants.ts";
import type {
  BridgeDirective,
  BridgeRole,
  PostHopGuardResult,
  PreSendGuardResult,
  RelayGuardReason,
  StopReason
} from "../shared/types.js";

interface RelayEnvelopeInput {
  sourceRole: BridgeRole;
  round: number;
  message: unknown;
  continueMarker?: string;
  bridgeStatePrefix?: string;
}

interface PreSendGuardInput {
  sourceText: unknown;
  sourceHash?: string | null;
  lastForwardedSourceHash?: string | null;
  stopMarker?: string;
}

interface PostHopGuardInput {
  assistantText: unknown;
  round: number;
  maxRounds: number;
  stopMarker?: string;
}

export function normalizeAssistantText(value: unknown): string {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\u00a0/g, " ")
    .trim();
}

export function hashText(value: unknown): string {
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
  continueMarker = DEFAULT_SETTINGS.continueMarker,
  bridgeStatePrefix = DEFAULT_SETTINGS.bridgeStatePrefix
}: RelayEnvelopeInput): string {
  return [
    "[BRIDGE_CONTEXT]",
    `source: ${sourceRole}`,
    `round: ${round}`,
    "",
    normalizeAssistantText(message),
    "",
    "[BRIDGE_INSTRUCTION]",
    "Continue the discussion from the bridged content above.",
    "End your reply with exactly one final line:",
    `${bridgeStatePrefix} ${continueMarker}`,
    "or",
    `${bridgeStatePrefix} ${DEFAULT_SETTINGS.stopMarker}`
  ].join("\n");
}

export function parseBridgeDirective(
  text: unknown,
  prefix = DEFAULT_SETTINGS.bridgeStatePrefix
): BridgeDirective | null {
  void prefix;

  const normalized = normalizeAssistantText(text);
  const lines = normalized
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const match = lines[index]?.match(/^\[BRIDGE_STATE\]\s+(CONTINUE|FREEZE)$/i);
    if (match) {
      return match[1].toUpperCase() as BridgeDirective;
    }
  }

  return null;
}

export function evaluatePreSendGuard({
  sourceText,
  sourceHash,
  lastForwardedSourceHash,
  stopMarker = DEFAULT_SETTINGS.stopMarker
}: PreSendGuardInput): PreSendGuardResult {
  const normalized = normalizeAssistantText(sourceText);

  if (!normalized) {
    return {
      shouldStop: false,
      reason: null,
      isEmpty: true
    };
  }

  if (parseBridgeDirective(normalized) === stopMarker) {
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
}: PostHopGuardInput): PostHopGuardResult {
  if (parseBridgeDirective(assistantText) === stopMarker) {
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

export function guardReasonToStopReason(
  reason: RelayGuardReason | string | null | undefined
): StopReason {
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

export function formatNextHop(sourceRole: BridgeRole): string {
  return `${sourceRole} -> ${otherRole(sourceRole)}`;
}

export interface SubmissionVerificationInput {
  baselineUserHash: string | null;
  baselineGenerating: boolean;
  currentUserHash: string | null;
  currentGenerating: boolean;
  currentLatestUserText: string | null;
  relayPayloadText: string;
}

export interface SubmissionVerificationResult {
  verified: boolean;
  reason: "payload_accepted" | "generation_with_user_changed" | "not_verified";
}

function containsBridgeEnvelope(text: string): boolean {
  return text.includes("[BRIDGE_CONTEXT]") || text.includes("[来自");
}

function calculateTextOverlap(textA: string, textB: string): number {
  if (!textA || !textB) {
    return 0;
  }
  
  const normalizedA = normalizeAssistantText(textA);
  const normalizedB = normalizeAssistantText(textB);
  
  const wordsA = normalizedA.split(/\s+/).filter(w => w.length > 0);
  const wordsB = normalizedB.split(/\s+/).filter(w => w.length > 0);
  
  if (wordsA.length === 0 || wordsB.length === 0) {
    return 0;
  }
  
  let matchCount = 0;
  for (const word of wordsA) {
    if (wordsB.some(bw => bw.includes(word) || word.includes(bw))) {
      matchCount++;
    }
  }
  
  return matchCount / Math.max(wordsA.length, wordsB.length);
}

function verifyPayloadCorrelation(latestUserText: string | null, relayPayload: string): boolean {
  if (!latestUserText || !relayPayload) {
    return false;
  }
  
  if (containsBridgeEnvelope(latestUserText)) {
    return true;
  }
  
  const overlap = calculateTextOverlap(latestUserText, relayPayload);
  if (overlap >= 0.5) {
    return true;
  }
  
  return false;
}

export function evaluateSubmissionVerification(input: SubmissionVerificationInput): SubmissionVerificationResult {
  const {
    baselineUserHash,
    baselineGenerating,
    currentUserHash,
    currentGenerating,
    currentLatestUserText,
    relayPayloadText
  } = input;

  if (currentUserHash && currentUserHash !== baselineUserHash) {
    if (currentLatestUserText && verifyPayloadCorrelation(currentLatestUserText, relayPayloadText)) {
      return {
        verified: true,
        reason: "payload_accepted"
      };
    }
  }

  if (!baselineGenerating && currentGenerating) {
    if (currentLatestUserText && verifyPayloadCorrelation(currentLatestUserText, relayPayloadText)) {
      return {
        verified: true,
        reason: "generation_with_user_changed"
      };
    }
  }

  return {
    verified: false,
    reason: "not_verified"
  };
}
