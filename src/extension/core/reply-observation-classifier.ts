import { STOP_REASONS } from "./constants.ts";

export type ReplyObservationInput = {
  elapsedMs: number; idleMs: number; baselineHash: string | null; currentHash: string | null;
  generating: boolean; replyPending: boolean; pageVisibility: "visible"|"hidden"|"unknown";
  tabLifecycle?: { active: boolean | null; discarded: boolean | null; frozen: boolean | null; status: string | null; };
  generationObservedAfterDispatch: boolean; hopTimeoutMs: number;
};
export type ReplyObservationDecision =
  | { kind: "continue"; progressObserved: boolean; reason: string }
  | { kind: "settled"; hash: string; reason: string }
  | { kind: "stop"; stopReason: string; reason: string };

export function classifyReplyObservation(input: ReplyObservationInput): ReplyObservationDecision {
  if (input.currentHash && input.currentHash !== input.baselineHash) return { kind: "settled", hash: input.currentHash, reason: "assistant_hash_changed" };
  if (input.elapsedMs >= input.hopTimeoutMs) return { kind: "stop", stopReason: STOP_REASONS.HOP_TIMEOUT, reason: "hop_timeout_elapsed" };
  if (input.tabLifecycle?.discarded) return { kind: "stop", stopReason: STOP_REASONS.STALE_TARGET, reason: "tab_discarded" };
  if (input.tabLifecycle?.frozen) return { kind: "continue", progressObserved: false, reason: "tab_frozen_wait" };
  if (input.tabLifecycle?.status === "unloaded") return { kind: "stop", stopReason: STOP_REASONS.UNREACHABLE_TARGET, reason: "tab_unreachable" };
  if (!input.generationObservedAfterDispatch && input.pageVisibility === "hidden" && !input.generating && input.replyPending) {
    return { kind: "stop", stopReason: STOP_REASONS.TARGET_HIDDEN_NO_GENERATION, reason: "hidden_no_generation" };
  }
  if (input.generating) return { kind: "continue", progressObserved: input.idleMs < Math.floor(input.hopTimeoutMs/2), reason: input.idleMs < Math.floor(input.hopTimeoutMs/2) ? "generating_recent" : "generating_stale" };
  return { kind: "continue", progressObserved: false, reason: input.replyPending ? "reply_pending_without_progress" : "waiting_new_hash" };
}
