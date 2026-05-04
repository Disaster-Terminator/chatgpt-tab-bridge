import { PHASES, STOP_REASONS } from "./constants.ts";
import { buildIssueAdvice } from "./reason-catalog.ts";
import { canWriteOverride, hasValidBindings } from "./state-machine.ts";
import type { BlockReason, BridgeRole, ExecutionReadiness, PopupControls, RuntimeDisplay, RuntimeState, ThreadActivity } from "../shared/types.js";

function resolveDisplayedSourceRole(state: RuntimeState): BridgeRole {
  const activeHop = state.activeHop;
  const isFreshPendingBoundary = activeHop?.stage === "pending" && activeHop.hopId === null;

  if (isFreshPendingBoundary) {
    return state.nextHopOverride ?? activeHop.sourceRole;
  }

  return activeHop?.sourceRole ?? state.nextHopOverride ?? state.nextHopSource;
}

export function deriveControls(state: RuntimeState, readiness: ExecutionReadiness): PopupControls {
  return {
    canStart: state.phase === PHASES.READY && !state.requiresTerminalClear && hasValidBindings(state) && !readiness.preflightPending && readiness.starterReady,
    canPause: state.phase === PHASES.RUNNING,
    canResume: state.phase === PHASES.PAUSED && hasValidBindings(state) && !readiness.preflightPending && readiness.starterReady,
    canStop: state.phase === PHASES.RUNNING || state.phase === PHASES.PAUSED,
    canClearTerminal: state.phase === PHASES.STOPPED || state.phase === PHASES.ERROR,
    canSetStarter: (state.phase === PHASES.IDLE || state.phase === PHASES.READY || state.phase === PHASES.PAUSED) && !readiness.preflightPending,
    canSetOverride: canWriteOverride(state) && !readiness.preflightPending,
    canSetSettings: state.phase !== PHASES.RUNNING
  };
}

export function computeReadiness(
  state: RuntimeState,
  sourceThreadActivity: ThreadActivity | null
): ExecutionReadiness {
  const sourceRole = resolveDisplayedSourceRole(state);
  
  const isGenerating = sourceThreadActivity?.generating ?? false;
  const sourceAssistantKnownEmpty =
    sourceThreadActivity !== null && sourceThreadActivity.latestAssistantHash === null;
  
  const starterReady = !isGenerating && !sourceAssistantKnownEmpty;
  
  let blockReason: BlockReason | null = null;
  
  if (state.phase === PHASES.RUNNING && state.runtimeActivity.step.startsWith("waiting starter")) {
    blockReason = "preflight_pending";
  } else if (!starterReady) {
    blockReason = isGenerating ? "starter_generating" : "starter_empty";
  } else if (state.requiresTerminalClear) {
    blockReason = "clear_terminal_required";
  } else if (!hasValidBindings(state)) {
    blockReason = "missing_binding";
  }
  
  return {
    starterReady,
    preflightPending: state.phase === PHASES.RUNNING && (
      state.runtimeActivity.step.startsWith("waiting starter") ||
      state.runtimeActivity.step.match(/^waiting [AB] settle$/) !== null
    ),
    blockReason,
    sourceRole
  };
}

export function buildDisplay(state: RuntimeState): RuntimeDisplay {
  const sourceRole = resolveDisplayedSourceRole(state);
  
  const normalStopReasons = new Set([
    STOP_REASONS.STOP_MARKER,
    STOP_REASONS.USER_STOP,
    STOP_REASONS.MAX_ROUNDS,
    STOP_REASONS.DUPLICATE_OUTPUT
  ]);
  const isNormalStop = state.lastStopReason && normalStopReasons.has(state.lastStopReason as typeof normalStopReasons extends Set<infer T> ? T : never);
  const displayStopReason = isNormalStop ? null : state.lastStopReason;
  const reasonForAdvice = state.lastError || displayStopReason;
  
  return {
    nextHop: `${sourceRole} -> ${sourceRole === "A" ? "B" : "A"}`,
    currentStep: state.runtimeActivity?.step ?? "idle",
    lastActionAt: state.runtimeActivity?.lastActionAt ?? null,
    transport: state.runtimeActivity?.transport ?? null,
    selector: state.runtimeActivity?.selector ?? null,
    lastIssue: state.lastError || displayStopReason || "None",
    issueAdvice: reasonForAdvice ? buildIssueAdvice(reasonForAdvice) : null
  };
}
