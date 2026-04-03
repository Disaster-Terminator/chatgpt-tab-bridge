(function main() {
  const contentHelpers = globalThis.ChatGptBridgeContent;
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
      Promise.resolve(sendRelayMessage(message.text))
        .then(sendResponse)
        .catch((error) => {
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
      const candidates = Array.from(document.querySelectorAll(selector)).filter((element) =>
        normalizeText(element.innerText || element.textContent || "")
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

    while (Date.now() - startedAt < 5000) {
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

    while (Date.now() - startedAt < 5000) {
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
      document.querySelector('button[aria-label*="停止"]') ||
        document.querySelector('button[aria-label*="Stop"]')
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
      const candidates = Array.from(document.querySelectorAll(selector)).filter((element) =>
        normalizeText(element.innerText || element.textContent || "")
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
