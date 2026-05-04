export const REPLY_OBSERVATION_STATES = {
  CORRECT_TARGET: "correct_target",
  WRONG_TARGET: "wrong_target",
  STALE_TARGET: "stale_target",
  UNREACHABLE_TARGET: "unreachable_target",
  PENDING_GENERATION: "pending_generation",
  PENDING_NO_PROGRESS: "pending_no_progress",
  HIDDEN_NO_GENERATION: "hidden_no_generation",
  TIMEOUT: "timeout"
} as const;

export type ReplyObservationState =
  (typeof REPLY_OBSERVATION_STATES)[keyof typeof REPLY_OBSERVATION_STATES];

export interface ReplyObservationInput {
  matchesTarget: boolean;
  reachable: boolean;
  hidden: boolean;
  generating: boolean;
  replyPending: boolean;
  timedOut: boolean;
  assistantHashChanged: boolean;
  progressStale: boolean;
  confirmedSamples: number;
  settleSamplesRequired: number;
}

export interface ReplyObservationClassification {
  state: ReplyObservationState;
  settled: boolean;
  reasons: string[];
  debug: {
    matchesTarget: boolean;
    reachable: boolean;
    hidden: boolean;
    generating: boolean;
    replyPending: boolean;
    timedOut: boolean;
    assistantHashChanged: boolean;
    progressStale: boolean;
    confirmedSamples: number;
    settleSamplesRequired: number;
    needsMoreSamples: boolean;
    confirmationReached: boolean;
  };
}

export function classifyReplyObservation(
  input: ReplyObservationInput
): ReplyObservationClassification {
  const needsMoreSamples = input.confirmedSamples < input.settleSamplesRequired;
  const confirmationReached = !needsMoreSamples;

  const debug = {
    matchesTarget: input.matchesTarget,
    reachable: input.reachable,
    hidden: input.hidden,
    generating: input.generating,
    replyPending: input.replyPending,
    timedOut: input.timedOut,
    assistantHashChanged: input.assistantHashChanged,
    progressStale: input.progressStale,
    confirmedSamples: input.confirmedSamples,
    settleSamplesRequired: input.settleSamplesRequired,
    needsMoreSamples,
    confirmationReached
  };

  if (!input.reachable) {
    return { state: REPLY_OBSERVATION_STATES.UNREACHABLE_TARGET, settled: false, reasons: ["target_unreachable"], debug };
  }

  if (!input.matchesTarget) {
    return { state: REPLY_OBSERVATION_STATES.WRONG_TARGET, settled: false, reasons: ["target_mismatch"], debug };
  }

  if (input.timedOut) {
    return { state: REPLY_OBSERVATION_STATES.TIMEOUT, settled: false, reasons: ["poll_timeout"], debug };
  }

  if (input.hidden && !input.generating) {
    return {
      state: REPLY_OBSERVATION_STATES.HIDDEN_NO_GENERATION,
      settled: false,
      reasons: ["hidden_page", "no_generation_activity"],
      debug
    };
  }

  if (input.generating && input.progressStale) {
    return { state: REPLY_OBSERVATION_STATES.STALE_TARGET, settled: false, reasons: ["generation_stale"], debug };
  }

  if (input.generating || input.replyPending) {
    return {
      state: REPLY_OBSERVATION_STATES.PENDING_GENERATION,
      settled: false,
      reasons: ["generation_pending", ...(input.assistantHashChanged ? ["hash_changed"] : [])],
      debug
    };
  }

  if (needsMoreSamples) {
    return {
      state: REPLY_OBSERVATION_STATES.PENDING_NO_PROGRESS,
      settled: false,
      reasons: ["awaiting_confirmed_samples", ...(input.assistantHashChanged ? ["hash_changed"] : [])],
      debug
    };
  }

  return {
    state: REPLY_OBSERVATION_STATES.CORRECT_TARGET,
    settled: true,
    reasons: ["target_confirmed", "stable_confirmed_sample"],
    debug
  };
}
