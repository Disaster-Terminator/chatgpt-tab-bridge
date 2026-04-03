import { PHASES } from "./constants.mjs";
import { canWriteOverride, hasValidBindings } from "./state-machine.mjs";

export function deriveControls(state) {
  return {
    canStart: state.phase === PHASES.READY && !state.requiresTerminalClear && hasValidBindings(state),
    canPause: state.phase === PHASES.RUNNING,
    canResume: state.phase === PHASES.PAUSED && hasValidBindings(state),
    canStop: state.phase === PHASES.RUNNING || state.phase === PHASES.PAUSED,
    canClearTerminal: state.phase === PHASES.STOPPED || state.phase === PHASES.ERROR,
    canSetStarter: state.phase === PHASES.IDLE || state.phase === PHASES.READY,
    canSetOverride: canWriteOverride(state)
  };
}

export function buildDisplay(state) {
  const sourceRole = state.nextHopOverride ?? state.nextHopSource;
  return {
    nextHop: `${sourceRole} -> ${sourceRole === "A" ? "B" : "A"}`,
    currentStep: state.runtimeActivity?.step ?? "idle",
    lastActionAt: state.runtimeActivity?.lastActionAt ?? null,
    transport: state.runtimeActivity?.transport ?? null,
    selector: state.runtimeActivity?.selector ?? null,
    lastIssue: state.lastError || state.lastStopReason || "None"
  };
}
