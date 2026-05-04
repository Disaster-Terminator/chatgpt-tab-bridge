import { describeRuntimeIssue } from "./reason-catalog.ts";
import type { DebugReport, OverlaySettings, RuntimeEvent, RuntimeState } from "../shared/types.js";

function truncate(s: string, max = 80): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

export function buildDebugReport(input: {
  state: RuntimeState;
  overlaySettings: OverlaySettings;
  recentRuntimeEvents: RuntimeEvent[];
  generatedAt: string;
  extensionVersion?: string | null;
}): DebugReport {
  const events = input.recentRuntimeEvents.map((e) => ({ ...e, verificationPollSample: truncate(e.verificationPollSample, 80) }));
  return {
    schemaVersion: 1,
    generatedAt: input.generatedAt,
    phase: input.state.phase,
    round: input.state.round,
    nextHopSource: input.state.nextHopSource,
    bindings: {
      A: input.state.bindings.A ? { ...input.state.bindings.A, title: truncate(input.state.bindings.A.title, 80) } : null,
      B: input.state.bindings.B ? { ...input.state.bindings.B, title: truncate(input.state.bindings.B.title, 80) } : null
    },
    settings: input.state.settings,
    overlaySettings: input.overlaySettings,
    lastStopReason: input.state.lastStopReason,
    lastError: input.state.lastError,
    issueAdvice: describeRuntimeIssue({ stopReason: input.state.lastStopReason, errorReason: input.state.lastError }),
    activeHop: input.state.activeHop,
    recentRuntimeEvents: events,
    extensionVersion: input.extensionVersion ?? null
  };
}
