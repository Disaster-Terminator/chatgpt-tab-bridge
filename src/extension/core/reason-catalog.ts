import type { StopReason } from "../shared/types.js";

const ISSUE_ADVICE_BY_REASON: Record<string, string> = Object.freeze({
  hop_timeout: "The target reply did not settle before timeout. Increase hopTimeoutMs or reduce chat load.",
  target_hidden_no_generation: "Target tab appears hidden and never generated. Focus the target tab and retry.",
  reply_observation_missing: "Reply observations were incomplete. Confirm target thread is reachable and not stale.",
  wrong_target: "Observations came from a different target. Rebind both tabs before restarting.",
  stale_target: "Target data looks stale. Refresh the target tab and rebind the role.",
  unreachable_target: "Target tab could not be reached. Verify the binding still points to an open ChatGPT thread.",
  binding_invalid: "A binding became invalid. Rebind both roles and restart.",
  starter_settle_timeout: "Starter did not settle in time. Wait for generation to finish, then retry.",
  target_settle_timeout: "Target did not settle in time. Increase settleSamplesRequired or poll interval if needed.",
  submission_not_verified: "Dispatch could not be verified. Retry and verify composer/send controls are available.",
  bootstrap_seed_not_sent: "Bootstrap seed message was not sent. Check page interaction permissions and retry.",
  dispatch_rejected: "Dispatch was rejected by the page controls. Verify send controls are enabled.",
  verification_failed: "Post-dispatch verification failed. Rebind and retry with a stable target thread.",
  waiting_before_acceptance: "Acceptance precondition did not clear in time. Retry after thread activity stabilizes.",
  url_not_available: "Thread URL was unavailable. Keep the tab on a supported chat thread and rebind.",
  starter_empty: "Starter thread has no assistant output yet. Wait for a reply before starting."
});

export function getIssueAdvice(reason: StopReason | string | null | undefined): string | null {
  if (!reason) {
    return null;
  }
  return ISSUE_ADVICE_BY_REASON[reason] ?? null;
}
