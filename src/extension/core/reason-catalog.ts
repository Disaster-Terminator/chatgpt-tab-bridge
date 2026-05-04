import { ERROR_REASONS, STOP_REASONS } from "./constants.ts";
import type { RuntimeIssueAdvice } from "../shared/types.js";

const stopAdvice: Record<string, RuntimeIssueAdvice> = {
  [STOP_REASONS.USER_STOP]: { code: STOP_REASONS.USER_STOP, severity: "info", category: "user_action", title: "Session stopped by user", explanation: "The relay was stopped manually.", suggestedAction: "Start again when you are ready.", retryable: true },
  [STOP_REASONS.STOP_MARKER]: { code: STOP_REASONS.STOP_MARKER, severity: "info", category: "user_action", title: "Stop marker detected", explanation: "A stop marker was found in assistant output.", suggestedAction: "Remove the stop marker or restart from the other side.", retryable: true },
  [STOP_REASONS.MAX_ROUNDS]: { code: STOP_REASONS.MAX_ROUNDS, severity: "info", category: "user_action", title: "Max rounds reached", explanation: "The configured max rounds limit was reached.", suggestedAction: "Increase max rounds or restart the session.", retryable: true },
  [STOP_REASONS.DUPLICATE_OUTPUT]: { code: STOP_REASONS.DUPLICATE_OUTPUT, severity: "info", category: "user_action", title: "Duplicate output detected", explanation: "The latest hop appears to repeat prior output.", suggestedAction: "Review prompts and restart if needed.", retryable: true },
  [STOP_REASONS.STARTER_EMPTY]: { code: STOP_REASONS.STARTER_EMPTY, severity: "warning", category: "user_action", title: "Starter side has no assistant reply", explanation: "The starter tab does not have assistant content yet.", suggestedAction: "Generate one assistant reply on starter tab first.", retryable: true },
  [STOP_REASONS.HOP_TIMEOUT]: { code: STOP_REASONS.HOP_TIMEOUT, severity: "warning", category: "timeout", title: "Hop timed out", explanation: "No settled reply was observed before the hop timeout.", suggestedAction: "Check target tab responsiveness and retry.", retryable: true },
  [STOP_REASONS.TARGET_HIDDEN_NO_GENERATION]: { code: STOP_REASONS.TARGET_HIDDEN_NO_GENERATION, severity: "warning", category: "browser_lifecycle", title: "Target tab accepted input but did not start generation", explanation: "The target tab stayed hidden and never entered generating state.", suggestedAction: "Switch to the target tab, or enable target wake policy.", retryable: true },
  [STOP_REASONS.REPLY_OBSERVATION_MISSING]: { code: STOP_REASONS.REPLY_OBSERVATION_MISSING, severity: "warning", category: "chatgpt_dom", title: "Reply observation missing", explanation: "The extension could not observe reply state from target tab.", suggestedAction: "Reload target tab and confirm ChatGPT UI is fully loaded.", retryable: true },
  [STOP_REASONS.WRONG_TARGET]: { code: STOP_REASONS.WRONG_TARGET, severity: "warning", category: "binding", title: "Wrong target tab", explanation: "The active target no longer matches the expected binding.", suggestedAction: "Re-bind both tabs and restart.", retryable: true },
  [STOP_REASONS.STALE_TARGET]: { code: STOP_REASONS.STALE_TARGET, severity: "warning", category: "binding", title: "Stale target tab", explanation: "The target tab context appears stale or replaced.", suggestedAction: "Refresh or re-open target tab, then re-bind.", retryable: true },
  [STOP_REASONS.UNREACHABLE_TARGET]: { code: STOP_REASONS.UNREACHABLE_TARGET, severity: "error", category: "browser_lifecycle", title: "Target tab unreachable", explanation: "The extension could not communicate with the target tab.", suggestedAction: "Bring tab online or re-bind to an available tab.", retryable: true },
  [STOP_REASONS.BINDING_INVALID]: { code: STOP_REASONS.BINDING_INVALID, severity: "error", category: "binding", title: "Binding invalid", explanation: "One or more tab bindings are invalid for relay.", suggestedAction: "Re-bind both tabs to supported ChatGPT thread URLs.", retryable: true },
  [STOP_REASONS.STARTER_SETTLE_TIMEOUT]: { code: STOP_REASONS.STARTER_SETTLE_TIMEOUT, severity: "warning", category: "timeout", title: "Starter settle timed out", explanation: "Starter tab did not reach stable state in time.", suggestedAction: "Wait for starter tab to settle and retry.", retryable: true },
  [STOP_REASONS.TARGET_SETTLE_TIMEOUT]: { code: STOP_REASONS.TARGET_SETTLE_TIMEOUT, severity: "warning", category: "timeout", title: "Target settle timed out", explanation: "Target tab did not reach stable state in time.", suggestedAction: "Wait for target tab to settle and retry.", retryable: true },
  [STOP_REASONS.SUBMISSION_NOT_VERIFIED]: { code: STOP_REASONS.SUBMISSION_NOT_VERIFIED, severity: "warning", category: "chatgpt_dom", title: "Submission was not verified", explanation: "Input dispatch did not produce expected post-submit evidence.", suggestedAction: "Check ChatGPT composer state and retry the hop.", retryable: true }
};

