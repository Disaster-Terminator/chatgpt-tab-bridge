import {
  DEFAULT_SETTINGS,
  ERROR_REASONS,
  PHASES,
  ROLE_A,
  STOP_REASONS,
  otherRole
} from "./constants.mjs";

export function createInitialState() {
  return {
    phase: PHASES.IDLE,
    bindings: {
      A: null,
      B: null
    },
    settings: {
      ...DEFAULT_SETTINGS
    },
    starter: ROLE_A,
    nextHopSource: ROLE_A,
    nextHopOverride: null,
    round: 0,
    sessionId: 0,
    pendingFreshSession: true,
    requiresTerminalClear: false,
    lastStopReason: null,
    lastError: null,
    lastCompletedHop: null,
    lastForwardedHashes: {
      A: null,
      B: null
    },
    lastAssistantHashes: {
      A: null,
      B: null
    },
    updatedAt: new Date().toISOString()
  };
}

export function reduceState(currentState, event) {
  const state = cloneState(currentState ?? createInitialState());
  state.updatedAt = new Date().toISOString();

  switch (event.type) {
    case "set_binding":
      return reduceSetBinding(state, event);
    case "invalidate_binding":
      return reduceInvalidateBinding(state, event);
    case "clear_terminal":
      return reduceClearTerminal(state);
    case "set_starter":
      return reduceSetStarter(state, event);
    case "start":
      return reduceStart(state);
    case "pause":
      return reducePause(state);
    case "resume":
      return reduceResume(state);
    case "stop":
      return toStopped(state, event.reason ?? STOP_REASONS.USER_STOP);
    case "set_next_hop_override":
      return reduceSetNextHopOverride(state, event);
    case "hop_completed":
      return reduceHopCompleted(state, event);
    case "stop_condition":
      return toStopped(state, event.reason ?? STOP_REASONS.USER_STOP);
    case "selector_failure":
      return toError(state, event.reason ?? ERROR_REASONS.SELECTOR_FAILURE);
    case "runtime_error":
      return toError(state, event.reason ?? ERROR_REASONS.INTERNAL_ERROR);
    default:
      return state;
  }
}

export function canWriteOverride(state) {
  return state.phase === PHASES.PAUSED;
}

export function hasValidBindings(state) {
  return isBindingValid(state.bindings.A) && isBindingValid(state.bindings.B);
}

export function isTerminalPhase(phase) {
  return phase === PHASES.STOPPED || phase === PHASES.ERROR;
}

function reduceSetBinding(state, event) {
  if (state.phase === PHASES.RUNNING || state.phase === PHASES.PAUSED) {
    return state;
  }

  const candidateBinding = normalizeBinding(event.binding);
  if (hasBindingConflict(state, event.role, candidateBinding)) {
    return state;
  }

  state.bindings[event.role] = candidateBinding;

  if (isTerminalPhase(state.phase)) {
    return state;
  }

  state.phase = hasValidBindings(state) ? PHASES.READY : PHASES.IDLE;
  state.requiresTerminalClear = false;
  return state;
}

function reduceInvalidateBinding(state, event) {
  state.bindings[event.role] = null;

  if (state.phase === PHASES.RUNNING || state.phase === PHASES.PAUSED) {
    return toStopped(state, STOP_REASONS.BINDING_INVALID);
  }

  if (state.phase === PHASES.STOPPED) {
    state.phase = PHASES.IDLE;
    state.requiresTerminalClear = false;
    return state;
  }

  if (state.phase === PHASES.READY) {
    state.phase = PHASES.IDLE;
  }

  return state;
}

function reduceClearTerminal(state) {
  if (!isTerminalPhase(state.phase)) {
    return state;
  }

  state.requiresTerminalClear = false;
  state.lastError = null;
  state.lastStopReason = null;
  state.nextHopOverride = null;
  state.pendingFreshSession = true;
  state.phase = hasValidBindings(state) ? PHASES.READY : PHASES.IDLE;
  return state;
}

function reduceSetStarter(state, event) {
  if (state.phase === PHASES.RUNNING) {
    return state;
  }

  state.starter = event.role === "B" ? "B" : "A";

  if (state.phase === PHASES.READY) {
    state.nextHopSource = state.starter;
  }

  return state;
}

