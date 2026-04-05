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
  BINDING_INVALID: "binding_invalid"
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
    unbind: "\u89E3\u7ED1",
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
    title: "\u63A7\u5236\u9762\u677F",
    sectionCurrentTab: "\u5F53\u524D\u6807\u7B7E\u9875",
    sectionBindings: "\u7ED1\u5B9A",
    sectionOverlay: "\u60AC\u6D6E\u7A97",
    sectionRunControls: "\u8FD0\u884C\u63A7\u5236",
    sectionFallback: "\u5907\u7528\u64CD\u4F5C",
    sectionDebug: "\u8C03\u8BD5",
    debugSummary: "\u8C03\u8BD5\u4FE1\u606F",
    labelStarter: "\u8D77\u59CB\u4FA7",
    labelOverride: "\u6682\u505C\u65F6\u4E0B\u4E00\u8DF3\u8986\u76D6",
    labelEnableOverlay: "\u542F\u7528\u60AC\u6D6E\u7A97",
    labelDefaultExpanded: "\u9ED8\u8BA4\u5C55\u5F00\u60AC\u6D6E\u7A97",
    bindA: "\u7ED1\u5B9A A",
    bindB: "\u7ED1\u5B9A B",
    unbind: "\u89E3\u7ED1",
    start: "\u5F00\u59CB",
    pause: "\u6682\u505C",
    resume: "\u6062\u590D",
    stop: "\u505C\u6B62",
    clearTerminal: "\u6E05\u7A7A\u7EC8\u7AEF",
    resetPosition: "\u91CD\u7F6E\u4F4D\u7F6E",
    copyDebug: "\u590D\u5236\u8C03\u8BD5\u5FEB\u7167",
    copied: "\u8C03\u8BD5\u5FEB\u7167\u5DF2\u590D\u5236",
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
    localeBilingual: "\u53CC\u8BED",
    helpText: "\u8986\u76D6\u4EC5\u5728\u6682\u505C\u65F6\u751F\u6548\uFF1B\u6E05\u7A7A\u7EC8\u7AEF\u53EF\u5C06\u5DF2\u505C\u6B62/\u9519\u8BEF\u72B6\u6001\u91CD\u7F6E\u4E3A\u5C31\u7EEA\u3002"
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
    unbind: "Unbind",
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
    title: "Popup control surface",
    sectionCurrentTab: "Current tab",
    sectionBindings: "Bindings",
    sectionOverlay: "Overlay",
    sectionRunControls: "Run controls",
    sectionFallback: "Fallback",
    sectionDebug: "Debug",
    debugSummary: "Debug info",
    labelStarter: "Starter side",
    labelOverride: "Paused next hop override",
    labelEnableOverlay: "Enable overlay",
    labelDefaultExpanded: "Default expanded overlay",
    bindA: "Bind A",
    bindB: "Bind B",
    unbind: "Unbind current tab",
    start: "Start",
    pause: "Pause",
    resume: "Resume",
    stop: "Stop",
    clearTerminal: "Clear terminal",
    resetPosition: "Reset position",
    copyDebug: "Copy debug snapshot",
    copied: "Debug snapshot copied",
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
    localeBilingual: "Bilingual",
    helpText: "Override only applies while paused; Clear returns stopped/error to ready."
  }
};
function toBilingual(zh, en2) {
  return `${zh} ${en2}`;
}
function getOverlayCopy(locale) {
  if (locale === "bilingual") {
    const z = zhCN.overlay;
    const e = en.overlay;
    return {
      bridgeTitle: toBilingual(z.bridgeTitle, e.bridgeTitle),
      phaseReady: toBilingual(z.phaseReady, e.phaseReady),
      phaseRunning: toBilingual(z.phaseRunning, e.phaseRunning),
      phasePaused: toBilingual(z.phasePaused, e.phasePaused),
      phaseStopped: toBilingual(z.phaseStopped, e.phaseStopped),
      phaseError: toBilingual(z.phaseError, e.phaseError),
      phaseIdle: toBilingual(z.phaseIdle, e.phaseIdle),
      roleUnbound: toBilingual(z.roleUnbound, e.roleUnbound),
      roleBoundA: toBilingual(z.roleBoundA, e.roleBoundA),
      roleBoundB: toBilingual(z.roleBoundB, e.roleBoundB),
      roundLabel: toBilingual(z.roundLabel, e.roundLabel),
      nextLabel: toBilingual(z.nextLabel, e.nextLabel),
      stepLabel: toBilingual(z.stepLabel, e.stepLabel),
      issueLabel: toBilingual(z.issueLabel, e.issueLabel),
      starterLabel: toBilingual(z.starterLabel, e.starterLabel),
      starterA: toBilingual(z.starterA, e.starterA),
      starterB: toBilingual(z.starterB, e.starterB),
      bindA: toBilingual(z.bindA, e.bindA),
      bindB: toBilingual(z.bindB, e.bindB),
      unbind: toBilingual(z.unbind, e.unbind),
      start: toBilingual(z.start, e.start),
      pause: toBilingual(z.pause, e.pause),
      resume: toBilingual(z.resume, e.resume),
      stop: toBilingual(z.stop, e.stop),
      clear: toBilingual(z.clear, e.clear),
      popup: toBilingual(z.popup, e.popup),
      collapseExpand: e.collapseExpand,
      collapseCollapse: e.collapseCollapse,
      none: toBilingual(z.none, e.none),
      idle: toBilingual(z.idle, e.idle)
    };
  }
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
function formatStarter(locale, role) {
  const c = getOverlayCopy(locale);
  return role === "A" ? c.starterA : c.starterB;
}
function formatStepLine(locale, step) {
  const c = getOverlayCopy(locale);
  const s = step || c.idle;
  return `${c.stepLabel}: ${s}`;
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
    if (raw === "zh-CN" || raw === "en" || raw === "bilingual") {
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
      if (value === "zh-CN" || value === "en" || value === "bilingual") {
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
    void dispatchOverlayAction({
      type: MESSAGE_TYPES.SET_BINDING,
      role: "A"
    });
  });
  requireOverlayElement("[data-bind-role='B']").addEventListener("click", () => {
    void dispatchOverlayAction({
      type: MESSAGE_TYPES.SET_BINDING,
      role: "B"
    });
  });
  requireOverlayElement("[data-action='unbind']").addEventListener("click", () => {
    if (!overlaySnapshot.assignedRole) {
      return;
    }
    void dispatchOverlayAction({
      type: MESSAGE_TYPES.CLEAR_BINDING,
      role: overlaySnapshot.assignedRole
    });
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
  requireOverlayElement("[data-action='start']").addEventListener("click", () => {
    void dispatchOverlayAction({ type: MESSAGE_TYPES.START_SESSION });
  });
  requireOverlayElement("[data-action='pause']").addEventListener("click", () => {
    void dispatchOverlayAction({ type: MESSAGE_TYPES.PAUSE_SESSION });
  });
  requireOverlayElement("[data-action='resume']").addEventListener("click", () => {
    void dispatchOverlayAction({ type: MESSAGE_TYPES.RESUME_SESSION });
  });
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
        <div class="chatgpt-bridge-overlay__title">${c.bridgeTitle}</div>
        <span class="chatgpt-bridge-overlay__phase-badge" data-slot="phase-badge" data-phase="idle">${c.phaseIdle}</span>
        <button type="button" class="chatgpt-bridge-overlay__collapse" data-action="toggle-collapse" aria-label="${c.collapseExpand}">${c.collapseCollapse}</button>
      </div>
      <div class="chatgpt-bridge-overlay__body">
      <div class="chatgpt-bridge-overlay__role-row">
        <div class="chatgpt-bridge-overlay__role" data-slot="role">${c.roleUnbound}</div>
      </div>
      <div class="chatgpt-bridge-overlay__stats">
        <div class="chatgpt-bridge-overlay__stat">
          <span>${c.roundLabel}</span>
          <strong data-slot="round">0</strong>
        </div>
        <div class="chatgpt-bridge-overlay__stat">
          <span>${c.nextLabel}</span>
          <strong data-slot="next-hop">A -> B</strong>
        </div>
      </div>
      <div class="chatgpt-bridge-overlay__step-band" data-slot="step-band">${c.stepLabel}: ${c.idle}</div>
      <div class="chatgpt-bridge-overlay__issue-row" data-slot="issue-row" hidden>
        <span data-slot="issue">${c.issueLabel}: ${c.none}</span>
      </div>
      <div class="chatgpt-bridge-overlay__starter-row" data-slot="starter-row">
        <span>${c.starterLabel}:</span>
        <strong data-slot="starter">${c.starterA}</strong>
      </div>
      <div class="chatgpt-bridge-overlay__actions chatgpt-bridge-overlay__actions--binding">
        <button type="button" data-bind-role="A">${c.bindA}</button>
        <button type="button" data-bind-role="B">${c.bindB}</button>
        <button type="button" data-action="unbind">${c.unbind}</button>
      </div>
      <div class="chatgpt-bridge-overlay__actions chatgpt-bridge-overlay__actions--session">
        <button type="button" data-action="start">${c.start}</button>
        <button type="button" data-action="pause">${c.pause}</button>
        <button type="button" data-action="resume">${c.resume}</button>
        <button type="button" data-action="stop">${c.stop}</button>
      </div>
      <div class="chatgpt-bridge-overlay__actions chatgpt-bridge-overlay__actions--aux">
        <button type="button" data-action="clear-terminal">${c.clear}</button>
        <button type="button" class="chatgpt-bridge-overlay__link" data-action="open-popup">${c.popup}</button>
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
  const phaseBadge = requireOverlayElement("[data-slot='phase-badge']");
  phaseBadge.textContent = formatPhase(overlayLocale, overlaySnapshot.phase);
  phaseBadge.dataset.phase = overlaySnapshot.phase;
  requireOverlayElement("[data-slot='round']").textContent = String(overlaySnapshot.round);
  requireOverlayElement("[data-slot='next-hop']").textContent = overlaySnapshot.nextHop;
  requireOverlayElement("[data-slot='step-band']").textContent = formatStepLine(overlayLocale, display?.currentStep);
  const issueRow = requireOverlayElement("[data-slot='issue-row']");
  const issueText = display?.lastIssue;
  if (!issueText || issueText === "None") {
    issueRow.hidden = true;
  } else {
    issueRow.hidden = false;
    requireOverlayElement("[data-slot='issue']").textContent = formatIssueLine(overlayLocale, issueText);
  }
  requireOverlayElement("[data-slot='starter']").textContent = formatStarter(overlayLocale, overlaySnapshot.starter);
  overlay.classList.toggle("chatgpt-bridge-overlay--terminal", Boolean(overlaySnapshot.requiresTerminalClear));
  overlay.classList.toggle("chatgpt-bridge-overlay--collapsed", Boolean(overlaySettings?.collapsed));
  overlay.hidden = overlaySettings?.enabled === false;
  applyOverlayPosition(overlaySettings?.position ?? null);
  requireOverlayElement("[data-bind-role='A']").disabled = !canChangeBindings;
  requireOverlayElement("[data-bind-role='B']").disabled = !canChangeBindings;
  requireOverlayElement("[data-action='unbind']").disabled = !overlaySnapshot.assignedRole || !canChangeBindings;
  requireOverlayElement("[data-action='start']").disabled = !controls?.canStart;
  requireOverlayElement("[data-action='pause']").disabled = !controls?.canPause;
  requireOverlayElement("[data-action='resume']").disabled = !controls?.canResume;
  requireOverlayElement("[data-action='stop']").disabled = !controls?.canStop;
  requireOverlayElement("[data-action='clear-terminal']").disabled = !controls?.canClearTerminal;
  requireOverlayElement(".chatgpt-bridge-overlay__collapse").textContent = overlaySettings?.collapsed ? c.collapseExpand : c.collapseCollapse;
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
      baseline: submissionBaseline,
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
        latestUserHash: readLatestUserHash(),
        composerText: readComposerText(composer),
        generating: isGenerationInProgress()
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
  return {
    composerText: readComposerText(findBestComposer(document)),
    generating: isGenerationInProgress(),
    userHash: readLatestUserHash(),
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
  const immediate = checkAckSignals(baseline, composer, expectedHash, expectedText);
  if (immediate) {
    return immediate;
  }
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      observer.disconnect();
      resolve({ ok: false, error: "send_not_acknowledged", signal: "none" });
    }, 1e4);
    const observer = new MutationObserver(() => {
      queueMicrotask(() => {
        const result = checkAckSignals(baseline, composer, expectedHash, expectedText);
        if (result) {
          clearTimeout(timeout);
          observer.disconnect();
          resolve(result);
        }
      });
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["aria-label", "disabled", "style", "class"]
    });
  });
}
function checkAckSignals(baseline, composer, expectedHash, expectedText) {
  const composerText = readComposerText(composer);
  const latestUserHash = readLatestUserHash();
  if (latestUserHash && latestUserHash !== baseline.userHash && latestUserHash === expectedHash) {
    return { ok: true, signal: "user_message_added" };
  }
  if (isGenerationInProgress() && composerText !== expectedText) {
    return { ok: true, signal: "generation_started" };
  }
  if (!composerText || composerText !== expectedText) {
    return { ok: true, signal: "composer_cleared" };
  }
  return null;
}
function readLatestUserHash() {
  const latest = findLatestMessageElement("user");
  if (!latest) {
    return null;
  }
  const text = normalizeText(latest.textContent || "");
  return text ? hashText(text) : null;
}
function isGenerationInProgress() {
  return Boolean(
    document.querySelector('button[aria-label*="\u505C\u6B62"]') || document.querySelector('button[aria-label*="Stop"]')
  );
}
function findLatestMessageElement(role) {
  const selectors = [
    `[data-message-author-role="${role}"]`,
    `article [data-message-author-role="${role}"]`,
    `[data-testid*="conversation-turn"] [data-message-author-role="${role}"]`,
    `main [data-message-author-role='${role}']`
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
function requireOverlayElement(selector) {
  const element = overlay.querySelector(selector);
  if (!element) {
    throw new Error(`overlay_element_missing:${selector}`);
  }
  return element;
}
