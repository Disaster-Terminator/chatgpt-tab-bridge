import type { OverlaySettings, RuntimeEvent, RuntimeState } from "../shared/types.js";
import { getIssueAdvice, type IssueAdvice } from "./reason-catalog.ts";

const MAX_TEXT = 240;
const MAX_EVENTS = 50;

export interface BuildDebugReportInput {
  state: RuntimeState;
  overlaySettings?: OverlaySettings | null;
  recentRuntimeEvents?: RuntimeEvent[] | null;
  now?: Date;
}

export interface DebugReport {
  schemaVersion: 1;
  generatedAt: string;
  phase: RuntimeState["phase"];
  bindings: Record<"A" | "B", { tabId: number | null; title: string | null; url: string | null; boundAt: string | null }>;
  settings: RuntimeState["settings"];
  overlaySettings: OverlaySettings | null;
  activeHop: RuntimeState["activeHop"];
  lastStopReason: string | null;
  lastError: string | null;
  issueAdvice: IssueAdvice | null;
  recentRuntimeEvents: Array<Record<string, unknown>>;
}

export function buildDebugReport(input: BuildDebugReportInput): DebugReport {
  const now = input.now ?? new Date();
  const state = input.state;
  const reason = state.lastStopReason ?? state.lastError;

  return {
    schemaVersion: 1,
    generatedAt: now.toISOString(),
    phase: state.phase,
    bindings: {
      A: summarizeBinding(state.bindings.A),
      B: summarizeBinding(state.bindings.B)
    },
    settings: JSON.parse(JSON.stringify(state.settings)),
    overlaySettings: input.overlaySettings ? JSON.parse(JSON.stringify(input.overlaySettings)) : null,
    activeHop: state.activeHop ? JSON.parse(JSON.stringify(state.activeHop)) : null,
    lastStopReason: state.lastStopReason ?? null,
    lastError: state.lastError ?? null,
    issueAdvice: getIssueAdvice(reason),
    recentRuntimeEvents: sanitizeEvents(input.recentRuntimeEvents)
  };
}

function summarizeBinding(binding: RuntimeState["bindings"]["A"]) {
  if (!binding) {
    return { tabId: null, title: null, url: null, boundAt: null };
  }

  return {
    tabId: binding.tabId,
    title: sanitizeText(binding.title),
    url: sanitizeText(binding.url),
    boundAt: binding.boundAt ?? null
  };
}

function sanitizeEvents(events: RuntimeEvent[] | null | undefined): Array<Record<string, unknown>> {
  if (!Array.isArray(events)) {
    return [];
  }

  return events.slice(0, MAX_EVENTS).map((event) => ({
    id: sanitizeText(event.id),
    level: event.level,
    category: sanitizeText(event.category),
    phaseStep: sanitizeText(event.phaseStep),
    timestamp: sanitizeText(event.timestamp),
    sourceRole: event.sourceRole,
    targetRole: event.targetRole,
    round: event.round,
    dispatchReadbackSummary: sanitizeText(event.dispatchReadbackSummary),
    sendTriggerMode: sanitizeText(event.sendTriggerMode),
    verificationBaseline: sanitizeText(event.verificationBaseline),
    verificationPollSample: sanitizeText(event.verificationPollSample),
    verificationVerdict: sanitizeText(event.verificationVerdict)
  }));
}

function sanitizeText(value: unknown): string {
  const text = typeof value === "string" ? value : String(value ?? "");
  if (text.length <= MAX_TEXT) {
    return text;
  }
  return `${text.slice(0, MAX_TEXT)}…[truncated:${text.length - MAX_TEXT}]`;
}
