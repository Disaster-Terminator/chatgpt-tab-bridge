// core/constants.ts
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

// copy/bridge-copy.ts
var DEFAULT_UI_LOCALE = "zh-CN";
var zhCN = {
  overlay: {
    bridgeTitle: "\u4E2D\u7EE7",
    phaseReady: "\u5C31\u7EEA",
    phaseRunning: "\u8FD0\u884C\u4E2D",
    phasePaused: "\u5DF2\u6682\u505C",
    phaseStopped: "\u5DF2\u505C\u6B62",
    phaseError: "\u9519\u8BEF",
    phaseIdle: "\u7A7A\u95F2",
    roleUnbound: "\u672A\u7ED1\u5B9A",
    roleBoundA: "\u5DF2\u7ED1\u5B9A A",
    roleBoundB: "\u5DF2\u7ED1\u5B9A B",
    roundLabel: "\u8F6E\u6B21",
    nextLabel: "\u4E0B\u4E00\u8DF3",
    stepLabel: "\u6B65\u9AA4",
    issueLabel: "\u95EE\u9898",
    starterLabel: "\u8D77\u59CB\u4FA7",
    starterA: "A \u8D77\u59CB",
    starterB: "B \u8D77\u59CB",
    bindA: "\u7ED1\u5B9A A",
    bindB: "\u7ED1\u5B9A B",
    unbind: "\u7A7A\u95F2",
    start: "\u5F00\u59CB",
    pause: "\u6682\u505C",
    resume: "\u6062\u590D",
    stop: "\u505C\u6B62",
    clear: "\u6E05\u7A7A",
    popup: "\u9762\u677F",
    collapseExpand: "+",
    collapseCollapse: "\u2212",
    none: "\u65E0",
    idle: "\u7A7A\u95F2"
  },
  popup: {
    eyebrow: "ChatGPT \u4E2D\u7EE7",
    title: "\u8BBE\u7F6E",
    sectionGlobalStatus: "\u5168\u5C40\u72B6\u6001",
    sectionSettings: "\u8BBE\u7F6E",
    sectionFallback: "\u5907\u7528\u64CD\u4F5C",
    sectionDebug: "\u8C03\u8BD5",
    debugSummary: "\u8C03\u8BD5\u4FE1\u606F",
    labelStarter: "\u8D77\u59CB\u4FA7",
    labelMaxRoundsLimit: "\u8F6E\u6570\u9650\u5236",
    labelMaxRounds: "\u6865\u63A5\u8F6E\u6570",
    maxRoundsHelp: "\u5F00\u542F\u540E\u5230\u8FBE\u76EE\u6807\u8F6E\u6570\u81EA\u52A8\u505C\u6B62\uFF1B\u5173\u95ED\u540E\u663E\u793A\u4E3A \u221E\u3002",
    maxRoundsDecrease: "\u51CF\u5C11\u6865\u63A5\u8F6E\u6570",
    maxRoundsIncrease: "\u589E\u52A0\u6865\u63A5\u8F6E\u6570",
    roundUnit: "\u8F6E",
    labelOverride: "\u6682\u505C\u65F6\u4E0B\u4E00\u8DF3\u8986\u76D6",
    labelEnableOverlay: "\u542F\u7528\u60AC\u6D6E\u7A97",
    labelEnableAmbientOverlay: "\u5168\u7AD9\u72B6\u6001\u63D0\u793A",
    labelDefaultExpanded: "\u9ED8\u8BA4\u5C55\u5F00\u60AC\u6D6E\u7A97",
    bindingA: "\u7ED1\u5B9A A",
    bindingB: "\u7ED1\u5B9A B",
    currentTab: "\u5F53\u524D\u6807\u7B7E\u9875",
    unbind: "\u89E3\u7ED1",
    start: "\u5F00\u59CB",
    pause: "\u6682\u505C",
    resume: "\u6062\u590D",
    stop: "\u505C\u6B62",
    clearTerminal: "\u6E05\u7A7A\u7EC8\u7AEF",
    openHelp: "\u5E2E\u52A9",
    resetPosition: "\u91CD\u7F6E\u4F4D\u7F6E",
    copyDebug: "\u590D\u5236\u8C03\u8BD5\u5FEB\u7167",
    copied: "\u8C03\u8BD5\u5FEB\u7167\u5DF2\u590D\u5236",
    copiedDebugSnapshot: "\u5DF2\u590D\u5236\u8C03\u8BD5\u5FEB\u7167",
    failedToCopyDebugSnapshot: "\u590D\u5236\u8C03\u8BD5\u5FEB\u7167\u5931\u8D25",
    noActiveTab: "\u65E0\u53EF\u7528\u6D3B\u52A8\u6807\u7B7E\u9875\u3002",
    unsupportedTab: "\u5F53\u524D\u6807\u7B7E\u9875\u4E0D\u662F\u652F\u6301\u7684 ChatGPT \u7EBF\u7A0B\u3002",
    tabBoundAs: (role) => `\u5F53\u524D\u6807\u7B7E\u9875\u5DF2\u7ED1\u5B9A\u4E3A ${role}\u3002`,
    tabEligible: (kind) => `\u5F53\u524D\u6807\u7B7E\u9875\u7B26\u5408\u6761\u4EF6\uFF08${kind}\uFF09\u3002`,
    unbound: "\u672A\u7ED1\u5B9A",
    none: "\u65E0",
    idle: "\u7A7A\u95F2",
    roundLabel: "\u8F6E\u6B21",
    nextHopLabel: "\u4E0B\u4E00\u8DF3",
    currentStepLabel: "\u5F53\u524D\u6B65\u9AA4",
    transportLabel: "\u4F20\u8F93",
    selectorLabel: "\u9009\u62E9\u5668",
    lastIssueLabel: "\u6700\u540E\u95EE\u9898",
    threadLabel: "\u7EBF\u7A0B",
    projectThreadLabel: "\u9879\u76EE\u7EBF\u7A0B",
    overrideNone: "\u4E0D\u8986\u76D6",
    overrideA: "A \u2192 B",
    overrideB: "B \u2192 A",
    starterA: "A \u8D77\u59CB",
    starterB: "B \u8D77\u59CB",
    localeLabel: "\u8BED\u8A00",
    localeZh: "\u4E2D\u6587",
    localeEn: "English",
    helpText: "\u8986\u76D6\u4EC5\u5728\u6682\u505C\u65F6\u751F\u6548\uFF1B\u6E05\u7A7A\u7EC8\u7AEF\u53EF\u5C06\u5DF2\u505C\u6B62/\u9519\u8BEF\u72B6\u6001\u91CD\u7F6E\u4E3A\u5C31\u7EEA\u3002",
    readinessLabel: "\u65E0\u6CD5\u542F\u52A8:",
    blockReasons: {
      starter_generating: "\u8D77\u59CB\u4FA7\u6B63\u5728\u751F\u6210\u4E2D",
      clear_terminal_required: "\u9700\u8981\u6E05\u7A7A\u7EC8\u7AEF",
      missing_binding: "\u7F3A\u5C11\u7ED1\u5B9A",
      preflight_pending: "\u7B49\u5F85\u8D77\u59CB\u4FA7\u5C31\u7EEA"
    }
  }
};
var en = {
  overlay: {
    bridgeTitle: "Bridge",
    phaseReady: "Ready",
    phaseRunning: "Running",
    phasePaused: "Paused",
    phaseStopped: "Stopped",
    phaseError: "Error",
    phaseIdle: "Idle",
    roleUnbound: "Unbound",
    roleBoundA: "Bound as A",
    roleBoundB: "Bound as B",
    roundLabel: "Round",
    nextLabel: "Next",
    stepLabel: "Step",
    issueLabel: "Issue",
    starterLabel: "Starter",
    starterA: "A starts",
    starterB: "B starts",
    bindA: "Bind A",
    bindB: "Bind B",
    unbind: "Idle",
    start: "Start",
    pause: "Pause",
    resume: "Resume",
    stop: "Stop",
    clear: "Clear",
    popup: "Popup",
    collapseExpand: "+",
    collapseCollapse: "\u2212",
    none: "None",
    idle: "idle"
  },
  popup: {
    eyebrow: "ChatGPT Bridge",
    title: "Settings",
    sectionGlobalStatus: "Global status",
    sectionSettings: "Settings",
    sectionFallback: "Fallback",
    sectionDebug: "Debug",
    debugSummary: "Debug info",
    labelStarter: "Starter side",
    labelMaxRoundsLimit: "Round limit",
    labelMaxRounds: "Bridge rounds",
    maxRoundsHelp: "When enabled, stops after the selected count; disabled shows \u221E.",
    maxRoundsDecrease: "Decrease bridge rounds",
    maxRoundsIncrease: "Increase bridge rounds",
    roundUnit: "rounds",
    labelOverride: "Paused next hop override",
    labelEnableOverlay: "Enable overlay",
    labelEnableAmbientOverlay: "Site-wide status hint",
    labelDefaultExpanded: "Default expanded overlay",
    bindingA: "Binding A",
    bindingB: "Binding B",
    currentTab: "Current tab",
    unbind: "Unbind",
    start: "Start",
    pause: "Pause",
    resume: "Resume",
    stop: "Stop",
    clearTerminal: "Clear terminal",
    openHelp: "Help",
    resetPosition: "Reset position",
    copyDebug: "Copy debug snapshot",
    copied: "Debug snapshot copied",
    copiedDebugSnapshot: "Copied debug snapshot",
    failedToCopyDebugSnapshot: "Failed to copy debug snapshot",
    noActiveTab: "No active tab available.",
    unsupportedTab: "Current tab is not a supported ChatGPT thread.",
    tabBoundAs: (role) => `Current tab is bound as ${role}.`,
    tabEligible: (kind) => `Current tab is eligible (${kind}).`,
    unbound: "Unbound",
    none: "None",
    idle: "idle",
    roundLabel: "Round",
    nextHopLabel: "Next hop",
    currentStepLabel: "Current step",
    transportLabel: "Transport",
    selectorLabel: "Selector",
    lastIssueLabel: "Last issue",
    threadLabel: "thread",
    projectThreadLabel: "project thread",
    overrideNone: "No override",
    overrideA: "A \u2192 B",
    overrideB: "B \u2192 A",
    starterA: "A starts",
    starterB: "B starts",
    localeLabel: "Language",
    localeZh: "Chinese",
    localeEn: "English",
    helpText: "Override only applies while paused; Clear returns stopped/error to ready.",
    readinessLabel: "Cannot start:",
    blockReasons: {
      starter_generating: "Starter is still generating",
      clear_terminal_required: "Terminal must be cleared",
      missing_binding: "Missing binding",
      preflight_pending: "Waiting for starter to settle"
    }
  }
};
function getOverlayCopy(locale) {
  return locale === "en" ? en.overlay : zhCN.overlay;
}
function getPopupCopy(locale) {
  return locale === "en" ? en.popup : zhCN.popup;
}
function formatPhase(locale, phase) {
  const c = getOverlayCopy(locale);
  switch (phase) {
    case "ready":
      return c.phaseReady;
    case "running":
      return c.phaseRunning;
    case "paused":
      return c.phasePaused;
    case "stopped":
      return c.phaseStopped;
    case "error":
      return c.phaseError;
    default:
      return c.phaseIdle;
  }
}
function applyStaticCopy(root, locale) {
  const c = getPopupCopy(locale);
  root.querySelectorAll("[data-copy]").forEach((el) => {
    const rawKey = el.dataset.copy;
    if (!rawKey) return;
    const key = rawKey;
    const value = c[key];
    if (typeof value === "string") {
      el.textContent = value;
    }
  });
}

