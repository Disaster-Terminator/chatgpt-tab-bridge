export type ReplyObservationState =
  | "correct_target"
  | "wrong_target"
  | "stale_target"
  | "unreachable_target"
  | "pending_generation"
  | "pending_no_progress"
  | "hidden_no_generation"
  | "timeout";

export type ReplyObservationInput = {
  expectedTargetId: string;
  observedTargetId: string | null;
  reachable: boolean;
  hidden: boolean;
  timedOut: boolean;
  generating: boolean;
  progressTick: number;
  settleSamplesRequired: number;
  settledStableSamples: number;
  contentHashChanged: boolean;
};

export type ReplyObservationClassification = {
  state: ReplyObservationState;
  isPending: boolean;
  isSettledCandidate: boolean;
  debug: {
    expectedTargetId: string;
    observedTargetId: string | null;
    reachable: boolean;
    hidden: boolean;
    timedOut: boolean;
    generating: boolean;
    progressTick: number;
    settleSamplesRequired: number;
    settledStableSamples: number;
    contentHashChanged: boolean;
    targetMatch: boolean;
    hasProgress: boolean;
    hasStableConfirmation: boolean;
  };
};

export function classifyReplyObservation(
  input: ReplyObservationInput
): ReplyObservationClassification {
  const targetMatch = input.observedTargetId === input.expectedTargetId;
  const hasProgress = input.progressTick > 0;
  const hasStableConfirmation = input.settledStableSamples >= input.settleSamplesRequired;

  let state: ReplyObservationState;

  if (!input.reachable) {
    state = "unreachable_target";
  } else if (!targetMatch) {
    state = "wrong_target";
  } else if (input.hidden && !input.generating) {
    state = "hidden_no_generation";
  } else if (input.timedOut) {
    state = "timeout";
  } else if (input.generating && !hasProgress) {
    state = "stale_target";
  } else if (input.generating) {
    state = "pending_generation";
  } else if (!hasStableConfirmation) {
    state = "pending_no_progress";
  } else {
    state = "correct_target";
  }

  const isPending = state === "pending_generation" || state === "pending_no_progress";
  const isSettledCandidate = state === "correct_target";

  return {
    state,
    isPending,
    isSettledCandidate,
    debug: {
      expectedTargetId: input.expectedTargetId,
      observedTargetId: input.observedTargetId,
      reachable: input.reachable,
      hidden: input.hidden,
      timedOut: input.timedOut,
      generating: input.generating,
      progressTick: input.progressTick,
      settleSamplesRequired: input.settleSamplesRequired,
      settledStableSamples: input.settledStableSamples,
      contentHashChanged: input.contentHashChanged,
      targetMatch,
      hasProgress,
      hasStableConfirmation
    }
  };
}
