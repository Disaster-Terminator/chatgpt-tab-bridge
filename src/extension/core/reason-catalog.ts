import { ERROR_REASONS, STOP_REASONS } from "./constants.ts";

type CatalogEntry = {
  title: string;
  summary: string;
  nextAction: string;
};

const REASON_CATALOG: Record<string, CatalogEntry> = {
  [STOP_REASONS.HOP_TIMEOUT]: {
    title: "Reply timed out",
    summary: "The target tab did not produce a stable assistant reply before timeout.",
    nextAction: "Check target tab visibility and response progress, then resume or restart."
  },
  [STOP_REASONS.TARGET_HIDDEN_NO_GENERATION]: {
    title: "Target tab hidden",
    summary: "The target tab stayed hidden and never entered generation.",
    nextAction: "Bring the target tab to foreground and retry from the terminal state."
  },
  [STOP_REASONS.REPLY_OBSERVATION_MISSING]: {
    title: "Reply observation missing",
    summary: "Reply checks could not confirm a valid assistant observation.",
    nextAction: "Verify the tab URL/binding pair and retry."
  },
  [ERROR_REASONS.SELECTOR_FAILURE]: {
    title: "UI selector failed",
    summary: "The extension could not find an expected ChatGPT UI element.",
    nextAction: "Refresh the tab and rebind if layout changed."
  }
};

export const FALLBACK_ISSUE_ADVICE: CatalogEntry = {
  title: "Bridge issue detected",
  summary: "The session stopped with an unclassified reason.",
  nextAction: "Use debug info and logs, then retry after checking both tabs."
};

export function getIssueAdviceByReason(reason: string): CatalogEntry {
  return REASON_CATALOG[reason] ?? FALLBACK_ISSUE_ADVICE;
}