function reduceStart(state) {
  if (state.phase !== PHASES.READY || !hasValidBindings(state) || state.requiresTerminalClear) {
    return state;
  }

  state.phase = PHASES.RUNNING;
  state.nextHopSource = state.starter;
  state.nextHopOverride = null;
  state.lastError = null;
  state.lastStopReason = null;

  if (state.pendingFreshSession) {
    state.round = 0;
    state.sessionId += 1;
    state.lastCompletedHop = null;
    state.lastForwardedHashes = {
      A: null,
      B: null
    };
    state.lastAssistantHashes = {
      A: null,
      B: null
    };
    state.pendingFreshSession = false;
  }

  return state;
}

function reducePause(state) {
  if (state.phase !== PHASES.RUNNING) {
    return state;
  }

  state.phase = PHASES.PAUSED;
  return state;
}

function reduceResume(state) {
  if (state.phase !== PHASES.PAUSED || !hasValidBindings(state)) {
    return state;
  }

  state.phase = PHASES.RUNNING;
  if (state.nextHopOverride) {
    state.nextHopSource = state.nextHopOverride;
    state.nextHopOverride = null;
  }

  return state;
}

function reduceSetNextHopOverride(state, event) {
  if (!canWriteOverride(state)) {
    return state;
  }

  if (!event.role) {
    state.nextHopOverride = null;
    return state;
  }

  state.nextHopOverride = event.role === "B" ? "B" : "A";
  return state;
}

function reduceHopCompleted(state, event) {
  if (state.phase !== PHASES.RUNNING) {
    return state;
  }

  state.round += 1;
  state.nextHopSource = event.targetRole ?? otherRole(event.sourceRole);
  state.lastCompletedHop = {
    sourceRole: event.sourceRole,
    targetRole: event.targetRole ?? otherRole(event.sourceRole),
    sourceHash: event.sourceHash ?? null,
    targetHash: event.targetHash ?? null,
    round: state.round
  };

  if (event.sourceRole && event.sourceHash) {
    state.lastForwardedHashes[event.sourceRole] = event.sourceHash;
    state.lastAssistantHashes[event.sourceRole] = event.sourceHash;
  }

  if (event.targetRole && event.targetHash) {
    state.lastAssistantHashes[event.targetRole] = event.targetHash;
  }

  return state;
}

function toStopped(state, reason) {
  if (state.phase !== PHASES.RUNNING && state.phase !== PHASES.PAUSED) {
    return state;
  }

  state.phase = PHASES.STOPPED;
  state.lastStopReason = reason;
  state.lastError = null;
  state.nextHopOverride = null;
  state.requiresTerminalClear = true;
  return state;
}

function toError(state, reason) {
  if (
    state.phase !== PHASES.RUNNING &&
    state.phase !== PHASES.PAUSED &&
    state.phase !== PHASES.READY
  ) {
    return state;
  }

  state.phase = PHASES.ERROR;
  state.lastError = reason;
  state.lastStopReason = null;
  state.nextHopOverride = null;
  state.requiresTerminalClear = true;
  return state;
}

function cloneState(state) {
  return JSON.parse(JSON.stringify(state));
}

function isBindingValid(binding) {
  return Boolean(binding?.tabId && binding?.urlInfo?.supported);
}

function normalizeBinding(binding) {
  if (!binding) {
    return null;
  }

  return {
    role: binding.role,
    tabId: binding.tabId,
    title: binding.title ?? "",
    url: binding.url ?? "",
    urlInfo: binding.urlInfo ?? null,
    boundAt: binding.boundAt ?? new Date().toISOString()
  };
}

function hasBindingConflict(state, role, candidateBinding) {
  if (!candidateBinding) {
    return false;
  }

  const siblingBinding = state.bindings[otherRole(role)];
  if (!siblingBinding) {
    return false;
  }

  return (
    siblingBinding.tabId === candidateBinding.tabId ||
    siblingBinding.urlInfo?.normalizedUrl === candidateBinding.urlInfo?.normalizedUrl
  );
}
