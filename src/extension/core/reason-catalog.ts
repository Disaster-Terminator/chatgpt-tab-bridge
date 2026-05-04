import type { ErrorReason, StopReason } from "../shared/types.js";

export interface IssueAdvice {
  code: string;
  title: string;
  advice: string[];
}

const STOP_REASON_ADVICE: Record<StopReason, IssueAdvice> = {
  user_stop: {
    code: "user_stop",
    title: "Stopped by user",
    advice: ["Session was stopped manually."]
  },
  stop_marker: { code: "stop_marker", title: "Stop marker reached", advice: ["Remove stop marker text to continue relaying."] },
  max_rounds_reached: { code: "max_rounds_reached", title: "Max rounds reached", advice: ["Increase max rounds or restart session."] },
  duplicate_output: { code: "duplicate_output", title: "Duplicate output detected", advice: ["Check prompt variance to avoid repeated assistant text."] },
  starter_empty: { code: "starter_empty", title: "Starter has no content", advice: ["Add starter prompt content before starting."] },
  hop_timeout: { code: "hop_timeout", title: "Hop timed out", advice: ["Increase hop timeout.", "Ensure target tab is visible and responsive."] },
  target_hidden_no_generation: { code: "target_hidden_no_generation", title: "Target hidden and not generating", advice: ["Bring target tab to foreground and retry."] },
  reply_observation_missing: { code: "reply_observation_missing", title: "Reply observation missing", advice: ["Retry after target tab stabilizes."] },
  wrong_target: { code: "wrong_target", title: "Wrong target detected", advice: ["Rebind tabs to the correct A/B conversations."] },
  stale_target: { code: "stale_target", title: "Stale target detected", advice: ["Refresh target tab and retry."] },
  unreachable_target: { code: "unreachable_target", title: "Target unreachable", advice: ["Check tab availability and permissions."] },
  binding_invalid: { code: "binding_invalid", title: "Binding invalid", advice: ["Rebind the missing or invalid tab."] },
  starter_settle_timeout: { code: "starter_settle_timeout", title: "Starter settle timeout", advice: ["Increase settle timeout or poll interval."] },
  target_settle_timeout: { code: "target_settle_timeout", title: "Target settle timeout", advice: ["Increase settle timeout or reduce tab load."] },
  submission_not_verified: { code: "submission_not_verified", title: "Submission not verified", advice: ["Retry and verify send button behavior."] },
  bootstrap_seed_not_sent: { code: "bootstrap_seed_not_sent", title: "Bootstrap seed not sent", advice: ["Ensure the first hop can submit in the starter tab."] },
  dispatch_rejected: { code: "dispatch_rejected", title: "Dispatch rejected", advice: ["Check composer state and send trigger conditions."] },
  verification_failed: { code: "verification_failed", title: "Verification failed", advice: ["Inspect runtime events for selector and baseline mismatches."] },
  waiting_before_acceptance: { code: "waiting_before_acceptance", title: "Waiting before acceptance", advice: ["Allow more time for target completion."] },
  url_not_available: { code: "url_not_available", title: "URL unavailable", advice: ["Open a supported chatgpt.com conversation URL and rebind."] }
};

const ERROR_REASON_ADVICE: Record<ErrorReason, IssueAdvice> = {
  selector_failure: { code: "selector_failure", title: "Selector failure", advice: ["Check page layout changes and selectors."] },
  message_send_failed: { code: "message_send_failed", title: "Message send failed", advice: ["Ensure input and send controls are available."] },
  unsupported_tab: { code: "unsupported_tab", title: "Unsupported tab", advice: ["Use a supported ChatGPT conversation URL."] },
  empty_assistant_reply: { code: "empty_assistant_reply", title: "Empty assistant reply", advice: ["Retry after the assistant response is visible."] },
  internal_error: { code: "internal_error", title: "Internal error", advice: ["Check recent runtime events for failure context."] }
};

export function getIssueAdvice(reason: string | null | undefined): IssueAdvice | null {
  if (!reason) {
    return null;
  }

  const [base] = reason.split(":");
  return (STOP_REASON_ADVICE as Record<string, IssueAdvice>)[base]
    ?? (ERROR_REASON_ADVICE as Record<string, IssueAdvice>)[base]
    ?? null;
}
