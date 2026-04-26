import {
  DEFAULT_SETTINGS,
  ERROR_REASONS,
  PHASES,
  ROLE_A,
  ROLE_B,
  STOP_REASONS,
  otherRole
} from "./constants.ts";
import type {
  BridgeRole,
  ErrorReason,
  RuntimeHopTruth,
  RuntimeActivity,
  RuntimeBinding,
  RuntimeSettings,
  RuntimePhase,
  RuntimeState,
  StopReason
} from "../shared/types.js";

interface SetBindingEvent {
  type: "set_binding";
  role: BridgeRole;
  binding: Partial<RuntimeBinding> | null;
}

interface InvalidateBindingEvent {
  type: "invalidate_binding";
  role: BridgeRole;
}

interface ClearTerminalEvent {
  type: "clear_terminal";
}

interface SetStarterEvent {
  type: "set_starter";
  role: BridgeRole;
}

interface SetRuntimeSettingsEvent {
  type: "set_runtime_settings";
  settings: Partial<RuntimeSettings>;
}

interface StartEvent {
  type: "start";
}

interface PauseEvent {
  type: "pause";
}

interface ResumeEvent {
  type: "resume";
}

interface StopEvent {
  type: "stop";
  reason?: StopReason | null;
}

interface SetNextHopOverrideEvent {
  type: "set_next_hop_override";
  role: BridgeRole | null;
}

interface HopCompletedEvent {
  type: "hop_completed";
  sourceRole: BridgeRole;
  targetRole?: BridgeRole | null;
  sourceHash?: string | null;
  targetHash?: string | null;
}

interface StopConditionEvent {
  type: "stop_condition";
  reason?: StopReason | null;
}

interface SelectorFailureEvent {
  type: "selector_failure";
  reason?: string | null;
}

interface RuntimeErrorEvent {
  type: "runtime_error";
  reason?: string | null;
}

interface SetRuntimeActivityEvent {
  type: "set_runtime_activity";
  activity: Partial<RuntimeActivity>;
}

interface SetExecutionHopEvent {
  type: "set_execution_hop";
  hop: RuntimeHopTruth | null;
}

export type RuntimeStateEvent =
  | SetBindingEvent
  | InvalidateBindingEvent
  | ClearTerminalEvent
  | SetStarterEvent
  | SetRuntimeSettingsEvent
  | StartEvent
  | PauseEvent
  | ResumeEvent
  | StopEvent
  | SetNextHopOverrideEvent
  | HopCompletedEvent
  | StopConditionEvent
  | SelectorFailureEvent
  | RuntimeErrorEvent
  | SetRuntimeActivityEvent
  | SetExecutionHopEvent;

export function createInitialState(): RuntimeState {
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
    activeHop: null,
    lastCompletedHop: null,
    lastForwardedHashes: {
      A: null,
      B: null
    },
    lastAssistantHashes: {
      A: null,
      B: null
    },
    runtimeActivity: {
      step: "idle",
      sourceRole: null,
      targetRole: null,
      pendingRound: null,
      lastActionAt: null,
      transport: null,
      selector: null
    },
    updatedAt: new Date().toISOString()
  };
}

export function reduceState(
  currentState: RuntimeState | null | undefined,
  event: RuntimeStateEvent
): RuntimeState {
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
    case "set_runtime_settings":
      return reduceSetRuntimeSettings(state, event);
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
    case "set_runtime_activity":
      return reduceSetRuntimeActivity(state, event);
    case "set_execution_hop":
      return reduceSetExecutionHop(state, event);
    default:
      return state;
  }
}

export function canWriteOverride(state: RuntimeState): boolean {
  return state.phase === PHASES.PAUSED;
}

export function hasValidBindings(state: RuntimeState): boolean {
  return isBindingValid(state.bindings.A) && isBindingValid(state.bindings.B);
}

export function isTerminalPhase(phase: RuntimePhase): boolean {
  return phase === PHASES.STOPPED || phase === PHASES.ERROR;
}

