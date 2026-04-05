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
  RuntimeMessage,
  RuntimeResponse,
  RuntimeSettings,
  RuntimeState,
  StopReason,
  ThreadActivityResponse
} from "./shared/types.js";

type OverlaySettingsResult = {
  state: RuntimeState;
  overlaySettings: OverlaySettings;
};

type BackgroundMessageResult = RuntimeState | PopupModel | OverlayModel | OverlaySettingsResult;

type SettledReplyResult =
  | AssistantSnapshotResponse
  | { ok: false; reason: "loop_cancelled" | StopReason };

interface WaitForSettledReplyInput {
  tabId: number;
  baselineHash: string;
  settings: RuntimeSettings;
  token: number;
}

let activeLoopToken = 0;
const keepAlivePorts = new Set<ChromePort>();

chrome.runtime.onInstalled.addListener(async (): Promise<void> => {
  await initializeState();
  await initializeOverlaySettings();
});

chrome.runtime.onStartup.addListener(async (): Promise<void> => {
  await initializeState();
  await initializeOverlaySettings();
});

chrome.runtime.onConnect.addListener((port): void => {
  if (port.name !== "bridge-tab-keepalive") {
    return;
  }

  keepAlivePorts.add(port);
  port.onMessage.addListener((): void => {});
  port.onDisconnect.addListener((): void => {
    keepAlivePorts.delete(port);
  });
});

chrome.tabs.onRemoved.addListener(async (tabId): Promise<void> => {
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
  nextState.bindings[role] = {
    ...nextState.bindings[role],
    url: changeInfo.url,
    urlInfo
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
  await broadcastOverlayState(nextState, previousState);
  return nextState;
}

async function updateState(event: RuntimeStateEvent): Promise<RuntimeState> {
  const current = await getState();
  const next = reduceState(current, event);

  if (next.phase !== PHASES.RUNNING) {
    activeLoopToken = 0;
  }

  return persistState(next, current);
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

  if (!urlInfo.supported) {
    throw new Error("The selected tab is not a supported ChatGPT thread.");
  }

  const otherBinding = state.bindings[otherRole(role)];
  if (
    otherBinding &&
    (otherBinding.tabId === tab.id || otherBinding.urlInfo?.normalizedUrl === urlInfo.normalizedUrl)
  ) {
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
      startRelayLoop(await getState());
    }
  }
  return getState();
}

async function runStarterPreflight(state: RuntimeState): Promise<boolean> {
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
    return true;
  }

  if (!threadActivity.result.generating && threadActivity.result.sendButtonReady) {
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
      return true;
    }

    if (!activity.result.generating && activity.result.sendButtonReady) {
      return true;
    }

    if (!activity.result.generating && !activity.result.sendButtonReady) {
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

function startRelayLoop(state: RuntimeState): void {
  activeLoopToken += 1;
  const token = activeLoopToken;
  void runRelayLoop(token, state.settings ?? DEFAULT_SETTINGS);
}

async function runRelayLoop(token: number, settings: RuntimeSettings): Promise<void> {
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

    // P0-1: Target-side preflight - check target is ready to receive
    const targetPreflight = await runTargetPreflight(targetRole, targetBinding, state, token);
    if (!targetPreflight) {
      return; // Target not ready, stop condition already set
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

    const sendResult = await sendRelayMessage(targetBinding.tabId, envelope);
    if (!sendResult.ok) {
      await updateState({
        type: "runtime_error",
        reason: `${ERROR_REASONS.MESSAGE_SEND_FAILED}:${sendResult.error ?? "unknown"}`
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

async function ensureRunnableBinding(
  role: BridgeRole,
  binding: RuntimeState["bindings"][BridgeRole]
): Promise<ChromeTab | null> {
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

async function requestAssistantSnapshot(tabId: number): Promise<AssistantSnapshotResponse> {
  try {
    return await chrome.tabs.sendMessage<AssistantSnapshotResponse>(tabId, {
      type: MESSAGE_TYPES.GET_ASSISTANT_SNAPSHOT
    });
  } catch (error: unknown) {
    return {
      ok: false,
      error: getErrorMessage(error)
    };
  }
}

async function requestThreadActivity(tabId: number): Promise<ThreadActivityResponse> {
  try {
    return await chrome.tabs.sendMessage<ThreadActivityResponse>(tabId, {
      type: MESSAGE_TYPES.GET_THREAD_ACTIVITY
    });
  } catch (error: unknown) {
    return {
      ok: false,
      error: getErrorMessage(error)
    };
  }
}

async function sendRelayMessage(tabId: number, text: string): Promise<RelayMessageResponse> {
  try {
    return await Promise.race([
      chrome.tabs.sendMessage<RelayMessageResponse>(tabId, {
        type: MESSAGE_TYPES.SEND_RELAY_MESSAGE,
        text
      }),
      sleep(15000).then<RelayMessageResponse>(() => ({
        ok: false,
        error: "send_message_timeout"
      }))
    ]);
  } catch (error: unknown) {
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
}: WaitForSettledReplyInput): Promise<SettledReplyResult> {
  const startedAt = Date.now();
  let stableHash: string | null = null;
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

async function buildOverlaySnapshot(
  state: RuntimeState,
  tabId: number | null,
  overlaySettings: OverlaySettings
): Promise<OverlayModel> {
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

function structuredCloneSafe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
