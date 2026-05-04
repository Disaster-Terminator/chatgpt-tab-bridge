import type { DebugReport, OverlaySettings, RuntimeEvent, RuntimeState } from "../shared/types.js";

function summarizeBindings(state: RuntimeState): string {
  const parts = (["A", "B"] as const).map((role) => {
    const binding = state.bindings[role];
    return binding ? `${role}:${binding.tabId}` : `${role}:unbound`;
  });
  return parts.join(", ");
}

function buildIssueAdvice(state: RuntimeState): string | null {
  if (state.lastError) {
    return `Runtime error recorded (${state.lastError}). Inspect recent runtime events for the failing phaseStep and verification verdict.`;
  }
  if (state.lastStopReason) {
    return `Session stopped with reason (${state.lastStopReason}). Confirm this stop reason is expected for the current phase and bindings.`;
  }
  return null;
}

export function buildDebugReport(input: {
  state: RuntimeState;
  overlaySettings: OverlaySettings;
  runtimeEvents: RuntimeEvent[];
}): DebugReport {
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    state: input.state,
    overlaySettings: input.overlaySettings,
    runtimeEvents: input.runtimeEvents,
    bindingsSummary: summarizeBindings(input.state),
    issueAdvice: buildIssueAdvice(input.state)
  };
}
