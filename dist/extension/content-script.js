// content-helpers.ts
function normalizeText(value) {
  return String(value || "").replace(/\r\n/g, "\n").replace(/\u00a0/g, " ").trim();
}
function hashText(value) {
  const text = normalizeText(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `h${(hash >>> 0).toString(16)}`;
}
function isComposerTrulyCleared(currentText, expectedText) {
  if (!currentText || currentText.trim() === "") {
    return true;
  }
  if (stillContainsExpectedPayload(currentText, expectedText)) {
    return false;
  }
  return true;
}
function stillContainsExpectedPayload(currentText, expectedText) {
  if (!expectedText || !currentText) {
    return false;
  }
  const normalizedCurrent = normalizeText(currentText);
  const normalizedExpected = normalizeText(expectedText);
  if (normalizedCurrent === normalizedExpected) {
    return true;
  }
  let matchCount = 0;
  const expectedWords = normalizedExpected.split(/\s+/).filter((w) => w.length > 0);
  const currentWords = normalizedCurrent.split(/\s+/).filter((w) => w.length > 0);
  for (const word of expectedWords) {
    if (currentWords.some((cw) => cw.includes(word) || word.includes(cw))) {
      matchCount++;
    }
  }
  const similarity = expectedWords.length > 0 ? matchCount / expectedWords.length : 0;
  return similarity >= 0.5;
}
function isGenerationInProgressFromDoc() {
  if (document.querySelector('button[data-testid="stop-button"]') || document.querySelector('button[data-testid="stop-generating-button"]')) {
    return true;
  }
  return Boolean(
    document.querySelector('button[aria-label*="\u505C\u6B62"]') || document.querySelector('button[aria-label*="Stop"]') || document.querySelector('button[aria-label*="Cancel"]')
  );
}
function readComposerTextFromDoc(composer) {
  if (!composer) {
    return "";
  }
  if (isValueComposer(composer)) {
    return normalizeText(composer.value || "");
  }
  return normalizeText(composer.textContent || "");
}
function findLatestUserMessageHash() {
  const selectors = [
    '[data-message-author-role="user"]',
    'article [data-message-author-role="user"]',
    '[data-testid*="conversation-turn"] [data-message-author-role="user"]',
    'main [data-message-author-role="user"]'
  ];
  for (const selector of selectors) {
    const candidates = Array.from(document.querySelectorAll(selector)).filter(
      (element) => normalizeText(element.textContent || "")
    );
    if (candidates.length > 0) {
      const latest = candidates[candidates.length - 1];
      const text = normalizeText(latest.textContent || "");
      return text ? hashText(text) : null;
    }
  }
  return null;
}
function checkAckSignals(input) {
  const { baselineGenerating, baselineUserHash, baselineSendButtonReady = false, composer, expectedHash, expectedText } = input;
  const composerText = readComposerTextFromDoc(composer);
  const latestUserHash = findLatestUserMessageHash();
  const currentGenerating = isGenerationInProgressFromDoc();
  const sendButton = findSendButton(document, composer);
  const currentSendButtonReady = sendButton !== null && !sendButton.disabled;
  if (latestUserHash && latestUserHash !== baselineUserHash) {
    if (latestUserHash === expectedHash) {
      return { ok: true, signal: "user_message_added" };
    }
  }
  if (!baselineGenerating && currentGenerating) {
    return { ok: true, signal: "generation_started" };
  }
  if (baselineGenerating && !currentGenerating) {
    return { ok: true, signal: "generation_started" };
  }
  if (!baselineSendButtonReady && currentSendButtonReady) {
    return { ok: true, signal: "send_button_appeared" };
  }
  if (isComposerTrulyCleared(composerText, expectedText)) {
    return { ok: true, signal: "composer_cleared" };
  }
  return null;
}
function findBestComposer(root) {
  const selectors = [
    '[contenteditable="true"][role="textbox"]',
    '[contenteditable="true"][data-testid*="composer"]',
    "textarea",
    "input"
  ];
  const visibleCandidates = [];
  const fallbackCandidates = [];
  for (const selector of selectors) {
    const elements = Array.from(root?.querySelectorAll?.(selector) ?? []);
    for (const element of elements) {
      if (isElementVisible(element)) {
        visibleCandidates.push(element);
      } else {
        fallbackCandidates.push(element);
      }
    }
  }
  return visibleCandidates[0] ?? fallbackCandidates[0] ?? null;
}
function applyComposerText(composer, text, createInputEvent = defaultInputEvent) {
  const normalized = normalizeText(text);
  composer?.focus?.();
  if (isValueComposer(composer)) {
    const prototype = String(composer.tagName || "").toLowerCase() === "textarea" ? globalThis.HTMLTextAreaElement?.prototype : globalThis.HTMLInputElement?.prototype;
    const valueSetter = prototype ? Object.getOwnPropertyDescriptor(prototype, "value")?.set : null;
    if (typeof valueSetter === "function") {
      valueSetter.call(composer, normalized);
    } else {
      composer.value = normalized;
    }
    composer.dispatchEvent?.(createInputEvent("input", { bubbles: true, data: normalized }));
    composer.dispatchEvent?.(createInputEvent("change", { bubbles: true, data: normalized }));
    return "value";
  }
  const ownerDocument = composer?.ownerDocument || globalThis.document;
  const selection = ownerDocument?.getSelection?.();
  if (selection && ownerDocument?.createRange) {
    const range = ownerDocument.createRange();
    range.selectNodeContents(composer);
    selection.removeAllRanges();
    selection.addRange(range);
  }
  if (typeof ownerDocument?.execCommand === "function") {
    const inserted = ownerDocument.execCommand("insertText", false, normalized);
    if (!inserted && composer) {
      composer.textContent = normalized;
    }
  } else if (composer) {
    composer.textContent = normalized;
  }
  composer?.dispatchEvent?.(
    createInputEvent("beforeinput", {
      bubbles: true,
      cancelable: true,
      data: normalized,
      inputType: "insertText"
    })
  );
  composer?.dispatchEvent?.(
    createInputEvent("input", {
      bubbles: true,
      data: normalized,
      inputType: "insertText"
    })
  );
  return "contenteditable";
}
function readComposerText(composer) {
  if (!composer) {
    return "";
  }
  if (isValueComposer(composer)) {
    return normalizeText(composer.value || "");
  }
  return normalizeText(composer.textContent || "");
}
function findSendButton(root, composer) {
  const candidates = [
    composer?.closest?.("form")?.querySelector?.('button[type="submit"]'),
    root?.getElementById?.("composer-submit-button"),
    root?.querySelector?.("#composer-submit-button"),
    root?.querySelector?.('button[data-testid="send-button"]'),
    root?.querySelector?.('button[aria-label*="Send"]'),
    root?.querySelector?.('button[aria-label*="\u53D1\u9001"]')
  ].filter(Boolean);
  return candidates[0] ?? null;
}
function triggerComposerSend({
  root,
  composer,
  sendButton = findSendButton(root, composer)
}) {
  if (!sendButton) {
    return {
      ok: false,
      mode: "button_missing",
      error: "send_button_missing"
    };
  }
  if (!isDisabledButton(sendButton)) {
    sendButton.click?.();
    return {
      ok: true,
      mode: "button"
    };
  }
  const form = composer?.closest?.("form");
  if (form) {
    if (typeof form.requestSubmit === "function") {
      form.requestSubmit();
      return {
        ok: true,
        mode: "form_submit"
      };
    }
    const submitAccepted = form.dispatchEvent?.(
      new Event("submit", {
        bubbles: true,
        cancelable: true
      })
    );
    if (submitAccepted) {
      return {
        ok: true,
        mode: "form_submit"
      };
    }
  }
  return {
    ok: false,
    mode: "button_disabled",
    error: "send_button_disabled"
  };
}
function isValueComposer(composer) {
  if (!composer) {
    return false;
  }
  const tagName = String(composer.tagName || "").toLowerCase();
  return tagName === "textarea" || tagName === "input";
}
function isDisabledButton(button) {
  if (!button) {
    return false;
  }
  return button.disabled === true || button.getAttribute?.("aria-disabled") === "true";
}
function isElementVisible(element) {
  if (!element) {
    return false;
  }
  if (element.hidden || element.getAttribute?.("aria-hidden") === "true") {
    return false;
  }
  const style = globalThis.getComputedStyle?.(element);
  if (style && (style.display === "none" || style.visibility === "hidden")) {
    return false;
  }
  const rects = element.getClientRects?.();
  return Boolean(rects && rects.length > 0);
}
function defaultInputEvent(type, init) {
  if (typeof InputEvent === "function") {
    return new InputEvent(type, init);
  }
  return new Event(type, {
    bubbles: init.bubbles,
    cancelable: init.cancelable,
    composed: init.composed
  });
}

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
  BINDING_INVALID: "binding_invalid",
  STARTER_SETTLE_TIMEOUT: "starter_settle_timeout",
  TARGET_SETTLE_TIMEOUT: "target_settle_timeout"
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
    labelOverride: "\u6682\u505C\u65F6\u4E0B\u4E00\u8DF3\u8986\u76D6",
    labelEnableOverlay: "\u542F\u7528\u60AC\u6D6E\u7A97",
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
    labelOverride: "Paused next hop override",
    labelEnableOverlay: "Enable overlay",
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
function formatRoleStatus(locale, assignedRole) {
  const c = getOverlayCopy(locale);
  if (!assignedRole) return c.roleUnbound;
  return assignedRole === "A" ? c.roleBoundA : c.roleBoundB;
}
function formatIssueLine(locale, issue) {
  const c = getOverlayCopy(locale);
  const i = issue || c.none;
  return `${c.issueLabel}: ${i}`;
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
function observeUiLocale(callback) {
  const handler = (event) => {
    if (event.key === UI_LOCALE_STORAGE_KEY && event.newValue) {
      const value = event.newValue;
      if (value === "zh-CN" || value === "en") {
        callback(value);
      }
    }
  };
  window.addEventListener("storage", handler);
  return () => window.removeEventListener("storage", handler);
}

// content-script.ts
var overlay = createOverlay();
var keepAlivePort = connectKeepAlivePort();
var defaultControls = {
  canStart: false,
  canPause: false,
  canResume: false,
  canStop: false,
  canClearTerminal: false,
  canSetStarter: false,
  canSetOverride: false
};
var defaultDisplay = {
  nextHop: "A -> B",
  currentStep: "idle",
  lastActionAt: null,
  transport: null,
  selector: null,
  lastIssue: "None"
};
var overlaySnapshot = {
  phase: "idle",
  round: 0,
  nextHop: "A -> B",
  assignedRole: null,
  requiresTerminalClear: false,
  starter: "A",
  controls: defaultControls,
  display: defaultDisplay,
  overlaySettings: {
    enabled: true,
    collapsed: false,
    position: null
  },
  readiness: {
    starterReady: true,
    preflightPending: false,
    blockReason: null,
    sourceRole: "A"
  }
};
var lastAckDebug = null;
var overlayLocale = readUiLocale();
observeUiLocale((locale) => {
  overlayLocale = locale;
  renderOverlay();
});
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === MESSAGE_TYPES.GET_ASSISTANT_SNAPSHOT) {
    try {
      sendResponse(readAssistantSnapshot());
    } catch (error) {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : "assistant_snapshot_failed"
      });
    }
    return true;
  }
  if (message?.type === MESSAGE_TYPES.GET_THREAD_ACTIVITY) {
    try {
      sendResponse(readThreadActivity());
    } catch (error) {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : "thread_activity_failed"
      });
    }
    return true;
  }
  if (message?.type === MESSAGE_TYPES.SEND_RELAY_MESSAGE) {
    Promise.resolve(sendRelayMessage(message.text)).then(sendResponse).catch((error) => {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : "send_relay_message_failed"
      });
    });
    return true;
  }
  if (message?.type === MESSAGE_TYPES.GET_LAST_ACK_DEBUG) {
    sendResponse(lastAckDebug ?? { ok: false, error: "no_ack_debug" });
    return true;
  }
  if (message?.type === MESSAGE_TYPES.SYNC_OVERLAY_STATE) {
    overlaySnapshot = {
      ...overlaySnapshot,
      ...message.snapshot
    };
    renderOverlay();
  }
  return void 0;
});
bindOverlayEvents();
renderOverlay();
void refreshOverlayModel();
function connectKeepAlivePort() {
  const port = chrome.runtime.connect({
    name: "bridge-tab-keepalive"
  });
  const intervalId = setInterval(() => {
    try {
      port.postMessage({
        type: "heartbeat"
      });
    } catch {
      clearInterval(intervalId);
    }
  }, 2e4);
  port.onDisconnect.addListener(() => {
    clearInterval(intervalId);
    keepAlivePort = null;
    setTimeout(() => {
      keepAlivePort = connectKeepAlivePort();
    }, 1e3);
  });
  return port;
}
function bindOverlayEvents() {
  requireOverlayElement("[data-bind-role='A']").addEventListener("click", () => {
    const action = overlaySnapshot.assignedRole === "A" ? { type: MESSAGE_TYPES.CLEAR_BINDING, role: "A" } : { type: MESSAGE_TYPES.SET_BINDING, role: "A", tabId: void 0 };
    void dispatchOverlayAction(action);
  });
  requireOverlayElement("[data-bind-role='B']").addEventListener("click", () => {
    const action = overlaySnapshot.assignedRole === "B" ? { type: MESSAGE_TYPES.CLEAR_BINDING, role: "B" } : { type: MESSAGE_TYPES.SET_BINDING, role: "B", tabId: void 0 };
    void dispatchOverlayAction(action);
  });
  requireOverlayElement("[data-action='open-popup']").addEventListener("click", () => {
    void dispatchOverlayAction({
      type: MESSAGE_TYPES.REQUEST_OPEN_POPUP
    });
  });
  requireOverlayElement("[data-action='toggle-collapse']").addEventListener("click", () => {
    void dispatchOverlayAction({
      type: MESSAGE_TYPES.SET_OVERLAY_COLLAPSED,
      collapsed: !overlaySnapshot.overlaySettings.collapsed
    });
  });
  overlay.querySelectorAll("[data-starter]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const starter = btn.dataset.starter;
      if (starter && starter !== overlaySnapshot.starter) {
        void dispatchOverlayAction({
          type: MESSAGE_TYPES.SET_STARTER,
          role: starter
        });
      }
    });
  });
  requireOverlayElement("[data-action='start']").addEventListener("click", () => {
    void dispatchOverlayAction({ type: MESSAGE_TYPES.START_SESSION });
  });
  const pauseBtn = overlay.querySelector("[data-action='pause']");
  if (pauseBtn) {
    pauseBtn.addEventListener("click", () => {
      void dispatchOverlayAction({ type: MESSAGE_TYPES.PAUSE_SESSION });
    });
  }
  const resumeBtn = overlay.querySelector("[data-action='resume']");
  if (resumeBtn) {
    resumeBtn.addEventListener("click", () => {
      void dispatchOverlayAction({ type: MESSAGE_TYPES.RESUME_SESSION });
    });
  }
  requireOverlayElement("[data-action='stop']").addEventListener("click", () => {
    void dispatchOverlayAction({ type: MESSAGE_TYPES.STOP_SESSION });
  });
  requireOverlayElement("[data-action='clear-terminal']").addEventListener("click", () => {
    void dispatchOverlayAction({ type: MESSAGE_TYPES.CLEAR_TERMINAL });
  });
  initOverlayDrag();
}
async function dispatchOverlayAction(message) {
  try {
    await chrome.runtime.sendMessage(message);
  } finally {
    await refreshOverlayModel();
  }
}
async function refreshOverlayModel() {
  try {
    const response = await chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.GET_OVERLAY_MODEL
    });
    const model = response.ok ? response.result : null;
    if (!model) {
      return;
    }
    overlaySnapshot = {
      ...overlaySnapshot,
      ...model
    };
    renderOverlay();
  } catch (error) {
    console.warn("[bridge] overlay model refresh failed", error);
  }
}
function createOverlay() {
  const c = getOverlayCopy(overlayLocale);
  const node = document.createElement("aside");
  node.className = "chatgpt-bridge-overlay";
  node.dataset.extensionId = chrome.runtime.id;
  node.innerHTML = `
    <div class="chatgpt-bridge-overlay__header" data-drag-handle="true">
      <div class="chatgpt-bridge-overlay__header-left">
        <div class="chatgpt-bridge-overlay__title">
          <svg class="chatgpt-bridge-overlay__title-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/>
            <polyline points="15 3 21 3 21 9"/>
            <line x1="10" y1="14" x2="21" y2="3"/>
          </svg>
          <span>${c.bridgeTitle}</span>
        </div>
        <div class="chatgpt-bridge-overlay__role-row">
          <span class="chatgpt-bridge-overlay__role-dot" data-slot="role-dot"></span>
          <span data-slot="role">${c.roleUnbound}</span>
        </div>
      </div>
      <div class="chatgpt-bridge-overlay__header-right">
        <span class="chatgpt-bridge-overlay__phase-badge" data-slot="phase-badge" data-phase="idle">${c.phaseIdle}</span>
        <button type="button" class="chatgpt-bridge-overlay__collapse" data-action="toggle-collapse" aria-label="${c.collapseExpand}">${c.collapseCollapse}</button>
      </div>
    </div>
    <div class="chatgpt-bridge-overlay__collapsed-row">
      <span data-slot="collapsed-role">${c.roleUnbound}</span>
      <span data-slot="collapsed-info">R<span data-slot="round">0</span> \xB7 <span data-slot="next-hop">A \u2192 B</span></span>
    </div>
    <div class="chatgpt-bridge-overlay__body">
      <div class="chatgpt-bridge-overlay__status-panel">
        <div class="chatgpt-bridge-overlay__round-next">
          <span>${c.roundLabel}</span>
          <span class="chatgpt-bridge-overlay__value" data-slot="round">0</span>
          <span class="chatgpt-bridge-overlay__dot"></span>
          <span>${c.nextLabel}</span>
          <span class="chatgpt-bridge-overlay__value" data-slot="next-hop">A \u2192 B</span>
        </div>
        <div class="chatgpt-bridge-overlay__step-card">
          <div class="chatgpt-bridge-overlay__step-header">
            <span class="chatgpt-bridge-overlay__step-dot"></span>
            <span>${c.stepLabel}</span>
          </div>
          <div class="chatgpt-bridge-overlay__step-value" data-slot="step">${c.idle}</div>
        </div>
        <div class="chatgpt-bridge-overlay__issue-row" data-slot="issue-row" hidden>
          <span data-slot="issue">${c.issueLabel}: ${c.none}</span>
        </div>
      </div>
      <div class="chatgpt-bridge-overlay__starter-card">
        <div class="chatgpt-bridge-overlay__starter-header">
          <span class="chatgpt-bridge-overlay__starter-label">${c.starterLabel}</span>
          <span class="chatgpt-bridge-overlay__starter-hint">A / B</span>
        </div>
        <div class="chatgpt-bridge-overlay__starter-seg">
          <div class="chatgpt-bridge-overlay__starter-slider" data-pos="A"></div>
          <div class="chatgpt-bridge-overlay__starter-options">
            <button type="button" class="chatgpt-bridge-overlay__starter-option" data-starter="A" data-active="true">A</button>
            <button type="button" class="chatgpt-bridge-overlay__starter-option" data-starter="B">B</button>
          </div>
        </div>
      </div>
      <div class="chatgpt-bridge-overlay__control-container">
        <div class="chatgpt-bridge-overlay__control-group">
          <span class="chatgpt-bridge-overlay__control-label">${c.bindA + " / " + c.bindB}</span>
          <div class="chatgpt-bridge-overlay__binding-row">
            <button type="button" class="chatgpt-bridge-overlay__binding-btn" data-bind-role="A">
              <svg class="chatgpt-bridge-overlay__binding-btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/>
                <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/>
              </svg>
              <span>A</span>
              <span class="chatgpt-bridge-overlay__binding-status">${c.unbind}</span>
            </button>
            <button type="button" class="chatgpt-bridge-overlay__binding-btn" data-bind-role="B">
              <svg class="chatgpt-bridge-overlay__binding-btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/>
                <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/>
              </svg>
              <span>B</span>
              <span class="chatgpt-bridge-overlay__binding-status">${c.unbind}</span>
            </button>
          </div>
        </div>
        <div class="chatgpt-bridge-overlay__control-group">
          <span class="chatgpt-bridge-overlay__control-label">Session</span>
          <div class="chatgpt-bridge-overlay__session-toolbar">
            <button type="button" class="chatgpt-bridge-overlay__session-primary" data-action="start">${c.start}</button>
            <button type="button" class="chatgpt-bridge-overlay__session-pause" data-action="pause" style="display:none">${c.pause}</button>
            <button type="button" class="chatgpt-bridge-overlay__session-resume" data-action="resume" style="display:none">${c.resume}</button>
            <button type="button" class="chatgpt-bridge-overlay__session-stop" data-action="stop">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="6" width="12" height="12" rx="2"/>
              </svg>
            </button>
          </div>
        </div>
        <div class="chatgpt-bridge-overlay__control-group">
          <span class="chatgpt-bridge-overlay__control-label">Utility</span>
          <div class="chatgpt-bridge-overlay__utility-toolbar">
            <button type="button" class="chatgpt-bridge-overlay__utility-btn" data-action="clear-terminal">${c.clear}</button>
            <button type="button" class="chatgpt-bridge-overlay__utility-btn" data-action="open-popup">
              <svg class="chatgpt-bridge-overlay__utility-btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="3" width="18" height="18" rx="2"/>
                <path d="M3 9h18"/>
              </svg>
              ${c.popup}
            </button>
          </div>
        </div>
      </div>
    </div>
  `;
  document.documentElement.appendChild(node);
  return node;
}
function renderOverlay() {
  const c = getOverlayCopy(overlayLocale);
  const { controls, display, overlaySettings } = overlaySnapshot;
  const canChangeBindings = overlaySnapshot.phase !== "running" && overlaySnapshot.phase !== "paused";
  requireOverlayElement("[data-slot='role']").textContent = formatRoleStatus(overlayLocale, overlaySnapshot.assignedRole);
  const roleDot = requireOverlayElement("[data-slot='role-dot']");
  if (overlaySnapshot.assignedRole) {
    roleDot.dataset.role = overlaySnapshot.assignedRole;
    roleDot.style.background = "rgba(201, 179, 122, 0.7)";
  } else {
    delete roleDot.dataset.role;
    roleDot.style.background = "";
  }
  const phaseBadge = requireOverlayElement("[data-slot='phase-badge']");
  phaseBadge.textContent = formatPhase(overlayLocale, overlaySnapshot.phase);
  phaseBadge.dataset.phase = overlaySnapshot.phase;
  requireOverlayElement("[data-slot='round']").textContent = String(overlaySnapshot.round);
  requireOverlayElement("[data-slot='next-hop']").textContent = overlaySnapshot.nextHop;
  requireOverlayElement("[data-slot='step']").textContent = display?.currentStep || c.idle;
  const issueRow = requireOverlayElement("[data-slot='issue-row']");
  const issueText = display?.lastIssue;
  if (!issueText || issueText === "None") {
    issueRow.hidden = true;
  } else {
    issueRow.hidden = false;
    requireOverlayElement("[data-slot='issue']").textContent = formatIssueLine(overlayLocale, issueText);
  }
  const starterBtns = overlay.querySelectorAll("[data-starter]");
  starterBtns.forEach((btn) => {
    const isActive = btn.dataset.starter === overlaySnapshot.starter;
    btn.dataset.active = String(isActive);
  });
  const slider = requireOverlayElement(".chatgpt-bridge-overlay__starter-slider");
  slider.dataset.pos = overlaySnapshot.starter;
  const bindingBtns = overlay.querySelectorAll("[data-bind-role]");
  bindingBtns.forEach((btn) => {
    const role = btn.dataset.bindRole;
    const isActive = overlaySnapshot.assignedRole === role;
    btn.dataset.active = String(isActive);
    const statusEl = btn.querySelector(".chatgpt-bridge-overlay__binding-status");
    if (statusEl) {
      statusEl.textContent = isActive ? role === "A" ? c.roleBoundA : c.roleBoundB : c.unbind;
    }
  });
  const startBtn = overlay.querySelector("[data-action='start']");
  const pauseBtn = overlay.querySelector("[data-action='pause']");
  const resumeBtn = overlay.querySelector("[data-action='resume']");
  const stopBtn = overlay.querySelector("[data-action='stop']");
  if (overlaySnapshot.phase === "running") {
    if (startBtn) startBtn.style.display = "none";
    if (pauseBtn) pauseBtn.style.display = "";
    if (resumeBtn) resumeBtn.style.display = "none";
    if (stopBtn) stopBtn.style.display = "";
  } else if (overlaySnapshot.phase === "paused") {
    if (startBtn) startBtn.style.display = "none";
    if (pauseBtn) pauseBtn.style.display = "none";
    if (resumeBtn) resumeBtn.style.display = "";
    if (stopBtn) stopBtn.style.display = "";
  } else {
    if (startBtn) startBtn.style.display = "";
    if (pauseBtn) pauseBtn.style.display = "none";
    if (resumeBtn) resumeBtn.style.display = "none";
    if (stopBtn) stopBtn.style.display = "none";
  }
  if (startBtn) startBtn.disabled = !controls?.canStart;
  if (pauseBtn) pauseBtn.disabled = !controls?.canPause;
  if (resumeBtn) resumeBtn.disabled = !controls?.canResume;
  if (stopBtn) stopBtn.disabled = !controls?.canStop;
  overlay.classList.toggle("chatgpt-bridge-overlay--terminal", Boolean(overlaySnapshot.requiresTerminalClear));
  overlay.classList.toggle("chatgpt-bridge-overlay--collapsed", Boolean(overlaySettings?.collapsed));
  overlay.hidden = overlaySettings?.enabled === false;
  applyOverlayPosition(overlaySettings?.position ?? null);
  requireOverlayElement("[data-action='clear-terminal']").disabled = !controls?.canClearTerminal;
  requireOverlayElement("[data-action='toggle-collapse']").textContent = overlaySettings?.collapsed ? c.collapseExpand : c.collapseCollapse;
  requireOverlayElement("[data-bind-role='A']").disabled = !canChangeBindings;
  requireOverlayElement("[data-bind-role='B']").disabled = !canChangeBindings;
  const collapsedRole = overlay.querySelector("[data-slot='collapsed-role']");
  if (collapsedRole) {
    collapsedRole.textContent = overlaySnapshot.assignedRole ? `Bound as ${overlaySnapshot.assignedRole}` : c.roleUnbound;
  }
}
function applyOverlayPosition(position) {
  if (!position) {
    overlay.style.left = "";
    overlay.style.top = "";
    overlay.style.right = "16px";
    overlay.style.bottom = "16px";
    return;
  }
  overlay.style.right = "auto";
  overlay.style.bottom = "auto";
  overlay.style.left = `${position.x}px`;
  overlay.style.top = `${position.y}px`;
}
function initOverlayDrag() {
  const handle = requireOverlayElement('[data-drag-handle="true"]');
  let dragState = null;
  handle.addEventListener("pointerdown", (event) => {
    if (event.target?.closest?.("button")) {
      return;
    }
    const rect = overlay.getBoundingClientRect();
    dragState = {
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top
    };
    handle.setPointerCapture(event.pointerId);
  });
  handle.addEventListener("pointermove", (event) => {
    if (!dragState) {
      return;
    }
    const x = Math.max(
      0,
      Math.min(window.innerWidth - overlay.offsetWidth, event.clientX - dragState.offsetX)
    );
    const y = Math.max(
      0,
      Math.min(window.innerHeight - overlay.offsetHeight, event.clientY - dragState.offsetY)
    );
    applyOverlayPosition({ x, y });
  });
  const finishDrag = async (event) => {
    if (!dragState) {
      return;
    }
    const rect = overlay.getBoundingClientRect();
    dragState = null;
    try {
      handle.releasePointerCapture(event.pointerId);
    } catch (error) {
      console.warn("[bridge] pointer capture release failed", error);
    }
    await chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.SET_OVERLAY_POSITION,
      position: {
        x: rect.left,
        y: rect.top
      }
    });
  };
  handle.addEventListener("pointerup", (event) => {
    void finishDrag(event);
  });
  handle.addEventListener("pointercancel", (event) => {
    void finishDrag(event);
  });
}
function readAssistantSnapshot() {
  const latest = findLatestAssistantElement();
  if (!latest) {
    return {
      ok: false,
      error: "assistant_message_not_found"
    };
  }
  const text = normalizeText(latest.textContent || "");
  if (!text) {
    return {
      ok: false,
      error: "assistant_message_empty"
    };
  }
  return {
    ok: true,
    result: {
      text,
      hash: hashText(text)
    }
  };
}
function readThreadActivity() {
  const generating = isGenerationInProgressFromDoc();
  const latestUserHash = findLatestUserMessageHash();
  const composer = findBestComposer(document);
  const composerText = readComposerText(composer);
  const sendButton = composer ? findSendButton(document, composer) : null;
  const sendButtonReady = sendButton !== null && !sendButton.disabled;
  const latestAssistant = findLatestAssistantElement();
  const latestAssistantHash = latestAssistant ? hashText(normalizeText(latestAssistant.textContent || "")) : null;
  return {
    ok: true,
    result: {
      generating,
      latestAssistantHash,
      latestUserHash,
      composerText,
      sendButtonReady
    }
  };
}
async function sendRelayMessage(text) {
  try {
    const composer = findBestComposer(document);
    if (!composer) {
      return {
        ok: false,
        error: "composer_not_found"
      };
    }
    const submissionBaseline = captureSubmissionBaseline(text);
    const applyMode = applyComposerText(composer, text);
    const sendButton = await waitForSendButton({
      composer,
      root: document
    });
    const sendResult = triggerComposerSend({
      root: document,
      composer,
      sendButton
    });
    if (!sendResult.ok) {
      return {
        ok: false,
        mode: sendResult.mode,
        applyMode,
        acknowledgement: "none",
        error: sendResult.error ?? "send_trigger_failed"
      };
    }
    const acknowledgement = await waitForSubmissionAcknowledgement({
      baseline: {
        userHash: submissionBaseline.userHash,
        generating: submissionBaseline.generating
      },
      composer,
      expectedText: text
    });
    lastAckDebug = {
      ok: acknowledgement.ok,
      signal: acknowledgement.ok ? acknowledgement.signal : null,
      error: acknowledgement.ok ? null : "error" in acknowledgement ? acknowledgement.error : "send_not_acknowledged",
      timedOut: !acknowledgement.ok && acknowledgement.signal === "none",
      baseline: submissionBaseline,
      after: {
        latestUserHash: findLatestUserMessageHash(),
        composerText: readComposerText(composer),
        generating: isGenerationInProgressFromDoc()
      },
      timestamp: Date.now()
    };
    if (!acknowledgement.ok) {
      const acknowledgementError = "error" in acknowledgement ? acknowledgement.error : "send_not_acknowledged";
      return {
        ok: false,
        mode: sendResult.mode,
        applyMode,
        acknowledgement: acknowledgement.signal,
        error: acknowledgementError
      };
    }
    return {
      ok: true,
      mode: sendResult.mode,
      applyMode,
      acknowledgement: acknowledgement.signal,
      error: null
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "send_relay_message_failed"
    };
  }
}
function findLatestAssistantElement() {
  const selectors = [
    '[data-message-author-role="assistant"]',
    'article [data-message-author-role="assistant"]',
    '[data-testid*="conversation-turn"] [data-message-author-role="assistant"]',
    "main [data-message-author-role='assistant']"
  ];
  for (const selector of selectors) {
    const candidates = Array.from(document.querySelectorAll(selector)).filter(
      (element) => normalizeText(element.textContent || "")
    );
    if (candidates.length > 0) {
      return candidates[candidates.length - 1];
    }
  }
  return null;
}
function captureSubmissionBaseline(expectedText) {
  const composer = findBestComposer(document);
  const sendButton = composer ? findSendButton(document, composer) : null;
  const sendButtonReady = sendButton !== null && !sendButton.disabled;
  return {
    composerText: readComposerText(composer),
    generating: isGenerationInProgressFromDoc(),
    sendButtonReady,
    userHash: findLatestUserMessageHash(),
    expectedHash: hashText(expectedText)
  };
}
async function waitForSendButton({
  root,
  composer
}) {
  const button = findSendButton(root, composer);
  if (button) {
    return button;
  }
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      observer.disconnect();
      resolve(null);
    }, 5e3);
    const observer = new MutationObserver(() => {
      queueMicrotask(() => {
        const found = findSendButton(root, composer);
        if (found) {
          clearTimeout(timeout);
          observer.disconnect();
          resolve(found);
        }
      });
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["disabled", "aria-disabled", "style", "class"]
    });
  });
}
async function waitForSubmissionAcknowledgement({
  baseline,
  composer,
  expectedText
}) {
  const expectedHash = hashText(expectedText);
  const input = {
    baselineUserHash: baseline.userHash,
    baselineGenerating: baseline.generating,
    baselineSendButtonReady: baseline.sendButtonReady,
    composer,
    expectedHash,
    expectedText
  };
  const immediate = checkAckSignals(input);
  if (immediate) {
    return immediate;
  }
  const startTime = Date.now();
  const pollingInterval = 200;
  const maxPollingTime = 1e4;
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      observer.disconnect();
      pollingHandle && clearInterval(pollingHandle);
      resolve({ ok: false, error: "send_not_acknowledged", signal: "none" });
    }, maxPollingTime);
    const checkAndResolve = (result) => {
      if (result) {
        clearTimeout(timeout);
        observer.disconnect();
        pollingHandle && clearInterval(pollingHandle);
        resolve(result);
      }
    };
    const observer = new MutationObserver(() => {
      queueMicrotask(() => {
        checkAndResolve(checkAckSignals(input));
      });
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["aria-label", "disabled", "style", "class", "data-testid"]
    });
    let pollingHandle = null;
    if (typeof setInterval !== "undefined") {
      pollingHandle = setInterval(() => {
        if (Date.now() - startTime >= maxPollingTime) {
          pollingHandle && clearInterval(pollingHandle);
          return;
        }
        checkAndResolve(checkAckSignals(input));
      }, pollingInterval);
    }
  });
}
function requireOverlayElement(selector) {
  const element = overlay.querySelector(selector);
  if (!element) {
    throw new Error(`overlay_element_missing:${selector}`);
  }
  return element;
}
