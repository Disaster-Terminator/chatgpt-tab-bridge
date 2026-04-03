(function main() {
  const MESSAGE_TYPES = Object.freeze({
    GET_ASSISTANT_SNAPSHOT: "GET_ASSISTANT_SNAPSHOT",
    SEND_RELAY_MESSAGE: "SEND_RELAY_MESSAGE",
    SYNC_OVERLAY_STATE: "SYNC_OVERLAY_STATE",
    SET_BINDING: "SET_BINDING",
    CLEAR_BINDING: "CLEAR_BINDING",
    REQUEST_OPEN_POPUP: "REQUEST_OPEN_POPUP"
  });

  const overlay = createOverlay();
  let keepAlivePort = connectKeepAlivePort();
  let overlaySnapshot = {
    phase: "idle",
    round: 0,
    nextHop: "A -> B",
    assignedRole: null,
    requiresTerminalClear: false
  };

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === MESSAGE_TYPES.GET_ASSISTANT_SNAPSHOT) {
      sendResponse(readAssistantSnapshot());
      return true;
    }

    if (message?.type === MESSAGE_TYPES.SEND_RELAY_MESSAGE) {
      Promise.resolve(sendRelayMessage(message.text)).then(sendResponse);
      return true;
    }

    if (message?.type === MESSAGE_TYPES.SYNC_OVERLAY_STATE) {
      overlaySnapshot = {
        ...overlaySnapshot,
        ...message.snapshot
      };
      renderOverlay();
    }

    return undefined;
  });

  bindOverlayEvents();
  renderOverlay();

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
    }, 20000);

    port.onDisconnect.addListener(() => {
      clearInterval(intervalId);
      keepAlivePort = null;
      setTimeout(() => {
        keepAlivePort = connectKeepAlivePort();
      }, 1000);
    });

    return port;
  }

  function bindOverlayEvents() {
    overlay.querySelector("[data-bind-role='A']").addEventListener("click", () => {
      chrome.runtime.sendMessage({
        type: MESSAGE_TYPES.SET_BINDING,
        role: "A"
      });
    });

    overlay.querySelector("[data-bind-role='B']").addEventListener("click", () => {
      chrome.runtime.sendMessage({
        type: MESSAGE_TYPES.SET_BINDING,
        role: "B"
      });
    });

    overlay.querySelector("[data-action='unbind']").addEventListener("click", () => {
      if (!overlaySnapshot.assignedRole) {
        return;
      }

      chrome.runtime.sendMessage({
        type: MESSAGE_TYPES.CLEAR_BINDING,
        role: overlaySnapshot.assignedRole
      });
    });

    overlay.querySelector("[data-action='open-popup']").addEventListener("click", () => {
      chrome.runtime.sendMessage({
        type: MESSAGE_TYPES.REQUEST_OPEN_POPUP
      });
    });
  }

  function createOverlay() {
    const node = document.createElement("aside");
    node.className = "chatgpt-bridge-overlay";
    node.dataset.extensionId = chrome.runtime.id;
    node.innerHTML = `
      <div class="chatgpt-bridge-overlay__title">Bridge</div>
      <div class="chatgpt-bridge-overlay__meta" data-slot="role">Unbound</div>
      <div class="chatgpt-bridge-overlay__meta" data-slot="phase">idle</div>
      <div class="chatgpt-bridge-overlay__meta" data-slot="round">Round 0</div>
      <div class="chatgpt-bridge-overlay__meta" data-slot="next-hop">A -> B</div>
      <div class="chatgpt-bridge-overlay__actions">
        <button type="button" data-bind-role="A">Bind A</button>
        <button type="button" data-bind-role="B">Bind B</button>
        <button type="button" data-action="unbind">Unbind</button>
      </div>
      <button type="button" class="chatgpt-bridge-overlay__link" data-action="open-popup">Open popup</button>
    `;
    document.documentElement.appendChild(node);
    return node;
  }

  function renderOverlay() {
    const canChangeBindings =
      overlaySnapshot.phase !== "running" && overlaySnapshot.phase !== "paused";

    overlay.querySelector("[data-slot='role']").textContent = overlaySnapshot.assignedRole
      ? `Bound as ${overlaySnapshot.assignedRole}`
      : "Unbound";
    overlay.querySelector("[data-slot='phase']").textContent = `State: ${overlaySnapshot.phase}`;
    overlay.querySelector("[data-slot='round']").textContent = `Round ${overlaySnapshot.round}`;
    overlay.querySelector("[data-slot='next-hop']").textContent = overlaySnapshot.nextHop;
    overlay.classList.toggle(
      "chatgpt-bridge-overlay--terminal",
      Boolean(overlaySnapshot.requiresTerminalClear)
    );
    overlay.querySelector("[data-bind-role='A']").disabled = !canChangeBindings;
    overlay.querySelector("[data-bind-role='B']").disabled = !canChangeBindings;
    overlay.querySelector("[data-action='unbind']").disabled =
      !overlaySnapshot.assignedRole || !canChangeBindings;
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
        hash: hashText(text)
      }
    };
  }

  async function sendRelayMessage(text) {
    const composer = findComposer();
    if (!composer) {
      return {
        ok: false,
        error: "composer_not_found"
      };
    }

    fillComposer(composer, text);

    const sendButton = findSendButton(composer);
    if (sendButton) {
      sendButton.click();
      return {
        ok: true
      };
    }

    const dispatched = dispatchSendKey(composer);
    return {
      ok: dispatched
    };
  }

  function findLatestAssistantElement() {
    const selectors = [
      '[data-message-author-role="assistant"]',
      'article [data-message-author-role="assistant"]',
      '[data-testid*="conversation-turn"] [data-message-author-role="assistant"]',
      "main [data-message-author-role='assistant']"
    ];

    for (const selector of selectors) {
      const candidates = Array.from(document.querySelectorAll(selector)).filter((element) =>
        normalizeText(element.innerText || element.textContent || "")
      );
      if (candidates.length > 0) {
        return candidates[candidates.length - 1];
      }
    }

    return null;
  }

  function findComposer() {
    return (
      document.querySelector("textarea") ||
      document.querySelector('[contenteditable="true"][role="textbox"]') ||
      document.querySelector('[contenteditable="true"][data-testid*="composer"]')
    );
  }

  function fillComposer(composer, text) {
    const normalized = normalizeText(text);
    composer.focus();

    if (composer instanceof HTMLTextAreaElement || composer instanceof HTMLInputElement) {
      composer.value = normalized;
      composer.dispatchEvent(new InputEvent("input", { bubbles: true, data: normalized }));
      return;
    }

    composer.textContent = normalized;
    composer.dispatchEvent(new InputEvent("input", { bubbles: true, data: normalized }));
  }

  function findSendButton(composer) {
    return (
      composer.closest("form")?.querySelector('button[type="submit"]') ||
      document.querySelector('button[data-testid="send-button"]') ||
      document.querySelector('button[aria-label*="Send"]')
    );
  }

  function dispatchSendKey(composer) {
    const keydownEvent = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "Enter",
      code: "Enter"
    });
    const keyupEvent = new KeyboardEvent("keyup", {
      bubbles: true,
      cancelable: true,
      key: "Enter",
      code: "Enter"
    });
    const keydownAccepted = composer.dispatchEvent(keydownEvent);
    const keyupAccepted = composer.dispatchEvent(keyupEvent);
    return keydownAccepted || keyupAccepted;
  }

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
})();
