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
  return hasGenerationControlButtonFromDoc();
}
function isReplyGenerationInProgressFromDoc(latestAssistantText) {
  if (hasTerminalBridgeDirective(latestAssistantText)) {
    return false;
  }
  return hasGenerationControlButtonFromDoc() || isLatestUserAfterLatestAssistantFromDoc();
}
function hasGenerationControlButtonFromDoc() {
  if (document.querySelector('button[data-testid="stop-button"]') || document.querySelector('button[data-testid="stop-generating-button"]')) {
    return true;
  }
  return Boolean(
    document.querySelector('button[aria-label*="\u505C\u6B62"]') || document.querySelector('button[aria-label*="Stop"]') || document.querySelector('button[aria-label*="Cancel"]')
  );
}
function hasTerminalBridgeDirective(value) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return false;
  }
  const lines = normalized.split("\n").map((line) => line.trim()).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (/^\[BRIDGE_STATE\]\s+(CONTINUE|FREEZE)$/i.test(lines[index] ?? "")) {
      return true;
    }
  }
  return false;
}
function isLatestUserAfterLatestAssistantFromDoc(root = document) {
  const latestUser = findLatestMessageElementFromRoot(root, "user");
  const latestAssistant = findLatestMessageElementFromRoot(root, "assistant");
  if (!latestUser) {
    return false;
  }
  if (!latestAssistant) {
    return true;
  }
  const position = latestAssistant.compareDocumentPosition?.(latestUser);
  if (typeof position !== "number") {
    return false;
  }
  const following = typeof Node !== "undefined" ? Node.DOCUMENT_POSITION_FOLLOWING : 4;
  return Boolean(position & following);
}
function findLatestMessageElementFromRoot(root, role) {
  const selectors = [
    `[data-message-author-role="${role}"]`,
    `article [data-message-author-role="${role}"]`,
    `[data-testid*="conversation-turn"] [data-message-author-role="${role}"]`,
    `main [data-message-author-role="${role}"]`
  ];
  const candidates = selectors.flatMap(
    (selector) => Array.from(root.querySelectorAll?.(selector) ?? [])
  );
  const uniqueCandidates = Array.from(new Set(candidates)).filter(
    (element) => normalizeText(element.textContent || "")
  );
  return uniqueCandidates[uniqueCandidates.length - 1] ?? null;
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
function evaluateDispatchAcceptanceSignal(input) {
  const { ack, baselineUserHash, currentUserHash, payloadReleased, textChanged, buttonStateChanged } = input;
  const hasUserThreadChange = currentUserHash !== null && currentUserHash !== baselineUserHash;
  const triggerConsumed = payloadReleased || textChanged || buttonStateChanged;
  if (ack?.ok && ack.signal === "user_message_added" && hasUserThreadChange) {
    return "user_message_added";
  }
  if (ack?.ok && ack.signal === "generation_started" && triggerConsumed) {
    return "generation_started";
  }
  if (triggerConsumed) {
    return "trigger_consumed";
  }
  return null;
}
function findLatestUserMessageText() {
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
      return text || null;
    }
  }
  return null;
}
function calculateTextOverlap(textA, textB) {
  const normalizedA = normalizeText(textA);
  const normalizedB = normalizeText(textB);
  if (!normalizedA || !normalizedB) {
    return 0;
  }
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
function containsBridgeEnvelopePrefix(text) {
  return text.includes("[BRIDGE_CONTEXT]") || text.includes("[\u6765\u81EA");
}
function extractHopMarker(text) {
  const match = normalizeText(text).match(/(?:^|\n)hop:\s*([^\s\n]+)/i);
  return match?.[1] ?? null;
}
function showsPayloadAdoption(latestText, expectedText) {
  const hopMarker = extractHopMarker(expectedText);
  if (hopMarker) {
    const latestLower = normalizeText(latestText).toLowerCase();
    return latestLower.includes(`[bridge_context]`) && latestLower.includes(`hop: ${hopMarker}`.toLowerCase());
  }
  if (containsBridgeEnvelopePrefix(latestText)) {
    return true;
  }
  const overlap = calculateTextOverlap(latestText, expectedText);
  if (overlap >= 0.5) {
    return true;
  }
  return false;
}
function checkAckSignals(input) {
  const { baselineGenerating, baselineUserHash, composer, expectedHash, expectedText } = input;
  const composerText = readComposerTextFromDoc(composer);
  const latestUserHash = findLatestUserMessageHash();
  const latestUserText = findLatestUserMessageText();
  const currentGenerating = isGenerationInProgressFromDoc();
  const composerCleared = isComposerTrulyCleared(composerText, expectedText);
  if (latestUserHash && latestUserHash !== baselineUserHash) {
    if (latestUserText && showsPayloadAdoption(latestUserText, expectedText)) {
      if (composerCleared) {
        return { ok: true, signal: "user_message_added", evidence: "strong_with_auxiliary" };
      }
      return { ok: true, signal: "user_message_added", evidence: "strong" };
    }
    if (latestUserHash === expectedHash) {
      if (composerCleared) {
        return { ok: true, signal: "user_message_added", evidence: "strong_with_auxiliary" };
      }
      return { ok: true, signal: "user_message_added", evidence: "strong" };
    }
  }
  if (!baselineGenerating && currentGenerating) {
    if (composerCleared) {
      return { ok: true, signal: "generation_started", evidence: "strong_with_auxiliary" };
    }
    return { ok: true, signal: "generation_started", evidence: "strong" };
  }
  if (composerCleared) {
    return { ok: true, signal: "composer_cleared", evidence: "auxiliary_only" };
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
    downloadDebug: "\u4E0B\u8F7D\u65E5\u5FD7",
    copied: "\u8C03\u8BD5\u5FEB\u7167\u5DF2\u590D\u5236",
    copiedDebugSnapshot: "\u5DF2\u590D\u5236\u8C03\u8BD5\u5FEB\u7167",
    downloadedDebugSnapshot: "\u5DF2\u4E0B\u8F7D\u8C03\u8BD5\u65E5\u5FD7",
    failedToCopyDebugSnapshot: "\u590D\u5236\u8C03\u8BD5\u5FEB\u7167\u5931\u8D25",
    failedToDownloadDebugSnapshot: "\u4E0B\u8F7D\u8C03\u8BD5\u65E5\u5FD7\u5931\u8D25",
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
    downloadDebug: "Download logs",
    copied: "Debug snapshot copied",
    copiedDebugSnapshot: "Copied debug snapshot",
    downloadedDebugSnapshot: "Downloaded debug log",
    failedToCopyDebugSnapshot: "Failed to copy debug snapshot",
    failedToDownloadDebugSnapshot: "Failed to download debug log",
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
var refreshTimerId = null;
var isChatGptPage = window.location.hostname === "chatgpt.com";
var defaultControls = {
  canStart: false,
  canPause: false,
  canResume: false,
  canStop: false,
  canClearTerminal: false,
  canSetStarter: false,
  canSetOverride: false,
  canSetSettings: false
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
  maxRoundsEnabled: true,
  maxRounds: 8,
  nextHop: "A -> B",
  assignedRole: null,
  requiresTerminalClear: false,
  starter: "A",
  controls: defaultControls,
  display: defaultDisplay,
  overlaySettings: {
    enabled: true,
    ambientEnabled: false,
    collapsed: false,
    position: null
  },
  readiness: {
    starterReady: true,
    preflightPending: false,
    blockReason: null,
    sourceRole: "A"
  },
  currentTabId: null
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
  if (message?.type === MESSAGE_TYPES.GET_LATEST_USER_TEXT) {
    try {
      sendResponse(getLatestUserText());
    } catch (error) {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : "get_latest_user_text_failed"
      });
    }
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
startOverlayRefreshLoop();
function connectKeepAlivePort() {
  const port = chrome.runtime.connect({
    name: "bridge-tab-keepalive"
  });
  port.onMessage.addListener((message) => {
    if (typeof message === "object" && message !== null && "type" in message && message.type === MESSAGE_TYPES.SYNC_OVERLAY_STATE) {
      overlaySnapshot = {
        ...overlaySnapshot,
        ...message.snapshot ?? {}
      };
      renderOverlay();
    }
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
function startOverlayRefreshLoop() {
  window.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      void refreshOverlayModel();
    }
  });
  window.addEventListener("focus", () => {
    void refreshOverlayModel();
  });
  refreshTimerId = window.setInterval(() => {
    void refreshOverlayModel();
  }, isChatGptPage ? 1500 : 2500);
}
function bindOverlayEvents() {
  requireOverlayElement("[data-bind-role='A']").addEventListener("click", () => {
    const action = overlaySnapshot.assignedRole === "A" ? { type: MESSAGE_TYPES.CLEAR_BINDING, role: "A" } : { type: MESSAGE_TYPES.SET_BINDING, role: "A", tabId: overlaySnapshot.currentTabId };
    void dispatchOverlayAction(action);
  });
  requireOverlayElement("[data-bind-role='B']").addEventListener("click", () => {
    const action = overlaySnapshot.assignedRole === "B" ? { type: MESSAGE_TYPES.CLEAR_BINDING, role: "B" } : { type: MESSAGE_TYPES.SET_BINDING, role: "B", tabId: overlaySnapshot.currentTabId };
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
    const response = await chrome.runtime.sendMessage(message);
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
  const isAmbient = !isChatGptPage;
  const hasIssue = Boolean(display?.lastIssue && display.lastIssue !== "None");
  const ambientVisible = overlaySnapshot.phase === "running" || overlaySnapshot.phase === "paused" || overlaySnapshot.phase === "stopped" || overlaySnapshot.phase === "error" || hasIssue;
  const overlayRoot = overlay;
  overlayRoot.dataset.tabId = overlaySnapshot.currentTabId !== null ? String(overlaySnapshot.currentTabId) : "";
  setOverlaySlotText("role", formatRoleStatus(overlayLocale, overlaySnapshot.assignedRole));
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
  setOverlaySlotText("round", formatRoundProgress(overlaySnapshot));
  setOverlaySlotText("next-hop", overlaySnapshot.nextHop);
  setOverlaySlotText("step", display?.currentStep || c.idle);
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
    btn.disabled = !controls?.canSetStarter;
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
  overlay.classList.toggle("chatgpt-bridge-overlay--ambient", isAmbient);
  overlay.classList.toggle("chatgpt-bridge-overlay--collapsed", Boolean(overlaySettings?.collapsed) && !isAmbient);
  overlay.hidden = isAmbient ? overlaySettings?.ambientEnabled !== true || !ambientVisible : overlaySettings?.enabled === false;
  applyOverlayPosition(isAmbient ? null : overlaySettings?.position ?? null);
  requireOverlayElement("[data-action='clear-terminal']").disabled = !controls?.canClearTerminal;
  requireOverlayElement("[data-action='toggle-collapse']").textContent = overlaySettings?.collapsed ? c.collapseExpand : c.collapseCollapse;
  requireOverlayElement("[data-bind-role='A']").disabled = !canChangeBindings;
  requireOverlayElement("[data-bind-role='B']").disabled = !canChangeBindings;
  const collapsedRole = overlay.querySelector("[data-slot='collapsed-role']");
  if (collapsedRole) {
    collapsedRole.textContent = formatRoleStatus(overlayLocale, overlaySnapshot.assignedRole);
  }
}
function formatRoundProgress(model) {
  return `${model.round} / ${model.maxRoundsEnabled ? model.maxRounds : "\u221E"}`;
}
function setOverlaySlotText(slot, text) {
  overlay.querySelectorAll(`[data-slot='${slot}']`).forEach((node) => {
    node.textContent = text;
  });
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
  const observation = readTargetObservationSample();
  const latestAssistant = observation.result.latestAssistant;
  if (!latestAssistant.present || !latestAssistant.text || !latestAssistant.hash) {
    return {
      ok: false,
      error: "assistant_message_not_found"
    };
  }
  return {
    ok: true,
    result: {
      text: latestAssistant.text,
      hash: latestAssistant.hash
    }
  };
}
function readThreadActivity() {
  const observation = readTargetObservationSample();
  const sample = observation.result;
  return {
    ok: true,
    result: {
      sample,
      generating: sample.generating,
      latestAssistantHash: sample.latestAssistant.hash,
      latestUserHash: sample.latestUser.hash,
      composerText: sample.composer.text,
      sendButtonReady: sample.composer.sendButtonReady,
      composerAvailable: sample.composer.available
    }
  };
}
function readTargetObservationSample() {
  const latestUser = readLatestMessageFacts("user");
  const latestAssistant = readLatestMessageFacts("assistant");
  const replyPending = isLatestUserAfterLatestAssistantFromDoc();
  const composer = findBestComposer(document);
  const sendButton = composer ? findSendButton(document, composer) : null;
  return {
    ok: true,
    result: {
      identity: {
        url: window.location.href,
        pathname: window.location.pathname,
        title: document.title
      },
      latestUser,
      latestAssistant,
      generating: isReplyGenerationInProgressFromDoc(latestAssistant.text),
      replyPending,
      composer: {
        available: composer !== null,
        text: readComposerText(composer),
        sendButtonReady: sendButton !== null && !sendButton.disabled
      }
    }
  };
}
function readLatestMessageFacts(role) {
  const latestMessage = findLatestMessageElement(role);
  const text = latestMessage ? normalizeText(latestMessage.textContent || "") : null;
  return {
    present: text !== null,
    text,
    hash: text ? hashText(text) : null
  };
}
async function sendRelayMessage(text) {
  try {
    const composer = findBestComposer(document);
    if (!composer) {
      const response2 = {
        ok: false,
        dispatchAccepted: false,
        dispatchSignal: "none",
        dispatchErrorCode: "dispatch_trigger_rejected",
        error: "composer_not_found"
      };
      recordAckDebug({
        outcome: "failed",
        reason: "composer_not_found",
        response: response2
      });
      return {
        ...response2
      };
    }
    const submissionBaseline = captureSubmissionBaseline(text);
    const applyMode = applyComposerText(composer, text);
    const composerTextBeforeTrigger = readComposerText(composer);
    const readbackValid = validateComposerReadback(composerTextBeforeTrigger, text);
    if (!readbackValid) {
      const failedEvidence = {
        baselineUserHash: submissionBaseline.userHash,
        currentUserHash: submissionBaseline.userHash,
        baselineGenerating: submissionBaseline.generating,
        currentGenerating: submissionBaseline.generating,
        baselineComposerPreview: submissionBaseline.composerText.slice(0, 120),
        preTriggerText: composerTextBeforeTrigger.slice(0, 120),
        postTriggerText: composerTextBeforeTrigger.slice(0, 120),
        latestUserPreview: submissionBaseline.latestUserText?.slice(0, 120) ?? null,
        textChanged: false,
        payloadReleased: false,
        buttonStateChanged: false,
        ackSignal: "none",
        attempts: 0
      };
      const response2 = {
        ok: false,
        applyMode,
        dispatchAccepted: false,
        dispatchSignal: "none",
        dispatchEvidence: failedEvidence,
        dispatchErrorCode: "payload_not_applied",
        error: "payload_not_applied"
      };
      recordAckDebug({
        outcome: "failed",
        reason: "payload_not_applied",
        baseline: submissionBaseline,
        response: response2
      });
      return {
        ...response2
      };
    }
    const sendButton = await waitForSendButton({
      composer,
      root: document
    });
    const sendButtonBefore = captureSendButtonState(sendButton);
    const sendResult = triggerComposerSend({
      root: document,
      composer,
      sendButton
    });
    if (!sendResult.ok) {
      const latestUserTextResponse = getLatestUserText();
      const failedEvidence = {
        baselineUserHash: submissionBaseline.userHash,
        currentUserHash: findLatestUserMessageHash(),
        baselineGenerating: submissionBaseline.generating,
        currentGenerating: isGenerationInProgressFromDoc(),
        baselineComposerPreview: submissionBaseline.composerText.slice(0, 120),
        preTriggerText: composerTextBeforeTrigger.slice(0, 120),
        postTriggerText: readComposerText(composer).slice(0, 120),
        latestUserPreview: latestUserTextResponse.ok ? latestUserTextResponse.text?.slice(0, 120) ?? null : null,
        textChanged: false,
        payloadReleased: false,
        buttonStateChanged: false,
        ackSignal: "none",
        attempts: 1
      };
      const response2 = {
        ok: false,
        mode: sendResult.mode,
        applyMode,
        dispatchAccepted: false,
        dispatchSignal: "none",
        dispatchEvidence: failedEvidence,
        dispatchErrorCode: "dispatch_trigger_rejected",
        error: sendResult.error ?? "dispatch_trigger_rejected"
      };
      recordAckDebug({
        outcome: "failed",
        reason: "dispatch_trigger_rejected",
        baseline: submissionBaseline,
        sendResult,
        response: response2
      });
      return {
        ...response2
      };
    }
    const dispatchProbe = await waitForDispatchAcceptance({
      composer,
      text,
      baseline: submissionBaseline,
      preTriggerComposerText: composerTextBeforeTrigger,
      sendButton,
      sendButtonBefore
    });
    if (!dispatchProbe.accepted) {
      const response2 = {
        ok: false,
        mode: sendResult.mode,
        applyMode,
        dispatchAccepted: false,
        dispatchSignal: dispatchProbe.signal,
        dispatchEvidence: dispatchProbe.evidence,
        dispatchErrorCode: "dispatch_evidence_weak",
        error: "dispatch_evidence_weak"
      };
      recordAckDebug({
        outcome: "failed",
        reason: "dispatch_evidence_weak",
        baseline: submissionBaseline,
        sendResult,
        response: response2
      });
      return {
        ...response2
      };
    }
    const response = {
      ok: true,
      mode: sendResult.mode,
      applyMode,
      dispatchAccepted: true,
      dispatchSignal: dispatchProbe.signal,
      dispatchEvidence: dispatchProbe.evidence,
      error: null
    };
    recordAckDebug({
      outcome: "accepted",
      baseline: submissionBaseline,
      sendResult,
      response
    });
    return {
      ...response
    };
  } catch (error) {
    const response = {
      ok: false,
      dispatchAccepted: false,
      dispatchSignal: "none",
      dispatchErrorCode: "dispatch_trigger_rejected",
      error: error instanceof Error ? error.message : "send_relay_message_failed"
    };
    recordAckDebug({
      outcome: "failed",
      reason: "send_relay_message_failed",
      response
    });
    return {
      ...response
    };
  }
}
function captureSendButtonState(sendButton) {
  if (!sendButton) {
    return null;
  }
  return {
    disabled: sendButton.disabled,
    visible: isElementVisible(sendButton)
  };
}
function hasButtonStateChanged(before, after) {
  if (!before || !after) {
    return false;
  }
  return before.disabled !== after.disabled || before.visible !== after.visible;
}
async function waitForDispatchAcceptance(input) {
  const timeoutMs = 5e3;
  const pollIntervalMs = 150;
  const startedAt = Date.now();
  let attempts = 0;
  let lastSignal = "none";
  let lastEvidence = {
    baselineUserHash: input.baseline.userHash,
    currentUserHash: input.baseline.userHash,
    baselineGenerating: input.baseline.generating,
    currentGenerating: input.baseline.generating,
    baselineComposerPreview: input.baseline.composerText.slice(0, 120),
    preTriggerText: input.preTriggerComposerText.slice(0, 120),
    postTriggerText: input.preTriggerComposerText.slice(0, 120),
    latestUserPreview: input.baseline.latestUserText?.slice(0, 120) ?? null,
    textChanged: false,
    payloadReleased: false,
    buttonStateChanged: false,
    ackSignal: "none",
    attempts
  };
  while (Date.now() - startedAt < timeoutMs) {
    attempts += 1;
    const currentUserHash = findLatestUserMessageHash();
    const latestUserTextResponse = getLatestUserText();
    const latestUserText = latestUserTextResponse.ok ? latestUserTextResponse.text : null;
    const currentGenerating = isGenerationInProgressFromDoc();
    const postTriggerComposerText = readComposerText(input.composer);
    const sendButtonAfter = captureSendButtonState(input.sendButton);
    const payloadReleased = !stillContainsExpectedPayload(postTriggerComposerText, input.text);
    const textChanged = postTriggerComposerText.length < input.preTriggerComposerText.length * 0.3;
    const buttonStateChanged = hasButtonStateChanged(input.sendButtonBefore, sendButtonAfter);
    const ack = checkAckSignals({
      baselineGenerating: input.baseline.generating,
      baselineUserHash: input.baseline.userHash,
      baselineSendButtonReady: input.baseline.sendButtonReady,
      composer: input.composer,
      expectedHash: input.baseline.expectedHash,
      expectedText: input.text
    });
    if (ack?.signal) {
      lastSignal = ack.signal;
    }
    const acceptedSignal = evaluateDispatchAcceptanceSignal({
      ack,
      baselineUserHash: input.baseline.userHash,
      currentUserHash,
      payloadReleased,
      textChanged,
      buttonStateChanged
    });
    if (acceptedSignal) {
      lastSignal = acceptedSignal;
    }
    lastEvidence = {
      baselineUserHash: input.baseline.userHash,
      currentUserHash,
      baselineGenerating: input.baseline.generating,
      currentGenerating,
      baselineComposerPreview: input.baseline.composerText.slice(0, 120),
      preTriggerText: input.preTriggerComposerText.slice(0, 120),
      postTriggerText: postTriggerComposerText.slice(0, 120),
      latestUserPreview: latestUserText?.slice(0, 120) ?? null,
      textChanged,
      payloadReleased,
      buttonStateChanged,
      ackSignal: acceptedSignal ?? ack?.signal ?? lastSignal,
      attempts
    };
    if (acceptedSignal) {
      return {
        accepted: true,
        signal: acceptedSignal,
        evidence: lastEvidence
      };
    }
    await sleep(pollIntervalMs);
  }
  return {
    accepted: false,
    signal: lastSignal,
    evidence: {
      ...lastEvidence,
      ackSignal: lastSignal,
      attempts
    }
  };
}
function recordAckDebug(payload) {
  lastAckDebug = {
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    ...payload
  };
}
function validateComposerReadback(composerText, expectedText) {
  if (!composerText || !expectedText) {
    return false;
  }
  const normalizedComposer = normalizeText(composerText);
  const normalizedExpected = normalizeText(expectedText);
  if (normalizedComposer.includes(normalizedExpected)) {
    return true;
  }
  const expectedWords = normalizedExpected.split(/\s+/).filter((w) => w.length > 0);
  const composerWords = normalizedComposer.split(/\s+/).filter((w) => w.length > 0);
  if (expectedWords.length === 0) {
    return false;
  }
  let matchCount = 0;
  for (const word of expectedWords) {
    if (composerWords.some((cw) => cw.includes(word) || word.includes(cw))) {
      matchCount++;
    }
  }
  const overlap = matchCount / expectedWords.length;
  return overlap >= 0.8;
}
function captureSubmissionBaseline(expectedText) {
  const composer = findBestComposer(document);
  const sendButton = composer ? findSendButton(document, composer) : null;
  const sendButtonReady = sendButton !== null && !sendButton.disabled;
  const composerAvailable = composer !== null;
  const latestUserTextResponse = getLatestUserText();
  return {
    composerText: readComposerText(composer),
    generating: isGenerationInProgressFromDoc(),
    sendButtonReady,
    composerAvailable,
    userHash: findLatestUserMessageHash(),
    latestUserText: latestUserTextResponse.ok ? latestUserTextResponse.text : null,
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
function getLatestUserText() {
  return {
    ok: true,
    text: readTargetObservationSample().result.latestUser.text
  };
}
function sleep(durationMs) {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}
function requireOverlayElement(selector) {
  const element = overlay.querySelector(selector);
  if (!element) {
    throw new Error(`overlay_element_missing:${selector}`);
  }
  return element;
}
