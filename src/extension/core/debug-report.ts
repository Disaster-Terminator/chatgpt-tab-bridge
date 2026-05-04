import type { OverlaySettings, RuntimeEvent, RuntimeState } from "../shared/types.ts";
import { describeIssueReason, type ReasonDescription } from "./reason-catalog.ts";

const SCHEMA_VERSION = 1;
const MAX_TEXT = 200;
const MAX_TITLE = 120;
const MAX_URL = 200;
const MAX_ERROR = 300;
const MAX_EVENTS = 25;

type DebugReportInput = {
  state: Pick<RuntimeState, "phase" | "bindings" | "settings" | "activeHop" | "lastStopReason" | "lastError">;
  overlaySettings?: OverlaySettings | null;
  recentRuntimeEvents?: RuntimeEvent[] | null;
  generatedAt?: string;
};

type DebugReport = {
  schemaVersion: 1;
  generatedAt: string;
  currentPhase: RuntimeState["phase"];
  bindings: {
    A: BindingSummary | null;
    B: BindingSummary | null;
  };
  settings: {
    maxRounds: number;
    maxRoundsEnabled: boolean;
    stopMarker: string;
    hopTimeoutMs: number;
    pollIntervalMs: number;
  };
  overlaySettings: OverlaySummary | null;
  activeHop: ActiveHopSummary | null;
  lastStopReason: string | null;
  lastError: string | null;
  issueAdvice: ReasonDescription;
  recentRuntimeEvents: RuntimeEventSummary[];
};

type BindingSummary = { tabId: number; title: string; url: string };
type OverlaySummary = { enabled?: boolean; ambientEnabled?: boolean; collapsed?: boolean };
type ActiveHopSummary = { sourceRole: "A" | "B"; targetRole: "A" | "B"; targetTabId: number | null; round: number; stage: string; hopId: string | null };
type RuntimeEventSummary = Pick<RuntimeEvent, "id" | "timestamp" | "level" | "category" | "phaseStep" | "sourceRole" | "targetRole" | "round"> & {
  dispatchReadbackSummary: string;
  sendTriggerMode: string;
  verificationBaseline: string;
  verificationPollSample: string;
  verificationVerdict: string;
};

function trunc(value: unknown, max: number): string {
  const text = typeof value === "string" ? value : value == null ? "" : String(value);
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function bindingSummary(binding: RuntimeState["bindings"]["A"] | RuntimeState["bindings"]["B"]): BindingSummary | null {
  if (!binding) return null;
  return {
    tabId: binding.tabId,
    title: trunc(binding.title, MAX_TITLE),
    url: trunc(binding.url, MAX_URL)
  };
}

function sanitizeEvents(events: RuntimeEvent[] | null | undefined): RuntimeEventSummary[] {
  if (!events?.length) return [];
  return events.slice(-MAX_EVENTS).map((event) => ({
    id: event.id,
    timestamp: event.timestamp,
    level: event.level,
    category: event.category,
    phaseStep: trunc(event.phaseStep, MAX_TEXT),
    sourceRole: event.sourceRole,
    targetRole: event.targetRole,
    round: event.round,
    dispatchReadbackSummary: trunc(event.dispatchReadbackSummary, MAX_TEXT),
    sendTriggerMode: trunc(event.sendTriggerMode, 80),
    verificationBaseline: trunc(event.verificationBaseline, MAX_TEXT),
    verificationPollSample: trunc(event.verificationPollSample, MAX_TEXT),
    verificationVerdict: trunc(event.verificationVerdict, MAX_TEXT)
  }));
}

export function buildDebugReport(input: DebugReportInput): DebugReport {
  const reason = input.state.lastError ?? input.state.lastStopReason;
  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    currentPhase: input.state.phase,
    bindings: {
      A: bindingSummary(input.state.bindings.A),
      B: bindingSummary(input.state.bindings.B)
    },
    settings: {
      maxRounds: input.state.settings.maxRounds,
      maxRoundsEnabled: input.state.settings.maxRoundsEnabled,
      stopMarker: trunc(input.state.settings.stopMarker, MAX_TEXT),
      hopTimeoutMs: input.state.settings.hopTimeoutMs,
      pollIntervalMs: input.state.settings.pollIntervalMs
    },
    overlaySettings: input.overlaySettings
      ? {
          enabled: input.overlaySettings.enabled,
          ambientEnabled: input.overlaySettings.ambientEnabled,
          collapsed: input.overlaySettings.collapsed
        }
      : null,
    activeHop: input.state.activeHop
      ? {
          sourceRole: input.state.activeHop.sourceRole,
          targetRole: input.state.activeHop.targetRole,
          targetTabId: input.state.activeHop.targetTabId,
          round: input.state.activeHop.round,
          stage: trunc(input.state.activeHop.stage, 80),
          hopId: input.state.activeHop.hopId
        }
      : null,
    lastStopReason: input.state.lastStopReason,
    lastError: trunc(input.state.lastError, MAX_ERROR) || null,
    issueAdvice: describeIssueReason(reason),
    recentRuntimeEvents: sanitizeEvents(input.recentRuntimeEvents)
  };
}
