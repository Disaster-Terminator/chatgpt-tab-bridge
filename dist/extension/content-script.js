// content-script.js
(function main() {
  const contentHelpers = globalThis.ChatGptBridgeContent;
  const MESSAGE_TYPES = Object.freeze({
    GET_OVERLAY_MODEL: "GET_OVERLAY_MODEL",
    GET_ASSISTANT_SNAPSHOT: "GET_ASSISTANT_SNAPSHOT",
    SEND_RELAY_MESSAGE: "SEND_RELAY_MESSAGE",
    SYNC_OVERLAY_STATE: "SYNC_OVERLAY_STATE",
    SET_BINDING: "SET_BINDING",
    CLEAR_BINDING: "CLEAR_BINDING",
    SET_STARTER: "SET_STARTER",
    START_SESSION: "START_SESSION",
    PAUSE_SESSION: "PAUSE_SESSION",
    RESUME_SESSION: "RESUME_SESSION",
    STOP_SESSION: "STOP_SESSION",
    CLEAR_TERMINAL: "CLEAR_TERMINAL",
    SET_OVERLAY_COLLAPSED: "SET_OVERLAY_COLLAPSED",
    SET_OVERLAY_POSITION: "SET_OVERLAY_POSITION",
    REQUEST_OPEN_POPUP: "REQUEST_OPEN_POPUP"
  });
  const overlay = createOverlay();
  let keepAlivePort = connectKeepAlivePort();
  let overlaySnapshot = {
    phase: "idle",
    round: 0,
    nextHop: "A -> B",
    assignedRole: null,
    requiresTerminalClear: false,
    starter: "A",
    controls: {},
    display: {},
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
          error: error?.message ?? "assistant_snapshot_failed"
        });
      }
      return true;
    }
    if (message?.type === MESSAGE_TYPES.SEND_RELAY_MESSAGE) {
      Promise.resolve(sendRelayMessage(message.text)).then(sendResponse).catch((error) => {
        sendResponse({
          ok: false,
          error: error?.message ?? "send_relay_message_failed"
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
    overlay.querySelector("[data-bind-role='A']").addEventListener("click", () => {
      void dispatchOverlayAction({
        type: MESSAGE_TYPES.SET_BINDING,
        role: "A"
      });
    });
    overlay.querySelector("[data-bind-role='B']").addEventListener("click", () => {
      void dispatchOverlayAction({
        type: MESSAGE_TYPES.SET_BINDING,
        role: "B"
      });
    });
    overlay.querySelector("[data-action='unbind']").addEventListener("click", () => {
      if (!overlaySnapshot.assignedRole) {
        return;
      }
      void dispatchOverlayAction({
        type: MESSAGE_TYPES.CLEAR_BINDING,
        role: overlaySnapshot.assignedRole
      });
    });
    overlay.querySelector("[data-action='open-popup']").addEventListener("click", () => {
      void dispatchOverlayAction({
        type: MESSAGE_TYPES.REQUEST_OPEN_POPUP
      });
    });
    overlay.querySelector("[data-action='toggle-collapse']").addEventListener("click", () => {
      void dispatchOverlayAction({
        type: MESSAGE_TYPES.SET_OVERLAY_COLLAPSED,
        collapsed: !overlaySnapshot.overlaySettings.collapsed
      });
    });
    overlay.querySelector("[data-action='start']").addEventListener("click", () => {
      void dispatchOverlayAction({ type: MESSAGE_TYPES.START_SESSION });
    });
    overlay.querySelector("[data-action='pause']").addEventListener("click", () => {
      void dispatchOverlayAction({ type: MESSAGE_TYPES.PAUSE_SESSION });
    });
    overlay.querySelector("[data-action='resume']").addEventListener("click", () => {
      void dispatchOverlayAction({ type: MESSAGE_TYPES.RESUME_SESSION });
    });
    overlay.querySelector("[data-action='stop']").addEventListener("click", () => {
      void dispatchOverlayAction({ type: MESSAGE_TYPES.STOP_SESSION });
    });
    overlay.querySelector("[data-action='clear-terminal']").addEventListener("click", () => {
      void dispatchOverlayAction({ type: MESSAGE_TYPES.CLEAR_TERMINAL });
    });
    overlay.querySelector("[data-role='starter']").addEventListener("change", (event) => {
      void dispatchOverlayAction({
        type: MESSAGE_TYPES.SET_STARTER,
        role: event.target.value
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
      const model = response?.ok ? response.result : response;
      if (!model) {
        return;
      }
      overlaySnapshot = {
        ...overlaySnapshot,
        ...model
      };
      renderOverlay();
    } catch {
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
    overlay.querySelector("[data-slot='role']").textContent = overlaySnapshot.assignedRole ? `Bound as ${overlaySnapshot.assignedRole}` : "Unbound";
    overlay.querySelector("[data-slot='phase']").textContent = overlaySnapshot.phase;
    overlay.querySelector("[data-slot='round']").textContent = String(overlaySnapshot.round);
    overlay.querySelector("[data-slot='next-hop']").textContent = overlaySnapshot.nextHop;
    overlay.querySelector("[data-slot='step']").textContent = `Step: ${display?.currentStep || "idle"}`;
    overlay.querySelector("[data-slot='issue']").textContent = `Issue: ${display?.lastIssue || "None"}`;
    overlay.querySelector('[data-role="starter"]').value = overlaySnapshot.starter;
    overlay.classList.toggle(
      "chatgpt-bridge-overlay--terminal",
      Boolean(overlaySnapshot.requiresTerminalClear)
    );
    overlay.classList.toggle(
      "chatgpt-bridge-overlay--collapsed",
      Boolean(overlaySettings?.collapsed)
    );
    overlay.hidden = overlaySettings?.enabled === false;
    applyOverlayPosition(overlaySettings?.position ?? null);
    overlay.querySelector("[data-bind-role='A']").disabled = !canChangeBindings;
    overlay.querySelector("[data-bind-role='B']").disabled = !canChangeBindings;
    overlay.querySelector("[data-action='unbind']").disabled = !overlaySnapshot.assignedRole || !canChangeBindings;
    overlay.querySelector("[data-action='start']").disabled = !controls?.canStart;
    overlay.querySelector("[data-action='pause']").disabled = !controls?.canPause;
    overlay.querySelector("[data-action='resume']").disabled = !controls?.canResume;
    overlay.querySelector("[data-action='stop']").disabled = !controls?.canStop;
    overlay.querySelector("[data-action='clear-terminal']").disabled = !controls?.canClearTerminal;
    overlay.querySelector(".chatgpt-bridge-overlay__collapse").textContent = overlaySettings?.collapsed ? "+" : "\u2212";
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
    const handle = overlay.querySelector('[data-drag-handle="true"]');
    let dragState = null;
    handle.addEventListener("pointerdown", (event) => {
      if (event.target.closest("button")) {
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
      const x = Math.max(0, Math.min(window.innerWidth - overlay.offsetWidth, event.clientX - dragState.offsetX));
      const y = Math.max(0, Math.min(window.innerHeight - overlay.offsetHeight, event.clientY - dragState.offsetY));
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
      } catch {
      }
      chrome.runtime.sendMessage({
        type: MESSAGE_TYPES.SET_OVERLAY_POSITION,
        position: {
          x: rect.left,
          y: rect.top
        }
      });
    };
    handle.addEventListener("pointerup", finishDrag);
    handle.addEventListener("pointercancel", finishDrag);
  }
  function readAssistantSnapshot() {
    const latest = findLatestAssistantElement();
    if (!latest) {
      return {
        ok: false,
        error: "assistant_message_not_found"
      };
    }
    const text = normalizeText(latest.innerText || latest.textContent || "");
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
        hash: contentHelpers.hashText(text)
      }
    };
  }
  async function sendRelayMessage(text) {
    try {
      const composer = contentHelpers.findBestComposer(document);
      if (!composer) {
        return {
          ok: false,
          error: "composer_not_found"
        };
      }
      const submissionBaseline = captureSubmissionBaseline(text);
      const applyMode = contentHelpers.applyComposerText(composer, text);
      const sendButton = await waitForSendButton({
        composer,
        root: document
      });
      const sendResult = contentHelpers.triggerComposerSend({
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
      return {
        ok: sendResult.ok && acknowledgement.ok,
        mode: sendResult.mode,
        applyMode,
        acknowledgement: acknowledgement.signal,
        error: acknowledgement.ok ? null : acknowledgement.error
      };
    } catch (error) {
      return {
        ok: false,
        error: error?.message ?? "send_relay_message_failed"
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
        (element) => normalizeText(element.innerText || element.textContent || "")
      );
      if (candidates.length > 0) {
        return candidates[candidates.length - 1];
      }
    }
    return null;
  }
  function captureSubmissionBaseline(expectedText) {
    return {
      composerText: contentHelpers.readComposerText(contentHelpers.findBestComposer(document)),
      generating: isGenerationInProgress(),
      userHash: readLatestUserHash(),
      expectedHash: contentHelpers.hashText(expectedText)
    };
  }
  async function waitForSendButton({ root, composer }) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < 5e3) {
      const button = contentHelpers.findSendButton(root, composer);
      if (button) {
        return button;
      }
      await sleep(200);
    }
    return null;
  }
  async function waitForSubmissionAcknowledgement({ baseline, composer, expectedText }) {
    const startedAt = Date.now();
    const expectedHash = contentHelpers.hashText(expectedText);
    while (Date.now() - startedAt < 5e3) {
      const composerText = contentHelpers.readComposerText(composer);
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
    const text = normalizeText(latest.innerText || latest.textContent || "");
    return text ? contentHelpers.hashText(text) : null;
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
        (element) => normalizeText(element.innerText || element.textContent || "")
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
  function normalizeText(value) {
    return contentHelpers.normalizeText(value);
  }
})();
