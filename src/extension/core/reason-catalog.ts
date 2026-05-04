export interface IssueAdvice {
  title: string;
  summary: string;
  nextAction: string;
  diagnostic: string;
}

const DEFAULT_ADVICE = {
  title: "Bridge stopped with issue",
  summary: "The relay halted before a normal completion condition.",
  nextAction: "Review bindings and current tab state, then clear terminal and restart."
};

const CATALOG: Record<string, Omit<IssueAdvice, "diagnostic">> = {
  hop_timeout: {
    title: "Reply timeout",
    summary: "No acceptable target reply arrived within the hop timeout window.",
    nextAction: "Keep the target tab visible, verify it can generate, then retry."
  },
  target_hidden_no_generation: {
    title: "Target tab hidden",
    summary: "The target tab was hidden and no generation activity was detected.",
    nextAction: "Bring the target tab to foreground and wait for generation before resuming."
  }
};

export function buildIssueAdvice(reason: string): IssueAdvice {
  const known = CATALOG[reason];
  if (known) {
    return { ...known, diagnostic: reason };
  }
  return {
    ...DEFAULT_ADVICE,
    diagnostic: reason
  };
}
