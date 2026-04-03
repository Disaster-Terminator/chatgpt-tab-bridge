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
