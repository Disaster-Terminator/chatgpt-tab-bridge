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
  hopId?: string | null;
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
  hopId = null,
  continueMarker = DEFAULT_SETTINGS.continueMarker,
  bridgeStatePrefix = DEFAULT_SETTINGS.bridgeStatePrefix
}: RelayEnvelopeInput): string {
  const headerLines = [
    "[BRIDGE_CONTEXT]",
    `source: ${sourceRole}`,
    `round: ${round}`,
    ...(hopId ? [`hop: ${hopId}`] : []),
    ""
  ];

  return [
    ...headerLines,
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
  baselineLatestUserText: string | null;
  currentUserHash: string | null;
  currentGenerating: boolean;
  currentLatestUserText: string | null;
  relayPayloadText: string;
  expectedHopId?: string | null;
}

export type HopBindingStrength = "strong" | "weak" | "none";

export type PayloadCorrelationStrength = "strong" | "weak" | "none";

export type GenerationSettlementStrength = "strong" | "weak" | "none";

export type AssistantSettlementStrength = "strong" | "weak" | "none" | "unavailable";

export interface SubmissionVerificationResult {
  verified: boolean;
  reason: string;
  hopBindingStrength: HopBindingStrength;
  payloadCorrelationStrength: PayloadCorrelationStrength;
  generationSettlementStrength: GenerationSettlementStrength;
  userTurnChanged: boolean;
  userTurnHopBinding: HopBindingStrength;
  assistantSettlementStrength: AssistantSettlementStrength;
  details: {
    baselineUserHash: string | null;
    currentUserHash: string | null;
    baselineGenerating: boolean;
    currentGenerating: boolean;
    baselineLatestUserText: string | null;
    currentLatestUserText: string | null;
    textOverlapRatio: number;
    containsBridgeContext: boolean;
    extractedHopId: string | null;
    expectedHopId: string | null;
  };
}

export interface SubmissionAcceptanceGateResult {
  acceptedEquivalentEvidence: boolean;
  waitingReplyAllowed: boolean;
  weakCorrelationOnly: boolean;
  reason: string;
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

function extractHopIdFromPayload(relayPayload: string): string | null {
  const match = normalizeAssistantText(relayPayload).match(/(?:^|\n)hop:\s*([^\s\n]+)/i);
  return match?.[1] ?? null;
}

function analyzeHopBinding(
  latestUserText: string | null,
  relayPayload: string,
  expectedHopId: string | null | undefined
): {
  hopBindingStrength: HopBindingStrength;
  containsBridgeContext: boolean;
  extractedHopId: string | null;
} {
  if (!latestUserText) {
    return { hopBindingStrength: "none", containsBridgeContext: false, extractedHopId: null };
  }

  const normalizedLatest = normalizeAssistantText(latestUserText);
  const normalizedPayload = normalizeAssistantText(relayPayload);
  const containsBridgeContext = containsBridgeEnvelope(normalizedLatest);
  const extractedHopId = extractHopIdFromPayload(normalizedPayload);
  const normalizedExpectedHopId = normalizeAssistantText(expectedHopId ?? "");

  if (normalizedExpectedHopId && extractedHopId) {
    const latestLower = normalizedLatest.toLowerCase();
    const expectedMarker = `hop: ${normalizedExpectedHopId}`.toLowerCase();
    if (latestLower.includes("[bridge_context]") && latestLower.includes(expectedMarker)) {
      return { hopBindingStrength: "strong", containsBridgeContext: true, extractedHopId };
    }
  }

  if (containsBridgeContext && extractedHopId) {
    const latestLower = normalizedLatest.toLowerCase();
    const payloadHopMarker = `hop: ${extractedHopId}`.toLowerCase();
    if (latestLower.includes(payloadHopMarker)) {
      return { hopBindingStrength: "strong", containsBridgeContext: true, extractedHopId };
    }
    return { hopBindingStrength: "weak", containsBridgeContext: true, extractedHopId };
  }

  if (containsBridgeContext) {
    return { hopBindingStrength: "weak", containsBridgeContext: true, extractedHopId };
  }

  return { hopBindingStrength: "none", containsBridgeContext: false, extractedHopId };
}

function analyzePayloadCorrelation(
  latestUserText: string | null,
  relayPayloadText: string,
  hopBindingStrength: HopBindingStrength
): PayloadCorrelationStrength {
  if (!latestUserText || !relayPayloadText) {
    return "none";
  }

  if (hopBindingStrength === "strong") {
    return "strong";
  }

  const normalizedLatest = normalizeAssistantText(latestUserText);
  const normalizedPayload = normalizeAssistantText(relayPayloadText);
  const overlap = calculateTextOverlap(normalizedLatest, normalizedPayload);

  if (overlap >= 0.5) {
    return "weak";
  }

  return "none";
}

function analyzeUserTurnChange(
  baselineLatestUserText: string | null,
  currentLatestUserText: string | null
): boolean {
  const baselineNormalized = normalizeAssistantText(baselineLatestUserText ?? "");
  const currentNormalized = normalizeAssistantText(currentLatestUserText ?? "");

  if (!currentNormalized) {
    return false;
  }

  return baselineNormalized !== currentNormalized;
}

function analyzeUserTurnHopBinding(
  baselineLatestUserText: string | null,
  currentLatestUserText: string | null,
  expectedHopId: string | null | undefined,
  relayPayloadText: string
): HopBindingStrength {
  if (!analyzeUserTurnChange(baselineLatestUserText, currentLatestUserText)) {
    return "none";
  }

  const analysis = analyzeHopBinding(currentLatestUserText, relayPayloadText, expectedHopId);
  return analysis.hopBindingStrength;
}

function analyzeGenerationSettlement(
  baselineGenerating: boolean,
  currentGenerating: boolean
): GenerationSettlementStrength {
  if (!baselineGenerating && currentGenerating) {
    return "strong";
  }
  if (baselineGenerating && !currentGenerating) {
    return "weak";
  }
  return "none";
}

export function evaluateSubmissionAcceptanceGate(
  result: SubmissionVerificationResult
): SubmissionAcceptanceGateResult {
  const userHashChanged =
    result.details.currentUserHash !== null &&
    result.details.currentUserHash !== result.details.baselineUserHash;
  const acceptedEquivalentEvidence =
    result.userTurnChanged &&
    result.hopBindingStrength === "strong" &&
    result.payloadCorrelationStrength === "strong";

  if (acceptedEquivalentEvidence) {
    if (userHashChanged) {
      return {
        acceptedEquivalentEvidence: true,
        waitingReplyAllowed: true,
        weakCorrelationOnly: false,
        reason: "acceptance_established_user_hash_changed"
      };
    }

    if (result.generationSettlementStrength === "strong") {
      return {
        acceptedEquivalentEvidence: true,
        waitingReplyAllowed: true,
        weakCorrelationOnly: false,
        reason: "acceptance_established_generation_started"
      };
    }

    return {
      acceptedEquivalentEvidence: true,
      waitingReplyAllowed: true,
      weakCorrelationOnly: false,
      reason: "acceptance_established_hop_bound_payload"
    };
  }

  const weakCorrelationOnly =
    result.hopBindingStrength === "weak" ||
    result.payloadCorrelationStrength === "weak" ||
    result.userTurnHopBinding === "weak";

  if (weakCorrelationOnly) {
    return {
      acceptedEquivalentEvidence: false,
      waitingReplyAllowed: false,
      weakCorrelationOnly: true,
      reason: "acceptance_not_established_weak_correlation"
    };
  }

  if (!result.userTurnChanged) {
    return {
      acceptedEquivalentEvidence: false,
      waitingReplyAllowed: false,
      weakCorrelationOnly: false,
      reason: "acceptance_not_established_no_user_turn_change"
    };
  }

  if (result.hopBindingStrength === "none") {
    return {
      acceptedEquivalentEvidence: false,
      waitingReplyAllowed: false,
      weakCorrelationOnly: false,
      reason: "acceptance_not_established_hop_binding_missing"
    };
  }

  if (result.payloadCorrelationStrength === "none") {
    return {
      acceptedEquivalentEvidence: false,
      waitingReplyAllowed: false,
      weakCorrelationOnly: false,
      reason: "acceptance_not_established_payload_not_correlated"
    };
  }

  return {
    acceptedEquivalentEvidence: false,
    waitingReplyAllowed: false,
    weakCorrelationOnly: false,
    reason: "acceptance_not_established"
  };
}

export function evaluateSubmissionVerification(input: SubmissionVerificationInput): SubmissionVerificationResult {
  const {
    baselineUserHash,
    baselineGenerating,
    baselineLatestUserText,
    currentUserHash,
    currentGenerating,
    currentLatestUserText,
    relayPayloadText,
    expectedHopId
  } = input;

  const userTurnChanged = analyzeUserTurnChange(baselineLatestUserText, currentLatestUserText);
  const userTurnHopBinding = analyzeUserTurnHopBinding(
    baselineLatestUserText,
    currentLatestUserText,
    expectedHopId,
    relayPayloadText
  );
  
  const hopBindingAnalysis = analyzeHopBinding(currentLatestUserText, relayPayloadText, expectedHopId);
  const hopBindingStrength = hopBindingAnalysis.hopBindingStrength;
  const containsBridgeContext = hopBindingAnalysis.containsBridgeContext;
  const extractedHopId = hopBindingAnalysis.extractedHopId;
  
  const payloadCorrelationStrength = analyzePayloadCorrelation(
    currentLatestUserText,
    relayPayloadText,
    hopBindingStrength
  );
  
  const generationSettlementStrength = analyzeGenerationSettlement(
    baselineGenerating,
    currentGenerating
  );
  
  const textOverlapRatio = calculateTextOverlap(
    normalizeAssistantText(currentLatestUserText ?? ""),
    normalizeAssistantText(relayPayloadText)
  );

  const userHashChanged = currentUserHash !== null && currentUserHash !== baselineUserHash;

  const baseDetails = {
    baselineUserHash,
    currentUserHash,
    baselineGenerating,
    currentGenerating,
    baselineLatestUserText,
    currentLatestUserText,
    textOverlapRatio,
    containsBridgeContext,
    extractedHopId,
    expectedHopId: expectedHopId ?? null
  };

  if (!userTurnChanged || payloadCorrelationStrength === "none") {
    return {
      verified: false,
      reason: "not_verified",
      hopBindingStrength,
      payloadCorrelationStrength,
      generationSettlementStrength,
      userTurnChanged,
      userTurnHopBinding,
      assistantSettlementStrength: "unavailable",
      details: baseDetails
    };
  }

  if (userHashChanged && hopBindingStrength === "strong") {
    return {
      verified: true,
      reason: "payload_accepted_strong",
      hopBindingStrength,
      payloadCorrelationStrength: "strong",
      generationSettlementStrength,
      userTurnChanged,
      userTurnHopBinding,
      assistantSettlementStrength: "unavailable",
      details: baseDetails
    };
  }

  if (userHashChanged && hopBindingStrength === "weak") {
    return {
      verified: false,
      reason: "not_verified_weak_correlation",
      hopBindingStrength,
      payloadCorrelationStrength,
      generationSettlementStrength,
      userTurnChanged,
      userTurnHopBinding,
      assistantSettlementStrength: "unavailable",
      details: baseDetails
    };
  }

  if (generationSettlementStrength === "strong" && userTurnChanged && payloadCorrelationStrength === "strong") {
    return {
      verified: true,
      reason: "generation_started_with_hop_bound_payload",
      hopBindingStrength,
      payloadCorrelationStrength,
      generationSettlementStrength,
      userTurnChanged,
      userTurnHopBinding,
      assistantSettlementStrength: "unavailable",
      details: baseDetails
    };
  }

  return {
    verified: false,
    reason: "not_verified",
    hopBindingStrength,
    payloadCorrelationStrength,
    generationSettlementStrength,
    userTurnChanged,
    userTurnHopBinding,
    assistantSettlementStrength: "unavailable",
    details: baseDetails
  };
}
