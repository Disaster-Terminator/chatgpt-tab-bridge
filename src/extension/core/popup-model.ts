import { PHASES, STOP_REASONS } from "./constants.ts";
import { canWriteOverride, hasValidBindings } from "./state-machine.ts";
import type { BlockReason, BridgeRole, ExecutionReadiness, PopupControls, RuntimeDisplay, RuntimeState, ThreadActivity } from "../shared/types.js";

export function deriveControls(state: RuntimeState, readiness: ExecutionReadiness): PopupControls {
  return {
    canStart: state.phase === PHASES.READY && !state.requiresTerminalClear && hasValidBindings(state) && !readiness.preflightPending && readiness.starterReady,
    canPause: state.phase === PHASES.RUNNING,
    canResume: state.phase === PHASES.PAUSED && hasValidBindings(state) && !readiness.preflightPending && readiness.starterReady,
    canStop: state.phase === PHASES.RUNNING || state.phase === PHASES.PAUSED,
    canClearTerminal: state.phase === PHASES.STOPPED || state.phase === PHASES.ERROR,
    canSetStarter: (state.phase === PHASES.IDLE || state.phase === PHASES.READY) && !readiness.preflightPending,
    canSetOverride: canWriteOverride(state) && !readiness.preflightPending
  };
}

export function computeReadiness(
  state: RuntimeState,
  sourceThreadActivity: ThreadActivity | null
): ExecutionReadiness {
  const sourceRole = state.activeHop?.sourceRole ?? state.nextHopOverride ?? state.nextHopSource;
  const starterRole = state.starter;
  
  const checkRole = state.phase === PHASES.READY ? starterRole : sourceRole;
  
  const isGenerating = sourceThreadActivity?.generating ?? false;
  
  const starterReady = !isGenerating;
  
  let blockReason: BlockReason | null = null;
  
  if (state.phase === PHASES.RUNNING && state.runtimeActivity.step.startsWith("waiting starter")) {
    blockReason = "preflight_pending";
  } else if (!starterReady) {
    blockReason = "starter_generating";
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
  const sourceRole = state.activeHop?.sourceRole ?? state.nextHopOverride ?? state.nextHopSource;
  
  const normalStopReasons = new Set([
    STOP_REASONS.STOP_MARKER,
    STOP_REASONS.USER_STOP,
    STOP_REASONS.MAX_ROUNDS,
    STOP_REASONS.DUPLICATE_OUTPUT
  ]);
  const isNormalStop = state.lastStopReason && normalStopReasons.has(state.lastStopReason as typeof normalStopReasons extends Set<infer T> ? T : never);
  const displayStopReason = isNormalStop ? null : state.lastStopReason;
  
  return {
    nextHop: `${sourceRole} -> ${sourceRole === "A" ? "B" : "A"}`,
    currentStep: state.runtimeActivity?.step ?? "idle",
    lastActionAt: state.runtimeActivity?.lastActionAt ?? null,
    transport: state.runtimeActivity?.transport ?? null,
    selector: state.runtimeActivity?.selector ?? null,
    lastIssue: state.lastError || displayStopReason || "None"
  };
}
