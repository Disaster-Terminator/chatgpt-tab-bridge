import {
  collectOverlaySyncTabIds,
  shouldKeepBindingForUrlChange
} from "./core/background-helpers.ts";
import { parseChatGptThreadUrl } from "./core/chatgpt-url.ts";
import {
  APP_STATE_KEY,
  DEFAULT_SETTINGS,
  DEFAULT_OVERLAY_SETTINGS,
  ERROR_REASONS,
  MESSAGE_TYPES,
  OVERLAY_SETTINGS_KEY,
  PHASES,
  ROLE_A,
  ROLE_B,
  ROLES,
  STOP_REASONS,
  otherRole
} from "./core/constants.ts";
import {
  createInitialState,
  reduceState,
  type RuntimeStateEvent
} from "./core/state-machine.ts";
import {
  buildRelayEnvelope,
  evaluatePostHopGuard,
  evaluatePreSendGuard,
  evaluateSubmissionAcceptanceGate,
  evaluateSubmissionVerification,
  formatNextHop,
  guardReasonToStopReason,
  hashText,
  normalizeAssistantText
} from "./core/relay-core.ts";
import { buildDisplay, deriveControls, computeReadiness } from "./core/popup-model.ts";
import {
  mergeOverlaySettings,
  normalizeOverlaySettings
} from "./core/overlay-settings.ts";
import type {
  ChromeMessageSender,
  ChromePort,
  ChromeTab
} from "./shared/globals";
import type {
  AssistantSnapshotResponse,
  BridgeRole,
  OverlayModel,
  OverlaySettings,
  PopupCurrentTab,
  PopupModel,
  RelayGuardReason,
  RelayMessageResponse,
  RuntimeEvent,
  RuntimeHopTruth,
  RuntimeHopProgress,
  RuntimeHopTargetIdentity,
  RuntimeMessage,
  RuntimeResponse,
  RuntimeSettings,
  RuntimeState,
  SessionIdentity,
  StopReason,
  TargetObservationClassification,
  TargetObservationSample,
  ThreadActivityResponse
} from "./shared/types.js";

type SettledReplySuccess = {
  ok: true;
  result: {
    text: string;
    hash: string;
    sample: TargetObservationSample;
  };
};

type ReplyObservationFailureReason = Extract<
  StopReason,
  "reply_observation_missing" | "wrong_target" | "stale_target" | "unreachable_target"
>;

type OverlaySettingsResult = {
  state: RuntimeState;
  overlaySettings: OverlaySettings;
};

type BackgroundMessageResult = RuntimeState | PopupModel | OverlayModel | OverlaySettingsResult | RuntimeEvent[];

type SettledReplyResult =
  | SettledReplySuccess
  | { ok: false; reason: "loop_cancelled" | StopReason };

type SettledReplyFailure = Extract<SettledReplyResult, { ok: false }>;

interface WaitForSettledReplyInput {
  tabId: number;
  canonicalTargetTabId: number;
  baselineHash: string | null;
  expectedTargetIdentity: RuntimeHopTargetIdentity | null;
  settings: RuntimeSettings;
  token: number;
  sourceRole?: BridgeRole | null;
  targetRole?: BridgeRole | null;
  round?: number;
}

type HopExecutionPlan = {
  shouldSend: boolean;
  shouldVerify: boolean;
  shouldWait: boolean;
};

type ClassifiedTargetObservation =
  | {
      classification: "correct_target";
      requestedTabId: number;
      canonicalTargetTabId: number;
      observedNormalizedUrl: string | null;
      sample: TargetObservationSample;
    }
  | {
      classification: "wrong_target" | "stale_target";
      requestedTabId: number;
      canonicalTargetTabId: number;
      observedNormalizedUrl: string | null;
      sample: TargetObservationSample;
    }
  | {
      classification: "unreachable_target";
      requestedTabId: number;
      canonicalTargetTabId: number;
      observedNormalizedUrl: null;
      error: string;
    };

type TabLifecycleFacts = {
  available: boolean;
  active: boolean | null;
  audible: boolean | null;
  autoDiscardable: boolean | null;
  discarded: boolean | null;
  frozen: boolean | null;
  highlighted: boolean | null;
  pinned: boolean | null;
  status: string | null;
  windowId: number | null;
  lastAccessed: number | null;
  error: string | null;
};

type VerificationExecutionResult =
  | {
      ok: true;
      progress: RuntimeHopProgress;
    }
  | {
      ok: false;
    };

let activeLoopToken = 0;
const keepAlivePorts = new Set<ChromePort>();
const overlayPortsByTabId = new Map<number, Set<ChromePort>>();
let relayLoopRunning = false;

export function setActiveLoopTokenForTest(token: number): void {
  activeLoopToken = token;
}

// P0-1: Runtime event ring buffer for evidence chain
const MAX_RUNTIME_EVENTS = 30;
const runtimeEvents: RuntimeEvent[] = [];
let runtimeEventSequence = 0;
const LOCAL_DEBUG_LOG_URL = "http://127.0.0.1:17761/events";
const RELAY_WATCHDOG_ALARM_NAME = "bridge-relay-watchdog";
const RELAY_WATCHDOG_PERIOD_MINUTES = 0.5;
const TAB_MESSAGE_TIMEOUT_MS = 8000;

