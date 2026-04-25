// core/background-helpers.ts
function shouldKeepBindingForUrlChange(binding, nextUrlInfo) {
  if (!binding?.urlInfo?.supported) {
    return true;
  }
  if (!nextUrlInfo?.supported) {
    return false;
  }
  return binding.urlInfo.normalizedUrl === nextUrlInfo.normalizedUrl;
}
function collectOverlaySyncTabIds(previousState, nextState) {
  const tabIds = /* @__PURE__ */ new Set();
  for (const state of [previousState, nextState]) {
    if (!state?.bindings) {
      continue;
    }
    for (const role of ["A", "B"]) {
      const tabId = state.bindings[role]?.tabId;
      if (tabId !== void 0 && tabId !== null) {
        tabIds.add(tabId);
      }
    }
  }
  return Array.from(tabIds);
}

// core/chatgpt-url.ts
var REGULAR_THREAD_RE = /^https:\/\/chatgpt\.com\/c\/([^/?#]+)(?:[/?#].*)?$/;
var PROJECT_THREAD_RE = /^https:\/\/chatgpt\.com\/g\/([^/?#]+)\/c\/([^/?#]+)(?:[/?#].*)?$/;
function parseChatGptThreadUrl(rawUrl) {
  if (typeof rawUrl !== "string" || rawUrl.length === 0) {
    return unsupported(rawUrl, "empty_url");
  }
  const projectMatch = rawUrl.match(PROJECT_THREAD_RE);
  if (projectMatch) {
    return {
      supported: true,
      kind: "project",
      projectId: projectMatch[1],
      conversationId: projectMatch[2],
      normalizedUrl: `https://chatgpt.com/g/${projectMatch[1]}/c/${projectMatch[2]}`
    };
  }
  const regularMatch = rawUrl.match(REGULAR_THREAD_RE);
  if (regularMatch) {
    return {
      supported: true,
      kind: "regular",
      projectId: null,
      conversationId: regularMatch[1],
      normalizedUrl: `https://chatgpt.com/c/${regularMatch[1]}`
    };
  }
  return unsupported(rawUrl, "unsupported_thread_url");
}
function unsupported(rawUrl, reason) {
  return {
    supported: false,
    kind: "unsupported",
    projectId: null,
    conversationId: null,
    normalizedUrl: rawUrl != null ? String(rawUrl) : null,
    reason
  };
}

// core/constants.ts
var APP_STATE_KEY = "chatgptBridgeRuntimeState";
var OVERLAY_SETTINGS_KEY = "chatgptBridgeOverlaySettings";
var ROLE_A = "A";
var ROLE_B = "B";
var ROLES = Object.freeze([ROLE_A, ROLE_B]);
var PHASES = Object.freeze({
  IDLE: "idle",
  READY: "ready",
  RUNNING: "running",
  PAUSED: "paused",
  STOPPED: "stopped",
  ERROR: "error"
});
var STOP_REASONS = Object.freeze({
  USER_STOP: "user_stop",
  STOP_MARKER: "stop_marker",
  MAX_ROUNDS: "max_rounds_reached",
  DUPLICATE_OUTPUT: "duplicate_output",
  HOP_TIMEOUT: "hop_timeout",
  REPLY_OBSERVATION_MISSING: "reply_observation_missing",
  WRONG_TARGET: "wrong_target",
  STALE_TARGET: "stale_target",
  UNREACHABLE_TARGET: "unreachable_target",
  BINDING_INVALID: "binding_invalid",
  STARTER_SETTLE_TIMEOUT: "starter_settle_timeout",
  TARGET_SETTLE_TIMEOUT: "target_settle_timeout",
  SUBMISSION_NOT_VERIFIED: "submission_not_verified"
});
var ERROR_REASONS = Object.freeze({
  SELECTOR_FAILURE: "selector_failure",
  MESSAGE_SEND_FAILED: "message_send_failed",
  UNSUPPORTED_TAB: "unsupported_tab",
  EMPTY_ASSISTANT_REPLY: "empty_assistant_reply",
  INTERNAL_ERROR: "internal_error"
});
var MESSAGE_TYPES = Object.freeze({
  GET_RUNTIME_STATE: "GET_RUNTIME_STATE",
  GET_POPUP_MODEL: "GET_POPUP_MODEL",
  GET_OVERLAY_MODEL: "GET_OVERLAY_MODEL",
  SET_BINDING: "SET_BINDING",
  CLEAR_BINDING: "CLEAR_BINDING",
  SET_STARTER: "SET_STARTER",
  SET_RUNTIME_SETTINGS: "SET_RUNTIME_SETTINGS",
  START_SESSION: "START_SESSION",
  PAUSE_SESSION: "PAUSE_SESSION",
  RESUME_SESSION: "RESUME_SESSION",
  STOP_SESSION: "STOP_SESSION",
  CLEAR_TERMINAL: "CLEAR_TERMINAL",
  SET_NEXT_HOP_OVERRIDE: "SET_NEXT_HOP_OVERRIDE",
  SET_OVERLAY_ENABLED: "SET_OVERLAY_ENABLED",
  SET_AMBIENT_OVERLAY_ENABLED: "SET_AMBIENT_OVERLAY_ENABLED",
  SET_OVERLAY_COLLAPSED: "SET_OVERLAY_COLLAPSED",
  SET_OVERLAY_POSITION: "SET_OVERLAY_POSITION",
  RESET_OVERLAY_POSITION: "RESET_OVERLAY_POSITION",
  GET_ASSISTANT_SNAPSHOT: "GET_ASSISTANT_SNAPSHOT",
  GET_THREAD_ACTIVITY: "GET_THREAD_ACTIVITY",
  GET_LAST_ACK_DEBUG: "GET_LAST_ACK_DEBUG",
  GET_LATEST_USER_TEXT: "GET_LATEST_USER_TEXT",
  GET_RECENT_RUNTIME_EVENTS: "GET_RECENT_RUNTIME_EVENTS",
  SEND_RELAY_MESSAGE: "SEND_RELAY_MESSAGE",
  SYNC_OVERLAY_STATE: "SYNC_OVERLAY_STATE",
  REQUEST_OPEN_POPUP: "REQUEST_OPEN_POPUP"
});
var DEFAULT_SETTINGS = Object.freeze({
  maxRoundsEnabled: true,
  maxRounds: 8,
  hopTimeoutMs: 6e4,
  pollIntervalMs: 1500,
  settleSamplesRequired: 2,
  bridgeStatePrefix: "[BRIDGE_STATE]",
  continueMarker: "CONTINUE",
  stopMarker: "FREEZE"
});
var DEFAULT_OVERLAY_SETTINGS = Object.freeze({
  enabled: true,
  ambientEnabled: false,
  collapsed: false,
  position: null
});
function otherRole(role) {
  return role === ROLE_A ? ROLE_B : ROLE_A;
}

// core/state-machine.ts
function createInitialState() {
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
    updatedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
}
function reduceState(currentState, event) {
  const state = cloneState(currentState ?? createInitialState());
  state.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
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
function canWriteOverride(state) {
  return state.phase === PHASES.PAUSED;
}
function hasValidBindings(state) {
  return isBindingValid(state.bindings.A) && isBindingValid(state.bindings.B);
}
function isTerminalPhase(phase) {
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
  state.activeHop = null;
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
  if (state.phase === PHASES.PAUSED) {
    state.nextHopOverride = state.starter;
  }
  return state;
}
function reduceSetRuntimeSettings(state, event) {
  if (state.phase === PHASES.RUNNING) {
    return state;
  }
  const maxRounds = "maxRounds" in event.settings ? normalizeMaxRounds(event.settings.maxRounds) : state.settings.maxRounds;
  const maxRoundsEnabled = "maxRoundsEnabled" in event.settings ? normalizeMaxRoundsEnabled(event.settings.maxRoundsEnabled) : state.settings.maxRoundsEnabled;
  state.settings = {
    ...state.settings,
    ...event.settings,
    maxRoundsEnabled,
    maxRounds
  };
  return state;
}
function reduceStart(state) {
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
    lastActionAt: (/* @__PURE__ */ new Date()).toISOString(),
    transport: null,
    selector: null
  };
  return state;
}
function reducePause(state) {
  if (state.phase !== PHASES.RUNNING) {
    return state;
  }
  if (!isFreshPendingHop(state.activeHop, state)) {
    state.runtimeActivity = {
      ...state.runtimeActivity,
      step: "pause_requested",
      lastActionAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    return state;
  }
  state.phase = PHASES.PAUSED;
  state.runtimeActivity = {
    ...state.runtimeActivity,
    step: "paused",
    lastActionAt: (/* @__PURE__ */ new Date()).toISOString()
  };
  return state;
}
function reduceResume(state) {
  if (state.phase !== PHASES.PAUSED || !hasValidBindings(state)) {
    return state;
  }
  state.phase = PHASES.RUNNING;
  const currentActiveHop = state.activeHop;
  if (isFreshPendingHop(currentActiveHop, state)) {
    const resumeSource = state.nextHopOverride ?? (state.round === 0 ? state.starter : currentActiveHop.sourceRole);
    state.nextHopSource = resumeSource;
    state.activeHop = resumeSource === currentActiveHop.sourceRole ? { ...currentActiveHop } : createPendingHop(state, resumeSource);
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
    lastActionAt: (/* @__PURE__ */ new Date()).toISOString()
  };
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
    lastActionAt: (/* @__PURE__ */ new Date()).toISOString(),
    transport: "ok",
    selector: "ok"
  };
  if (pauseRequestedAtBoundary) {
    state.phase = PHASES.PAUSED;
  }
  return state;
}
function reduceSetRuntimeActivity(state, event) {
  state.runtimeActivity = {
    ...state.runtimeActivity,
    ...event.activity,
    lastActionAt: (/* @__PURE__ */ new Date()).toISOString()
  };
  return state;
}
function reduceSetExecutionHop(state, event) {
  state.activeHop = event.hop ? { ...event.hop } : null;
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
  state.activeHop = null;
  state.requiresTerminalClear = true;
  state.runtimeActivity = {
    ...state.runtimeActivity,
    step: "stopped",
    lastActionAt: (/* @__PURE__ */ new Date()).toISOString()
  };
  return state;
}
function toError(state, reason) {
  if (state.phase !== PHASES.RUNNING && state.phase !== PHASES.PAUSED && state.phase !== PHASES.READY) {
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
    lastActionAt: (/* @__PURE__ */ new Date()).toISOString()
  };
  return state;
}
function cloneState(state) {
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
function isBindingValid(binding) {
  return Boolean(binding?.tabId && (binding.sessionIdentity !== null || binding.urlInfo?.supported));
}
function isBridgeRole(value) {
  return value === ROLE_A || value === ROLE_B;
}
function isTabId(value) {
  return typeof value === "number" && Number.isFinite(value);
}
function normalizeMaxRounds(value) {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    return DEFAULT_SETTINGS.maxRounds;
  }
  return Math.min(50, Math.max(1, Math.round(numeric)));
}
function normalizeMaxRoundsEnabled(value) {
  if (typeof value !== "boolean") {
    return DEFAULT_SETTINGS.maxRoundsEnabled;
  }
  return value;
}
function normalizeBinding(binding) {
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
    boundAt: binding.boundAt ?? (/* @__PURE__ */ new Date()).toISOString()
  };
}
function createPendingHop(state, sourceRole) {
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
function isFreshPendingHop(activeHop, state) {
  return Boolean(
    activeHop && activeHop.stage === "pending" && activeHop.hopId === null && activeHop.round === state.round + 1
  );
}
function hasBindingConflict(state, role, candidateBinding) {
  if (!candidateBinding) {
    return false;
  }
  const siblingBinding = state.bindings[otherRole(role)];
  if (!siblingBinding) {
    return false;
  }
  if (siblingBinding.tabId === candidateBinding.tabId) {
    return true;
  }
  const bothAreLiveSessions = siblingBinding.sessionIdentity?.kind === "live_session" && candidateBinding.sessionIdentity?.kind === "live_session";
  if (!bothAreLiveSessions && siblingBinding.urlInfo?.normalizedUrl && candidateBinding.urlInfo?.normalizedUrl) {
    if (siblingBinding.urlInfo.normalizedUrl === candidateBinding.urlInfo.normalizedUrl) {
      return true;
    }
  }
  if (siblingBinding.sessionIdentity && candidateBinding.sessionIdentity) {
    if (siblingBinding.sessionIdentity.kind === "live_session" && candidateBinding.sessionIdentity.kind === "live_session") {
      if (siblingBinding.sessionIdentity.tabId === candidateBinding.sessionIdentity.tabId) {
        return true;
      }
    }
  }
  return false;
}

// core/relay-core.ts
function normalizeAssistantText(value) {
  return String(value ?? "").replace(/\r\n/g, "\n").replace(/\u00a0/g, " ").trim();
}
function hashText(value) {
  const text = normalizeAssistantText(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `h${(hash >>> 0).toString(16)}`;
}
function buildRelayEnvelope({
  sourceRole: _sourceRole,
  round: _round,
  message,
  hopId = null,
  continueMarker = DEFAULT_SETTINGS.continueMarker,
  bridgeStatePrefix = DEFAULT_SETTINGS.bridgeStatePrefix,
  instructionLocale = "zh-CN"
}) {
  const metadataLines = [
    ...hopId ? [`[BRIDGE_META hop=${hopId}]`, ""] : []
  ];
  void _sourceRole;
  void _round;
  const instructionLines = instructionLocale === "en" ? [
    "[BRIDGE_INSTRUCTION]",
    "Continue the discussion from the bridged content above.",
    "End your reply with exactly one final line:",
    `${bridgeStatePrefix} ${continueMarker}`,
    "or",
    `${bridgeStatePrefix} ${DEFAULT_SETTINGS.stopMarker}`
  ] : [
    "[BRIDGE_INSTRUCTION]",
    "\u7EE7\u7EED\u4E0A\u65B9\u6865\u63A5\u5185\u5BB9\u7684\u8BA8\u8BBA\u3002",
    "\u8BF7\u5728\u56DE\u590D\u6700\u540E\u5355\u72EC\u8F93\u51FA\u4E00\u884C\u72B6\u6001:",
    `${bridgeStatePrefix} ${continueMarker}`,
    "\u6216",
    `${bridgeStatePrefix} ${DEFAULT_SETTINGS.stopMarker}`
  ];
  return [
    normalizeAssistantText(message),
    "",
    ...metadataLines,
    ...instructionLines
  ].join("\n");
}
function parseBridgeDirective(text, prefix = DEFAULT_SETTINGS.bridgeStatePrefix) {
  void prefix;
  const normalized = normalizeAssistantText(text);
  const lines = normalized.split("\n").map((line) => line.trim()).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const match = lines[index]?.match(/^\[BRIDGE_STATE\]\s+(CONTINUE|FREEZE)$/i);
    if (match) {
      return match[1].toUpperCase();
    }
  }
  return null;
}
function evaluatePreSendGuard({
  sourceText,
  sourceHash,
  lastForwardedSourceHash,
  stopMarker = DEFAULT_SETTINGS.stopMarker
}) {
  const normalized = normalizeAssistantText(sourceText);
  if (!normalized) {
    return {
      shouldStop: false,
      reason: null,
      isEmpty: true
    };
  }
  if (parseBridgeDirective(normalized) === stopMarker) {
    return {
      shouldStop: true,
      reason: "stop_marker",
      isEmpty: false
    };
  }
  if (sourceHash && lastForwardedSourceHash && sourceHash === lastForwardedSourceHash) {
    return {
      shouldStop: true,
      reason: "duplicate_output",
      isEmpty: false
    };
  }
  return {
    shouldStop: false,
    reason: null,
    isEmpty: false
  };
}
function evaluatePostHopGuard({
  assistantText,
  round,
  maxRoundsEnabled = DEFAULT_SETTINGS.maxRoundsEnabled,
  maxRounds,
  stopMarker = DEFAULT_SETTINGS.stopMarker
}) {
  if (parseBridgeDirective(assistantText) === stopMarker) {
    return {
      shouldStop: true,
      reason: "stop_marker"
    };
  }
  if (maxRoundsEnabled && round >= maxRounds) {
    return {
      shouldStop: true,
      reason: "max_rounds_reached"
    };
  }
  return {
    shouldStop: false,
    reason: null
  };
}
function guardReasonToStopReason(reason) {
  switch (reason) {
    case "stop_marker":
      return "stop_marker";
    case "duplicate_output":
      return "duplicate_output";
    case "max_rounds_reached":
      return "max_rounds_reached";
    default:
      return "user_stop";
  }
}
function formatNextHop(sourceRole) {
  return `${sourceRole} -> ${otherRole(sourceRole)}`;
}
function containsBridgeEnvelope(text) {
  return text.includes("[BRIDGE_META") || text.includes("[BRIDGE_CONTEXT]") || text.includes("[\u6765\u81EA");
}
function calculateTextOverlap(textA, textB) {
  if (!textA || !textB) {
    return 0;
  }
  const normalizedA = normalizeAssistantText(textA);
  const normalizedB = normalizeAssistantText(textB);
  const wordsA = normalizedA.split(/\s+/).filter((w) => w.length > 0);
  const wordsB = normalizedB.split(/\s+/).filter((w) => w.length > 0);
  if (wordsA.length === 0 || wordsB.length === 0) {
    return 0;
  }
  let matchCount = 0;
  for (const word of wordsA) {
    if (wordsB.some((bw) => bw.includes(word) || word.includes(bw))) {
      matchCount++;
    }
  }
  return matchCount / Math.max(wordsA.length, wordsB.length);
}
function extractHopIdFromPayload(relayPayload) {
  const normalized = normalizeAssistantText(relayPayload);
  const metaMatch = normalized.match(/\[BRIDGE_META[^\]]*\bhop=([^\s\]]+)/i);
  if (metaMatch?.[1]) {
    return metaMatch[1];
  }
  const legacyMatch = normalized.match(/(?:^|\n)hop:\s*([^\s\n]+)/i);
  return legacyMatch?.[1] ?? null;
}
function hasHopMarker(text, hopId) {
  const normalized = normalizeAssistantText(text).toLowerCase();
  const normalizedHopId = normalizeAssistantText(hopId).toLowerCase();
  return normalized.includes(`[bridge_meta hop=${normalizedHopId}]`) || normalized.includes(`hop: ${normalizedHopId}`);
}
function analyzeHopBinding(latestUserText, relayPayload, expectedHopId) {
  if (!latestUserText) {
    return { hopBindingStrength: "none", containsBridgeContext: false, extractedHopId: null };
  }
  const normalizedLatest = normalizeAssistantText(latestUserText);
  const normalizedPayload = normalizeAssistantText(relayPayload);
  const containsBridgeContext = containsBridgeEnvelope(normalizedLatest);
  const extractedHopId = extractHopIdFromPayload(normalizedPayload);
  const normalizedExpectedHopId = normalizeAssistantText(expectedHopId ?? "");
  if (normalizedExpectedHopId && extractedHopId) {
    if (containsBridgeContext && hasHopMarker(normalizedLatest, normalizedExpectedHopId)) {
      return { hopBindingStrength: "strong", containsBridgeContext: true, extractedHopId };
    }
  }
  if (containsBridgeContext && extractedHopId) {
    if (hasHopMarker(normalizedLatest, extractedHopId)) {
      return { hopBindingStrength: "strong", containsBridgeContext: true, extractedHopId };
    }
    return { hopBindingStrength: "weak", containsBridgeContext: true, extractedHopId };
  }
  if (containsBridgeContext) {
    return { hopBindingStrength: "weak", containsBridgeContext: true, extractedHopId };
  }
  return { hopBindingStrength: "none", containsBridgeContext: false, extractedHopId };
}
function analyzePayloadCorrelation(latestUserText, relayPayloadText, hopBindingStrength) {
  if (!latestUserText || !relayPayloadText) {
    return "none";
  }
  if (hopBindingStrength === "strong") {
    return "strong";
  }
  const normalizedLatest = normalizeAssistantText(latestUserText);
  const normalizedPayload = normalizeAssistantText(relayPayloadText);
  const overlap = calculateTextOverlap(normalizedLatest, normalizedPayload);
  if (overlap >= 0.5) {
    return "weak";
  }
  return "none";
}
function analyzeUserTurnChange(baselineLatestUserText, currentLatestUserText) {
  const baselineNormalized = normalizeAssistantText(baselineLatestUserText ?? "");
  const currentNormalized = normalizeAssistantText(currentLatestUserText ?? "");
  if (!currentNormalized) {
    return false;
  }
  return baselineNormalized !== currentNormalized;
}
function analyzeUserTurnHopBinding(baselineLatestUserText, currentLatestUserText, expectedHopId, relayPayloadText) {
  if (!analyzeUserTurnChange(baselineLatestUserText, currentLatestUserText)) {
    return "none";
  }
  const analysis = analyzeHopBinding(currentLatestUserText, relayPayloadText, expectedHopId);
  return analysis.hopBindingStrength;
}
function analyzeGenerationSettlement(baselineGenerating, currentGenerating) {
  if (!baselineGenerating && currentGenerating) {
    return "strong";
  }
  if (baselineGenerating && !currentGenerating) {
    return "weak";
  }
  return "none";
}
function evaluateSubmissionAcceptanceGate(result) {
  const userHashChanged = result.details.currentUserHash !== null && result.details.currentUserHash !== result.details.baselineUserHash;
  const acceptedEquivalentEvidence = result.userTurnChanged && result.hopBindingStrength === "strong" && result.payloadCorrelationStrength === "strong";
  if (acceptedEquivalentEvidence) {
    if (userHashChanged) {
      return {
        acceptedEquivalentEvidence: true,
        waitingReplyAllowed: true,
        weakCorrelationOnly: false,
        reason: "acceptance_established_user_hash_changed"
      };
    }
    if (result.generationSettlementStrength === "strong") {
      return {
        acceptedEquivalentEvidence: true,
        waitingReplyAllowed: true,
        weakCorrelationOnly: false,
        reason: "acceptance_established_generation_started"
      };
    }
    return {
      acceptedEquivalentEvidence: true,
      waitingReplyAllowed: true,
      weakCorrelationOnly: false,
      reason: "acceptance_established_hop_bound_payload"
    };
  }
  const weakCorrelationOnly = result.hopBindingStrength === "weak" || result.payloadCorrelationStrength === "weak" || result.userTurnHopBinding === "weak";
  if (weakCorrelationOnly) {
    return {
      acceptedEquivalentEvidence: false,
      waitingReplyAllowed: false,
      weakCorrelationOnly: true,
      reason: "acceptance_not_established_weak_correlation"
    };
  }
  if (!result.userTurnChanged) {
    return {
      acceptedEquivalentEvidence: false,
      waitingReplyAllowed: false,
      weakCorrelationOnly: false,
      reason: "acceptance_not_established_no_user_turn_change"
    };
  }
  if (result.hopBindingStrength === "none") {
    return {
      acceptedEquivalentEvidence: false,
      waitingReplyAllowed: false,
      weakCorrelationOnly: false,
      reason: "acceptance_not_established_hop_binding_missing"
    };
  }
  if (result.payloadCorrelationStrength === "none") {
    return {
      acceptedEquivalentEvidence: false,
      waitingReplyAllowed: false,
      weakCorrelationOnly: false,
      reason: "acceptance_not_established_payload_not_correlated"
    };
  }
  return {
    acceptedEquivalentEvidence: false,
    waitingReplyAllowed: false,
    weakCorrelationOnly: false,
    reason: "acceptance_not_established"
  };
}
function evaluateSubmissionVerification(input) {
  const {
    baselineUserHash,
    baselineGenerating,
    baselineLatestUserText,
    currentUserHash,
    currentGenerating,
    currentLatestUserText,
    relayPayloadText,
    expectedHopId
  } = input;
  const userTurnChanged = analyzeUserTurnChange(baselineLatestUserText, currentLatestUserText);
  const userTurnHopBinding = analyzeUserTurnHopBinding(
    baselineLatestUserText,
    currentLatestUserText,
    expectedHopId,
    relayPayloadText
  );
  const hopBindingAnalysis = analyzeHopBinding(currentLatestUserText, relayPayloadText, expectedHopId);
  const hopBindingStrength = hopBindingAnalysis.hopBindingStrength;
  const containsBridgeContext = hopBindingAnalysis.containsBridgeContext;
  const extractedHopId = hopBindingAnalysis.extractedHopId;
  const payloadCorrelationStrength = analyzePayloadCorrelation(
    currentLatestUserText,
    relayPayloadText,
    hopBindingStrength
  );
  const generationSettlementStrength = analyzeGenerationSettlement(
    baselineGenerating,
    currentGenerating
  );
  const textOverlapRatio = calculateTextOverlap(
    normalizeAssistantText(currentLatestUserText ?? ""),
    normalizeAssistantText(relayPayloadText)
  );
  const userHashChanged = currentUserHash !== null && currentUserHash !== baselineUserHash;
  const baseDetails = {
    baselineUserHash,
    currentUserHash,
    baselineGenerating,
    currentGenerating,
    baselineLatestUserText,
    currentLatestUserText,
    textOverlapRatio,
    containsBridgeContext,
    extractedHopId,
    expectedHopId: expectedHopId ?? null
  };
  if (!userTurnChanged || payloadCorrelationStrength === "none") {
    return {
      verified: false,
      reason: "not_verified",
      hopBindingStrength,
      payloadCorrelationStrength,
      generationSettlementStrength,
      userTurnChanged,
      userTurnHopBinding,
      assistantSettlementStrength: "unavailable",
      details: baseDetails
    };
  }
  if (userHashChanged && hopBindingStrength === "strong") {
    return {
      verified: true,
      reason: "payload_accepted_strong",
      hopBindingStrength,
      payloadCorrelationStrength: "strong",
      generationSettlementStrength,
      userTurnChanged,
      userTurnHopBinding,
      assistantSettlementStrength: "unavailable",
      details: baseDetails
    };
  }
  if (userHashChanged && hopBindingStrength === "weak") {
    return {
      verified: false,
      reason: "not_verified_weak_correlation",
      hopBindingStrength,
      payloadCorrelationStrength,
      generationSettlementStrength,
      userTurnChanged,
      userTurnHopBinding,
      assistantSettlementStrength: "unavailable",
      details: baseDetails
    };
  }
  if (generationSettlementStrength === "strong" && userTurnChanged && payloadCorrelationStrength === "strong") {
    return {
      verified: true,
      reason: "generation_started_with_hop_bound_payload",
      hopBindingStrength,
      payloadCorrelationStrength,
      generationSettlementStrength,
      userTurnChanged,
      userTurnHopBinding,
      assistantSettlementStrength: "unavailable",
      details: baseDetails
    };
  }
  return {
    verified: false,
    reason: "not_verified",
    hopBindingStrength,
    payloadCorrelationStrength,
    generationSettlementStrength,
    userTurnChanged,
    userTurnHopBinding,
    assistantSettlementStrength: "unavailable",
    details: baseDetails
  };
}

// core/popup-model.ts
function resolveDisplayedSourceRole(state) {
  const activeHop = state.activeHop;
  const isFreshPendingBoundary = activeHop?.stage === "pending" && activeHop.hopId === null;
  if (isFreshPendingBoundary) {
    return state.nextHopOverride ?? activeHop.sourceRole;
  }
  return activeHop?.sourceRole ?? state.nextHopOverride ?? state.nextHopSource;
}
function deriveControls(state, readiness) {
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
function computeReadiness(state, sourceThreadActivity) {
  const sourceRole = resolveDisplayedSourceRole(state);
  const isGenerating = sourceThreadActivity?.generating ?? false;
  const starterReady = !isGenerating;
  let blockReason = null;
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
    preflightPending: state.phase === PHASES.RUNNING && (state.runtimeActivity.step.startsWith("waiting starter") || state.runtimeActivity.step.match(/^waiting [AB] settle$/) !== null),
    blockReason,
    sourceRole
  };
}
function buildDisplay(state) {
  const sourceRole = resolveDisplayedSourceRole(state);
  const normalStopReasons = /* @__PURE__ */ new Set([
    STOP_REASONS.STOP_MARKER,
    STOP_REASONS.USER_STOP,
    STOP_REASONS.MAX_ROUNDS,
    STOP_REASONS.DUPLICATE_OUTPUT
  ]);
  const isNormalStop = state.lastStopReason && normalStopReasons.has(state.lastStopReason);
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

// core/overlay-settings.ts
function normalizeOverlaySettings(input) {
  const position = normalizePosition(input?.position);
  return {
    enabled: input?.enabled ?? DEFAULT_OVERLAY_SETTINGS.enabled,
    ambientEnabled: input?.ambientEnabled ?? DEFAULT_OVERLAY_SETTINGS.ambientEnabled,
    collapsed: input?.collapsed ?? DEFAULT_OVERLAY_SETTINGS.collapsed,
    position
  };
}
function mergeOverlaySettings(current, patch) {
  return normalizeOverlaySettings({
    ...normalizeOverlaySettings(current),
    ...patch
  });
}
function normalizePosition(position) {
  const pos = position;
  if (!pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.y)) {
    return null;
  }
  return {
    x: Math.max(0, Math.round(pos.x)),
    y: Math.max(0, Math.round(pos.y))
  };
}

// background.ts
var activeLoopToken = 0;
var keepAlivePorts = /* @__PURE__ */ new Set();
var overlayPortsByTabId = /* @__PURE__ */ new Map();
function setActiveLoopTokenForTest(token) {
  activeLoopToken = token;
}
var MAX_RUNTIME_EVENTS = 30;
var runtimeEvents = [];
var runtimeEventSequence = 0;
var LOCAL_DEBUG_LOG_URL = "http://127.0.0.1:17761/events";
function addRuntimeEvent(event) {
  runtimeEventSequence += 1;
  const runtimeEvent = {
    ...event,
    id: `evt_${runtimeEventSequence}_${Math.random().toString(36).slice(2, 9)}`,
    timestamp: (/* @__PURE__ */ new Date()).toISOString()
  };
  runtimeEvents.push(runtimeEvent);
  if (runtimeEvents.length > MAX_RUNTIME_EVENTS) {
    runtimeEvents.shift();
  }
  if (shouldPostLocalDebugEvents()) {
    void postLocalDebugEvent(runtimeEvent);
  }
}
function getRecentRuntimeEvents() {
  return [...runtimeEvents];
}
async function postLocalDebugEvent(event) {
  try {
    await fetch(LOCAL_DEBUG_LOG_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(event)
    });
  } catch {
  }
}
function shouldPostLocalDebugEvents() {
  return typeof chrome !== "undefined" && typeof chrome.runtime?.id === "string" && chrome.runtime.id.length > 0;
}
function getInstructionLocale() {
  const chromeI18n = typeof chrome !== "undefined" ? chrome.i18n : null;
  const language = (typeof chromeI18n?.getUILanguage === "function" ? chromeI18n.getUILanguage() : globalThis.navigator?.language)?.toLowerCase() ?? "";
  return language.startsWith("zh") ? "zh-CN" : "en";
}
function formatVerificationBaseline(baselineUserHash, baselineGenerating, baselineLatestUserText, hopId) {
  if (baselineLatestUserText) {
    return `hash:${baselineUserHash},gen:${baselineGenerating},hop:${hopId ?? "none"},text:${baselineLatestUserText.slice(0, 50)}`;
  }
  return `hash:${baselineUserHash},gen:${baselineGenerating},hop:${hopId ?? "none"},text:null`;
}
function formatVerificationPollSample(currentUserHash, currentGenerating, currentLatestUserText) {
  return `hash:${currentUserHash},gen:${currentGenerating},text:${currentLatestUserText?.slice(0, 50) ?? "null"}`;
}
function summarizeDispatchReadback(sendResult) {
  const accepted = sendResult.ok && sendResult.dispatchAccepted === true ? "accepted" : "rejected";
  const signal = sendResult.dispatchSignal ?? "none";
  const evidence = sendResult.dispatchEvidence;
  if (!evidence) {
    return `${accepted}|signal:${signal}`;
  }
  return [
    accepted,
    `signal:${signal}`,
    `text_changed:${evidence.textChanged}`,
    `payload_released:${evidence.payloadReleased}`,
    `button_changed:${evidence.buttonStateChanged}`,
    `attempts:${evidence.attempts}`
  ].join("|");
}
function summarizeDispatchEvidence(sendResult) {
  const evidence = sendResult.dispatchEvidence;
  if (!evidence) {
    return "dispatch_evidence_missing";
  }
  return [
    `baseline_user:${evidence.baselineUserHash}`,
    `current_user:${evidence.currentUserHash}`,
    `baseline_gen:${evidence.baselineGenerating}`,
    `current_gen:${evidence.currentGenerating}`,
    `ack:${evidence.ackSignal}`,
    `latest_user:${evidence.latestUserPreview ?? "null"}`
  ].join("|");
}
function resolveDispatchFailureCode(sendResult) {
  if (sendResult.ok && sendResult.dispatchAccepted === true) {
    return "dispatch_accepted";
  }
  if (!sendResult.ok) {
    const dispatchCode = "dispatchErrorCode" in sendResult ? sendResult.dispatchErrorCode : void 0;
    return dispatchCode ?? sendResult.error ?? "dispatch_rejected";
  }
  return sendResult.error ?? "dispatch_rejected";
}
function mapObservationClassificationToStopReason(classification) {
  switch (classification) {
    case "wrong_target":
      return STOP_REASONS.WRONG_TARGET;
    case "stale_target":
      return STOP_REASONS.STALE_TARGET;
    case "unreachable_target":
      return STOP_REASONS.UNREACHABLE_TARGET;
  }
}
async function handleSettledReplyFailure({
  settled,
  sourceRole,
  targetRole,
  round,
  progress
}) {
  if (settled.reason === "loop_cancelled") {
    return false;
  }
  const observationFailureReasons = /* @__PURE__ */ new Set([
    STOP_REASONS.REPLY_OBSERVATION_MISSING,
    STOP_REASONS.WRONG_TARGET,
    STOP_REASONS.STALE_TARGET,
    STOP_REASONS.UNREACHABLE_TARGET
  ]);
  const isObservationFailure = observationFailureReasons.has(
    settled.reason
  );
  addRuntimeEvent({
    phaseStep: isObservationFailure ? "reply_observation_failed" : "reply_timeout",
    sourceRole,
    targetRole,
    round,
    dispatchReadbackSummary: progress.dispatchReadbackSummary,
    sendTriggerMode: progress.sendTriggerMode,
    verificationBaseline: progress.verificationBaselineSummary,
    verificationPollSample: progress.lastVerificationPollSample ?? "no_poll_sample",
    verificationVerdict: isObservationFailure ? settled.reason : "reply_timeout"
  });
  await updateState({
    type: "set_runtime_activity",
    activity: {
      step: `waiting ${targetRole} reply`,
      sourceRole,
      targetRole,
      pendingRound: round,
      transport: progress.sendTransport,
      selector: isObservationFailure ? settled.reason : "reply_timeout"
    }
  });
  await updateState({
    type: "stop_condition",
    reason: settled.reason
  });
  return true;
}
function createVerificationHopId(sessionId, round) {
  return `s${sessionId}-r${round}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
chrome.runtime.onInstalled.addListener(async () => {
  await initializeState();
  await initializeOverlaySettings();
  await updateActionBadge(await getState());
});
chrome.runtime.onStartup.addListener(async () => {
  await initializeState();
  await initializeOverlaySettings();
  await updateActionBadge(await getState());
});
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "bridge-tab-keepalive") {
    return;
  }
  keepAlivePorts.add(port);
  const tabId = port.sender?.tab?.id;
  if (tabId) {
    const tabPorts = overlayPortsByTabId.get(tabId) ?? /* @__PURE__ */ new Set();
    tabPorts.add(port);
    overlayPortsByTabId.set(tabId, tabPorts);
  }
  port.onMessage.addListener(() => {
  });
  port.onDisconnect.addListener(() => {
    keepAlivePorts.delete(port);
    if (tabId) {
      const tabPorts = overlayPortsByTabId.get(tabId);
      tabPorts?.delete(port);
      if (tabPorts?.size === 0) {
        overlayPortsByTabId.delete(tabId);
      }
    }
  });
});
chrome.tabs.onRemoved.addListener(async (tabId) => {
  overlayPortsByTabId.delete(tabId);
  const state = await getState();
  const role = findRoleByTabId(state, tabId);
  if (!role) {
    return;
  }
  await updateState({ type: "invalidate_binding", role });
});
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (!changeInfo.url) {
    return;
  }
  const state = await getState();
  const role = findRoleByTabId(state, tabId);
  if (!role) {
    return;
  }
  const urlInfo = parseChatGptThreadUrl(changeInfo.url);
  if (!shouldKeepBindingForUrlChange(state.bindings[role], urlInfo)) {
    await updateState({ type: "invalidate_binding", role });
    return;
  }
  const nextState = structuredCloneSafe(state);
  const currentBinding = nextState.bindings[role];
  if (!currentBinding) {
    return;
  }
  let sessionIdentity = currentBinding.sessionIdentity;
  if (urlInfo.supported && sessionIdentity?.kind === "live_session") {
    sessionIdentity = {
      kind: "persistent_url",
      tabId: currentBinding.tabId,
      role,
      boundAt: sessionIdentity.boundAt,
      url: changeInfo.url,
      urlInfo,
      currentRound: sessionIdentity.currentRound
    };
  }
  nextState.bindings[role] = {
    ...currentBinding,
    url: changeInfo.url,
    urlInfo,
    sessionIdentity
  };
  await persistState(nextState, state);
});
chrome.runtime.onMessage.addListener(
  (message, sender, sendResponse) => {
    void handleMessage(message, sender).then((result) => sendResponse({ ok: true, result })).catch((error) => sendResponse({ ok: false, error: getErrorMessage(error) }));
    return true;
  }
);
async function handleMessage(message, sender) {
  switch (message?.type) {
    case MESSAGE_TYPES.GET_RUNTIME_STATE:
      return getState();
    case MESSAGE_TYPES.GET_POPUP_MODEL:
      return getPopupModel(message.activeTabId ?? null);
    case MESSAGE_TYPES.GET_OVERLAY_MODEL:
      return getOverlayModel(sender.tab?.id ?? null);
    case MESSAGE_TYPES.SET_BINDING:
      return bindTabToRole(message.role, message.tabId ?? sender.tab?.id ?? null);
    case MESSAGE_TYPES.CLEAR_BINDING:
      return clearBinding(message.role ?? findRoleByTabId(await getState(), sender.tab?.id ?? null));
    case MESSAGE_TYPES.SET_STARTER:
      return updateState({ type: "set_starter", role: message.role });
    case MESSAGE_TYPES.SET_RUNTIME_SETTINGS:
      return updateState({ type: "set_runtime_settings", settings: message.settings });
    case MESSAGE_TYPES.SET_NEXT_HOP_OVERRIDE:
      return updateState({ type: "set_next_hop_override", role: message.role });
    case MESSAGE_TYPES.SET_OVERLAY_ENABLED:
      return updateOverlaySettings({ enabled: Boolean(message.enabled) });
    case MESSAGE_TYPES.SET_AMBIENT_OVERLAY_ENABLED:
      return updateOverlaySettings({ ambientEnabled: Boolean(message.enabled) });
    case MESSAGE_TYPES.SET_OVERLAY_COLLAPSED:
      return updateOverlaySettings({ collapsed: Boolean(message.collapsed) });
    case MESSAGE_TYPES.SET_OVERLAY_POSITION:
      return updateOverlaySettings({ position: message.position ?? null });
    case MESSAGE_TYPES.RESET_OVERLAY_POSITION:
      return updateOverlaySettings({ position: null });
    case MESSAGE_TYPES.START_SESSION:
      return startSession();
    case MESSAGE_TYPES.PAUSE_SESSION:
      return pauseSession();
    case MESSAGE_TYPES.RESUME_SESSION:
      return resumeSession();
    case MESSAGE_TYPES.STOP_SESSION:
      return stopSession();
    case MESSAGE_TYPES.CLEAR_TERMINAL:
      return clearTerminal();
    case MESSAGE_TYPES.GET_RECENT_RUNTIME_EVENTS:
      return getRecentRuntimeEvents();
    case MESSAGE_TYPES.REQUEST_OPEN_POPUP:
      if (typeof chrome.action.openPopup === "function") {
        await chrome.action.openPopup();
      }
      return getState();
    default:
      return getState();
  }
}
async function initializeState() {
  const current = await getSessionValue(APP_STATE_KEY);
  if (!current) {
    await setSessionValue(APP_STATE_KEY, createInitialState());
  }
}
async function initializeOverlaySettings() {
  const current = await getLocalValue(OVERLAY_SETTINGS_KEY);
  if (!current) {
    await setLocalValue(OVERLAY_SETTINGS_KEY, DEFAULT_OVERLAY_SETTINGS);
  }
}
async function getState() {
  await initializeState();
  const state = await getSessionValue(APP_STATE_KEY) ?? createInitialState();
  state.settings = {
    ...DEFAULT_SETTINGS,
    ...state.settings
  };
  return state;
}
async function getOverlaySettings() {
  await initializeOverlaySettings();
  return normalizeOverlaySettings(
    await getLocalValue(OVERLAY_SETTINGS_KEY) ?? DEFAULT_OVERLAY_SETTINGS
  );
}
async function updateOverlaySettings(patch) {
  const currentSettings = await getOverlaySettings();
  const nextSettings = mergeOverlaySettings(currentSettings, patch);
  await setLocalValue(OVERLAY_SETTINGS_KEY, nextSettings);
  const state = await getState();
  await broadcastOverlayState(state, null, true, nextSettings);
  return {
    state,
    overlaySettings: nextSettings
  };
}
async function persistState(nextState, previousState = null) {
  await setSessionValue(APP_STATE_KEY, nextState);
  await updateActionBadge(nextState);
  await broadcastOverlayState(nextState, previousState);
  return nextState;
}
async function updateActionBadge(state) {
  if (!chrome.action.setBadgeText) {
    return;
  }
  const cleanStopReasons = /* @__PURE__ */ new Set([
    STOP_REASONS.MAX_ROUNDS,
    STOP_REASONS.STOP_MARKER,
    STOP_REASONS.DUPLICATE_OUTPUT
  ]);
  let text = "";
  let color = "#52525b";
  let title = "ChatGPT Bridge";
  if (state.phase === PHASES.RUNNING) {
    text = "RUN";
    color = "#0ea5e9";
    title = `ChatGPT Bridge running: ${state.round}/${state.settings.maxRoundsEnabled ? state.settings.maxRounds : "\u221E"}`;
  } else if (state.phase === PHASES.PAUSED) {
    text = "PAU";
    color = "#f59e0b";
    title = "ChatGPT Bridge paused";
  } else if (state.phase === PHASES.STOPPED) {
    const cleanStop = cleanStopReasons.has(state.lastStopReason ?? "");
    text = cleanStop ? "OK" : "STOP";
    color = cleanStop ? "#22c55e" : "#71717a";
    title = cleanStop ? `ChatGPT Bridge completed: ${state.lastStopReason ?? "stopped"}` : `ChatGPT Bridge stopped: ${state.lastStopReason ?? "user_stop"}`;
  } else if (state.phase === PHASES.ERROR) {
    text = "ERR";
    color = "#ef4444";
    title = `ChatGPT Bridge error: ${state.lastError ?? "unknown"}`;
  }
  await chrome.action.setBadgeText({ text });
  await chrome.action.setBadgeBackgroundColor?.({ color });
  await chrome.action.setTitle?.({ title });
}
async function updateState(event) {
  const current = await getState();
  const next = reduceState(current, event);
  if (next.phase !== PHASES.RUNNING) {
    activeLoopToken = 0;
  }
  addStateTransitionEvent(event, current, next);
  return persistState(next, current);
}
function addStateTransitionEvent(event, previousState, nextState) {
  const observableEvents = /* @__PURE__ */ new Set([
    "set_starter",
    "set_next_hop_override",
    "start",
    "pause",
    "resume",
    "stop",
    "set_runtime_settings"
  ]);
  if (!observableEvents.has(event.type)) {
    return;
  }
  const sourceRole = nextState.activeHop?.sourceRole ?? nextState.nextHopOverride ?? nextState.nextHopSource;
  addRuntimeEvent({
    phaseStep: `state:${event.type}`,
    sourceRole,
    targetRole: otherRole(sourceRole),
    round: nextState.activeHop?.round ?? nextState.round,
    dispatchReadbackSummary: [
      `phase:${previousState.phase}->${nextState.phase}`,
      `starter:${previousState.starter}->${nextState.starter}`,
      `next:${previousState.nextHopSource}->${nextState.nextHopSource}`,
      `override:${previousState.nextHopOverride ?? "none"}->${nextState.nextHopOverride ?? "none"}`,
      `active:${summarizeActiveHop(previousState.activeHop)}->${summarizeActiveHop(nextState.activeHop)}`
    ].join("|"),
    sendTriggerMode: "state_transition",
    verificationBaseline: `event:${event.type}`,
    verificationPollSample: "n/a",
    verificationVerdict: "recorded"
  });
}
function summarizeActiveHop(activeHop) {
  if (!activeHop) {
    return "none";
  }
  return `${activeHop.sourceRole}->${activeHop.targetRole}/r${activeHop.round}/${activeHop.stage}/${activeHop.hopId ?? "pending"}`;
}
async function bindTabToRole(role, tabId) {
  if (!isBridgeRole2(role) || !tabId) {
    throw new Error("A valid role and tab id are required.");
  }
  const state = await getState();
  if (state.phase === PHASES.RUNNING || state.phase === PHASES.PAUSED) {
    throw new Error("Bindings cannot change during an active session.");
  }
  const tab = await chrome.tabs.get(tabId);
  const urlInfo = parseChatGptThreadUrl(tab.url ?? "");
  const sessionIdentity = urlInfo.supported ? {
    kind: "persistent_url",
    tabId: tab.id ?? tabId,
    role,
    boundAt: (/* @__PURE__ */ new Date()).toISOString(),
    url: tab.url ?? "",
    urlInfo,
    currentRound: 0
  } : {
    kind: "live_session",
    tabId: tab.id ?? tabId,
    role,
    boundAt: (/* @__PURE__ */ new Date()).toISOString(),
    observedSnapshot: null,
    currentRound: 0
  };
  const otherBinding = state.bindings[otherRole(role)];
  if (otherBinding) {
    if (otherBinding.tabId === tab.id) {
      throw new Error("A and B must be bound to different ChatGPT threads.");
    }
    if (urlInfo.supported && otherBinding.urlInfo?.normalizedUrl) {
      if (urlInfo.normalizedUrl === otherBinding.urlInfo.normalizedUrl) {
        throw new Error("A and B must be bound to different ChatGPT threads.");
      }
    }
    if (sessionIdentity.kind === "live_session" && otherBinding.sessionIdentity?.kind === "live_session") {
      if (otherBinding.sessionIdentity.tabId === sessionIdentity.tabId) {
        throw new Error("A and B must be bound to different ChatGPT threads.");
      }
    }
  }
  return updateState({
    type: "set_binding",
    role,
    binding: {
      role,
      tabId: tab.id ?? tabId,
      title: tab.title ?? "",
      url: tab.url ?? "",
      urlInfo,
      sessionIdentity,
      boundAt: (/* @__PURE__ */ new Date()).toISOString()
    }
  });
}
async function clearBinding(role) {
  if (!isBridgeRole2(role)) {
    throw new Error("A valid role is required.");
  }
  return updateState({
    type: "set_binding",
    role,
    binding: null
  });
}
async function startSession() {
  const next = await updateState({ type: "start" });
  if (next.phase === PHASES.RUNNING) {
    const started = await runStarterPreflight(next);
    if (started) {
      startRelayLoop(await getState());
    }
  }
  return getState();
}
async function pauseSession() {
  return updateState({ type: "pause" });
}
async function resumeSession() {
  const next = await updateState({ type: "resume" });
  if (next.phase === PHASES.RUNNING) {
    const started = await runStarterPreflight(next);
    if (started) {
      startRelayLoop(next);
    }
  }
  return getState();
}
async function runStarterPreflight(state) {
  const sourceRole = state.activeHop?.sourceRole ?? state.nextHopSource;
  const sourceBinding = state.bindings[sourceRole];
  if (!sourceBinding) {
    return true;
  }
  const threadActivity = await requestThreadActivity(sourceBinding.tabId);
  if (!threadActivity.ok) {
    return true;
  }
  if (!threadActivity.result.generating) {
    return true;
  }
  const timeoutMs = state.settings?.hopTimeoutMs ?? DEFAULT_SETTINGS.hopTimeoutMs;
  const pollIntervalMs = state.settings?.pollIntervalMs ?? DEFAULT_SETTINGS.pollIntervalMs;
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    const currentState = await getState();
    if (currentState.phase !== PHASES.RUNNING) {
      return false;
    }
    const activity = await requestThreadActivity(sourceBinding.tabId);
    if (!activity.ok || !activity.result.generating) {
      return true;
    }
    await updateState({
      type: "set_runtime_activity",
      activity: {
        step: `waiting ${sourceRole} settle`,
        sourceRole,
        targetRole: otherRole(sourceRole),
        pendingRound: currentState.round + 1,
        transport: "preflight",
        selector: "starter_generating"
      }
    });
    await sleep(pollIntervalMs);
  }
  await updateState({
    type: "stop_condition",
    reason: STOP_REASONS.STARTER_SETTLE_TIMEOUT
  });
  return false;
}
async function runTargetPreflight(targetRole, targetBinding, state, token) {
  if (!targetBinding) {
    return true;
  }
  const threadActivity = await requestThreadActivity(targetBinding.tabId);
  if (!threadActivity.ok) {
    const sourceRole2 = otherRole(targetRole);
    await updateState({
      type: "set_runtime_activity",
      activity: {
        step: `waiting ${targetRole} ready`,
        sourceRole: sourceRole2,
        targetRole,
        pendingRound: state.round + 1,
        transport: "preflight",
        selector: "activity_check_failed"
      }
    });
  } else if (!threadActivity.result.generating && threadActivity.result.composerAvailable) {
    return true;
  }
  const timeoutMs = state.settings?.hopTimeoutMs ?? DEFAULT_SETTINGS.hopTimeoutMs;
  const pollIntervalMs = state.settings?.pollIntervalMs ?? DEFAULT_SETTINGS.pollIntervalMs;
  const startTime = Date.now();
  const sourceRole = otherRole(targetRole);
  while (Date.now() - startTime < timeoutMs) {
    if (token !== activeLoopToken) {
      return false;
    }
    const currentState = await getState();
    if (currentState.phase !== PHASES.RUNNING) {
      return false;
    }
    const activity = await requestThreadActivity(targetBinding.tabId);
    if (!activity.ok) {
      await updateState({
        type: "set_runtime_activity",
        activity: {
          step: `waiting ${targetRole} ready`,
          sourceRole,
          targetRole,
          pendingRound: currentState.round + 1,
          transport: "preflight",
          selector: "activity_check_failed"
        }
      });
      await sleep(pollIntervalMs);
      continue;
    }
    if (!activity.result.generating && activity.result.composerAvailable) {
      return true;
    }
    if (activity.result.generating) {
      await updateState({
        type: "set_runtime_activity",
        activity: {
          step: `waiting ${targetRole} ready`,
          sourceRole,
          targetRole,
          pendingRound: currentState.round + 1,
          transport: "preflight",
          selector: "target_generating"
        }
      });
    } else if (!activity.result.composerAvailable) {
      await updateState({
        type: "set_runtime_activity",
        activity: {
          step: `waiting ${targetRole} ready`,
          sourceRole,
          targetRole,
          pendingRound: currentState.round + 1,
          transport: "preflight",
          selector: "target_busy"
        }
      });
    }
    await sleep(pollIntervalMs);
  }
  await updateState({
    type: "stop_condition",
    reason: STOP_REASONS.TARGET_SETTLE_TIMEOUT
  });
  return false;
}
async function stopSession() {
  return updateState({ type: "stop", reason: STOP_REASONS.USER_STOP });
}
async function clearTerminal() {
  return updateState({ type: "clear_terminal" });
}
function startRelayLoop(state) {
  activeLoopToken += 1;
  const token = activeLoopToken;
  void runRelayLoop(token, state.settings ?? DEFAULT_SETTINGS);
}
function getHopExecutionPlan(stage) {
  if (stage === "verifying") {
    return {
      shouldSend: false,
      shouldVerify: true,
      shouldWait: true
    };
  }
  if (stage === "waiting_reply") {
    return {
      shouldSend: false,
      shouldVerify: false,
      shouldWait: true
    };
  }
  return {
    shouldSend: true,
    shouldVerify: true,
    shouldWait: true
  };
}
function formatPendingBoundaryStep(sourceRole, targetRole) {
  return `pending ${sourceRole} -> ${targetRole}`;
}
function shouldExposePendingHopBoundary(state, activeHop) {
  return activeHop.stage === "pending" && activeHop.hopId === null && state.runtimeActivity.step !== formatPendingBoundaryStep(activeHop.sourceRole, activeHop.targetRole);
}
async function runRelayLoop(token, settings) {
  while (token === activeLoopToken) {
    const state = await getState();
    if (state.phase !== PHASES.RUNNING) {
      return;
    }
    const activeHop = state.activeHop;
    if (!activeHop) {
      await updateState({
        type: "runtime_error",
        reason: `${ERROR_REASONS.INTERNAL_ERROR}:missing_active_hop`
      });
      return;
    }
    const sourceRole = activeHop.sourceRole;
    const targetRole = activeHop.targetRole;
    const sourceBinding = state.bindings[sourceRole];
    const targetBinding = state.bindings[targetRole];
    const stagePlan = getHopExecutionPlan(activeHop.stage);
    if (shouldExposePendingHopBoundary(state, activeHop)) {
      await updateState({
        type: "set_runtime_activity",
        activity: {
          step: formatPendingBoundaryStep(sourceRole, targetRole),
          sourceRole,
          targetRole,
          pendingRound: activeHop.round,
          transport: null,
          selector: "pending"
        }
      });
      if (settings.pollIntervalMs > 0) {
        await sleep(Math.max(settings.pollIntervalMs, 3e3));
      }
      continue;
    }
    if (stagePlan.shouldSend) {
      await updateState({
        type: "set_runtime_activity",
        activity: {
          step: `reading ${sourceRole}`,
          sourceRole,
          targetRole,
          pendingRound: activeHop.round,
          transport: null,
          selector: null
        }
      });
    }
    if (stagePlan.shouldSend && (!sourceBinding || !targetBinding)) {
      await updateState({
        type: "invalidate_binding",
        role: !sourceBinding ? sourceRole : targetRole
      });
      return;
    }
    if (!stagePlan.shouldSend) {
      const resumeResult = await resumePersistedHop({
        activeHop,
        sourceRole,
        targetRole,
        token,
        settings
      });
      if (!resumeResult.ok) {
        return;
      }
      continue;
    }
    const sourceTab = await ensureRunnableBinding(sourceRole, sourceBinding);
    const targetTab = await ensureRunnableBinding(targetRole, targetBinding);
    if (!sourceTab || !targetTab) {
      return;
    }
    if (!await shouldContinueRelayLoop(token)) {
      return;
    }
    const targetPreflight = await runTargetPreflight(targetRole, targetBinding, state, token);
    if (!targetPreflight) {
      return;
    }
    if (!await shouldContinueRelayLoop(token)) {
      return;
    }
    const sourceSnapshot = await requestAssistantSnapshot(sourceBinding.tabId);
    if (!sourceSnapshot.ok) {
      await updateState({
        type: "selector_failure",
        reason: `${ERROR_REASONS.SELECTOR_FAILURE}:source:${sourceRole}`
      });
      return;
    }
    if (!await shouldContinueRelayLoop(token)) {
      return;
    }
    const sourceText = normalizeAssistantText(sourceSnapshot.result.text);
    const sourceHash = sourceSnapshot.result.hash ?? hashText(sourceText);
    const preSend = evaluatePreSendGuard({
      sourceText,
      sourceHash,
      lastForwardedSourceHash: state.lastForwardedHashes[sourceRole],
      stopMarker: settings.stopMarker
    });
    if (preSend.isEmpty) {
      await updateState({
        type: "runtime_error",
        reason: ERROR_REASONS.EMPTY_ASSISTANT_REPLY
      });
      return;
    }
    if (preSend.shouldStop) {
      await updateState({
        type: "stop_condition",
        reason: mapGuardReasonToStop(preSend.reason)
      });
      return;
    }
    const baselineTarget = await requestAssistantSnapshot(targetBinding.tabId);
    const targetHasNoAssistantMessage = baselineTarget.ok === false && (baselineTarget.error?.includes("not_found") || baselineTarget.error?.includes("empty"));
    if (!baselineTarget.ok && !targetHasNoAssistantMessage) {
      await updateState({
        type: "selector_failure",
        reason: `${ERROR_REASONS.SELECTOR_FAILURE}:target:${targetRole}`
      });
      return;
    }
    if (!await shouldContinueRelayLoop(token)) {
      return;
    }
    const verificationHopId = createVerificationHopId(state.sessionId, activeHop.round);
    const envelope = buildRelayEnvelope({
      sourceRole,
      round: activeHop.round,
      message: sourceText,
      hopId: verificationHopId,
      continueMarker: settings.continueMarker,
      instructionLocale: getInstructionLocale()
    });
    await updateState({
      type: "set_runtime_activity",
      activity: {
        step: `sending ${sourceRole} -> ${targetRole}`,
        sourceRole,
        targetRole,
        pendingRound: activeHop.round,
        transport: "sending",
        selector: "ok"
      }
    });
    const baselineCapture = await captureSubmissionVerificationBaseline(targetBinding.tabId);
    if (!baselineCapture.ok) {
      const baselineFailureReason = "reason" in baselineCapture ? baselineCapture.reason : "baseline_capture_failed";
      addRuntimeEvent({
        phaseStep: "baseline_capture_failed",
        sourceRole,
        targetRole,
        round: activeHop.round,
        dispatchReadbackSummary: "baseline_capture_failed",
        sendTriggerMode: "not_triggered",
        verificationBaseline: `hop:${verificationHopId}`,
        verificationPollSample: baselineFailureReason,
        verificationVerdict: "baseline_capture_failed"
      });
      await updateState({
        type: "selector_failure",
        reason: `${ERROR_REASONS.SELECTOR_FAILURE}:baseline_capture_failed`
      });
      return;
    }
    if (!await shouldContinueRelayLoop(token)) {
      return;
    }
    const baselineUserHash = baselineCapture.sample.latestUser.hash;
    const baselineGenerating = baselineCapture.sample.generating;
    const baselineLatestUserText = baselineCapture.sample.latestUser.text;
    const verificationBaselineSummary = formatVerificationBaseline(
      baselineUserHash,
      baselineGenerating,
      baselineLatestUserText,
      verificationHopId
    );
    addRuntimeEvent({
      phaseStep: "pre_send_baseline",
      sourceRole,
      targetRole,
      round: activeHop.round,
      dispatchReadbackSummary: "baseline_captured",
      sendTriggerMode: "not_triggered",
      verificationBaseline: verificationBaselineSummary,
      verificationPollSample: "baseline_only",
      verificationVerdict: "baseline_ready"
    });
    const sendResult = await sendRelayMessage(targetBinding.tabId, envelope);
    if (!await shouldContinueRelayLoop(token)) {
      return;
    }
    const dispatchReadbackSummary = summarizeDispatchReadback(sendResult);
    const dispatchEvidenceSummary = summarizeDispatchEvidence(sendResult);
    const dispatchFailureCode = resolveDispatchFailureCode(sendResult);
    if (!sendResult.ok || sendResult.dispatchAccepted !== true) {
      addRuntimeEvent({
        phaseStep: "dispatch_rejected",
        sourceRole,
        targetRole,
        round: activeHop.round,
        dispatchReadbackSummary,
        sendTriggerMode: sendResult.mode ?? "unknown",
        verificationBaseline: verificationBaselineSummary,
        verificationPollSample: dispatchEvidenceSummary,
        verificationVerdict: dispatchFailureCode
      });
      await updateState({
        type: "runtime_error",
        reason: `${ERROR_REASONS.MESSAGE_SEND_FAILED}:${dispatchFailureCode}`
      });
      return;
    }
    addRuntimeEvent({
      phaseStep: "dispatch_accepted",
      sourceRole,
      targetRole,
      round: activeHop.round,
      dispatchReadbackSummary,
      sendTriggerMode: sendResult.mode,
      verificationBaseline: verificationBaselineSummary,
      verificationPollSample: dispatchEvidenceSummary,
      verificationVerdict: "observation_window_opened"
    });
    const verifyingHop = {
      ...activeHop,
      targetTabId: targetBinding.tabId,
      hopId: verificationHopId,
      stage: "verifying",
      progress: {
        sourceHash,
        relayPayloadText: envelope,
        baselineUserHash,
        baselineGenerating,
        baselineLatestUserText,
        baselineAssistantHash: baselineTarget.ok ? baselineTarget.result.hash : null,
        verificationBaselineSummary,
        dispatchReadbackSummary,
        sendTriggerMode: sendResult.mode,
        sendTransport: `${sendResult.applyMode ?? "unknown"}:${sendResult.mode ?? "unknown"}`,
        lastVerificationPollSample: null,
        targetIdentity: captureHopTargetIdentity(targetBinding)
      }
    };
    await updateState({
      type: "set_execution_hop",
      hop: verifyingHop
    });
    const verificationResult = await verifySubmittedHop({
      activeHop: verifyingHop,
      sourceRole,
      targetRole,
      token
    });
    if (!verificationResult.ok) {
      return;
    }
    const waitingHop = {
      ...verifyingHop,
      stage: "waiting_reply",
      progress: verificationResult.progress
    };
    await updateState({
      type: "set_execution_hop",
      hop: waitingHop
    });
    const settled = await waitForHopReply({
      activeHop: waitingHop,
      sourceRole,
      targetRole,
      settings,
      token
    });
    if (token !== activeLoopToken) {
      return;
    }
    if (!settled.ok) {
      if (await handleSettledReplyFailure({
        settled,
        sourceRole,
        targetRole,
        round: activeHop.round,
        progress: verificationResult.progress
      })) {
        return;
      }
      await updateState({
        type: "selector_failure",
        reason: `${ERROR_REASONS.SELECTOR_FAILURE}:target_wait:${targetRole}`
      });
      return;
    }
    const nextState = await updateState({
      type: "hop_completed",
      sourceRole,
      targetRole,
      sourceHash: verificationResult.progress.sourceHash,
      targetHash: settled.result.hash
    });
    const postHop = evaluatePostHopGuard({
      assistantText: settled.result.text,
      round: nextState.round,
      maxRoundsEnabled: settings.maxRoundsEnabled,
      maxRounds: settings.maxRounds,
      stopMarker: settings.stopMarker
    });
    if (postHop.shouldStop) {
      await updateState({
        type: "stop_condition",
        reason: mapGuardReasonToStop(postHop.reason)
      });
      return;
    }
  }
}
async function resumePersistedHop({
  activeHop,
  sourceRole,
  targetRole,
  token,
  settings
}) {
  const progress = activeHop.progress ?? null;
  if (!activeHop.targetTabId || !activeHop.hopId || !progress) {
    await updateState({
      type: "runtime_error",
      reason: `${ERROR_REASONS.INTERNAL_ERROR}:missing_hop_progress`
    });
    return { ok: false };
  }
  if (activeHop.stage === "verifying") {
    const verificationResult = await verifySubmittedHop({
      activeHop,
      sourceRole,
      targetRole,
      token
    });
    if (!verificationResult.ok) {
      return verificationResult;
    }
    const waitingHop = {
      ...activeHop,
      stage: "waiting_reply",
      progress: verificationResult.progress
    };
    await updateState({
      type: "set_execution_hop",
      hop: waitingHop
    });
    const settled2 = await waitForHopReply({
      activeHop: waitingHop,
      sourceRole,
      targetRole,
      settings,
      token
    });
    if (token !== activeLoopToken) {
      return { ok: false };
    }
    if (!settled2.ok) {
      if (await handleSettledReplyFailure({
        settled: settled2,
        sourceRole,
        targetRole,
        round: activeHop.round,
        progress: verificationResult.progress
      })) {
        return { ok: false };
      }
      await updateState({
        type: "selector_failure",
        reason: `${ERROR_REASONS.SELECTOR_FAILURE}:target_wait:${targetRole}`
      });
      return { ok: false };
    }
    const nextState2 = await updateState({
      type: "hop_completed",
      sourceRole,
      targetRole,
      sourceHash: verificationResult.progress.sourceHash,
      targetHash: settled2.result.hash
    });
    const postHop2 = evaluatePostHopGuard({
      assistantText: settled2.result.text,
      round: nextState2.round,
      maxRoundsEnabled: settings.maxRoundsEnabled,
      maxRounds: settings.maxRounds,
      stopMarker: settings.stopMarker
    });
    if (postHop2.shouldStop) {
      await updateState({
        type: "stop_condition",
        reason: mapGuardReasonToStop(postHop2.reason)
      });
      return { ok: false };
    }
    return verificationResult;
  }
  const settled = await waitForHopReply({
    activeHop,
    sourceRole,
    targetRole,
    settings,
    token
  });
  if (token !== activeLoopToken) {
    return { ok: false };
  }
  if (!settled.ok) {
    if (await handleSettledReplyFailure({
      settled,
      sourceRole,
      targetRole,
      round: activeHop.round,
      progress
    })) {
      return { ok: false };
    }
    await updateState({
      type: "selector_failure",
      reason: `${ERROR_REASONS.SELECTOR_FAILURE}:target_wait:${targetRole}`
    });
    return { ok: false };
  }
  const nextState = await updateState({
    type: "hop_completed",
    sourceRole,
    targetRole,
    sourceHash: progress.sourceHash,
    targetHash: settled.result.hash
  });
  const postHop = evaluatePostHopGuard({
    assistantText: settled.result.text,
    round: nextState.round,
    maxRoundsEnabled: settings.maxRoundsEnabled,
    maxRounds: settings.maxRounds,
    stopMarker: settings.stopMarker
  });
  if (postHop.shouldStop) {
    await updateState({
      type: "stop_condition",
      reason: mapGuardReasonToStop(postHop.reason)
    });
    return { ok: false };
  }
  return {
    ok: true,
    progress
  };
}
async function ensureRunnableBinding(role, binding) {
  if (!binding) {
    return null;
  }
  try {
    const tab = await chrome.tabs.get(binding.tabId);
    return tab;
  } catch {
    await updateState({
      type: "invalidate_binding",
      role
    });
    return null;
  }
}
async function requestAssistantSnapshot(tabId) {
  try {
    return await chrome.tabs.sendMessage(tabId, {
      type: MESSAGE_TYPES.GET_ASSISTANT_SNAPSHOT
    });
  } catch (error) {
    return {
      ok: false,
      error: getErrorMessage(error)
    };
  }
}
async function requestThreadActivity(tabId) {
  try {
    return await chrome.tabs.sendMessage(tabId, {
      type: MESSAGE_TYPES.GET_THREAD_ACTIVITY
    });
  } catch (error) {
    return {
      ok: false,
      error: getErrorMessage(error)
    };
  }
}
async function requestTargetObservationSample(tabId) {
  const activity = await requestThreadActivity(tabId);
  if (!activity.ok) {
    return {
      ok: false,
      error: "error" in activity ? activity.error : "target_observation_unavailable"
    };
  }
  return {
    ok: true,
    result: activity.result.sample
  };
}
function captureHopTargetIdentity(binding) {
  const normalizedUrl = binding?.urlInfo?.supported ? binding.urlInfo.normalizedUrl : null;
  return {
    normalizedUrl
  };
}
function classifyTargetObservation({
  requestedTabId,
  canonicalTargetTabId,
  expectedTargetIdentity,
  observation
}) {
  if (!observation.ok) {
    return {
      classification: "unreachable_target",
      requestedTabId,
      canonicalTargetTabId,
      observedNormalizedUrl: null,
      error: "error" in observation ? observation.error : "target_observation_unavailable"
    };
  }
  const observedUrlInfo = parseChatGptThreadUrl(observation.result.identity.url);
  const observedNormalizedUrl = observedUrlInfo.supported ? observedUrlInfo.normalizedUrl : null;
  if (requestedTabId !== canonicalTargetTabId) {
    return {
      classification: "wrong_target",
      requestedTabId,
      canonicalTargetTabId,
      observedNormalizedUrl,
      sample: observation.result
    };
  }
  if (expectedTargetIdentity?.normalizedUrl && observedNormalizedUrl !== expectedTargetIdentity.normalizedUrl) {
    return {
      classification: "stale_target",
      requestedTabId,
      canonicalTargetTabId,
      observedNormalizedUrl,
      sample: observation.result
    };
  }
  return {
    classification: "correct_target",
    requestedTabId,
    canonicalTargetTabId,
    observedNormalizedUrl,
    sample: observation.result
  };
}
async function verifySubmittedHop({
  activeHop,
  sourceRole,
  targetRole,
  token
}) {
  const progress = activeHop.progress ?? null;
  if (!progress || !activeHop.targetTabId || !activeHop.hopId) {
    await updateState({
      type: "runtime_error",
      reason: `${ERROR_REASONS.INTERNAL_ERROR}:missing_hop_progress`
    });
    return { ok: false };
  }
  await updateState({
    type: "set_runtime_activity",
    activity: {
      step: `verifying ${targetRole} submission`,
      sourceRole,
      targetRole,
      pendingRound: activeHop.round,
      transport: "verifying",
      selector: "pending"
    }
  });
  const verificationTimeoutMs = 1e4;
  const verificationPollIntervalMs = 500;
  const verificationStartTime = Date.now();
  let acceptanceEstablished = false;
  let lastVerificationPollSample = progress.lastVerificationPollSample ?? "no_poll_sample";
  let lastAcceptanceGateReason = "acceptance_not_established_observation_window_only";
  while (Date.now() - verificationStartTime < verificationTimeoutMs) {
    if (token !== activeLoopToken) {
      return { ok: false };
    }
    const currentState = await getState();
    if (currentState.phase !== PHASES.RUNNING) {
      return { ok: false };
    }
    await sleep(verificationPollIntervalMs);
    const observation = classifyTargetObservation({
      requestedTabId: activeHop.targetTabId,
      canonicalTargetTabId: activeHop.targetTabId,
      expectedTargetIdentity: progress.targetIdentity ?? null,
      observation: await requestTargetObservationSample(activeHop.targetTabId)
    });
    if (observation.classification !== "correct_target") {
      lastAcceptanceGateReason = observation.classification;
      lastVerificationPollSample = observation.classification;
      await updateState({
        type: "set_runtime_activity",
        activity: {
          step: `verifying ${targetRole} submission`,
          sourceRole,
          targetRole,
          pendingRound: currentState.activeHop?.round ?? activeHop.round,
          transport: "verifying",
          selector: observation.classification
        }
      });
      continue;
    }
    const verificationResult = evaluateSubmissionVerification({
      baselineUserHash: progress.baselineUserHash,
      baselineGenerating: progress.baselineGenerating,
      baselineLatestUserText: progress.baselineLatestUserText,
      currentUserHash: observation.sample.latestUser.hash,
      currentGenerating: observation.sample.generating,
      currentLatestUserText: observation.sample.latestUser.text,
      relayPayloadText: progress.relayPayloadText,
      expectedHopId: activeHop.hopId
    });
    const acceptanceGate = evaluateSubmissionAcceptanceGate(verificationResult);
    const verificationPollSampleBase = formatVerificationPollSample(
      observation.sample.latestUser.hash,
      observation.sample.generating,
      observation.sample.latestUser.text
    );
    const verificationPollSample = [
      verificationPollSampleBase,
      `gate:${acceptanceGate.reason}`,
      `hop_binding:${verificationResult.hopBindingStrength}`,
      `payload:${verificationResult.payloadCorrelationStrength}`,
      `generation:${verificationResult.generationSettlementStrength}`,
      `user_turn_changed:${verificationResult.userTurnChanged}`
    ].join("|");
    lastVerificationPollSample = verificationPollSample;
    lastAcceptanceGateReason = acceptanceGate.reason;
    if (acceptanceGate.acceptedEquivalentEvidence) {
      addRuntimeEvent({
        phaseStep: "verification_passed",
        sourceRole,
        targetRole,
        round: activeHop.round,
        dispatchReadbackSummary: progress.dispatchReadbackSummary,
        sendTriggerMode: progress.sendTriggerMode,
        verificationBaseline: progress.verificationBaselineSummary,
        verificationPollSample,
        verificationVerdict: acceptanceGate.reason
      });
      acceptanceEstablished = true;
      break;
    }
    addRuntimeEvent({
      phaseStep: "verifying",
      sourceRole,
      targetRole,
      round: activeHop.round,
      dispatchReadbackSummary: progress.dispatchReadbackSummary,
      sendTriggerMode: progress.sendTriggerMode,
      verificationBaseline: progress.verificationBaselineSummary,
      verificationPollSample,
      verificationVerdict: acceptanceGate.reason
    });
    await updateState({
      type: "set_runtime_activity",
      activity: {
        step: `verifying ${targetRole} submission`,
        sourceRole,
        targetRole,
        pendingRound: currentState.activeHop?.round ?? activeHop.round,
        transport: "verifying",
        selector: acceptanceGate.reason
      }
    });
  }
  if (!acceptanceEstablished) {
    addRuntimeEvent({
      phaseStep: "verification_failed",
      sourceRole,
      targetRole,
      round: activeHop.round,
      dispatchReadbackSummary: progress.dispatchReadbackSummary,
      sendTriggerMode: progress.sendTriggerMode,
      verificationBaseline: progress.verificationBaselineSummary,
      verificationPollSample: lastVerificationPollSample,
      verificationVerdict: lastAcceptanceGateReason
    });
    await updateState({
      type: "set_runtime_activity",
      activity: {
        step: `verifying ${targetRole} submission`,
        sourceRole,
        targetRole,
        pendingRound: activeHop.round,
        transport: "verifying",
        selector: "acceptance_not_established"
      }
    });
    await updateState({
      type: "stop_condition",
      reason: STOP_REASONS.SUBMISSION_NOT_VERIFIED
    });
    return { ok: false };
  }
  const nextProgress = {
    ...progress,
    lastVerificationPollSample
  };
  await updateState({
    type: "set_execution_hop",
    hop: {
      ...activeHop,
      progress: nextProgress
    }
  });
  return {
    ok: true,
    progress: nextProgress
  };
}
async function waitForHopReply({
  activeHop,
  sourceRole,
  targetRole,
  settings,
  token
}) {
  const progress = activeHop.progress ?? null;
  if (!progress || !activeHop.targetTabId) {
    await updateState({
      type: "runtime_error",
      reason: `${ERROR_REASONS.INTERNAL_ERROR}:missing_hop_progress`
    });
    return {
      ok: false,
      reason: STOP_REASONS.HOP_TIMEOUT
    };
  }
  await updateState({
    type: "set_runtime_activity",
    activity: {
      step: `waiting ${targetRole} reply`,
      sourceRole,
      targetRole,
      pendingRound: activeHop.round,
      transport: progress.sendTransport,
      selector: "waiting_reply"
    }
  });
  addRuntimeEvent({
    phaseStep: "waiting_reply",
    sourceRole,
    targetRole,
    round: activeHop.round,
    dispatchReadbackSummary: progress.dispatchReadbackSummary,
    sendTriggerMode: progress.sendTriggerMode,
    verificationBaseline: progress.verificationBaselineSummary,
    verificationPollSample: progress.lastVerificationPollSample ?? "no_poll_sample",
    verificationVerdict: "waiting_reply_after_acceptance"
  });
  return waitForSettledReply({
    tabId: activeHop.targetTabId,
    canonicalTargetTabId: activeHop.targetTabId,
    baselineHash: progress.baselineAssistantHash,
    expectedTargetIdentity: progress.targetIdentity ?? null,
    settings,
    token,
    sourceRole,
    targetRole,
    round: activeHop.round
  });
}
async function captureSubmissionVerificationBaseline(tabId, timeoutMs = 5e3, pollIntervalMs = 250) {
  const startedAt = Date.now();
  let lastReason = "thread_activity_unavailable";
  while (Date.now() - startedAt < timeoutMs) {
    const observation = await requestTargetObservationSample(tabId);
    if (!observation.ok) {
      lastReason = `target_observation:${"error" in observation ? observation.error : "unavailable"}`;
      await sleep(pollIntervalMs);
      continue;
    }
    return {
      ok: true,
      sample: observation.result
    };
  }
  return {
    ok: false,
    reason: lastReason
  };
}
var SEND_MESSAGE_TIMEOUT_MS = 8e3;
async function sendRelayMessage(tabId, text) {
  try {
    return await Promise.race([
      chrome.tabs.sendMessage(tabId, {
        type: MESSAGE_TYPES.SEND_RELAY_MESSAGE,
        text
      }),
      sleep(SEND_MESSAGE_TIMEOUT_MS).then(() => ({
        ok: false,
        error: "send_message_timeout"
      }))
    ]);
  } catch (error) {
    return {
      ok: false,
      error: getErrorMessage(error)
    };
  }
}
async function waitForSettledReply({
  tabId,
  canonicalTargetTabId,
  baselineHash,
  expectedTargetIdentity,
  settings,
  token,
  sourceRole = null,
  targetRole = null,
  round = 0
}) {
  const startedAt = Date.now();
  let lastProgressAt = startedAt;
  let elapsedMs = 0;
  let idleMs = 0;
  let stableHash = null;
  let lastObservedAssistantHash = baselineHash;
  let stableCount = 0;
  let pendingObservationFailure = null;
  while (true) {
    const now = Date.now();
    elapsedMs = now - startedAt;
    idleMs = now - lastProgressAt;
    if (idleMs >= settings.hopTimeoutMs) {
      break;
    }
    if (token !== activeLoopToken) {
      return {
        ok: false,
        reason: "loop_cancelled"
      };
    }
    await sleep(settings.pollIntervalMs);
    const observation = classifyTargetObservation({
      requestedTabId: tabId,
      canonicalTargetTabId,
      expectedTargetIdentity,
      observation: await requestTargetObservationSample(tabId)
    });
    if (observation.classification !== "correct_target") {
      addRuntimeEvent({
        phaseStep: "reply_poll",
        sourceRole,
        targetRole,
        round,
        dispatchReadbackSummary: "reply_wait",
        sendTriggerMode: "observation",
        verificationBaseline: `baseline_assistant:${baselineHash ?? "null"}`,
        verificationPollSample: `classification:${observation.classification}|elapsed_ms:${elapsedMs}`,
        verificationVerdict: observation.classification
      });
      return {
        ok: false,
        reason: mapObservationClassificationToStopReason(observation.classification)
      };
    }
    const latestAssistant = observation.sample.latestAssistant;
    if (!latestAssistant.present || !latestAssistant.text || !latestAssistant.hash) {
      pendingObservationFailure = STOP_REASONS.REPLY_OBSERVATION_MISSING;
      stableHash = null;
      stableCount = 0;
      addRuntimeEvent({
        phaseStep: "reply_poll",
        sourceRole,
        targetRole,
        round,
        dispatchReadbackSummary: "reply_wait",
        sendTriggerMode: "observation",
        verificationBaseline: `baseline_assistant:${baselineHash ?? "null"}`,
        verificationPollSample: formatReplyPollSample({
          observation,
          baselineHash,
          stableHash,
          stableCount,
          elapsedMs
        }),
        verificationVerdict: STOP_REASONS.REPLY_OBSERVATION_MISSING
      });
      continue;
    }
    pendingObservationFailure = null;
    const currentHash = latestAssistant.hash;
    if (currentHash && currentHash !== baselineHash && currentHash !== lastObservedAssistantHash) {
      lastObservedAssistantHash = currentHash;
      lastProgressAt = Date.now();
      idleMs = 0;
    }
    if (!currentHash || currentHash === baselineHash) {
      stableHash = null;
      stableCount = 0;
      addRuntimeEvent({
        phaseStep: "reply_poll",
        sourceRole,
        targetRole,
        round,
        dispatchReadbackSummary: "reply_wait",
        sendTriggerMode: "observation",
        verificationBaseline: `baseline_assistant:${baselineHash ?? "null"}`,
        verificationPollSample: formatReplyPollSample({
          observation,
          baselineHash,
          stableHash,
          stableCount,
          elapsedMs
        }),
        verificationVerdict: "assistant_hash_unchanged"
      });
      continue;
    }
    if (stableHash === currentHash) {
      stableCount += 1;
    } else {
      stableHash = currentHash;
      stableCount = 1;
    }
    const replySettleConfirmed = observation.sample.generating === false;
    addRuntimeEvent({
      phaseStep: "reply_poll",
      sourceRole,
      targetRole,
      round,
      dispatchReadbackSummary: "reply_wait",
      sendTriggerMode: "observation",
      verificationBaseline: `baseline_assistant:${baselineHash ?? "null"}`,
      verificationPollSample: formatReplyPollSample({
        observation,
        baselineHash,
        stableHash,
        stableCount,
        elapsedMs
      }),
      verificationVerdict: replySettleConfirmed ? "settle_candidate" : "still_generating"
    });
    if (stableCount >= settings.settleSamplesRequired && replySettleConfirmed) {
      return {
        ok: true,
        result: {
          text: latestAssistant.text,
          hash: currentHash,
          sample: observation.sample
        }
      };
    }
  }
  addRuntimeEvent({
    phaseStep: "reply_timeout_final",
    sourceRole,
    targetRole,
    round,
    dispatchReadbackSummary: "reply_wait",
    sendTriggerMode: "observation",
    verificationBaseline: `baseline_assistant:${baselineHash ?? "null"}`,
    verificationPollSample: `elapsed_ms:${elapsedMs}|idle_ms:${idleMs}|stable_hash:${stableHash ?? "null"}|stable_count:${stableCount}`,
    verificationVerdict: pendingObservationFailure ?? STOP_REASONS.HOP_TIMEOUT
  });
  return {
    ok: false,
    reason: pendingObservationFailure ?? STOP_REASONS.HOP_TIMEOUT
  };
}
function formatReplyPollSample({
  observation,
  baselineHash,
  stableHash,
  stableCount,
  elapsedMs
}) {
  const assistant = observation.sample.latestAssistant;
  const preview = normalizeAssistantText(assistant.text).slice(0, 80).replace(/\s+/g, " ");
  return [
    `elapsed_ms:${elapsedMs}`,
    `assistant_present:${assistant.present}`,
    `assistant_hash:${assistant.hash ?? "null"}`,
    `baseline_hash:${baselineHash ?? "null"}`,
    `stable_hash:${stableHash ?? "null"}`,
    `stable_count:${stableCount}`,
    `generating:${observation.sample.generating}`,
    `preview:${preview || "null"}`
  ].join("|");
}
async function getPopupModel(activeTabId) {
  const state = await getState();
  const overlaySettings = await getOverlaySettings();
  const currentTab = activeTabId ? await safeGetTab(activeTabId) : null;
  const currentTabInfo = currentTab ? {
    id: currentTab.id,
    title: currentTab.title ?? "",
    url: currentTab.url ?? "",
    urlInfo: parseChatGptThreadUrl(currentTab.url ?? ""),
    assignedRole: findRoleByTabId(state, currentTab.id ?? null)
  } : null;
  const sourceRole = state.activeHop?.sourceRole ?? state.nextHopOverride ?? state.nextHopSource;
  const sourceBinding = state.bindings[sourceRole];
  let sourceThreadActivity = null;
  if (sourceBinding) {
    const activity = await requestThreadActivity(sourceBinding.tabId);
    if (activity.ok) {
      sourceThreadActivity = activity.result;
    }
  }
  const readiness = computeReadiness(state, sourceThreadActivity);
  return {
    state,
    overlaySettings,
    currentTab: currentTabInfo,
    controls: deriveControls(state, readiness),
    display: buildDisplay(state),
    readiness
  };
}
async function getOverlayModel(tabId) {
  const state = await getState();
  const overlaySettings = await getOverlaySettings();
  return await buildOverlaySnapshot(state, tabId, overlaySettings);
}
async function safeGetTab(tabId) {
  try {
    return await chrome.tabs.get(tabId);
  } catch {
    return null;
  }
}
async function broadcastOverlayState(state, previousState = null, broadcastAllChatGptTabs = false, overlaySettings = null) {
  const nextOverlaySettings = overlaySettings ?? await getOverlaySettings();
  const tabIds = new Set(collectOverlaySyncTabIds(previousState, state));
  for (const tabId of overlayPortsByTabId.keys()) {
    tabIds.add(tabId);
  }
  if (broadcastAllChatGptTabs) {
    const tabs = await chrome.tabs.query({
      url: ["https://chatgpt.com/*"]
    });
    for (const tab of tabs) {
      if (tab.id) {
        tabIds.add(tab.id);
      }
    }
  }
  await Promise.all(
    Array.from(tabIds).map(async (tabId) => {
      try {
        const snapshot = await buildOverlaySnapshot(state, tabId, nextOverlaySettings);
        const message = {
          type: MESSAGE_TYPES.SYNC_OVERLAY_STATE,
          snapshot
        };
        postOverlayStateToPorts(tabId, message);
        await chrome.tabs.sendMessage(tabId, message);
      } catch {
        return null;
      }
      return null;
    })
  );
}
function postOverlayStateToPorts(tabId, message) {
  const tabPorts = overlayPortsByTabId.get(tabId);
  if (!tabPorts) {
    return;
  }
  for (const port of tabPorts) {
    try {
      port.postMessage(message);
    } catch {
      tabPorts.delete(port);
    }
  }
  if (tabPorts.size === 0) {
    overlayPortsByTabId.delete(tabId);
  }
}
async function buildOverlaySnapshot(state, tabId, overlaySettings) {
  const sourceRole = state.activeHop?.sourceRole ?? state.nextHopOverride ?? state.nextHopSource;
  const sourceBinding = state.bindings[sourceRole];
  let sourceThreadActivity = null;
  if (sourceBinding) {
    const activity = await requestThreadActivity(sourceBinding.tabId);
    if (activity.ok) {
      sourceThreadActivity = activity.result;
    }
  }
  const readiness = computeReadiness(state, sourceThreadActivity);
  return {
    phase: state.phase,
    round: state.round,
    maxRoundsEnabled: state.settings.maxRoundsEnabled,
    maxRounds: state.settings.maxRounds,
    nextHop: formatNextHop(state.activeHop?.sourceRole ?? state.nextHopOverride ?? state.nextHopSource),
    requiresTerminalClear: state.requiresTerminalClear,
    assignedRole: findRoleByTabId(state, tabId),
    starter: state.starter,
    controls: deriveControls(state, readiness),
    display: buildDisplay(state),
    overlaySettings,
    readiness,
    currentTabId: tabId
  };
}
function findRoleByTabId(state, tabId) {
  if (!tabId) {
    return null;
  }
  if (state.bindings.A?.tabId === tabId) {
    return ROLE_A;
  }
  if (state.bindings.B?.tabId === tabId) {
    return ROLE_B;
  }
  return null;
}
function mapGuardReasonToStop(reason) {
  return guardReasonToStopReason(reason);
}
function isBridgeRole2(role) {
  return typeof role === "string" && ROLES.includes(role);
}
async function getSessionValue(key) {
  const payload = await chrome.storage.session.get(key);
  return payload[key] ?? null;
}
async function setSessionValue(key, value) {
  await chrome.storage.session.set({
    [key]: value
  });
}
async function getLocalValue(key) {
  const payload = await chrome.storage.local.get(key);
  return payload[key] ?? null;
}
async function setLocalValue(key, value) {
  await chrome.storage.local.set({
    [key]: value
  });
}
function getErrorMessage(error) {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error ?? "unknown_error");
}
function sleep(durationMs) {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}
async function shouldContinueRelayLoop(token) {
  if (token !== activeLoopToken) {
    return false;
  }
  const state = await getState();
  return state.phase === PHASES.RUNNING;
}
function structuredCloneSafe(value) {
  return JSON.parse(JSON.stringify(value));
}
export {
  classifyTargetObservation,
  formatPendingBoundaryStep,
  getHopExecutionPlan,
  runRelayLoop,
  setActiveLoopTokenForTest,
  shouldExposePendingHopBoundary,
  waitForSettledReply
};