const errorAdvice: Record<string, RuntimeIssueAdvice> = {
  [ERROR_REASONS.SELECTOR_FAILURE]: { code: ERROR_REASONS.SELECTOR_FAILURE, severity: "error", category: "chatgpt_dom", title: "Selector lookup failed", explanation: "Required ChatGPT UI selectors were not found.", suggestedAction: "Refresh the page and verify ChatGPT DOM is fully loaded.", retryable: true },
  [ERROR_REASONS.MESSAGE_SEND_FAILED]: { code: ERROR_REASONS.MESSAGE_SEND_FAILED, severity: "error", category: "chatgpt_dom", title: "Message send failed", explanation: "The extension could not complete message submission.", suggestedAction: "Check composer focus/button state and retry.", retryable: true },
  [ERROR_REASONS.UNSUPPORTED_TAB]: { code: ERROR_REASONS.UNSUPPORTED_TAB, severity: "error", category: "binding", title: "Unsupported tab URL", explanation: "The bound tab is not a supported ChatGPT thread URL.", suggestedAction: "Use chatgpt.com/c/<id> or project conversation URL.", retryable: true },
  [ERROR_REASONS.EMPTY_ASSISTANT_REPLY]: { code: ERROR_REASONS.EMPTY_ASSISTANT_REPLY, severity: "error", category: "chatgpt_dom", title: "Assistant reply was empty", explanation: "No usable assistant reply text was captured.", suggestedAction: "Wait for generation completion and retry.", retryable: true },
  [ERROR_REASONS.INTERNAL_ERROR]: { code: ERROR_REASONS.INTERNAL_ERROR, severity: "error", category: "internal", title: "Internal runtime error", explanation: "An unexpected internal runtime condition occurred.", suggestedAction: "Collect debug report and restart the extension session.", retryable: true }
};

function fallback(reason: string, severity: "warning" | "error"): RuntimeIssueAdvice {
  return { code: reason, severity, category: "internal", title: "Unknown runtime issue", explanation: `No catalog entry for reason: ${reason}.`, suggestedAction: "Collect debug report and inspect runtime events.", retryable: true };
}

export function describeStopReason(reason: string | null | undefined): RuntimeIssueAdvice | null { if (!reason) return null; return stopAdvice[reason] ?? fallback(reason, "warning"); }
export function describeErrorReason(reason: string | null | undefined): RuntimeIssueAdvice | null { if (!reason) return null; const code = reason.split(":")[0]; return errorAdvice[code] ?? fallback(reason, "error"); }
export function describeRuntimeIssue(input: { stopReason?: string | null; errorReason?: string | null; }): RuntimeIssueAdvice | null {
  return describeErrorReason(input.errorReason) ?? describeStopReason(input.stopReason);
}
