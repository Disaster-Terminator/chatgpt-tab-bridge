import { getIssueAdvice } from "./reason-catalog.ts";
import type { OverlaySettings, RuntimeEvent, RuntimeState } from "../shared/types.js";

const MAX_TEXT = 180;

export interface DebugReportInput {
  state: RuntimeState;
  overlaySettings?: OverlaySettings | null;
  recentRuntimeEvents?: RuntimeEvent[] | null;
  generatedAt?: string;
}

function truncateText(value: unknown, max = MAX_TEXT): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "";
  }
  if (normalized.length <= max) {
    return normalized;
  }
  return `${normalized.slice(0, max)}…`;
}

function sanitizeBindingSummary(binding: RuntimeState["bindings"]["A"]) {
  if (!binding) {
    return null;
  }
  return {
    role: binding.role,
    tabId: binding.tabId,
    title: truncateText(binding.title, 120),
    url: truncateText(binding.url, 140),
    isEmptyThread: binding.isEmptyThread,
    boundAt: binding.boundAt,
    sessionIdentity: binding.sessionIdentity
      ? {
          kind: binding.sessionIdentity.kind,
          tabId: binding.sessionIdentity.tabId,
          role: binding.sessionIdentity.role,
          currentRound: binding.sessionIdentity.currentRound
        }
      : null
  };
}

function sanitizeRuntimeEvent(event: RuntimeEvent) {
  return {
    id: event.id,
    level: event.level,
    category: truncateText(event.category, 80),
    phaseStep: truncateText(event.phaseStep, 120),
    timestamp: event.timestamp,
    sourceRole: event.sourceRole,
    targetRole: event.targetRole,
    round: event.round,
    dispatchReadbackSummary: truncateText(event.dispatchReadbackSummary),
    sendTriggerMode: truncateText(event.sendTriggerMode, 80),
    verificationBaseline: truncateText(event.verificationBaseline),
    verificationPollSample: truncateText(event.verificationPollSample),
    verificationVerdict: truncateText(event.verificationVerdict)
  };
}

export function buildDebugReport(input: DebugReportInput) {
  const state = input.state;

  return {
    schemaVersion: 1,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    currentPhase: state.phase,
    bindings: {
      A: sanitizeBindingSummary(state.bindings.A),
      B: sanitizeBindingSummary(state.bindings.B)
    },
    settings: {
      maxRoundsEnabled: state.settings.maxRoundsEnabled,
      maxRounds: state.settings.maxRounds,
      hopTimeoutMs: state.settings.hopTimeoutMs,
      pollIntervalMs: state.settings.pollIntervalMs,
      settleSamplesRequired: state.settings.settleSamplesRequired,
      bridgeStatePrefix: truncateText(state.settings.bridgeStatePrefix, 40),
      continueMarker: truncateText(state.settings.continueMarker, 40),
      stopMarker: truncateText(state.settings.stopMarker, 40)
    },
    overlaySettings: input.overlaySettings
      ? {
          enabled: input.overlaySettings.enabled,
          ambientEnabled: input.overlaySettings.ambientEnabled,
          collapsed: input.overlaySettings.collapsed,
          position: input.overlaySettings.position
            ? {
                x: input.overlaySettings.position.x,
                y: input.overlaySettings.position.y
              }
            : null
        }
      : null,
    activeHop: state.activeHop
      ? {
          sourceRole: state.activeHop.sourceRole,
          targetRole: state.activeHop.targetRole,
          targetTabId: state.activeHop.targetTabId,
          round: state.activeHop.round,
          hopId: state.activeHop.hopId,
          stage: state.activeHop.stage
        }
      : null,
    lastStopReason: state.lastStopReason,
    lastError: truncateText(state.lastError, 220),
    issueAdvice: getIssueAdvice(state.lastStopReason),
    recentRuntimeEvents: (input.recentRuntimeEvents ?? []).map(sanitizeRuntimeEvent)
  };
}
