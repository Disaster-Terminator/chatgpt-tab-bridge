import { ERROR_REASONS, STOP_REASONS } from "./constants.ts";
import type { RuntimeIssueAdvice } from "../shared/types.js";

const stopCatalog: Record<string, RuntimeIssueAdvice> = {
  [STOP_REASONS.USER_STOP]: { code: STOP_REASONS.USER_STOP, severity: "info", category: "user_action", title: "Stopped by user", explanation: "The relay was manually stopped.", suggestedAction: "Resume when ready.", retryable: true },
  [STOP_REASONS.STOP_MARKER]: { code: STOP_REASONS.STOP_MARKER, severity: "info", category: "user_action", title: "Stop marker detected", explanation: "A stop marker was found in the assistant output.", suggestedAction: "Remove marker if you want to continue relay.", retryable: true },
  [STOP_REASONS.MAX_ROUNDS]: { code: STOP_REASONS.MAX_ROUNDS, severity: "info", category: "user_action", title: "Max rounds reached", explanation: "Relay stopped at configured round limit.", suggestedAction: "Increase max rounds if needed.", retryable: true },
  [STOP_REASONS.DUPLICATE_OUTPUT]: { code: STOP_REASONS.DUPLICATE_OUTPUT, severity: "warning", category: "chatgpt_dom", title: "Duplicate output detected", explanation: "Detected duplicated assistant output and halted to avoid loops.", suggestedAction: "Check source/target thread state, then retry.", retryable: true },
  [STOP_REASONS.STARTER_EMPTY]: { code: STOP_REASONS.STARTER_EMPTY, severity: "warning", category: "user_action", title: "Starter side has no assistant reply", explanation: "Starter tab has no assistant message to relay.", suggestedAction: "Generate one assistant reply in starter tab first.", retryable: true },
  [STOP_REASONS.HOP_TIMEOUT]: { code: STOP_REASONS.HOP_TIMEOUT, severity: "warning", category: "timeout", title: "Hop timed out", explanation: "Target side did not settle before timeout.", suggestedAction: "Increase timeout or retry when target is responsive.", retryable: true },
  [STOP_REASONS.TARGET_HIDDEN_NO_GENERATION]: { code: STOP_REASONS.TARGET_HIDDEN_NO_GENERATION, severity: "warning", category: "browser_lifecycle", title: "Target accepted input but did not start generation", explanation: "The target tab appeared hidden/inactive and generation did not start.", suggestedAction: "Switch to the target tab, or enable target wake policy.", retryable: true },
  [STOP_REASONS.REPLY_OBSERVATION_MISSING]: { code: STOP_REASONS.REPLY_OBSERVATION_MISSING, severity: "warning", category: "chatgpt_dom", title: "Reply observation missing", explanation: "Could not reliably observe assistant reply from target tab.", suggestedAction: "Wait for page to stabilize and retry.", retryable: true },
  [STOP_REASONS.WRONG_TARGET]: { code: STOP_REASONS.WRONG_TARGET, severity: "error", category: "binding", title: "Wrong target tab observed", explanation: "Polled tab did not match expected target thread.", suggestedAction: "Rebind tabs A/B to the correct ChatGPT threads.", retryable: true },
  [STOP_REASONS.STALE_TARGET]: { code: STOP_REASONS.STALE_TARGET, severity: "error", category: "binding", title: "Stale target identity", explanation: "Target thread identity changed during hop.", suggestedAction: "Rebind the target tab and rerun.", retryable: true },
  [STOP_REASONS.UNREACHABLE_TARGET]: { code: STOP_REASONS.UNREACHABLE_TARGET, severity: "error", category: "browser_lifecycle", title: "Target tab unreachable", explanation: "Could not reach target tab for observation.", suggestedAction: "Ensure tab is open and extension has access, then retry.", retryable: true },
  [STOP_REASONS.BINDING_INVALID]: { code: STOP_REASONS.BINDING_INVALID, severity: "error", category: "binding", title: "Binding invalid", explanation: "Runtime binding state is invalid.", suggestedAction: "Clear bindings and bind A/B again.", retryable: true },
  [STOP_REASONS.STARTER_SETTLE_TIMEOUT]: { code: STOP_REASONS.STARTER_SETTLE_TIMEOUT, severity: "warning", category: "timeout", title: "Starter settle timeout", explanation: "Starter side did not settle in time.", suggestedAction: "Wait for starter completion and retry.", retryable: true },
  [STOP_REASONS.TARGET_SETTLE_TIMEOUT]: { code: STOP_REASONS.TARGET_SETTLE_TIMEOUT, severity: "warning", category: "timeout", title: "Target settle timeout", explanation: "Target side did not settle during preflight.", suggestedAction: "Retry after target tab becomes stable.", retryable: true },
  [STOP_REASONS.SUBMISSION_NOT_VERIFIED]: { code: STOP_REASONS.SUBMISSION_NOT_VERIFIED, severity: "error", category: "chatgpt_dom", title: "Submission not verified", explanation: "The relay dispatch could not be verified as accepted.", suggestedAction: "Retry and check send button/composer status.", retryable: true }
};