type RuntimeEventInput =
  Omit<RuntimeEvent, "id" | "timestamp" | "level" | "category"> &
  Partial<Pick<RuntimeEvent, "level" | "category">>;

function addRuntimeEvent(event: RuntimeEventInput): void {
  runtimeEventSequence += 1;
  const runtimeEvent = {
    ...event,
    level: event.level ?? inferRuntimeEventLevel(event),
    category: event.category ?? inferRuntimeEventCategory(event.phaseStep),
    id: `evt_${runtimeEventSequence}_${Math.random().toString(36).slice(2, 9)}`,
    timestamp: new Date().toISOString()
  };
  runtimeEvents.push(runtimeEvent);
  if (runtimeEvents.length > MAX_RUNTIME_EVENTS) {
    runtimeEvents.shift();
  }
  if (shouldPostLocalDebugEvents()) {
    void postLocalDebugEvent(runtimeEvent);
  }
}

function inferRuntimeEventLevel(event: RuntimeEventInput): RuntimeEvent["level"] {
  if (
    event.phaseStep.includes("failed") ||
    event.phaseStep.includes("timeout") ||
    event.verificationVerdict.includes("timeout") ||
    event.verificationVerdict.includes("failure") ||
    event.verificationVerdict.includes("missing") ||
    event.verificationVerdict.includes("rejected") ||
    event.verificationVerdict === "wrong_target" ||
    event.verificationVerdict === "stale_target" ||
    event.verificationVerdict === "unreachable_target"
  ) {
    return "error";
  }

  if (
    event.phaseStep === "target_wake_requested" ||
    event.phaseStep === "state:stop_condition" ||
    event.verificationVerdict === "assistant_hash_unchanged" ||
    event.verificationVerdict === "still_generating"
  ) {
    return "warn";
  }

  if (event.phaseStep === "reply_poll") {
    return "debug";
  }

  return "info";
}

function inferRuntimeEventCategory(phaseStep: string): RuntimeEvent["category"] {
  if (phaseStep.startsWith("state:")) {
    return "state";
  }

  if (phaseStep.includes("dispatch") || phaseStep.includes("send")) {
    return "dispatch";
  }

  if (phaseStep.includes("verification") || phaseStep.includes("baseline")) {
    return "verification";
  }

  if (phaseStep.includes("reply") || phaseStep === "target_wake_requested") {
    return "reply";
  }

  if (phaseStep.includes("recovered") || phaseStep.includes("watchdog")) {
    return "recovery";
  }

  return "runtime";
}

function getRecentRuntimeEvents(): RuntimeEvent[] {
  return [...runtimeEvents];
}

async function postLocalDebugEvent(event: RuntimeEvent): Promise<void> {
  try {
    await fetch(LOCAL_DEBUG_LOG_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(event)
    });
  } catch {
    // Dev-only local sink is optional.
  }
}

function shouldPostLocalDebugEvents(): boolean {
  return typeof chrome !== "undefined" && typeof chrome.runtime?.id === "string" && chrome.runtime.id.length > 0;
}

function getInstructionLocale(): "zh-CN" | "en" {
  const chromeI18n = typeof chrome !== "undefined" ? (chrome as any).i18n : null;
  const language = (
    typeof chromeI18n?.getUILanguage === "function"
      ? chromeI18n.getUILanguage()
      : globalThis.navigator?.language
  )?.toLowerCase() ?? "";
  return language.startsWith("zh") ? "zh-CN" : "en";
}

function formatVerificationBaseline(
  baselineUserHash: string | null,
  baselineGenerating: boolean,
  baselineLatestUserText: string | null,
  hopId: string | null
): string {
  if (baselineLatestUserText) {
    return `hash:${baselineUserHash},gen:${baselineGenerating},hop:${hopId ?? "none"},text:${baselineLatestUserText.slice(0, 50)}`;
  }

  return `hash:${baselineUserHash},gen:${baselineGenerating},hop:${hopId ?? "none"},text:null`;
}

function formatVerificationPollSample(
  currentUserHash: string | null,
  currentGenerating: boolean,
  currentLatestUserText: string | null
): string {
  return `hash:${currentUserHash},gen:${currentGenerating},text:${currentLatestUserText?.slice(0, 50) ?? "null"}`;
}

