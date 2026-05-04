import { describeRuntimeIssue } from "./reason-catalog.ts";
import type { DebugReport, OverlaySettings, RuntimeEvent, RuntimeState } from "../shared/types.js";

export function buildDebugReport(input: { state: RuntimeState; overlaySettings: OverlaySettings; recentRuntimeEvents: RuntimeEvent[]; generatedAt: string; extensionVersion?: string | null; }): DebugReport {
  const sanitize = (v: string | null | undefined) => !v ? v ?? null : (v.length > 80 ? `${v.slice(0, 80)}...` : v);
  return {
    schemaVersion: 1,
    generatedAt: input.generatedAt,
    phase: input.state.phase,
    round: input.state.round,
    nextHopSource: input.state.nextHopSource,
    bindings: {
      A: input.state.bindings.A ? { role: "A", tabId: input.state.bindings.A.tabId, normalizedUrl: input.state.bindings.A.urlInfo?.normalizedUrl ?? null } : null,
      B: input.state.bindings.B ? { role: "B", tabId: input.state.bindings.B.tabId, normalizedUrl: input.state.bindings.B.urlInfo?.normalizedUrl ?? null } : null
    },
    settings: input.state.settings,
    overlaySettings: input.overlaySettings,
    lastStopReason: input.state.lastStopReason,
    lastError: input.state.lastError,
    issueAdvice: describeRuntimeIssue({ stopReason: input.state.lastStopReason, errorReason: input.state.lastError }),
    activeHop: input.state.activeHop,
    recentRuntimeEvents: input.recentRuntimeEvents.map((e) => ({ ...e, verificationPollSample: sanitize(e.verificationPollSample), dispatchReadbackSummary: sanitize(e.dispatchReadbackSummary), verificationBaseline: sanitize(e.verificationBaseline) }))
  };
}