const errorCatalog: Record<string, RuntimeIssueAdvice> = {
  [ERROR_REASONS.SELECTOR_FAILURE]: { code: ERROR_REASONS.SELECTOR_FAILURE, severity: "error", category: "chatgpt_dom", title: "ChatGPT DOM selector failure", explanation: "Required UI elements were not found reliably.", suggestedAction: "Refresh ChatGPT tab and retry.", retryable: true },
  [ERROR_REASONS.MESSAGE_SEND_FAILED]: { code: ERROR_REASONS.MESSAGE_SEND_FAILED, severity: "error", category: "chatgpt_dom", title: "Message send failed", explanation: "The extension attempted to send but trigger failed.", suggestedAction: "Check composer/send button readiness and retry.", retryable: true },
  [ERROR_REASONS.UNSUPPORTED_TAB]: { code: ERROR_REASONS.UNSUPPORTED_TAB, severity: "error", category: "binding", title: "Unsupported tab URL", explanation: "Tab is not a supported ChatGPT conversation URL.", suggestedAction: "Use chatgpt.com/c/... or /g/.../c/... thread URLs.", retryable: true },
  [ERROR_REASONS.EMPTY_ASSISTANT_REPLY]: { code: ERROR_REASONS.EMPTY_ASSISTANT_REPLY, severity: "error", category: "chatgpt_dom", title: "Empty assistant reply", explanation: "Assistant reply text was empty after normalization.", suggestedAction: "Retry after response fully renders.", retryable: true },
  [ERROR_REASONS.INTERNAL_ERROR]: { code: ERROR_REASONS.INTERNAL_ERROR, severity: "error", category: "internal", title: "Internal runtime error", explanation: "Unexpected internal condition interrupted relay.", suggestedAction: "Clear terminal and restart session.", retryable: true }
};

function fallbackAdvice(code: string, severity: RuntimeIssueAdvice["severity"]): RuntimeIssueAdvice {
  return { code, severity, category: "internal", title: "Unknown runtime issue", explanation: "Received an unrecognized runtime reason.", suggestedAction: "Capture debug report and retry.", retryable: true };
}

function normalizeReason(reason: string | null | undefined): string | null {
  if (!reason) return null;
  const [head] = reason.split(":");
  return head || null;
}

export function describeStopReason(reason: string | null | undefined): RuntimeIssueAdvice | null {
  const code = normalizeReason(reason);
  if (!code) return null;
  return stopCatalog[code] ?? fallbackAdvice(code, "warning");
}

export function describeErrorReason(reason: string | null | undefined): RuntimeIssueAdvice | null {
  const code = normalizeReason(reason);
  if (!code) return null;
  return errorCatalog[code] ?? fallbackAdvice(code, "error");
}

export function describeRuntimeIssue(input: { stopReason?: string | null; errorReason?: string | null; }): RuntimeIssueAdvice | null {
  return describeErrorReason(input.errorReason) ?? describeStopReason(input.stopReason);
}