// ui/preferences.ts
var UI_LOCALE_STORAGE_KEY = "chatgptBridgeUiLocale";
function readUiLocale() {
  try {
    const raw = localStorage.getItem(UI_LOCALE_STORAGE_KEY);
    if (raw === "zh-CN" || raw === "en") {
      return raw;
    }
  } catch {
  }
  return DEFAULT_UI_LOCALE;
}
function writeUiLocale(locale) {
  try {
    localStorage.setItem(UI_LOCALE_STORAGE_KEY, locale);
  } catch {
  }
}

// popup.ts
var REFRESH_INTERVAL_MS = 1e3;
var MIN_MAX_ROUNDS = 1;
var MAX_MAX_ROUNDS = 50;
function withTimeout(promise, timeoutMs) {
  return Promise.race([
    promise,
    new Promise(
      (_, reject) => setTimeout(() => reject(new Error("Operation timed out")), timeoutMs)
    )
  ]);
}
var elements = {
  phaseBadge: requireElement("#phaseBadge"),
  currentTabStatus: requireElement("#currentTabStatus"),
  bindAButton: requireElement("#bindAButton"),
  bindBButton: requireElement("#bindBButton"),
  bindingA: requireElement("#bindingA"),
  bindingB: requireElement("#bindingB"),
  localeSelect: requireElement("#localeSelect"),
  maxRoundsRange: requireElement("#maxRoundsRange"),
  maxRoundsValue: requireElement("#maxRoundsValue"),
  maxRoundsEnabledCheckbox: requireElement("#maxRoundsEnabledCheckbox"),
  decreaseMaxRoundsButton: requireElement("#decreaseMaxRoundsButton"),
  increaseMaxRoundsButton: requireElement("#increaseMaxRoundsButton"),
  overlayEnabledCheckbox: requireElement("#overlayEnabledCheckbox"),
  ambientOverlayEnabledCheckbox: requireElement("#ambientOverlayEnabledCheckbox"),
  defaultExpandedCheckbox: requireElement("#defaultExpandedCheckbox"),
  resetOverlayPositionButton: requireElement("#resetOverlayPositionButton"),
  starterSelect: requireElement("#starterSelect"),
  overrideSelect: requireElement("#overrideSelect"),
  startButton: requireElement("#startButton"),
  pauseButton: requireElement("#pauseButton"),
  resumeButton: requireElement("#resumeButton"),
  stopButton: requireElement("#stopButton"),
  clearTerminalButton: requireElement("#clearTerminalButton"),
  copyDebugButton: requireElement("#copyDebugButton"),
  openHelpButton: requireElement("#openHelpButton"),
  roundValue: requireElement("#roundValue"),
  nextHopValue: requireElement("#nextHopValue"),
  currentStepValue: requireElement("#currentStepValue"),
  currentStepValueDebug: requireElement("#currentStepValueDebug"),
  transportValue: requireElement("#transportValue"),
  selectorValue: requireElement("#selectorValue"),
  issueValue: requireElement("#issueValue"),
  issueValueDebug: requireElement("#issueValueDebug"),
  issueRow: requireElement("#issueRow"),
  copyFeedback: requireElement("#copyFeedback"),
  readinessRow: requireElement("#readinessRow"),
  readinessReason: requireElement("#readinessReason")
};
var currentTabId = null;
var currentModel = null;
var refreshTimerId = null;
var refreshInFlight = null;
var currentLocale = readUiLocale();
applyStaticCopy(document.body, currentLocale);
document.documentElement.lang = currentLocale === "en" ? "en" : "zh-CN";
wireEvents();
void refresh();
startAutoRefresh();
async function refresh() {
  if (refreshInFlight) {
    return refreshInFlight;
  }
  refreshInFlight = refreshLatestModel();
  try {
    return await refreshInFlight;
  } finally {
    refreshInFlight = null;
  }
}
async function refreshLatestModel() {
  try {
    const [activeTab] = await chrome.tabs.query({
      active: true,
      currentWindow: true
    });
    currentTabId = activeTab?.id ?? null;
    const response = await sendMessage({
      type: MESSAGE_TYPES.GET_POPUP_MODEL,
      activeTabId: currentTabId
    });
    currentModel = response;
    render(response);
    return response;
  } catch (error) {
    const message = getErrorMessage(error);
    elements.currentTabStatus.textContent = message;
    elements.issueValue.textContent = message;
    return null;
  }
}
function wireEvents() {
  elements.bindAButton.addEventListener("click", () => {
    void perform({
      type: MESSAGE_TYPES.SET_BINDING,
      role: "A",
      tabId: currentTabId
    });
  });
  elements.bindBButton.addEventListener("click", () => {
    void perform({
      type: MESSAGE_TYPES.SET_BINDING,
      role: "B",
      tabId: currentTabId
    });
  });
  elements.starterSelect.addEventListener("change", () => {
    void perform({
      type: MESSAGE_TYPES.SET_STARTER,
      role: elements.starterSelect.value
    });
  });
  elements.overrideSelect.addEventListener("change", () => {
    const role = toNullableRole(elements.overrideSelect.value);
    void perform({
      type: MESSAGE_TYPES.SET_NEXT_HOP_OVERRIDE,
      role
    });
  });
  elements.startButton.addEventListener("click", () => {
    void perform({
      type: MESSAGE_TYPES.START_SESSION
    });
  });
  elements.pauseButton.addEventListener("click", () => {
    void perform({
      type: MESSAGE_TYPES.PAUSE_SESSION
    });
  });
  elements.resumeButton.addEventListener("click", () => {
    void perform({
      type: MESSAGE_TYPES.RESUME_SESSION
    });
  });
  elements.stopButton.addEventListener("click", () => {
    void perform({
      type: MESSAGE_TYPES.STOP_SESSION
    });
  });
  elements.clearTerminalButton.addEventListener("click", () => {
    void perform({
      type: MESSAGE_TYPES.CLEAR_TERMINAL
    });
  });
  elements.copyDebugButton.addEventListener("click", () => {
    void copyDebugSnapshot();
  });
  elements.openHelpButton.addEventListener("click", () => {
    window.open("https://github.com/raystorm1/chatgpt-tab-bridge#readme", "_blank");
  });
  elements.overlayEnabledCheckbox.addEventListener("change", () => {
    void perform({
      type: MESSAGE_TYPES.SET_OVERLAY_ENABLED,
      enabled: elements.overlayEnabledCheckbox.checked
    });
  });
  elements.ambientOverlayEnabledCheckbox.addEventListener("change", () => {
    void perform({
      type: MESSAGE_TYPES.SET_AMBIENT_OVERLAY_ENABLED,
      enabled: elements.ambientOverlayEnabledCheckbox.checked
    });
  });
  elements.resetOverlayPositionButton.addEventListener("click", () => {
    void perform({
      type: MESSAGE_TYPES.RESET_OVERLAY_POSITION
    });
  });
  elements.localeSelect.addEventListener("change", () => {
    const newLocale = elements.localeSelect.value;
    currentLocale = newLocale;
    writeUiLocale(newLocale);
    document.documentElement.lang = newLocale === "en" ? "en" : "zh-CN";
    applyStaticCopy(document.body, newLocale);
    if (currentModel) {
      render(currentModel);
    }
  });
  elements.maxRoundsRange.addEventListener("input", () => {
    renderMaxRoundsValue(Number(elements.maxRoundsRange.value));
  });
  elements.maxRoundsRange.addEventListener("change", () => {
    void updateMaxRounds(Number(elements.maxRoundsRange.value));
  });
  elements.maxRoundsEnabledCheckbox.addEventListener("change", () => {
    void perform({
      type: MESSAGE_TYPES.SET_RUNTIME_SETTINGS,
      settings: {
        maxRoundsEnabled: elements.maxRoundsEnabledCheckbox.checked
      }
    });
  });
  elements.decreaseMaxRoundsButton.addEventListener("click", () => {
    void updateMaxRounds(Number(elements.maxRoundsRange.value) - 1);
  });
  elements.increaseMaxRoundsButton.addEventListener("click", () => {
    void updateMaxRounds(Number(elements.maxRoundsRange.value) + 1);
  });
  elements.defaultExpandedCheckbox.addEventListener("change", () => {
    void perform({
      type: MESSAGE_TYPES.SET_OVERLAY_COLLAPSED,
      collapsed: !elements.defaultExpandedCheckbox.checked
    });
  });
}
async function perform(message) {
  try {
    await sendMessage(message);
    await refresh();
  } catch (error) {
    elements.issueValue.textContent = getErrorMessage(error);
  }
}
function render(model) {
  const copy = getPopupCopy(currentLocale);
  const { state, currentTab, controls, display, overlaySettings, readiness } = model;
  elements.phaseBadge.textContent = formatPhase(currentLocale, state.phase);
  elements.phaseBadge.dataset.phase = state.phase;
  elements.bindingA.textContent = summarizeBinding(copy, state.bindings.A);
  elements.bindingB.textContent = summarizeBinding(copy, state.bindings.B);
  elements.roundValue.textContent = formatRoundProgress(state.settings.maxRoundsEnabled, state.round, state.settings.maxRounds);
  elements.nextHopValue.textContent = display.nextHop;
  elements.currentStepValue.textContent = display.currentStep || copy.idle;
  elements.currentStepValueDebug.textContent = display.currentStep || copy.idle;
  elements.transportValue.textContent = display.transport || copy.none;
  elements.selectorValue.textContent = display.selector || copy.none;
  if (display.lastIssue && display.lastIssue !== "None") {
    elements.issueRow.hidden = false;
    elements.issueValue.textContent = display.lastIssue;
    elements.issueValueDebug.textContent = display.lastIssue;
  } else {
    elements.issueRow.hidden = true;
    elements.issueValueDebug.textContent = copy.none;
  }
  elements.starterSelect.value = state.starter;
  elements.overrideSelect.value = state.nextHopOverride ?? "";
  elements.localeSelect.value = currentLocale;
  setMaxRoundsControl(state.settings.maxRounds, state.settings.maxRoundsEnabled);
  elements.overlayEnabledCheckbox.checked = overlaySettings.enabled;
  elements.ambientOverlayEnabledCheckbox.checked = overlaySettings.ambientEnabled;
  elements.defaultExpandedCheckbox.checked = !overlaySettings.collapsed;
  const toggle = elements.overlayEnabledCheckbox.closest(".popup__toggle");
  if (toggle) {
    toggle.dataset.checked = String(elements.overlayEnabledCheckbox.checked);
  }
  const ambientToggle = elements.ambientOverlayEnabledCheckbox.closest(".popup__toggle");
  if (ambientToggle) {
    ambientToggle.dataset.checked = String(elements.ambientOverlayEnabledCheckbox.checked);
  }
  const expandedToggle = elements.defaultExpandedCheckbox.closest(".popup__toggle");
  if (expandedToggle) {
    expandedToggle.dataset.checked = String(elements.defaultExpandedCheckbox.checked);
  }
  if (!currentTab) {
    elements.currentTabStatus.textContent = copy.noActiveTab;
  } else if (!currentTab.urlInfo.supported) {
    elements.currentTabStatus.textContent = copy.unsupportedTab;
  } else {
    elements.currentTabStatus.textContent = currentTab.assignedRole ? copy.tabBoundAs(currentTab.assignedRole) : copy.tabEligible(currentTab.urlInfo.kind);
  }
  elements.startButton.disabled = !controls.canStart;
  elements.pauseButton.disabled = !controls.canPause;
  elements.resumeButton.disabled = !controls.canResume;
  elements.stopButton.disabled = !controls.canStop;
  elements.clearTerminalButton.disabled = !controls.canClearTerminal;
  elements.starterSelect.disabled = !controls.canSetStarter;
  elements.overrideSelect.disabled = !controls.canSetOverride;
  elements.maxRoundsRange.disabled = !controls.canSetSettings;
  elements.maxRoundsEnabledCheckbox.disabled = !controls.canSetSettings;
  elements.decreaseMaxRoundsButton.disabled = !controls.canSetSettings || !state.settings.maxRoundsEnabled || state.settings.maxRounds <= MIN_MAX_ROUNDS;
  elements.increaseMaxRoundsButton.disabled = !controls.canSetSettings || !state.settings.maxRoundsEnabled || state.settings.maxRounds >= MAX_MAX_ROUNDS;
  elements.decreaseMaxRoundsButton.setAttribute("aria-label", copy.maxRoundsDecrease);
  elements.increaseMaxRoundsButton.setAttribute("aria-label", copy.maxRoundsIncrease);
  const maxRoundsToggle = elements.maxRoundsEnabledCheckbox.closest(".popup__toggle");
  if (maxRoundsToggle) {
    maxRoundsToggle.dataset.checked = String(elements.maxRoundsEnabledCheckbox.checked);
  }
  if (readiness.blockReason) {
    elements.readinessRow.hidden = false;
    const reasonKey = readiness.blockReason;
    elements.readinessReason.textContent = copy.blockReasons?.[reasonKey] || copy.none;
  } else {
    elements.readinessRow.hidden = true;
  }
  const starterOptions = elements.starterSelect.options;
  starterOptions[0].textContent = copy.starterA;
  starterOptions[1].textContent = copy.starterB;
  const overrideOptions = elements.overrideSelect.options;
  overrideOptions[0].textContent = copy.overrideNone;
  overrideOptions[1].textContent = copy.overrideA;
  overrideOptions[2].textContent = copy.overrideB;
}
function showCopyFeedback(message, isSuccess) {
  const feedback = elements.copyFeedback;
  feedback.textContent = message;
  feedback.className = "popup__copy-feedback";
  feedback.classList.add(isSuccess ? "popup__copy-feedback--success" : "popup__copy-feedback--error");
  feedback.hidden = false;
  setTimeout(() => {
    feedback.hidden = true;
  }, 1800);
}
async function copyDebugSnapshot() {
  const latestModel = await refresh() ?? currentModel;
  if (!latestModel) {
    showCopyFeedback("No data available", false);
    return;
  }
  const ackTarget = resolveAckDebugTarget(latestModel, currentTabId);
  if (!ackTarget.tabId) {
    showCopyFeedback(getPopupCopy(currentLocale).failedToCopyDebugSnapshot, false);
    return;
  }
  let ackDebug = null;
  let runtimeEvents = [];
  try {
    ackDebug = await withTimeout(
      chrome.tabs.sendMessage(ackTarget.tabId, { type: MESSAGE_TYPES.GET_LAST_ACK_DEBUG }),
      5e3
    );
  } catch (error) {
    console.warn("Failed to fetch ack debug:", error);
  }
  try {
    const eventsResponse = await withTimeout(
      chrome.runtime.sendMessage({
        type: MESSAGE_TYPES.GET_RECENT_RUNTIME_EVENTS
      }),
      5e3
    );
    runtimeEvents = eventsResponse.ok ? eventsResponse.result : [];
  } catch (error) {
    console.warn("Failed to fetch runtime events:", error);
  }
  const payload = buildDebugSnapshot(latestModel, ackDebug, ackTarget, runtimeEvents);
  try {
    await navigator.clipboard.writeText(payload);
    showCopyFeedback(getPopupCopy(currentLocale).copiedDebugSnapshot, true);
  } catch {
    const fallback = document.createElement("textarea");
    fallback.value = payload;
    fallback.setAttribute("readonly", "true");
    fallback.style.position = "fixed";
    fallback.style.opacity = "0";
    document.body.appendChild(fallback);
    fallback.select();
    document.execCommand("copy");
    fallback.remove();
    showCopyFeedback(getPopupCopy(currentLocale).copiedDebugSnapshot, true);
  }
}
function buildDebugSnapshot(model, ackDebug, ackTarget, runtimeEvents = []) {
  const copy = getPopupCopy(currentLocale);
  const { state, currentTab, display } = model;
  const tabStatus = currentTab?.assignedRole ? copy.tabBoundAs(currentTab.assignedRole) : currentTab?.urlInfo?.supported ? copy.tabEligible(currentTab.urlInfo.kind) : copy.unsupportedTab;
  const lines = [
    copy.title,
    "",
    `${formatPhase(currentLocale, state.phase)}`,
    tabStatus,
    `A: ${summarizeBinding(copy, state.bindings.A)}`,
    `B: ${summarizeBinding(copy, state.bindings.B)}`,
    `${copy.labelStarter}: ${state.starter}`,
    `${copy.roundLabel}: ${formatRoundProgress(state.settings.maxRoundsEnabled, state.round, state.settings.maxRounds)}`,
    `${copy.nextHopLabel}: ${display.nextHop}`,
    `${copy.currentStepLabel}: ${display.currentStep || copy.idle}`,
    `${copy.transportLabel}: ${display.transport || copy.none}`,
    `${copy.selectorLabel}: ${display.selector || copy.none}`,
    `${copy.lastIssueLabel}: ${display.lastIssue || copy.none}`,
    `Ack target: ${ackTarget.role ?? "current"} (#${ackTarget.tabId ?? "N/A"}, ${ackTarget.source})`
  ];
  if (ackDebug && ackDebug.ok === false && ackDebug.error) {
    lines.push("", "Ack Debug:", `  Error: ${ackDebug.error}`);
  } else if (ackDebug) {
    const response = ackDebug.response ?? {};
    const evidence = response.dispatchEvidence ?? {};
    lines.push(
      "",
      "Ack Debug:",
      `  Timestamp: ${formatTimestamp(ackDebug.timestamp)}`,
      `  Outcome: ${ackDebug.outcome || "unknown"}`,
      `  Reason: ${ackDebug.reason || "none"}`,
      `  Accepted: ${response.dispatchAccepted ?? response.ok ?? "N/A"}`,
      `  Mode: ${response.applyMode || "unknown"}:${response.mode || "unknown"}`,
      `  Signal: ${response.dispatchSignal || evidence.ackSignal || "none"}`,
      `  Error code: ${response.dispatchErrorCode || "none"}`,
      `  Error: ${response.error || "none"}`,
      `  Expected (hash): ${ackDebug?.baseline?.expectedHash || evidence.expectedHash || "N/A"}`,
      `  Baseline:`,
      `    userHash: ${ackDebug?.baseline?.userHash || evidence.baselineUserHash || "N/A"}`,
      `    composerText: ${preview(ackDebug?.baseline?.composerText ?? evidence.baselineComposerPreview)}`,
      `    generating: ${ackDebug?.baseline?.generating ?? evidence.baselineGenerating ?? "N/A"}`,
      `  Evidence:`,
      `    currentUserHash: ${evidence.currentUserHash || "N/A"}`,
      `    currentGenerating: ${evidence.currentGenerating ?? "N/A"}`,
      `    payloadReleased: ${evidence.payloadReleased ?? "N/A"}`,
      `    textChanged: ${evidence.textChanged ?? "N/A"}`,
      `    buttonStateChanged: ${evidence.buttonStateChanged ?? "N/A"}`,
      `    attempts: ${evidence.attempts ?? "N/A"}`,
      `    latestUser: ${preview(evidence.latestUserPreview)}`
    );
  }
  if (runtimeEvents.length > 0) {
    lines.push("", "Runtime Events:");
    for (const event of runtimeEvents.slice(-10)) {
      lines.push(
        `  ${formatTimestamp(event.timestamp)} ${event.phaseStep} ${event.sourceRole ?? "-"}->${event.targetRole ?? "-"} r${event.round}`,
        `    summary: ${event.dispatchReadbackSummary}`,
        `    mode: ${event.sendTriggerMode}`,
        `    baseline: ${event.verificationBaseline}`,
        `    poll: ${event.verificationPollSample}`,
        `    verdict: ${event.verificationVerdict}`
      );
    }
  }
  return lines.join("\n");
}
function resolveAckDebugTarget(model, fallbackTabId) {
  const { state } = model;
  const role = state.activeHop?.targetRole ?? state.runtimeActivity.targetRole ?? model.currentTab?.assignedRole ?? null;
  const tabId = state.activeHop?.targetTabId ?? (role ? state.bindings[role]?.tabId ?? null : null) ?? fallbackTabId;
  return {
    role,
    tabId,
    source: state.activeHop?.targetTabId ? "active-hop" : role && state.bindings[role]?.tabId ? "runtime-target-role" : "active-tab"
  };
}
function formatTimestamp(value) {
  if (!value) {
    return "N/A";
  }
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}
function formatRoundProgress(enabled, round, maxRounds) {
  return `${round} / ${enabled ? maxRounds : "\u221E"}`;
}
function preview(value) {
  const text = String(value ?? "");
  if (!text) {
    return "N/A";
  }
  return text.length > 80 ? `${text.slice(0, 80)}...` : text;
}
function summarizeBinding(copy, binding) {
  if (!binding) {
    return copy.unbound;
  }
  const label = binding.urlInfo?.kind === "project" ? copy.projectThreadLabel : copy.threadLabel;
  return `${binding.title || label} (#${binding.tabId})`;
}
async function updateMaxRounds(value) {
  const maxRounds = clampMaxRounds(value);
  setMaxRoundsControl(maxRounds, elements.maxRoundsEnabledCheckbox.checked);
  await perform({
    type: MESSAGE_TYPES.SET_RUNTIME_SETTINGS,
    settings: {
      maxRounds
    }
  });
}
function setMaxRoundsControl(value, enabled) {
  const maxRounds = clampMaxRounds(value);
  elements.maxRoundsRange.value = String(maxRounds);
  elements.maxRoundsEnabledCheckbox.checked = enabled;
  elements.maxRoundsRange.closest(".popup__round-control")?.setAttribute(
    "data-unlimited",
    String(!enabled)
  );
  renderMaxRoundsValue(maxRounds, enabled);
}
function renderMaxRoundsValue(value, enabled = elements.maxRoundsEnabledCheckbox.checked) {
  elements.maxRoundsValue.textContent = enabled ? String(clampMaxRounds(value)) : "\u221E";
}
function clampMaxRounds(value) {
  if (!Number.isFinite(value)) {
    return 8;
  }
  return Math.min(MAX_MAX_ROUNDS, Math.max(MIN_MAX_ROUNDS, Math.round(value)));
}
async function sendMessage(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response.ok) {
    throw new Error("error" in response ? response.error : "runtime_message_failed");
  }
  return response.result;
}
function startAutoRefresh() {
  if (refreshTimerId !== null) {
    return;
  }
  refreshTimerId = window.setInterval(() => {
    void refresh().catch((error) => {
      console.error("Refresh failed:", error);
    });
  }, REFRESH_INTERVAL_MS);
  window.addEventListener("beforeunload", () => {
    if (refreshTimerId !== null) {
      window.clearInterval(refreshTimerId);
      refreshTimerId = null;
    }
  }, { once: true });
}
function requireElement(selector) {
  const element = document.querySelector(selector);
  if (!element) {
    throw new Error(`Missing required popup element: ${selector}`);
  }
  return element;
}
function toNullableRole(value) {
  return value === "A" || value === "B" ? value : null;
}
function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
