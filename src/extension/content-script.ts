import {
  applyComposerText,
  findBestComposer,
  findSendButton,
  hashText,
  normalizeText,
  readComposerText,
  triggerComposerSend
} from "./content-helpers.ts";
import { MESSAGE_TYPES } from "./core/constants.ts";
import type {
  OverlayModel,
  PopupControls,
  RuntimeDisplay,
  RuntimeMessage,
  RuntimeResponse
} from "./shared/types.js";
import type { ChromePort } from "./shared/globals";

const overlay = createOverlay();
let keepAlivePort: ChromePort | null = connectKeepAlivePort();
const defaultControls: PopupControls = {
  canStart: false,
  canPause: false,
  canResume: false,
  canStop: false,
  canClearTerminal: false,
  canSetStarter: false,
  canSetOverride: false
};
const defaultDisplay: RuntimeDisplay = {
  nextHop: "A -> B",
  currentStep: "idle",
  lastActionAt: null,
  transport: null,
  selector: null,
  lastIssue: "None"
};
let overlaySnapshot: OverlayModel = {
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
    Promise.resolve(sendRelayMessage(message.text))
      .then(sendResponse)
      .catch((error: unknown) => {
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

  return undefined;
});

bindOverlayEvents();
renderOverlay();
void refreshOverlayModel();

function connectKeepAlivePort(): ChromePort {
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

function bindOverlayEvents(): void {
  requireOverlayElement<HTMLButtonElement>("[data-bind-role='A']").addEventListener("click", () => {
    void dispatchOverlayAction({
      type: MESSAGE_TYPES.SET_BINDING,
      role: "A"
    });
  });

  requireOverlayElement<HTMLButtonElement>("[data-bind-role='B']").addEventListener("click", () => {
    void dispatchOverlayAction({
      type: MESSAGE_TYPES.SET_BINDING,
      role: "B"
    });
  });

  requireOverlayElement<HTMLButtonElement>("[data-action='unbind']").addEventListener("click", () => {
    if (!overlaySnapshot.assignedRole) {
      return;
    }

    void dispatchOverlayAction({
      type: MESSAGE_TYPES.CLEAR_BINDING,
      role: overlaySnapshot.assignedRole
    });
  });

  requireOverlayElement<HTMLButtonElement>("[data-action='open-popup']").addEventListener("click", () => {
    void dispatchOverlayAction({
      type: MESSAGE_TYPES.REQUEST_OPEN_POPUP
    });
  });

  requireOverlayElement<HTMLButtonElement>("[data-action='toggle-collapse']").addEventListener("click", () => {
    void dispatchOverlayAction({
      type: MESSAGE_TYPES.SET_OVERLAY_COLLAPSED,
      collapsed: !overlaySnapshot.overlaySettings.collapsed
    });
  });

  requireOverlayElement<HTMLButtonElement>("[data-action='start']").addEventListener("click", () => {
    void dispatchOverlayAction({ type: MESSAGE_TYPES.START_SESSION });
  });
  requireOverlayElement<HTMLButtonElement>("[data-action='pause']").addEventListener("click", () => {
    void dispatchOverlayAction({ type: MESSAGE_TYPES.PAUSE_SESSION });
  });
  requireOverlayElement<HTMLButtonElement>("[data-action='resume']").addEventListener("click", () => {
    void dispatchOverlayAction({ type: MESSAGE_TYPES.RESUME_SESSION });
  });
  requireOverlayElement<HTMLButtonElement>("[data-action='stop']").addEventListener("click", () => {
    void dispatchOverlayAction({ type: MESSAGE_TYPES.STOP_SESSION });
  });
  requireOverlayElement<HTMLButtonElement>("[data-action='clear-terminal']").addEventListener("click", () => {
    void dispatchOverlayAction({ type: MESSAGE_TYPES.CLEAR_TERMINAL });
  });

  requireOverlayElement<HTMLSelectElement>("[data-role='starter']").addEventListener("change", (event) => {
    const target = event.target as HTMLSelectElement;
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

async function dispatchOverlayAction(message: RuntimeMessage): Promise<void> {
  try {
    await chrome.runtime.sendMessage(message);
  } finally {
    await refreshOverlayModel();
  }
}

async function refreshOverlayModel(): Promise<void> {
  try {
    const response = await chrome.runtime.sendMessage<RuntimeResponse<OverlayModel>>({
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

function createOverlay(): HTMLElement {
  const node = document.createElement("aside");
  node.className = "chatgpt-bridge-overlay";
  node.dataset.extensionId = chrome.runtime.id;
  node.innerHTML = `
      <div class="chatgpt-bridge-overlay__header" data-drag-handle="true">
        <div class="chatgpt-bridge-overlay__title">Bridge</div>
        <button type="button" class="chatgpt-bridge-overlay__collapse" data-action="toggle-collapse">−</button>
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

function renderOverlay(): void {
  const { controls, display, overlaySettings } = overlaySnapshot;
  const canChangeBindings = overlaySnapshot.phase !== "running" && overlaySnapshot.phase !== "paused";

  requireOverlayElement("[data-slot='role']").textContent = overlaySnapshot.assignedRole
    ? `Bound as ${overlaySnapshot.assignedRole}`
    : "Unbound";
  requireOverlayElement("[data-slot='phase']").textContent = overlaySnapshot.phase;
  requireOverlayElement("[data-slot='round']").textContent = String(overlaySnapshot.round);
  requireOverlayElement("[data-slot='next-hop']").textContent = overlaySnapshot.nextHop;
  requireOverlayElement("[data-slot='step']").textContent = `Step: ${display?.currentStep || "idle"}`;
  requireOverlayElement("[data-slot='issue']").textContent = `Issue: ${display?.lastIssue || "None"}`;
  requireOverlayElement<HTMLSelectElement>('[data-role="starter"]').value = overlaySnapshot.starter;
  overlay.classList.toggle("chatgpt-bridge-overlay--terminal", Boolean(overlaySnapshot.requiresTerminalClear));
  overlay.classList.toggle("chatgpt-bridge-overlay--collapsed", Boolean(overlaySettings?.collapsed));
  overlay.hidden = overlaySettings?.enabled === false;
  applyOverlayPosition(overlaySettings?.position ?? null);
  requireOverlayElement<HTMLButtonElement>("[data-bind-role='A']").disabled = !canChangeBindings;
  requireOverlayElement<HTMLButtonElement>("[data-bind-role='B']").disabled = !canChangeBindings;
  requireOverlayElement<HTMLButtonElement>("[data-action='unbind']").disabled =
    !overlaySnapshot.assignedRole || !canChangeBindings;
  requireOverlayElement<HTMLButtonElement>("[data-action='start']").disabled = !controls?.canStart;
  requireOverlayElement<HTMLButtonElement>("[data-action='pause']").disabled = !controls?.canPause;
  requireOverlayElement<HTMLButtonElement>("[data-action='resume']").disabled = !controls?.canResume;
  requireOverlayElement<HTMLButtonElement>("[data-action='stop']").disabled = !controls?.canStop;
  requireOverlayElement<HTMLButtonElement>("[data-action='clear-terminal']").disabled = !controls?.canClearTerminal;
  requireOverlayElement<HTMLButtonElement>(".chatgpt-bridge-overlay__collapse").textContent =
    overlaySettings?.collapsed ? "+" : "−";
}

function applyOverlayPosition(position: { x: number; y: number } | null): void {
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

function initOverlayDrag(): void {
  const handle = requireOverlayElement<HTMLElement>('[data-drag-handle="true"]');
  let dragState: { offsetX: number; offsetY: number } | null = null;

  handle.addEventListener("pointerdown", (event) => {
    if ((event.target as HTMLElement | null)?.closest?.("button")) {
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

  const finishDrag = async (event: PointerEvent): Promise<void> => {
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

function readAssistantSnapshot():
  | { ok: true; result: { text: string; hash: string } }
  | { ok: false; error: string } {
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

async function sendRelayMessage(text: string): Promise<{
  ok: boolean;
  mode?: string;
  applyMode?: string;
  acknowledgement?: string;
  error?: string | null;
}> {
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

function findLatestAssistantElement(): Element | null {
  const selectors = [
    '[data-message-author-role="assistant"]',
    'article [data-message-author-role="assistant"]',
    '[data-testid*="conversation-turn"] [data-message-author-role="assistant"]',
    "main [data-message-author-role='assistant']"
  ];

  for (const selector of selectors) {
    const candidates = Array.from(document.querySelectorAll(selector)).filter((element) =>
      normalizeText(element.textContent || "")
    );
    if (candidates.length > 0) {
      return candidates[candidates.length - 1];
    }
  }

  return null;
}

function captureSubmissionBaseline(expectedText: string): {
  composerText: string;
  generating: boolean;
  userHash: string | null;
  expectedHash: string;
} {
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
}: {
  root: ParentNode;
  composer: Element;
}): Promise<HTMLButtonElement | null> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < 5000) {
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
}: {
  baseline: { userHash: string | null };
  composer: Element;
  expectedText: string;
}): Promise<
  | { ok: true; signal: "user_message_added" | "generation_started" | "composer_cleared" }
  | { ok: false; error: "send_not_acknowledged"; signal: "none" }
> {
  const startedAt = Date.now();
  const expectedHash = hashText(expectedText);

  while (Date.now() - startedAt < 5000) {
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

function readLatestUserHash(): string | null {
  const latest = findLatestMessageElement("user");
  if (!latest) {
    return null;
  }

  const text = normalizeText(latest.textContent || "");
  return text ? hashText(text) : null;
}

function isGenerationInProgress(): boolean {
  return Boolean(
    document.querySelector('button[aria-label*="停止"]') ||
      document.querySelector('button[aria-label*="Stop"]')
  );
}

function findLatestMessageElement(role: "user" | "assistant"): Element | null {
  const selectors = [
    `[data-message-author-role="${role}"]`,
    `article [data-message-author-role="${role}"]`,
    `[data-testid*="conversation-turn"] [data-message-author-role="${role}"]`,
    `main [data-message-author-role='${role}']`
  ];

  for (const selector of selectors) {
    const candidates = Array.from(document.querySelectorAll(selector)).filter((element) =>
      normalizeText(element.textContent || "")
    );
    if (candidates.length > 0) {
      return candidates[candidates.length - 1];
    }
  }

  return null;
}

function sleep(durationMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}

function requireOverlayElement<T extends Element = Element>(selector: string): T {
  const element = overlay.querySelector(selector);
  if (!element) {
    throw new Error(`overlay_element_missing:${selector}`);
  }
  return element as T;
}
