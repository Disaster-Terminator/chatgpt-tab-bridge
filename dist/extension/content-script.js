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
  requireOverlayElement("[data-role='starter']").addEventListener("change", (event) => {
    const target = event.target;
    if (target.value !== "A" && target.value !== "B") {
      return;
    }
    void dispatchOverlayAction({
      type: MESSAGE_TYPES.SET_STARTER,
      role: target.value
    });
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
  const node = document.createElement("aside");
  node.className = "chatgpt-bridge-overlay";
  node.dataset.extensionId = chrome.runtime.id;
  node.innerHTML = `
      <div class="chatgpt-bridge-overlay__header" data-drag-handle="true">
        <div class="chatgpt-bridge-overlay__title">Bridge</div>
        <button type="button" class="chatgpt-bridge-overlay__collapse" data-action="toggle-collapse">\u2212</button>
      </div>
      <div class="chatgpt-bridge-overlay__body">
      <div class="chatgpt-bridge-overlay__hero">
        <div class="chatgpt-bridge-overlay__role" data-slot="role">Unbound</div>
        <div class="chatgpt-bridge-overlay__phase" data-slot="phase">idle</div>
      </div>
      <div class="chatgpt-bridge-overlay__stats">
        <div class="chatgpt-bridge-overlay__stat">
          <span>Round</span>
          <strong data-slot="round">0</strong>
        </div>
        <div class="chatgpt-bridge-overlay__stat">
          <span>Next</span>
          <strong data-slot="next-hop">A -> B</strong>
        </div>
      </div>
      <div class="chatgpt-bridge-overlay__debug">
        <div class="chatgpt-bridge-overlay__meta" data-slot="step">Step: idle</div>
        <div class="chatgpt-bridge-overlay__meta" data-slot="issue">Issue: None</div>
      </div>
      <label class="chatgpt-bridge-overlay__label">Starter
        <select data-role="starter">
          <option value="A">A starts</option>
          <option value="B">B starts</option>
        </select>
      </label>
      <div class="chatgpt-bridge-overlay__actions">
        <button type="button" data-bind-role="A">Bind A</button>
        <button type="button" data-bind-role="B">Bind B</button>
        <button type="button" data-action="unbind">Unbind</button>
      </div>
      <div class="chatgpt-bridge-overlay__actions">
        <button type="button" data-action="start">Start</button>
        <button type="button" data-action="pause">Pause</button>
        <button type="button" data-action="resume">Resume</button>
      </div>
      <div class="chatgpt-bridge-overlay__actions">
        <button type="button" data-action="stop">Stop</button>
        <button type="button" data-action="clear-terminal">Clear</button>
      </div>
      <button type="button" class="chatgpt-bridge-overlay__link" data-action="open-popup">Open popup</button>
      </div>
    `;
  document.documentElement.appendChild(node);
  return node;
}
function renderOverlay() {
  const { controls, display, overlaySettings } = overlaySnapshot;
  const canChangeBindings = overlaySnapshot.phase !== "running" && overlaySnapshot.phase !== "paused";
  requireOverlayElement("[data-slot='role']").textContent = overlaySnapshot.assignedRole ? `Bound as ${overlaySnapshot.assignedRole}` : "Unbound";
  requireOverlayElement("[data-slot='phase']").textContent = overlaySnapshot.phase;
  requireOverlayElement("[data-slot='round']").textContent = String(overlaySnapshot.round);
  requireOverlayElement("[data-slot='next-hop']").textContent = overlaySnapshot.nextHop;
  requireOverlayElement("[data-slot='step']").textContent = `Step: ${display?.currentStep || "idle"}`;
  requireOverlayElement("[data-slot='issue']").textContent = `Issue: ${display?.lastIssue || "None"}`;
  requireOverlayElement('[data-role="starter"]').value = overlaySnapshot.starter;
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
  requireOverlayElement(".chatgpt-bridge-overlay__collapse").textContent = overlaySettings?.collapsed ? "+" : "\u2212";
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
  const startedAt = Date.now();
  while (Date.now() - startedAt < 5e3) {
    const button = findSendButton(root, composer);
    if (button) {
      return button;
    }
    await sleep(200);
  }
  return null;
}
async function waitForSubmissionAcknowledgement({
  baseline,
  composer,
  expectedText
}) {
  const startedAt = Date.now();
  const expectedHash = hashText(expectedText);
  while (Date.now() - startedAt < 5e3) {
    const composerText = readComposerText(composer);
    const latestUserHash = readLatestUserHash();
    if (latestUserHash && latestUserHash !== baseline.userHash && latestUserHash === expectedHash) {
      return {
        ok: true,
        signal: "user_message_added"
      };
    }
    if (isGenerationInProgress() && composerText !== expectedText) {
      return {
        ok: true,
        signal: "generation_started"
      };
    }
    if (!composerText || composerText !== expectedText) {
      return {
        ok: true,
        signal: "composer_cleared"
      };
    }
    await sleep(250);
  }
  return {
    ok: false,
    error: "send_not_acknowledged",
    signal: "none"
  };
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