function summarizeDispatchReadback(sendResult: RelayMessageResponse): string {
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

function summarizeDispatchEvidence(sendResult: RelayMessageResponse): string {
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

function resolveDispatchFailureCode(sendResult: RelayMessageResponse): string {
  if (sendResult.ok && sendResult.dispatchAccepted === true) {
    return "dispatch_accepted";
  }

  if (!sendResult.ok) {
    const dispatchCode = "dispatchErrorCode" in sendResult ? sendResult.dispatchErrorCode : undefined;
    return dispatchCode ?? sendResult.error ?? "dispatch_rejected";
  }

  return sendResult.error ?? "dispatch_rejected";
}

function mapObservationClassificationToStopReason(
  classification: Exclude<TargetObservationClassification, "correct_target">
): ReplyObservationFailureReason {
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
}: {
  settled: SettledReplyFailure;
  sourceRole: BridgeRole;
  targetRole: BridgeRole;
  round: number;
  progress: RuntimeHopProgress;
}): Promise<boolean> {
  if (settled.reason === "loop_cancelled") {
    return false;
  }

  const observationFailureReasons = new Set<ReplyObservationFailureReason>([
    STOP_REASONS.REPLY_OBSERVATION_MISSING,
    STOP_REASONS.WRONG_TARGET,
    STOP_REASONS.STALE_TARGET,
    STOP_REASONS.UNREACHABLE_TARGET
  ]);
  const isObservationFailure = observationFailureReasons.has(
    settled.reason as ReplyObservationFailureReason
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

function createVerificationHopId(sessionId: number, round: number): string {
  return `s${sessionId}-r${round}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

chrome.runtime.onInstalled.addListener(async (): Promise<void> => {
  await initializeState();
  await initializeOverlaySettings();
  await configureRelayWatchdogAlarm();
  await updateActionBadge(await getState());
  void ensureRelayLoopRunning("installed");
});

chrome.runtime.onStartup.addListener(async (): Promise<void> => {
  await initializeState();
  await initializeOverlaySettings();
  await configureRelayWatchdogAlarm();
  await updateActionBadge(await getState());
  void ensureRelayLoopRunning("startup");
});

chrome.alarms?.onAlarm.addListener((alarm): void => {
  if (alarm.name === RELAY_WATCHDOG_ALARM_NAME) {
    void ensureRelayLoopRunning("alarm");
  }
});

chrome.runtime.onConnect.addListener((port): void => {
  if (port.name !== "bridge-tab-keepalive") {
    return;
  }

  keepAlivePorts.add(port);
  const tabId = port.sender?.tab?.id;
  if (tabId) {
    const tabPorts = overlayPortsByTabId.get(tabId) ?? new Set<ChromePort>();
    tabPorts.add(port);
    overlayPortsByTabId.set(tabId, tabPorts);
  }
  port.onMessage.addListener((): void => {
    void ensureRelayLoopRunning("port_heartbeat");
  });
  port.onDisconnect.addListener((): void => {
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

void configureRelayWatchdogAlarm();
void ensureRelayLoopRunning("worker_wakeup");

chrome.tabs.onRemoved.addListener(async (tabId): Promise<void> => {
  overlayPortsByTabId.delete(tabId);
  const state = await getState();
  const role = findRoleByTabId(state, tabId);
  if (!role) {
    return;
  }

  await updateState({ type: "invalidate_binding", role });
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo): Promise<void> => {
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
  (
    message: RuntimeMessage,
    sender: ChromeMessageSender,
    sendResponse: (response?: RuntimeResponse<BackgroundMessageResult>) => void
  ): boolean => {
    void handleMessage(message, sender)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error: unknown) => sendResponse({ ok: false, error: getErrorMessage(error) }));

    return true;
  }
);

async function handleMessage(
  message: RuntimeMessage | null | undefined,
  sender: ChromeMessageSender
): Promise<BackgroundMessageResult> {
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

async function initializeState(): Promise<void> {
  const current = await getSessionValue<RuntimeState>(APP_STATE_KEY);
  if (!current) {
    await setSessionValue(APP_STATE_KEY, createInitialState());
  }
}

async function initializeOverlaySettings(): Promise<void> {
  const current = await getLocalValue<OverlaySettings>(OVERLAY_SETTINGS_KEY);
  if (!current) {
    await setLocalValue(OVERLAY_SETTINGS_KEY, DEFAULT_OVERLAY_SETTINGS);
  }
}

async function getState(): Promise<RuntimeState> {
  await initializeState();
  const state = (await getSessionValue<RuntimeState>(APP_STATE_KEY)) ?? createInitialState();
  state.settings = {
    ...DEFAULT_SETTINGS,
    ...state.settings
  };
  return state;
}

async function getOverlaySettings(): Promise<OverlaySettings> {
  await initializeOverlaySettings();
  return normalizeOverlaySettings(
    (await getLocalValue<OverlaySettings>(OVERLAY_SETTINGS_KEY)) ?? DEFAULT_OVERLAY_SETTINGS
  );
}

async function updateOverlaySettings(
  patch: Partial<OverlaySettings>
): Promise<OverlaySettingsResult> {
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

async function persistState(
  nextState: RuntimeState,
  previousState: RuntimeState | null = null
): Promise<RuntimeState> {
  await setSessionValue(APP_STATE_KEY, nextState);
  await updateActionBadge(nextState);
  await broadcastOverlayState(nextState, previousState);
  return nextState;
}

async function updateActionBadge(state: RuntimeState): Promise<void> {
  if (!chrome.action.setBadgeText) {
    return;
  }

  const cleanStopReasons = new Set<string>([
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
    title = `ChatGPT Bridge running: ${state.round}/${state.settings.maxRoundsEnabled ? state.settings.maxRounds : "∞"}`;
  } else if (state.phase === PHASES.PAUSED) {
    text = "PAU";
    color = "#f59e0b";
    title = "ChatGPT Bridge paused";
  } else if (state.phase === PHASES.STOPPED) {
    const cleanStop = cleanStopReasons.has(state.lastStopReason ?? "");
    text = cleanStop ? "OK" : "STOP";
    color = cleanStop ? "#22c55e" : "#71717a";
    title = cleanStop
      ? `ChatGPT Bridge completed: ${state.lastStopReason ?? "stopped"}`
      : `ChatGPT Bridge stopped: ${state.lastStopReason ?? "user_stop"}`;
  } else if (state.phase === PHASES.ERROR) {
    text = "ERR";
    color = "#ef4444";
    title = `ChatGPT Bridge error: ${state.lastError ?? "unknown"}`;
  }

  await chrome.action.setBadgeText({ text });
  await chrome.action.setBadgeBackgroundColor?.({ color });
  await chrome.action.setTitle?.({ title });
}

async function updateState(event: RuntimeStateEvent): Promise<RuntimeState> {
  const current = await getState();
  const next = reduceState(current, event);

  if (next.phase !== PHASES.RUNNING) {
    activeLoopToken = 0;
    relayLoopRunning = false;
  }

  addStateTransitionEvent(event, current, next);
  return persistState(next, current);
}

function addStateTransitionEvent(
  event: RuntimeStateEvent,
  previousState: RuntimeState,
  nextState: RuntimeState
): void {
  const observableEvents = new Set<RuntimeStateEvent["type"]>([
    "set_starter",
    "set_next_hop_override",
    "start",
    "pause",
    "resume",
    "stop",
    "hop_completed",
    "stop_condition",
    "selector_failure",
    "runtime_error",
    "set_runtime_settings"
  ]);

  if (!observableEvents.has(event.type)) {
    return;
  }

  const sourceRole = getRuntimeStateEventSourceRole(event, nextState);
  const targetRole = getRuntimeStateEventTargetRole(event, sourceRole);
  const eventReason = getRuntimeStateEventReason(event);
  addRuntimeEvent({
    phaseStep: `state:${event.type}`,
    sourceRole,
    targetRole,
    round: nextState.activeHop?.round ?? nextState.round,
    dispatchReadbackSummary: [
      `phase:${previousState.phase}->${nextState.phase}`,
      `starter:${previousState.starter}->${nextState.starter}`,
      `next:${previousState.nextHopSource}->${nextState.nextHopSource}`,
      `override:${previousState.nextHopOverride ?? "none"}->${nextState.nextHopOverride ?? "none"}`,
      `active:${summarizeActiveHop(previousState.activeHop)}->${summarizeActiveHop(nextState.activeHop)}`,
      `reason:${eventReason ?? "none"}`
    ].join("|"),
    sendTriggerMode: "state_transition",
    verificationBaseline: eventReason ? `event:${event.type}|reason:${eventReason}` : `event:${event.type}`,
    verificationPollSample: "n/a",
    verificationVerdict: eventReason ?? "recorded"
  });
}

function getRuntimeStateEventReason(event: RuntimeStateEvent): string | null {
  return "reason" in event && typeof event.reason === "string" ? event.reason : null;
}

function getRuntimeStateEventSourceRole(event: RuntimeStateEvent, nextState: RuntimeState): BridgeRole {
  if ("sourceRole" in event && isBridgeRole(event.sourceRole)) {
    return event.sourceRole;
  }

  return nextState.activeHop?.sourceRole ?? nextState.nextHopOverride ?? nextState.nextHopSource;
}

function getRuntimeStateEventTargetRole(event: RuntimeStateEvent, sourceRole: BridgeRole): BridgeRole {
  if ("targetRole" in event && isBridgeRole(event.targetRole)) {
    return event.targetRole;
  }

  return otherRole(sourceRole);
}

function summarizeActiveHop(activeHop: RuntimeHopTruth | null): string {
  if (!activeHop) {
    return "none";
  }

  return `${activeHop.sourceRole}->${activeHop.targetRole}/r${activeHop.round}/${activeHop.stage}/${activeHop.hopId ?? "pending"}`;
}

async function bindTabToRole(
  role: BridgeRole | null | undefined,
  tabId: number | null | undefined
): Promise<RuntimeState> {
  if (!isBridgeRole(role) || !tabId) {
    throw new Error("A valid role and tab id are required.");
  }

  const state = await getState();
  if (state.phase === PHASES.RUNNING || state.phase === PHASES.PAUSED) {
    throw new Error("Bindings cannot change during an active session.");
  }

  const tab = await chrome.tabs.get(tabId);
  const urlInfo = parseChatGptThreadUrl(tab.url ?? "");

  // P0-1: Allow binding without URL - live session can work without persistent URL
  // URL is no longer mandatory for binding - it's now optional enhancement
  const sessionIdentity: SessionIdentity | null = urlInfo.supported
    ? {
        kind: "persistent_url",
        tabId: tab.id ?? tabId,
        role,
        boundAt: new Date().toISOString(),
        url: tab.url ?? "",
        urlInfo,
        currentRound: 0
      }
    : {
        kind: "live_session",
        tabId: tab.id ?? tabId,
        role,
        boundAt: new Date().toISOString(),
        observedSnapshot: null,
        currentRound: 0
      };

  const otherBinding = state.bindings[otherRole(role)];
  if (otherBinding) {
    // Check tabId conflict
    if (otherBinding.tabId === tab.id) {
      throw new Error("A and B must be bound to different ChatGPT threads.");
    }
    // Check URL conflict for persistent URL bindings
    if (urlInfo.supported && otherBinding.urlInfo?.normalizedUrl) {
      if (urlInfo.normalizedUrl === otherBinding.urlInfo.normalizedUrl) {
        throw new Error("A and B must be bound to different ChatGPT threads.");
      }
    }
    // Check sessionIdentity conflict for live sessions
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
      boundAt: new Date().toISOString()
    }
  });
}

async function clearBinding(role: BridgeRole | null | undefined): Promise<RuntimeState> {
  if (!isBridgeRole(role)) {
    throw new Error("A valid role is required.");
  }

  return updateState({
    type: "set_binding",
    role,
    binding: null
  });
}

async function startSession(): Promise<RuntimeState> {
  const next = await updateState({ type: "start" });
  if (next.phase === PHASES.RUNNING) {
    const started = await runStarterPreflight(next);
    if (started) {
      startRelayLoop(await getState());
    }
  }
  return getState();
}

async function pauseSession(): Promise<RuntimeState> {
  return updateState({ type: "pause" });
}

async function resumeSession(): Promise<RuntimeState> {
  const next = await updateState({ type: "resume" });
  if (next.phase === PHASES.RUNNING) {
    const started = await runStarterPreflight(next);
    if (started) {
      startRelayLoop(next);
    }
  }
  return getState();
}

async function runStarterPreflight(state: RuntimeState): Promise<boolean> {
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

async function runTargetPreflight(
  targetRole: BridgeRole,
  targetBinding: RuntimeState["bindings"][BridgeRole],
  state: RuntimeState,
  token: number
): Promise<boolean> {
  if (!targetBinding) {
    return true;
  }

  const threadActivity = await requestThreadActivity(targetBinding.tabId);
  if (!threadActivity.ok) {
    const sourceRole = otherRole(targetRole);
    await updateState({
      type: "set_runtime_activity",
      activity: {
        step: `waiting ${targetRole} ready`,
        sourceRole,
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

async function stopSession(): Promise<RuntimeState> {
  return updateState({ type: "stop", reason: STOP_REASONS.USER_STOP });
}

async function clearTerminal(): Promise<RuntimeState> {
  return updateState({ type: "clear_terminal" });
}

async function configureRelayWatchdogAlarm(): Promise<void> {
  try {
    await chrome.alarms?.create(RELAY_WATCHDOG_ALARM_NAME, {
      delayInMinutes: RELAY_WATCHDOG_PERIOD_MINUTES,
      periodInMinutes: RELAY_WATCHDOG_PERIOD_MINUTES
    });
  } catch {
    // The alarm is a resilience layer; normal user actions can still wake the worker.
  }
}

async function ensureRelayLoopRunning(trigger: string): Promise<void> {
  if (relayLoopRunning) {
    return;
  }

  const state = await getState();
  if (state.phase !== PHASES.RUNNING || !state.activeHop) {
    return;
  }

  const sourceRole = state.activeHop.sourceRole;
  addRuntimeEvent({
    phaseStep: "loop_recovered",
    sourceRole,
    targetRole: state.activeHop.targetRole,
    round: state.activeHop.round,
    dispatchReadbackSummary: `trigger:${trigger}|stage:${state.activeHop.stage}`,
    sendTriggerMode: "watchdog",
    verificationBaseline: `active:${summarizeActiveHop(state.activeHop)}`,
    verificationPollSample: "restart_background_loop",
    verificationVerdict: "loop_recovered"
  });
  startRelayLoop(state, { forceRestart: false });
}

function startRelayLoop(
  state: RuntimeState,
  options: { forceRestart?: boolean } = { forceRestart: true }
): void {
  if (relayLoopRunning && options.forceRestart === false) {
    return;
  }

  activeLoopToken += 1;
  const token = activeLoopToken;
  relayLoopRunning = true;
  void runRelayLoop(token, state.settings ?? DEFAULT_SETTINGS).finally(() => {
    if (token === activeLoopToken) {
      relayLoopRunning = false;
    }
  });
}

export function getHopExecutionPlan(stage: RuntimeHopTruth["stage"]): HopExecutionPlan {
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

export function formatPendingBoundaryStep(sourceRole: BridgeRole, targetRole: BridgeRole): string {
  return `pending ${sourceRole} -> ${targetRole}`;
}

export function shouldExposePendingHopBoundary(state: RuntimeState, activeHop: RuntimeHopTruth): boolean {
  return (
    activeHop.stage === "pending" &&
    activeHop.hopId === null &&
    state.runtimeActivity.step !== formatPendingBoundaryStep(activeHop.sourceRole, activeHop.targetRole)
  );
}

export async function runRelayLoop(token: number, settings: RuntimeSettings): Promise<void> {
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
        await sleep(Math.max(settings.pollIntervalMs, 3000));
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

    if (!(await shouldContinueRelayLoop(token))) {
      return;
    }

    // P0-1: Target-side preflight - check target is ready to receive
    const targetPreflight = await runTargetPreflight(targetRole, targetBinding, state, token);
    if (!targetPreflight) {
      return; // Target not ready, stop condition already set
    }

    if (!(await shouldContinueRelayLoop(token))) {
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

    if (!(await shouldContinueRelayLoop(token))) {
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
    const targetHasNoAssistantMessage = baselineTarget.ok === false && 
      (baselineTarget.error?.includes("not_found") || baselineTarget.error?.includes("empty"));
    
    if (!baselineTarget.ok && !targetHasNoAssistantMessage) {
      await updateState({
        type: "selector_failure",
        reason: `${ERROR_REASONS.SELECTOR_FAILURE}:target:${targetRole}`
      });
      return;
    }

    if (!(await shouldContinueRelayLoop(token))) {
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
      const baselineFailureReason = "reason" in baselineCapture
        ? baselineCapture.reason
        : "baseline_capture_failed";

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

    if (!(await shouldContinueRelayLoop(token))) {
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
    if (!(await shouldContinueRelayLoop(token))) {
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
      stage: "verifying" as const,
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
      stage: "waiting_reply" as const,
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
      if (
        await handleSettledReplyFailure({
          settled: settled as SettledReplyFailure,
          sourceRole,
          targetRole,
          round: activeHop.round,
          progress: verificationResult.progress
        })
      ) {
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
}: {
  activeHop: RuntimeHopTruth;
  sourceRole: BridgeRole;
  targetRole: BridgeRole;
  token: number;
  settings: RuntimeSettings;
}): Promise<VerificationExecutionResult> {
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
      stage: "waiting_reply" as const,
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
      return { ok: false };
    }

    if (!settled.ok) {
      if (
        await handleSettledReplyFailure({
          settled: settled as SettledReplyFailure,
          sourceRole,
          targetRole,
          round: activeHop.round,
          progress: verificationResult.progress
        })
      ) {
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
    if (
      await handleSettledReplyFailure({
        settled: settled as SettledReplyFailure,
        sourceRole,
        targetRole,
        round: activeHop.round,
        progress
      })
    ) {
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

async function ensureRunnableBinding(
  role: BridgeRole,
  binding: RuntimeState["bindings"][BridgeRole]
): Promise<ChromeTab | null> {
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

async function requestAssistantSnapshot(tabId: number): Promise<AssistantSnapshotResponse> {
  try {
    return await sendTabMessageWithTimeout<AssistantSnapshotResponse>(
      tabId,
      { type: MESSAGE_TYPES.GET_ASSISTANT_SNAPSHOT },
      "assistant_snapshot_timeout"
    );
  } catch (error: unknown) {
    return {
      ok: false,
      error: getErrorMessage(error)
    };
  }
}

async function requestThreadActivity(tabId: number): Promise<ThreadActivityResponse> {
  try {
    return await sendTabMessageWithTimeout<ThreadActivityResponse>(
      tabId,
      { type: MESSAGE_TYPES.GET_THREAD_ACTIVITY },
      "thread_activity_timeout"
    );
  } catch (error: unknown) {
    return {
      ok: false,
      error: getErrorMessage(error)
    };
  }
}

async function requestTargetObservationSample(
  tabId: number
): Promise<
  | { ok: true; result: TargetObservationSample }
  | { ok: false; error: string }
> {
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

function captureHopTargetIdentity(
  binding: RuntimeState["bindings"][BridgeRole]
): RuntimeHopTargetIdentity | null {
  const normalizedUrl = binding?.urlInfo?.supported ? binding.urlInfo.normalizedUrl : null;
  return {
    normalizedUrl
  };
}

export function classifyTargetObservation({
  requestedTabId,
  canonicalTargetTabId,
  expectedTargetIdentity,
  observation
}: {
  requestedTabId: number;
  canonicalTargetTabId: number;
  expectedTargetIdentity: RuntimeHopTargetIdentity | null;
  observation:
    | { ok: true; result: TargetObservationSample }
    | { ok: false; error: string };
}): ClassifiedTargetObservation {
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

  if (
    expectedTargetIdentity?.normalizedUrl &&
    observedNormalizedUrl !== expectedTargetIdentity.normalizedUrl
  ) {
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
}: {
  activeHop: RuntimeHopTruth;
  sourceRole: BridgeRole;
  targetRole: BridgeRole;
  token: number;
}): Promise<VerificationExecutionResult> {
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

  const verificationTimeoutMs = 10000;
  const verificationPollIntervalMs = 500;
  const verificationStartTime = Date.now();
  let acceptanceEstablished = false;
  let lastVerificationPollSample = progress.lastVerificationPollSample ?? "no_poll_sample";
  let lastAcceptanceGateReason: string | TargetObservationClassification =
    "acceptance_not_established_observation_window_only";

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
}: {
  activeHop: RuntimeHopTruth;
  sourceRole: BridgeRole;
  targetRole: BridgeRole;
  settings: RuntimeSettings;
  token: number;
}): Promise<SettledReplyResult> {
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

async function captureSubmissionVerificationBaseline(
  tabId: number,
  timeoutMs = 5000,
  pollIntervalMs = 250
): Promise<
  | {
      ok: true;
      sample: TargetObservationSample;
    }
  | {
      ok: false;
      reason: string;
    }
> {
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

async function sendRelayMessage(tabId: number, text: string): Promise<RelayMessageResponse> {
  try {
    return await sendTabMessageWithTimeout<RelayMessageResponse>(
      tabId,
      {
        type: MESSAGE_TYPES.SEND_RELAY_MESSAGE,
        text
      },
      "send_message_timeout"
    );
  } catch (error: unknown) {
    return {
      ok: false,
      error: getErrorMessage(error)
    };
  }
}

async function sendTabMessageWithTimeout<T>(
  tabId: number,
  message: RuntimeMessage,
  timeoutError: string
): Promise<T> {
  return Promise.race([
    chrome.tabs.sendMessage<T>(tabId, message),
    sleep(TAB_MESSAGE_TIMEOUT_MS).then<T>(() => {
      throw new Error(timeoutError);
    })
  ]);
}

async function readTabLifecycleFacts(tabId: number): Promise<TabLifecycleFacts> {
  try {
    const tab = await chrome.tabs.get(tabId);
    return {
      available: true,
      active: typeof tab.active === "boolean" ? tab.active : null,
      audible: typeof tab.audible === "boolean" ? tab.audible : null,
      autoDiscardable: typeof tab.autoDiscardable === "boolean" ? tab.autoDiscardable : null,
      discarded: typeof tab.discarded === "boolean" ? tab.discarded : null,
      frozen: typeof tab.frozen === "boolean" ? tab.frozen : null,
      highlighted: typeof tab.highlighted === "boolean" ? tab.highlighted : null,
      pinned: typeof tab.pinned === "boolean" ? tab.pinned : null,
      status: typeof tab.status === "string" ? tab.status : null,
      windowId: typeof tab.windowId === "number" ? tab.windowId : null,
      lastAccessed: typeof tab.lastAccessed === "number" ? tab.lastAccessed : null,
      error: null
    };
  } catch (error) {
    return {
      available: false,
      active: null,
      audible: null,
      autoDiscardable: null,
      discarded: null,
      frozen: null,
      highlighted: null,
      pinned: null,
      status: null,
      windowId: null,
      lastAccessed: null,
      error: getErrorMessage(error)
    };
  }
}

export async function waitForSettledReply({
  tabId,
  canonicalTargetTabId,
  baselineHash,
  expectedTargetIdentity,
  settings,
  token,
  sourceRole = null,
  targetRole = null,
  round = 0
}: WaitForSettledReplyInput): Promise<SettledReplyResult> {
  const startedAt = Date.now();
  let lastProgressAt = startedAt;
  let elapsedMs = 0;
  let idleMs = 0;
  let stableHash: string | null = null;
  let lastObservedAssistantHash: string | null = baselineHash;
  let stableCount = 0;
  let pendingObservationFailure: ReplyObservationFailureReason | null = null;
  let pendingReplyStallReason: StopReason | null = null;

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
    const tabLifecycle = await readTabLifecycleFacts(canonicalTargetTabId);
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
        verificationPollSample: `classification:${observation.classification}|elapsed_ms:${elapsedMs}|${formatTabLifecycleFacts(tabLifecycle)}`,
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
      pendingReplyStallReason = null;
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
          elapsedMs,
          idleMs,
          tabLifecycle
        }),
        verificationVerdict: STOP_REASONS.REPLY_OBSERVATION_MISSING
      });
      continue;
    }

    pendingObservationFailure = null;

    const currentHash = latestAssistant.hash;
    if (currentHash && currentHash !== baselineHash && currentHash !== lastObservedAssistantHash) {
      lastObservedAssistantHash = currentHash;
      pendingReplyStallReason = null;
      lastProgressAt = Date.now();
      idleMs = 0;
    }

    if (!currentHash || currentHash === baselineHash) {
      stableHash = null;
      stableCount = 0;
      idleMs = Date.now() - lastProgressAt;
      pendingReplyStallReason = classifyReplyStallReason({
        observation,
        tabLifecycle
      });

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
          elapsedMs,
          idleMs,
          tabLifecycle
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
        elapsedMs,
        idleMs,
        tabLifecycle
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
    verificationVerdict: pendingObservationFailure ?? pendingReplyStallReason ?? STOP_REASONS.HOP_TIMEOUT
  });

  return {
    ok: false,
    reason: pendingObservationFailure ?? pendingReplyStallReason ?? STOP_REASONS.HOP_TIMEOUT
  };
}

function classifyReplyStallReason({
  observation,
  tabLifecycle
}: {
  observation: Extract<ClassifiedTargetObservation, { classification: "correct_target" }>;
  tabLifecycle: TabLifecycleFacts;
}): StopReason | null {
  const page = observation.sample.page;
  const pageHidden = page?.hidden === true || page?.visibilityState === "hidden";
  const pageInactive = page?.focused === false || tabLifecycle.active === false;
  const targetAvailable = tabLifecycle.available === true;
  const targetNotDiscarded = tabLifecycle.discarded !== true && page?.wasDiscarded !== true;
  const targetNotFrozen = tabLifecycle.frozen !== true && page?.prerendering !== true;
  const noGenerationStarted = observation.sample.generating === false;
  const submittedTurnPending = observation.sample.replyPending === true;

  if (
    submittedTurnPending &&
    noGenerationStarted &&
    pageHidden &&
    pageInactive &&
    targetAvailable &&
    targetNotDiscarded &&
    targetNotFrozen
  ) {
    return STOP_REASONS.TARGET_HIDDEN_NO_GENERATION;
  }

  return null;
}

function formatReplyPollSample({
  observation,
  baselineHash,
  stableHash,
  stableCount,
  elapsedMs,
  idleMs,
  tabLifecycle
}: {
  observation: Extract<ClassifiedTargetObservation, { classification: "correct_target" }>;
  baselineHash: string | null;
  stableHash: string | null;
  stableCount: number;
  elapsedMs: number;
  idleMs: number;
  tabLifecycle: TabLifecycleFacts;
}): string {
  const assistant = observation.sample.latestAssistant;
  const page = observation.sample.page;
  const preview = normalizeAssistantText(assistant.text).slice(0, 80).replace(/\s+/g, " ");
  return [
    `elapsed_ms:${elapsedMs}`,
    `idle_ms:${idleMs}`,
    `page_hidden:${page?.hidden ?? "unknown"}`,
    `page_visibility:${page?.visibilityState ?? "unknown"}`,
    `page_focused:${page?.focused ?? "unknown"}`,
    `page_was_discarded:${page?.wasDiscarded ?? "unknown"}`,
    `page_prerendering:${page?.prerendering ?? "unknown"}`,
    formatTabLifecycleFacts(tabLifecycle),
    `assistant_present:${assistant.present}`,
    `assistant_hash:${assistant.hash ?? "null"}`,
    `baseline_hash:${baselineHash ?? "null"}`,
    `stable_hash:${stableHash ?? "null"}`,
    `stable_count:${stableCount}`,
    `generating:${observation.sample.generating}`,
    `reply_pending:${observation.sample.replyPending}`,
    `preview:${preview || "null"}`
  ].join("|");
}

function formatTabLifecycleFacts(tab: TabLifecycleFacts): string {
  return [
    `tab_available:${tab.available}`,
    `tab_active:${tab.active ?? "unknown"}`,
    `tab_status:${tab.status ?? "unknown"}`,
    `tab_discarded:${tab.discarded ?? "unknown"}`,
    `tab_frozen:${tab.frozen ?? "unknown"}`,
    `tab_auto_discardable:${tab.autoDiscardable ?? "unknown"}`,
    `tab_audible:${tab.audible ?? "unknown"}`,
    `tab_highlighted:${tab.highlighted ?? "unknown"}`,
    `tab_pinned:${tab.pinned ?? "unknown"}`,
    `tab_window:${tab.windowId ?? "unknown"}`,
    `tab_last_accessed:${tab.lastAccessed ?? "unknown"}`,
    `tab_error:${tab.error ?? "none"}`
  ].join("|");
}

async function getPopupModel(activeTabId: number | null): Promise<PopupModel> {
  const state = await getState();
  const overlaySettings = await getOverlaySettings();
  const currentTab = activeTabId ? await safeGetTab(activeTabId) : null;
  const currentTabInfo: PopupCurrentTab | null = currentTab
    ? {
        id: currentTab.id,
        title: currentTab.title ?? "",
        url: currentTab.url ?? "",
        urlInfo: parseChatGptThreadUrl(currentTab.url ?? ""),
        assignedRole: findRoleByTabId(state, currentTab.id ?? null)
      }
    : null;

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

async function getOverlayModel(tabId: number | null): Promise<OverlayModel> {
  const state = await getState();
  const overlaySettings = await getOverlaySettings();
  return await buildOverlaySnapshot(state, tabId, overlaySettings);
}

async function safeGetTab(tabId: number): Promise<ChromeTab | null> {
  try {
    return await chrome.tabs.get(tabId);
  } catch {
    return null;
  }
}

async function broadcastOverlayState(
  state: RuntimeState,
  previousState: RuntimeState | null = null,
  broadcastAllChatGptTabs = false,
  overlaySettings: OverlaySettings | null = null
): Promise<void> {
  const nextOverlaySettings = overlaySettings ?? (await getOverlaySettings());
  const tabIds = new Set<number>(collectOverlaySyncTabIds(previousState, state));
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
    Array.from(tabIds).map(async (tabId): Promise<null> => {
      try {
        const snapshot = await buildOverlaySnapshot(state, tabId, nextOverlaySettings);
        const message = {
          type: MESSAGE_TYPES.SYNC_OVERLAY_STATE,
          snapshot
        } as const;
        postOverlayStateToPorts(tabId, message);
        await chrome.tabs.sendMessage(tabId, message);
      } catch {
        return null;
      }
      return null;
    })
  );
}

function postOverlayStateToPorts(
  tabId: number,
  message: { type: "SYNC_OVERLAY_STATE"; snapshot: OverlayModel }
): void {
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

async function buildOverlaySnapshot(
  state: RuntimeState,
  tabId: number | null,
  overlaySettings: OverlaySettings
): Promise<OverlayModel> {
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

function findRoleByTabId(state: RuntimeState, tabId: number | null | undefined): BridgeRole | null {
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

function mapGuardReasonToStop(reason: RelayGuardReason | string | null | undefined): StopReason {
  return guardReasonToStopReason(reason);
}

function isBridgeRole(role: unknown): role is BridgeRole {
  return typeof role === "string" && ROLES.includes(role as BridgeRole);
}

async function getSessionValue<T>(key: string): Promise<T | null> {
  const payload = await chrome.storage.session.get(key);
  return (payload[key] as T | undefined) ?? null;
}

async function setSessionValue<T>(key: string, value: T): Promise<void> {
  await chrome.storage.session.set({
    [key]: value
  });
}

async function getLocalValue<T>(key: string): Promise<T | null> {
  const payload = await chrome.storage.local.get(key);
  return (payload[key] as T | undefined) ?? null;
}

async function setLocalValue<T>(key: string, value: T): Promise<void> {
  await chrome.storage.local.set({
    [key]: value
  });
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error ?? "unknown_error");
}

function sleep(durationMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}

async function shouldContinueRelayLoop(token: number): Promise<boolean> {
  if (token !== activeLoopToken) {
    return false;
  }

  const state = await getState();
  return state.phase === PHASES.RUNNING;
}

function structuredCloneSafe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
