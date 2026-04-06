// core/background-helpers.ts
function shouldKeepBindingForUrlChange(binding, nextUrlInfo) {
  if (!binding?.urlInfo?.supported || !nextUrlInfo?.supported) {
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
  START_SESSION: "START_SESSION",
  PAUSE_SESSION: "PAUSE_SESSION",
  RESUME_SESSION: "RESUME_SESSION",
  STOP_SESSION: "STOP_SESSION",
  CLEAR_TERMINAL: "CLEAR_TERMINAL",
  SET_NEXT_HOP_OVERRIDE: "SET_NEXT_HOP_OVERRIDE",
  SET_OVERLAY_ENABLED: "SET_OVERLAY_ENABLED",
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
  state.runtimeActivity = {
    step: "starting",
    sourceRole: state.starter,
    targetRole: otherRole(state.starter),
    pendingRound: state.round + 1,
    lastActionAt: (/* @__PURE__ */ new Date()).toISOString(),
    transport: null,
    selector: null
  };
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
  if (state.nextHopOverride) {
    state.nextHopSource = state.nextHopOverride;
    state.nextHopOverride = null;
  }
  state.runtimeActivity = {
    ...state.runtimeActivity,
    step: "resuming",
    sourceRole: state.nextHopSource,
    targetRole: otherRole(state.nextHopSource),
    pendingRound: state.round + 1,
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
  state.runtimeActivity = {
    step: "hop_completed",
    sourceRole: event.sourceRole ?? null,
    targetRole: event.targetRole ?? null,
    pendingRound: state.round,
    lastActionAt: (/* @__PURE__ */ new Date()).toISOString(),
    transport: "ok",
    selector: "ok"
  };
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
function toStopped(state, reason) {
  if (state.phase !== PHASES.RUNNING && state.phase !== PHASES.PAUSED) {
    return state;
  }
  state.phase = PHASES.STOPPED;
  state.lastStopReason = reason;
  state.lastError = null;
  state.nextHopOverride = null;
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
  return Boolean(binding?.tabId && binding?.urlInfo?.supported);
}
function isBridgeRole(value) {
  return value === ROLE_A || value === ROLE_B;
}
function isTabId(value) {
  return typeof value === "number" && Number.isFinite(value);
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
    boundAt: binding.boundAt ?? (/* @__PURE__ */ new Date()).toISOString()
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
  return siblingBinding.tabId === candidateBinding.tabId || siblingBinding.urlInfo?.normalizedUrl === candidateBinding.urlInfo?.normalizedUrl;
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
  sourceRole,
  round,
  message,
  continueMarker = DEFAULT_SETTINGS.continueMarker,
  bridgeStatePrefix = DEFAULT_SETTINGS.bridgeStatePrefix
}) {
  return [
    "[BRIDGE_CONTEXT]",
    `source: ${sourceRole}`,
    `round: ${round}`,
    "",
    normalizeAssistantText(message),
    "",
    "[BRIDGE_INSTRUCTION]",
    "Continue the discussion from the bridged content above.",
    "End your reply with exactly one final line:",
    `${bridgeStatePrefix} ${continueMarker}`,
    "or",
    `${bridgeStatePrefix} ${DEFAULT_SETTINGS.stopMarker}`
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
  maxRounds,
  stopMarker = DEFAULT_SETTINGS.stopMarker
}) {
  if (parseBridgeDirective(assistantText) === stopMarker) {
    return {
      shouldStop: true,
      reason: "stop_marker"
    };
  }
  if (round >= maxRounds) {
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
  return text.includes("[BRIDGE_CONTEXT]") || text.includes("[\u6765\u81EA");
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
function verifyPayloadCorrelation(latestUserText, relayPayload) {
  if (!latestUserText || !relayPayload) {
    return false;
  }
  if (containsBridgeEnvelope(latestUserText)) {
    return true;
  }
  const overlap = calculateTextOverlap(latestUserText, relayPayload);
  if (overlap >= 0.5) {
    return true;
  }
  return false;
}
function evaluateSubmissionVerification(input) {
  const {
    baselineUserHash,
    baselineGenerating,
    baselineLatestUserText,
    currentUserHash,
    currentGenerating,
    currentLatestUserText,
    relayPayloadText
  } = input;
  if (currentUserHash && currentUserHash !== baselineUserHash) {
    if (currentLatestUserText && verifyPayloadCorrelation(currentLatestUserText, relayPayloadText)) {
      return {
        verified: true,
        reason: "payload_accepted"
      };
    }
  }
  if (!baselineGenerating && currentGenerating) {
    if (currentLatestUserText && verifyPayloadCorrelation(currentLatestUserText, relayPayloadText)) {
      const textChanged = baselineLatestUserText !== null && currentLatestUserText !== null && currentLatestUserText !== baselineLatestUserText;
      if (textChanged) {
        return {
          verified: true,
          reason: "generation_with_user_changed"
        };
      }
    }
  }
  return {
    verified: false,
    reason: "not_verified"
  };
}

// core/popup-model.ts
function deriveControls(state, readiness) {
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
function computeReadiness(state, sourceThreadActivity) {
  const sourceRole = state.nextHopOverride ?? state.nextHopSource;
  const starterRole = state.starter;
  const checkRole = state.phase === PHASES.READY ? starterRole : sourceRole;
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
  const sourceRole = state.nextHopOverride ?? state.nextHopSource;
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
var MAX_RUNTIME_EVENTS = 30;
var runtimeEvents = [];
function addRuntimeEvent(event) {
  runtimeEvents.push({
    ...event,
    id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    timestamp: (/* @__PURE__ */ new Date()).toISOString()
  });
  if (runtimeEvents.length > MAX_RUNTIME_EVENTS) {
    runtimeEvents.shift();
  }
}
function getRecentRuntimeEvents() {
  return [...runtimeEvents];
}
chrome.runtime.onInstalled.addListener(async () => {
  await initializeState();
  await initializeOverlaySettings();
});
chrome.runtime.onStartup.addListener(async () => {
  await initializeState();
  await initializeOverlaySettings();
});
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "bridge-tab-keepalive") {
    return;
  }
  keepAlivePorts.add(port);
  port.onMessage.addListener(() => {
  });
  port.onDisconnect.addListener(() => {
    keepAlivePorts.delete(port);
  });
});
chrome.tabs.onRemoved.addListener(async (tabId) => {
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
  nextState.bindings[role] = {
    ...nextState.bindings[role],
    url: changeInfo.url,
    urlInfo
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
    case MESSAGE_TYPES.SET_NEXT_HOP_OVERRIDE:
      return updateState({ type: "set_next_hop_override", role: message.role });
    case MESSAGE_TYPES.SET_OVERLAY_ENABLED:
      return updateOverlaySettings({ enabled: Boolean(message.enabled) });
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
  await broadcastOverlayState(nextState, previousState);
  return nextState;
}
async function updateState(event) {
  const current = await getState();
  const next = reduceState(current, event);
  if (next.phase !== PHASES.RUNNING) {
    activeLoopToken = 0;
  }
  return persistState(next, current);
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
  if (!urlInfo.supported) {
    throw new Error("The selected tab is not a supported ChatGPT thread.");
  }
  const otherBinding = state.bindings[otherRole(role)];
  if (otherBinding && (otherBinding.tabId === tab.id || otherBinding.urlInfo?.normalizedUrl === urlInfo.normalizedUrl)) {
    throw new Error("A and B must be bound to different ChatGPT threads.");
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
      startRelayLoop(await getState());
    }
  }
  return getState();
}
async function runStarterPreflight(state) {
  const sourceRole = state.nextHopSource;
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
  } else if (!threadActivity.result.generating && threadActivity.result.sendButtonReady) {
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
    if (!activity.result.generating && activity.result.sendButtonReady) {
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
    } else if (!activity.result.sendButtonReady) {
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
async function runRelayLoop(token, settings) {
  while (token === activeLoopToken) {
    const state = await getState();
    if (state.phase !== PHASES.RUNNING) {
      return;
    }
    const sourceRole = state.nextHopSource;
    const targetRole = otherRole(sourceRole);
    const sourceBinding = state.bindings[sourceRole];
    const targetBinding = state.bindings[targetRole];
    await updateState({
      type: "set_runtime_activity",
      activity: {
        step: `reading ${sourceRole}`,
        sourceRole,
        targetRole,
        pendingRound: state.round + 1,
        transport: null,
        selector: null
      }
    });
    if (!sourceBinding || !targetBinding) {
      await updateState({
        type: "invalidate_binding",
        role: !sourceBinding ? sourceRole : targetRole
      });
      return;
    }
    const sourceTab = await ensureRunnableBinding(sourceRole, sourceBinding);
    const targetTab = await ensureRunnableBinding(targetRole, targetBinding);
    if (!sourceTab || !targetTab) {
      return;
    }
    const targetPreflight = await runTargetPreflight(targetRole, targetBinding, state, token);
    if (!targetPreflight) {
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
    if (!baselineTarget.ok) {
      await updateState({
        type: "selector_failure",
        reason: `${ERROR_REASONS.SELECTOR_FAILURE}:target:${targetRole}`
      });
      return;
    }
    const envelope = buildRelayEnvelope({
      sourceRole,
      round: state.round + 1,
      message: sourceText,
      continueMarker: settings.continueMarker
    });
    await updateState({
      type: "set_runtime_activity",
      activity: {
        step: `sending ${sourceRole} -> ${targetRole}`,
        sourceRole,
        targetRole,
        pendingRound: state.round + 1,
        transport: "sending",
        selector: "ok"
      }
    });
    const baselineTargetActivity = await requestThreadActivity(targetBinding.tabId);
    const baselineUserHash = baselineTargetActivity.ok ? baselineTargetActivity.result.latestUserHash : null;
    const baselineGenerating = baselineTargetActivity.ok ? baselineTargetActivity.result.generating : false;
    const baselineLatestUserText = baselineTargetActivity.ok ? await getTargetLatestUserText(targetBinding.tabId) : null;
    addRuntimeEvent({
      phaseStep: "pre_send_baseline",
      sourceRole,
      targetRole,
      round: state.round + 1,
      dispatchReadbackSummary: "pending",
      sendTriggerMode: "pending",
      verificationBaseline: baselineLatestUserText ? `hash:${baselineUserHash},gen:${baselineGenerating},text:${baselineLatestUserText.slice(0, 50)}` : `hash:${baselineUserHash},gen:${baselineGenerating}`,
      verificationPollSample: "",
      verificationVerdict: "pending"
    });
    const sendResult = await sendRelayMessage(targetBinding.tabId, envelope);
    if (!sendResult.ok) {
      addRuntimeEvent({
        phaseStep: "send_failed",
        sourceRole,
        targetRole,
        round: state.round + 1,
        dispatchReadbackSummary: sendResult.dispatchAccepted ? "accepted" : "rejected",
        sendTriggerMode: sendResult.mode ?? "unknown",
        verificationBaseline: "n/a",
        verificationPollSample: "",
        verificationVerdict: sendResult.error ?? "unknown_error"
      });
      await updateState({
        type: "runtime_error",
        reason: `${ERROR_REASONS.MESSAGE_SEND_FAILED}:${sendResult.error ?? "unknown"}`
      });
      return;
    }
    await updateState({
      type: "set_runtime_activity",
      activity: {
        step: `verifying ${targetRole} submission`,
        sourceRole,
        targetRole,
        pendingRound: state.round + 1,
        transport: "verifying",
        selector: "pending"
      }
    });
    const verificationTimeoutMs = 1e4;
    const verificationPollIntervalMs = 500;
    const verificationStartTime = Date.now();
    let verificationPassed = false;
    while (Date.now() - verificationStartTime < verificationTimeoutMs) {
      if (token !== activeLoopToken) {
        return;
      }
      const currentState = await getState();
      if (currentState.phase !== PHASES.RUNNING) {
        return;
      }
      await sleep(verificationPollIntervalMs);
      const activity = await requestThreadActivity(targetBinding.tabId);
      if (!activity.ok) {
        await updateState({
          type: "set_runtime_activity",
          activity: {
            step: `verifying ${targetRole} submission`,
            sourceRole,
            targetRole,
            pendingRound: currentState.round + 1,
            transport: "verifying",
            selector: "activity_check_failed"
          }
        });
        continue;
      }
      const currentLatestUserText = await getTargetLatestUserText(targetBinding.tabId);
      const verificationResult = evaluateSubmissionVerification({
        baselineUserHash,
        baselineGenerating,
        baselineLatestUserText,
        currentUserHash: activity.result.latestUserHash,
        currentGenerating: activity.result.generating,
        currentLatestUserText,
        relayPayloadText: envelope
      });
      if (verificationResult.verified) {
        addRuntimeEvent({
          phaseStep: "verification_passed",
          sourceRole,
          targetRole,
          round: state.round + 1,
          dispatchReadbackSummary: "n/a",
          sendTriggerMode: sendResult.mode ?? "unknown",
          verificationBaseline: baselineLatestUserText ? `hash:${baselineUserHash},gen:${baselineGenerating},text:${baselineLatestUserText.slice(0, 50)}` : `hash:${baselineUserHash},gen:${baselineGenerating}`,
          verificationPollSample: `hash:${activity.result.latestUserHash},gen:${activity.result.generating},text:${currentLatestUserText?.slice(0, 50) ?? "null"}`,
          verificationVerdict: verificationResult.reason
        });
        verificationPassed = true;
        break;
      }
      addRuntimeEvent({
        phaseStep: "verifying",
        sourceRole,
        targetRole,
        round: state.round + 1,
        dispatchReadbackSummary: "n/a",
        sendTriggerMode: sendResult.mode ?? "unknown",
        verificationBaseline: baselineLatestUserText ? `hash:${baselineUserHash},gen:${baselineGenerating},text:${baselineLatestUserText.slice(0, 50)}` : `hash:${baselineUserHash},gen:${baselineGenerating}`,
        verificationPollSample: `hash:${activity.result.latestUserHash},gen:${activity.result.generating},text:${currentLatestUserText?.slice(0, 50) ?? "null"}`,
        verificationVerdict: verificationResult.reason
      });
      await updateState({
        type: "set_runtime_activity",
        activity: {
          step: `verifying ${targetRole} submission`,
          sourceRole,
          targetRole,
          pendingRound: currentState.round + 1,
          transport: "verifying",
          selector: verificationResult.reason
        }
      });
    }
    if (!verificationPassed) {
      await updateState({
        type: "stop_condition",
        reason: STOP_REASONS.SUBMISSION_NOT_VERIFIED
      });
      return;
    }
    await updateState({
      type: "set_runtime_activity",
      activity: {
        step: `waiting ${targetRole} reply`,
        sourceRole,
        targetRole,
        pendingRound: state.round + 1,
        transport: `${sendResult.applyMode ?? "unknown"}:${sendResult.mode ?? "unknown"}`,
        selector: "waiting_reply"
      }
    });
    const settled = await waitForSettledReply({
      tabId: targetBinding.tabId,
      baselineHash: baselineTarget.result.hash,
      settings,
      token
    });
    if (token !== activeLoopToken) {
      return;
    }
    if ("reason" in settled && settled.reason === STOP_REASONS.HOP_TIMEOUT) {
      await updateState({
        type: "stop_condition",
        reason: STOP_REASONS.HOP_TIMEOUT
      });
      return;
    }
    if (!settled.ok) {
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
      sourceHash,
      targetHash: settled.result.hash
    });
    const postHop = evaluatePostHopGuard({
      assistantText: settled.result.text,
      round: nextState.round,
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
async function ensureRunnableBinding(role, binding) {
  if (!binding) {
    return null;
  }
  try {
    const tab = await chrome.tabs.get(binding.tabId);
    const urlInfo = parseChatGptThreadUrl(tab.url ?? "");
    if (!urlInfo.supported) {
      await updateState({
        type: "invalidate_binding",
        role
      });
      return null;
    }
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
async function getTargetLatestUserText(tabId) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, {
      type: MESSAGE_TYPES.GET_LATEST_USER_TEXT
    });
    if (response.ok) {
      return response.text;
    }
    return null;
  } catch {
    return null;
  }
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
  baselineHash,
  settings,
  token
}) {
  const startedAt = Date.now();
  let stableHash = null;
  let stableCount = 0;
  while (Date.now() - startedAt < settings.hopTimeoutMs) {
    if (token !== activeLoopToken) {
      return {
        ok: false,
        reason: "loop_cancelled"
      };
    }
    await sleep(settings.pollIntervalMs);
    const snapshot = await requestAssistantSnapshot(tabId);
    if (!snapshot.ok) {
      return snapshot;
    }
    const currentHash = snapshot.result.hash;
    if (!currentHash || currentHash === baselineHash) {
      stableHash = null;
      stableCount = 0;
      continue;
    }
    if (stableHash === currentHash) {
      stableCount += 1;
    } else {
      stableHash = currentHash;
      stableCount = 1;
    }
    if (stableCount >= settings.settleSamplesRequired) {
      return snapshot;
    }
  }
  return {
    ok: false,
    reason: STOP_REASONS.HOP_TIMEOUT
  };
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
  const sourceRole = state.nextHopOverride ?? state.nextHopSource;
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
        await chrome.tabs.sendMessage(tabId, {
          type: MESSAGE_TYPES.SYNC_OVERLAY_STATE,
          snapshot
        });
      } catch {
        return null;
      }
      return null;
    })
  );
}
async function buildOverlaySnapshot(state, tabId, overlaySettings) {
  const sourceRole = state.nextHopOverride ?? state.nextHopSource;
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
    nextHop: formatNextHop(state.nextHopOverride ?? state.nextHopSource),
    requiresTerminalClear: state.requiresTerminalClear,
    assignedRole: findRoleByTabId(state, tabId),
    starter: state.starter,
    controls: deriveControls(state, readiness),
    display: buildDisplay(state),
    overlaySettings,
    readiness
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
function structuredCloneSafe(value) {
  return JSON.parse(JSON.stringify(value));
}
