import { ERROR_REASONS, STOP_REASONS } from "./constants.ts";

export type ReasonSeverity = "info" | "warning" | "error";

export type ReasonDescription = {
  title: string;
  severity: ReasonSeverity;
  summary: string;
  nextAction: string;
  reason: string;
};

const UNKNOWN_STOP_REASON = "unknown_stop_reason";
const UNKNOWN_ERROR_REASON = "unknown_error_reason";

const STOP_REASON_DESCRIPTIONS: Record<string, Omit<ReasonDescription, "reason">> = {
  [STOP_REASONS.USER_STOP]: {
    title: "Stopped by user",
    severity: "info",
    summary: "The relay was stopped manually.",
    nextAction: "Start a new session when you are ready to continue."
  },
  [STOP_REASONS.STOP_MARKER]: {
    title: "Stop marker detected",
    severity: "info",
    summary: "A configured stop marker was detected in the conversation.",
    nextAction: "Review the latest message and restart if more relay rounds are needed."
  },
  [STOP_REASONS.MAX_ROUNDS]: {
    title: "Round limit reached",
    severity: "info",
    summary: "The relay hit the configured maximum number of rounds.",
    nextAction: "Increase max rounds or restart if additional hops are expected."
  },
  [STOP_REASONS.DUPLICATE_OUTPUT]: {
    title: "Duplicate output detected",
    severity: "warning",
    summary: "The target produced repeated output and the relay stopped to avoid loops.",
    nextAction: "Inspect recent replies and adjust the prompt before retrying."
  },
  [STOP_REASONS.STARTER_EMPTY]: {
    title: "Starter message empty",
    severity: "warning",
    summary: "No starter message was available to begin relay.",
    nextAction: "Set a starter message and start the session again."
  },
  [STOP_REASONS.HOP_TIMEOUT]: {
    title: "Hop timed out",
    severity: "warning",
    summary: "A relay hop exceeded the configured timeout.",
    nextAction: "Retry or increase timeout settings if responses are slow."
  },
  [STOP_REASONS.TARGET_HIDDEN_NO_GENERATION]: {
    title: "Target tab inactive",
    severity: "warning",
    summary: "The target tab was hidden and no generation activity was detected.",
    nextAction: "Bring the target tab to the foreground and retry."
  },
  [STOP_REASONS.REPLY_OBSERVATION_MISSING]: {
    title: "Reply not observed",
    severity: "warning",
    summary: "The relay could not observe a usable reply from the target tab.",
    nextAction: "Confirm the target tab produced a response, then rerun."
  },
  [STOP_REASONS.WRONG_TARGET]: {
    title: "Wrong target tab",
    severity: "warning",
    summary: "The bound target tab no longer matches the expected conversation.",
    nextAction: "Rebind tabs to the intended source and target conversations."
  },
  [STOP_REASONS.STALE_TARGET]: {
    title: "Stale target tab",
    severity: "warning",
    summary: "The target tab context became stale during relay.",
    nextAction: "Refresh or reopen the target thread and rebind tabs."
  },
  [STOP_REASONS.UNREACHABLE_TARGET]: {
    title: "Target unreachable",
    severity: "error",
    summary: "The relay could not access the bound target tab.",
    nextAction: "Check tab availability, then rebind and retry."
  },
  [STOP_REASONS.BINDING_INVALID]: {
    title: "Binding invalid",
    severity: "error",
    summary: "Relay binding data is missing or invalid.",
    nextAction: "Clear binding and set tabs again before starting."
  },
  [STOP_REASONS.STARTER_SETTLE_TIMEOUT]: {
    title: "Starter settle timeout",
    severity: "warning",
    summary: "The starter tab did not settle within the expected time.",
    nextAction: "Wait for the tab to settle, then retry."
  },
  [STOP_REASONS.TARGET_SETTLE_TIMEOUT]: {
    title: "Target settle timeout",
    severity: "warning",
    summary: "The target tab did not settle within the expected time.",
    nextAction: "Wait for the tab to settle, then retry."
  },
  [STOP_REASONS.SUBMISSION_NOT_VERIFIED]: {
    title: "Submission not verified",
    severity: "warning",
    summary: "Message submission could not be confirmed.",
    nextAction: "Retry the hop and verify that the message appears in the thread."
  }
};

const ERROR_REASON_DESCRIPTIONS: Record<string, Omit<ReasonDescription, "reason">> = {
  [ERROR_REASONS.SELECTOR_FAILURE]: {
    title: "Selector failure",
    severity: "error",
    summary: "Required page elements could not be located.",
    nextAction: "Reload the tab and try again."
  },
  [ERROR_REASONS.MESSAGE_SEND_FAILED]: {
    title: "Message send failed",
    severity: "error",
    summary: "The extension could not send a required message.",
    nextAction: "Retry the action; if it persists, restart the extension."
  },
  [ERROR_REASONS.UNSUPPORTED_TAB]: {
    title: "Unsupported tab",
    severity: "error",
    summary: "The selected tab is not supported for relay.",
    nextAction: "Use a supported ChatGPT conversation URL and retry."
  },
  [ERROR_REASONS.EMPTY_ASSISTANT_REPLY]: {
    title: "Empty assistant reply",
    severity: "warning",
    summary: "No assistant reply content was captured.",
    nextAction: "Wait for generation to finish and retry the relay hop."
  },
  [ERROR_REASONS.INTERNAL_ERROR]: {
    title: "Internal error",
    severity: "error",
    summary: "An unexpected internal error occurred.",
    nextAction: "Retry; if it continues, collect logs and report the issue."
  }
};

function fallbackReason(reason: string, title: string): ReasonDescription {
  return {
    title,
    severity: "warning",
    summary: "The relay stopped for an unrecognized reason.",
    nextAction: "Review logs and retry; update diagnostics mapping if this recurs.",
    reason
  };
}

export function describeStopReason(reason: string | null | undefined): ReasonDescription {
  const normalizedReason = reason ?? UNKNOWN_STOP_REASON;
  const description = STOP_REASON_DESCRIPTIONS[normalizedReason];
  if (!description) {
    return fallbackReason(normalizedReason, "Unknown stop reason");
  }
  return { ...description, reason: normalizedReason };
}

export function describeErrorReason(reason: string | null | undefined): ReasonDescription {
  const normalizedReason = reason ?? UNKNOWN_ERROR_REASON;
  const description = ERROR_REASON_DESCRIPTIONS[normalizedReason];
  if (!description) {
    return fallbackReason(normalizedReason, "Unknown error reason");
  }
  return { ...description, reason: normalizedReason };
}

export function describeIssueReason(reason: string | null | undefined): ReasonDescription {
  if (reason && ERROR_REASON_DESCRIPTIONS[reason]) {
    return describeErrorReason(reason);
  }
  return describeStopReason(reason);
}
