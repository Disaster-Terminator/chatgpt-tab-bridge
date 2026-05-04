import type { DebugReport, OverlaySettings, RuntimeEvent, RuntimeState } from "../shared/types.js";

function summarizeBinding(binding: RuntimeState["bindings"]["A" | "B"]): string {
  if (!binding) {
    return "unbound";
  }
  return `${binding.role}#${binding.tabId}:${binding.urlInfo?.supported ? binding.urlInfo.kind : "unsupported"}`;
}

function buildIssueAdvice(state: RuntimeState): string[] {
  const advice: string[] = [];

  if (state.lastStopReason) {
    advice.push(`Last stop reason: ${state.lastStopReason}. Check runtime events around the stop boundary.`);
  }

  if (state.lastError) {
    advice.push(`Last error: ${state.lastError}. Inspect send/verification evidence and active hop progress.`);
  }

  return advice;
}

export function buildDebugReport(input: {
  state: RuntimeState;
  overlaySettings: OverlaySettings;
  runtimeEvents: RuntimeEvent[];
}): DebugReport {
  const { state, overlaySettings, runtimeEvents } = input;
  const issueAdvice = buildIssueAdvice(state);

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    state,
    overlaySettings,
    bindingsSummary: {
      A: summarizeBinding(state.bindings.A),
      B: summarizeBinding(state.bindings.B)
    },
    recentRuntimeEvents: runtimeEvents,
    issueAdvice: issueAdvice.length > 0 ? issueAdvice : undefined
  };
}
