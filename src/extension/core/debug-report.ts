import type { OverlaySettings, RuntimeEvent, RuntimeState } from "../shared/types.js";
import { describeIssueReason, type ReasonDescription } from "./reason-catalog.ts";

const SCHEMA_VERSION = 1;
const MAX_TEXT = 160;
const MAX_TITLE = 96;
const MAX_URL = 180;
const MAX_ERROR = 220;
const MAX_EVENT_TEXT = 140;
const MAX_RECENT_EVENTS = 25;

type DebugReportInput = {
  runtimeState: RuntimeState;
  overlaySettings?: OverlaySettings | null;
  recentRuntimeEvents?: RuntimeEvent[] | null;
  generatedAt?: string;
};

type DebugBindingSummary = {
  tabId: number | null;
  title: string | null;
  url: string | null;
  boundAt: string | null;
};

type DebugRuntimeEvent = {
  id: string;
  timestamp: string;
  level: RuntimeEvent["level"];
  category: string;
  phaseStep: string;
  sourceRole: RuntimeEvent["sourceRole"];
  targetRole: RuntimeEvent["targetRole"];
  round: number;
  dispatchReadbackSummary: string;
  sendTriggerMode: string;
  verificationBaseline: string;
  verificationPollSample: string;
  verificationVerdict: string;
};

export type DebugReport = {
  schemaVersion: 1;
  generatedAt: string;
  currentPhase: RuntimeState["phase"];
  bindings: {
    A: DebugBindingSummary;
    B: DebugBindingSummary;
  };
  settings: {
    maxRoundsEnabled: boolean;
    maxRounds: number;
    hopTimeoutMs: number;
    pollIntervalMs: number;
    settleSamplesRequired: number;
    bridgeStatePrefix: string;
    continueMarker: string;
    stopMarker: string;
  };
  overlaySettings?: {
    enabled: boolean;
    ambientEnabled: boolean;
    collapsed: boolean;
    position: { x: number; y: number } | null;
  };
  activeHop: {
    sourceRole: string | null;
    targetRole: string | null;
    targetTabId: number | null;
    round: number | null;
    stage: string | null;
    hopId: string | null;
  } | null;
  lastStopReason: string | null;
  lastError: string | null;
  issueAdvice: ReasonDescription;
  recentRuntimeEvents: DebugRuntimeEvent[];
};

export function buildDebugReport(input: DebugReportInput): DebugReport {
  const { runtimeState, overlaySettings, recentRuntimeEvents } = input;
  const reason = runtimeState.lastError ?? runtimeState.lastStopReason;

  const report: DebugReport = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    currentPhase: runtimeState.phase,
    bindings: {
      A: summarizeBinding(runtimeState.bindings.A),
      B: summarizeBinding(runtimeState.bindings.B)
    },
    settings: {
      maxRoundsEnabled: Boolean(runtimeState.settings.maxRoundsEnabled),
      maxRounds: toSafeNumber(runtimeState.settings.maxRounds),
      hopTimeoutMs: toSafeNumber(runtimeState.settings.hopTimeoutMs),
      pollIntervalMs: toSafeNumber(runtimeState.settings.pollIntervalMs),
      settleSamplesRequired: toSafeNumber(runtimeState.settings.settleSamplesRequired),
      bridgeStatePrefix: sanitizeText(runtimeState.settings.bridgeStatePrefix, MAX_TEXT),
      continueMarker: sanitizeText(runtimeState.settings.continueMarker, MAX_TEXT),
      stopMarker: sanitizeText(runtimeState.settings.stopMarker, MAX_TEXT)
    },
    activeHop: summarizeActiveHop(runtimeState.activeHop),
    lastStopReason: runtimeState.lastStopReason ? sanitizeText(runtimeState.lastStopReason, MAX_TEXT) : null,
    lastError: runtimeState.lastError ? sanitizeText(runtimeState.lastError, MAX_ERROR) : null,
    issueAdvice: describeIssueReason(reason),
    recentRuntimeEvents: summarizeEvents(recentRuntimeEvents)
  };

  if (overlaySettings) {
    report.overlaySettings = {
      enabled: Boolean(overlaySettings.enabled),
      ambientEnabled: Boolean(overlaySettings.ambientEnabled),
      collapsed: Boolean(overlaySettings.collapsed),
      position: overlaySettings.position
        ? { x: toSafeNumber(overlaySettings.position.x), y: toSafeNumber(overlaySettings.position.y) }
        : null
    };
  }

  return report;
}

function summarizeBinding(binding: RuntimeState["bindings"]["A"]): DebugBindingSummary {
  if (!binding) {
    return { tabId: null, title: null, url: null, boundAt: null };
  }

  return {
    tabId: Number.isFinite(binding.tabId) ? binding.tabId : null,
    title: sanitizeText(binding.title, MAX_TITLE),
    url: sanitizeText(binding.url, MAX_URL),
    boundAt: sanitizeText(binding.boundAt, MAX_TEXT)
  };
}

function summarizeActiveHop(activeHop: RuntimeState["activeHop"]): DebugReport["activeHop"] {
  if (!activeHop) {
    return null;
  }

  return {
    sourceRole: activeHop.sourceRole ?? null,
    targetRole: activeHop.targetRole ?? null,
    targetTabId: Number.isFinite(activeHop.targetTabId) ? activeHop.targetTabId : null,
    round: Number.isFinite(activeHop.round) ? activeHop.round : null,
    stage: sanitizeText(activeHop.stage, MAX_TEXT),
    hopId: activeHop.hopId ? sanitizeText(activeHop.hopId, MAX_TEXT) : null
  };
}

function summarizeEvents(events: RuntimeEvent[] | null | undefined): DebugRuntimeEvent[] {
  if (!Array.isArray(events) || events.length === 0) {
    return [];
  }

  return events.slice(-MAX_RECENT_EVENTS).map((event) => ({
    id: sanitizeText(event.id, MAX_TEXT),
    timestamp: sanitizeText(event.timestamp, MAX_TEXT),
    level: event.level,
    category: sanitizeText(event.category, MAX_TEXT),
    phaseStep: sanitizeText(event.phaseStep, MAX_TEXT),
    sourceRole: event.sourceRole,
    targetRole: event.targetRole,
    round: toSafeNumber(event.round),
    dispatchReadbackSummary: sanitizeText(event.dispatchReadbackSummary, MAX_EVENT_TEXT),
    sendTriggerMode: sanitizeText(event.sendTriggerMode, MAX_EVENT_TEXT),
    verificationBaseline: sanitizeText(event.verificationBaseline, MAX_EVENT_TEXT),
    verificationPollSample: sanitizeText(event.verificationPollSample, MAX_EVENT_TEXT),
    verificationVerdict: sanitizeText(event.verificationVerdict, MAX_EVENT_TEXT)
  }));
}

function sanitizeText(value: unknown, maxLength: number): string {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, Math.max(0, maxLength - 1))}…`;
}

function toSafeNumber(value: unknown): number {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : 0;
}
