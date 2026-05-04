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

const stopReasonDescriptions: Record<string, Omit<ReasonDescription, "reason">> = {
  [STOP_REASONS.USER_STOP]: {
    title: "Stopped by user",
    severity: "info",
    summary: "The bridge was stopped manually.",
    nextAction: "Start a new session when you're ready to continue."
  },
  [STOP_REASONS.STOP_MARKER]: {
    title: "Stop marker received",
    severity: "info",
    summary: "A configured stop marker ended the relay loop.",
    nextAction: "Review the latest reply and restart if more rounds are needed."
  },
  [STOP_REASONS.MAX_ROUNDS]: {
    title: "Max rounds reached",
    severity: "warning",
    summary: "The session reached the configured maximum round limit.",
    nextAction: "Increase the max rounds setting or continue manually."
  },
  [STOP_REASONS.DUPLICATE_OUTPUT]: {
    title: "Duplicate output detected",
    severity: "warning",
    summary: "The relay stopped because output repeated without meaningful change.",
    nextAction: "Check prompts for repetition, then resume with updated context."
  },
  [STOP_REASONS.STARTER_EMPTY]: {
    title: "Starter message missing",
    severity: "warning",
    summary: "No starter message was available when the session attempted to run.",
    nextAction: "Set a starter message in the popup and try again."
  },
  [STOP_REASONS.HOP_TIMEOUT]: {
    title: "Hop timeout",
    severity: "warning",
    summary: "A relay hop took longer than the configured timeout window.",
    nextAction: "Increase timeout settings or retry when the target tab is responsive."
  },
  [STOP_REASONS.TARGET_HIDDEN_NO_GENERATION]: {
    title: "Target tab hidden",
    severity: "warning",
    summary: "The target tab was hidden and no generation activity was observed.",
    nextAction: "Bring both tabs to the foreground and restart the session."
  },
  [STOP_REASONS.REPLY_OBSERVATION_MISSING]: {
    title: "Reply observation missing",
    severity: "warning",
    summary: "A relay reply could not be observed after submission.",
    nextAction: "Retry and confirm the destination thread is still active."
  },
  [STOP_REASONS.WRONG_TARGET]: {
    title: "Wrong target tab",
    severity: "warning",
    summary: "The active relay target no longer matches the expected thread.",
    nextAction: "Rebind tabs to the intended conversation targets."
  },
  [STOP_REASONS.STALE_TARGET]: {
    title: "Stale target",
    severity: "warning",
    summary: "The target context became stale before relay completion.",
    nextAction: "Refresh or reopen the target tab, then bind again."
  },
  [STOP_REASONS.UNREACHABLE_TARGET]: {
    title: "Target unreachable",
    severity: "warning",
    summary: "The extension could not reach the expected target tab.",
    nextAction: "Confirm the target tab is open and on a supported ChatGPT URL."
  },
  [STOP_REASONS.BINDING_INVALID]: {
    title: "Binding invalid",
    severity: "warning",
    summary: "Stored tab binding was invalid for this session.",
    nextAction: "Clear binding and bind the two tabs again."
  },
  [STOP_REASONS.STARTER_SETTLE_TIMEOUT]: {
    title: "Starter settle timeout",
    severity: "warning",
    summary: "Starter tab did not settle before timeout.",
    nextAction: "Wait for the tab to finish loading, then retry."
  },
  [STOP_REASONS.TARGET_SETTLE_TIMEOUT]: {
    title: "Target settle timeout",
    severity: "warning",
    summary: "Target tab did not settle before timeout.",
    nextAction: "Wait for the target tab to stabilize, then restart."
  },
  [STOP_REASONS.SUBMISSION_NOT_VERIFIED]: {
    title: "Submission not verified",
    severity: "warning",
    summary: "The extension could not verify that a relay submission was accepted.",
    nextAction: "Retry and watch for composer/ack indicators in the target tab."
  }
};

const errorReasonDescriptions: Record<string, Omit<ReasonDescription, "reason">> = {
  [ERROR_REASONS.SELECTOR_FAILURE]: {
    title: "Selector failure",
    severity: "error",
    summary: "Required page elements were not found for this operation.",
    nextAction: "Refresh the page and retry after the UI fully loads."
  },
  [ERROR_REASONS.MESSAGE_SEND_FAILED]: {
    title: "Message send failed",
    severity: "error",
    summary: "The extension failed to submit a relay message.",
    nextAction: "Retry the session and confirm the composer is interactive."
  },
  [ERROR_REASONS.UNSUPPORTED_TAB]: {
    title: "Unsupported tab",
    severity: "error",
    summary: "The selected tab is not a supported ChatGPT conversation page.",
    nextAction: "Open a supported chat URL and rebind the tabs."
  },
  [ERROR_REASONS.EMPTY_ASSISTANT_REPLY]: {
    title: "Empty assistant reply",
    severity: "error",
    summary: "No assistant reply content was available for relay.",
    nextAction: "Wait for generation to complete, then retry."
  },
  [ERROR_REASONS.INTERNAL_ERROR]: {
    title: "Internal error",
    severity: "error",
    summary: "An unexpected internal bridge error occurred.",
    nextAction: "Restart the extension session and collect logs if it repeats."
  }
};

function describeReason(
  reason: string | null | undefined,
  catalog: Record<string, Omit<ReasonDescription, "reason">>,
  unknownReason: string,
  fallback: Omit<ReasonDescription, "reason">
): ReasonDescription {
  const normalizedReason = String(reason ?? "").split(":", 1)[0];

  if (!normalizedReason || !catalog[normalizedReason]) {
    return { ...fallback, reason: unknownReason };
  }

  return { ...catalog[normalizedReason], reason: normalizedReason };
}

export function describeStopReason(reason: string | null | undefined): ReasonDescription {
  return describeReason(reason, stopReasonDescriptions, UNKNOWN_STOP_REASON, {
    title: "Stopped",
    severity: "warning",
    summary: "The bridge stopped for an unrecognized reason.",
    nextAction: "Review the latest runtime event details and retry."
  });
}

export function describeErrorReason(reason: string | null | undefined): ReasonDescription {
  return describeReason(reason, errorReasonDescriptions, UNKNOWN_ERROR_REASON, {
    title: "Error",
    severity: "error",
    summary: "The bridge hit an unrecognized error reason.",
    nextAction: "Retry the action and collect diagnostics if it persists."
  });
}

export function describeIssueReason(reason: string | null | undefined): ReasonDescription {
  const normalizedReason = String(reason ?? "").split(":", 1)[0];

  return errorReasonDescriptions[normalizedReason]
    ? describeErrorReason(reason)
    : describeStopReason(reason);
}