function reduceSetBinding(state: RuntimeState, event: SetBindingEvent): RuntimeState {
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

function reduceInvalidateBinding(state: RuntimeState, event: InvalidateBindingEvent): RuntimeState {
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

function reduceClearTerminal(state: RuntimeState): RuntimeState {
  if (!isTerminalPhase(state.phase)) {
    return state;
  }

  state.requiresTerminalClear = false;
  state.lastError = null;
  state.lastStopReason = null;
  state.nextHopOverride = null;
  state.activeHop = null;
  state.pendingFreshSession = true;
  state.phase = hasValidBindings(state) ? PHASES.READY : PHASES.IDLE;
  return state;
}

function reduceSetStarter(state: RuntimeState, event: SetStarterEvent): RuntimeState {
  if (state.phase === PHASES.RUNNING) {
    return state;
  }

  state.starter = event.role === "B" ? "B" : "A";

  if (state.phase === PHASES.READY) {
    state.nextHopSource = state.starter;
  }

  if (state.phase === PHASES.PAUSED) {
    state.nextHopOverride = state.starter;
  }

  return state;
}

function reduceSetRuntimeSettings(state: RuntimeState, event: SetRuntimeSettingsEvent): RuntimeState {
  if (state.phase === PHASES.RUNNING) {
    return state;
  }

  const maxRounds = "maxRounds" in event.settings
    ? normalizeMaxRounds(event.settings.maxRounds)
    : state.settings.maxRounds;
  const maxRoundsEnabled = "maxRoundsEnabled" in event.settings
    ? normalizeMaxRoundsEnabled(event.settings.maxRoundsEnabled)
    : state.settings.maxRoundsEnabled;
  state.settings = {
    ...state.settings,
    ...event.settings,
    maxRoundsEnabled,
    maxRounds
  };
  return state;
}

function reduceStart(state: RuntimeState): RuntimeState {
  if (state.phase !== PHASES.READY || !hasValidBindings(state) || state.requiresTerminalClear) {
    return state;
  }

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

  state.phase = PHASES.RUNNING;
  state.nextHopSource = state.starter;
  state.nextHopOverride = null;
  state.lastError = null;
  state.lastStopReason = null;
  state.activeHop = createPendingHop(state, state.starter);
  state.runtimeActivity = {
    step: "starting",
    sourceRole: state.starter,
    targetRole: otherRole(state.starter),
    pendingRound: state.round + 1,
    lastActionAt: new Date().toISOString(),
    transport: null,
    selector: null
  };

  return state;
}

function reducePause(state: RuntimeState): RuntimeState {
  if (state.phase !== PHASES.RUNNING) {
    return state;
  }

  if (!isFreshPendingHop(state.activeHop, state)) {
    state.runtimeActivity = {
      ...state.runtimeActivity,
      step: "pause_requested",
      lastActionAt: new Date().toISOString()
    };
    return state;
  }

  state.phase = PHASES.PAUSED;
  state.runtimeActivity = {
    ...state.runtimeActivity,
    step: "paused",
    lastActionAt: new Date().toISOString()
  };
  return state;
}

function reduceResume(state: RuntimeState): RuntimeState {
  if (state.phase !== PHASES.PAUSED || !hasValidBindings(state)) {
    return state;
  }

  state.phase = PHASES.RUNNING;
  const currentActiveHop = state.activeHop;

  if (isFreshPendingHop(currentActiveHop, state)) {
    const resumeSource =
      state.nextHopOverride ??
      (state.round === 0 ? state.starter : currentActiveHop.sourceRole);
    state.nextHopSource = resumeSource;
    state.activeHop =
      resumeSource === currentActiveHop.sourceRole
        ? { ...currentActiveHop }
        : createPendingHop(state, resumeSource);

    if (state.nextHopOverride) {
      state.nextHopOverride = null;
    }
  } else if (currentActiveHop) {
    state.nextHopSource = currentActiveHop.sourceRole;
  } else {
    const resumeSource = state.nextHopOverride ?? state.nextHopSource;
    state.nextHopSource = resumeSource;
    state.activeHop = createPendingHop(state, resumeSource);

    if (state.nextHopOverride) {
      state.nextHopOverride = null;
    }
  }

  const runtimeSourceRole = state.activeHop?.sourceRole ?? state.nextHopSource;
  const runtimeTargetRole = state.activeHop?.targetRole ?? otherRole(runtimeSourceRole);
  const pendingRound = state.activeHop?.round ?? state.round + 1;
  state.runtimeActivity = {
    ...state.runtimeActivity,
    step: "resuming",
    sourceRole: runtimeSourceRole,
    targetRole: runtimeTargetRole,
    pendingRound,
    lastActionAt: new Date().toISOString()
  };

  return state;
}

function reduceSetNextHopOverride(
  state: RuntimeState,
  event: SetNextHopOverrideEvent
): RuntimeState {
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

function reduceHopCompleted(state: RuntimeState, event: HopCompletedEvent): RuntimeState {
  if (state.phase !== PHASES.RUNNING) {
    return state;
  }

   const pauseRequestedAtBoundary = state.runtimeActivity.step === "pause_requested";

  state.round += 1;
  state.nextHopSource = event.targetRole ?? otherRole(event.sourceRole);
  state.activeHop = createPendingHop(state, state.nextHopSource);
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

  state.runtimeActivity = {
    step: pauseRequestedAtBoundary ? "paused" : "hop_completed",
    sourceRole: event.sourceRole ?? null,
    targetRole: event.targetRole ?? null,
    pendingRound: state.round,
    lastActionAt: new Date().toISOString(),
    transport: "ok",
    selector: "ok"
  };

  if (pauseRequestedAtBoundary) {
    state.phase = PHASES.PAUSED;
  }

  return state;
}

function reduceSetRuntimeActivity(
  state: RuntimeState,
  event: SetRuntimeActivityEvent
): RuntimeState {
  state.runtimeActivity = {
    ...state.runtimeActivity,
    ...event.activity,
    lastActionAt: new Date().toISOString()
  };
  return state;
}

function reduceSetExecutionHop(state: RuntimeState, event: SetExecutionHopEvent): RuntimeState {
  state.activeHop = event.hop ? { ...event.hop } : null;
  return state;
}

function toStopped(state: RuntimeState, reason: StopReason): RuntimeState {
  if (state.phase !== PHASES.RUNNING && state.phase !== PHASES.PAUSED) {
    return state;
  }

  state.phase = PHASES.STOPPED;
  state.lastStopReason = reason;
  state.lastError = null;
  state.nextHopOverride = null;
  state.activeHop = null;
  state.requiresTerminalClear = true;
  state.runtimeActivity = {
    ...state.runtimeActivity,
    step: "stopped",
    lastActionAt: new Date().toISOString()
  };
  return state;
}

function toError(state: RuntimeState, reason: ErrorReason | string): RuntimeState {
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
  state.activeHop = null;
  state.requiresTerminalClear = true;
  state.runtimeActivity = {
    ...state.runtimeActivity,
    step: "error",
    selector: reason,
    lastActionAt: new Date().toISOString()
  };
  return state;
}

function cloneState(state: RuntimeState): RuntimeState {
  return {
    ...state,
    bindings: {
      A: state.bindings.A ? { ...state.bindings.A } : null,
      B: state.bindings.B ? { ...state.bindings.B } : null
    },
    settings: {
      ...state.settings
    },
    activeHop: state.activeHop ? { ...state.activeHop } : null,
    lastCompletedHop: state.lastCompletedHop ? { ...state.lastCompletedHop } : null,
    lastForwardedHashes: {
      ...state.lastForwardedHashes
    },
    lastAssistantHashes: {
      ...state.lastAssistantHashes
    },
    runtimeActivity: {
      ...state.runtimeActivity
    }
  };
}

function isBindingValid(binding: RuntimeBinding | null | undefined): boolean {
  return Boolean(binding?.tabId && (binding.sessionIdentity !== null || binding.urlInfo?.supported));
}

function isBridgeRole(value: unknown): value is BridgeRole {
  return value === ROLE_A || value === ROLE_B;
}

function isTabId(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function normalizeMaxRounds(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    return DEFAULT_SETTINGS.maxRounds;
  }
  return Math.min(50, Math.max(1, Math.round(numeric)));
}

function normalizeMaxRoundsEnabled(value: unknown): boolean {
  if (typeof value !== "boolean") {
    return DEFAULT_SETTINGS.maxRoundsEnabled;
  }
  return value;
}

function normalizeBinding(binding: Partial<RuntimeBinding> | null | undefined): RuntimeBinding | null {
  if (!binding || !isBridgeRole(binding.role) || !isTabId(binding.tabId)) {
    return null;
  }

  return {
    role: binding.role,
    tabId: binding.tabId,
    title: binding.title ?? "",
    url: binding.url ?? "",
    urlInfo: binding.urlInfo ?? null,
    sessionIdentity: binding.sessionIdentity ?? null,
    isEmptyThread: typeof binding.isEmptyThread === "boolean" ? binding.isEmptyThread : null,
    boundAt: binding.boundAt ?? new Date().toISOString()
  };
}

function createPendingHop(state: RuntimeState, sourceRole: BridgeRole): RuntimeHopTruth {
  const targetRole = otherRole(sourceRole);
  return {
    sourceRole,
    targetRole,
    targetTabId: state.bindings[targetRole]?.tabId ?? null,
    round: state.round + 1,
    hopId: null,
    stage: "pending"
  };
}

function isFreshPendingHop(
  activeHop: RuntimeHopTruth | null | undefined,
  state: RuntimeState
): boolean {
  return Boolean(
    activeHop &&
      activeHop.stage === "pending" &&
      activeHop.hopId === null &&
      activeHop.round === state.round + 1
  );
}

function hasBindingConflict(
  state: RuntimeState,
  role: BridgeRole,
  candidateBinding: RuntimeBinding | null
): boolean {
  if (!candidateBinding) {
    return false;
  }

  const siblingBinding = state.bindings[otherRole(role)];
  if (!siblingBinding) {
    return false;
  }

  // P0-1: Check conflict by tabId OR sessionIdentity (for live sessions)
  if (siblingBinding.tabId === candidateBinding.tabId) {
    return true;
  }

  // URL conflict check skipped when both are live sessions (root pages can share same normalized URL)
  const bothAreLiveSessions =
    siblingBinding.sessionIdentity?.kind === "live_session" &&
    candidateBinding.sessionIdentity?.kind === "live_session";

  if (!bothAreLiveSessions && siblingBinding.urlInfo?.normalizedUrl && candidateBinding.urlInfo?.normalizedUrl) {
    if (siblingBinding.urlInfo.normalizedUrl === candidateBinding.urlInfo.normalizedUrl) {
      return true;
    }
  }

  // Check sessionIdentity conflict for live sessions
  if (siblingBinding.sessionIdentity && candidateBinding.sessionIdentity) {
    if (siblingBinding.sessionIdentity.kind === "live_session" && 
        candidateBinding.sessionIdentity.kind === "live_session") {
      if (siblingBinding.sessionIdentity.tabId === candidateBinding.sessionIdentity.tabId) {
        return true;
      }
    }
  }

  return false;
}
