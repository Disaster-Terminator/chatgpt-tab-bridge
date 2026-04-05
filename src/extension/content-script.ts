import {
  applyComposerText,
  checkAckSignals,
  findBestComposer,
  findLatestUserMessageHash,
  findSendButton,
  hashText,
  isComposerTrulyCleared,
  isGenerationInProgressFromDoc,
  normalizeText,
  readComposerText,
  triggerComposerSend,
  type AckSignal,
  type CheckAckSignalsResult
} from "./content-helpers.ts";
import { MESSAGE_TYPES } from "./core/constants.ts";
import { getOverlayCopy, formatPhase, formatRoleStatus, formatStarter, formatStepLine, formatIssueLine, type UiLocale } from "./copy/bridge-copy.ts";
import { readUiLocale, observeUiLocale } from "./ui/preferences.ts";
import type {
  OverlayModel,
  PopupControls,
  RuntimeDisplay,
  RuntimeMessage,
  RuntimeResponse,
  ThreadActivityResponse,
  ExecutionReadiness
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
  },
  readiness: {
    starterReady: true,
    preflightPending: false,
    blockReason: null,
    sourceRole: "A"
  }
};

let lastAckDebug: any = null;

let overlayLocale: UiLocale = readUiLocale();
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
    const action = overlaySnapshot.assignedRole === "A"
      ? { type: MESSAGE_TYPES.CLEAR_BINDING, role: "A" as const }
      : { type: MESSAGE_TYPES.SET_BINDING, role: "A" as const, tabId: void 0 };
    void dispatchOverlayAction(action);
  });

  requireOverlayElement<HTMLButtonElement>("[data-bind-role='B']").addEventListener("click", () => {
    const action = overlaySnapshot.assignedRole === "B"
      ? { type: MESSAGE_TYPES.CLEAR_BINDING, role: "B" as const }
      : { type: MESSAGE_TYPES.SET_BINDING, role: "B" as const, tabId: void 0 };
    void dispatchOverlayAction(action);
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

  overlay.querySelectorAll<HTMLButtonElement>("[data-starter]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const starter = btn.dataset.starter as "A" | "B";
      if (starter && starter !== overlaySnapshot.starter) {
        void dispatchOverlayAction({
          type: MESSAGE_TYPES.SET_STARTER,
          role: starter
        });
      }
    });
  });

  requireOverlayElement<HTMLButtonElement>("[data-action='start']").addEventListener("click", () => {
    void dispatchOverlayAction({ type: MESSAGE_TYPES.START_SESSION });
  });
  
  const pauseBtn = overlay.querySelector<HTMLButtonElement>("[data-action='pause']");
  if (pauseBtn) {
    pauseBtn.addEventListener("click", () => {
      void dispatchOverlayAction({ type: MESSAGE_TYPES.PAUSE_SESSION });
    });
  }
  
  const resumeBtn = overlay.querySelector<HTMLButtonElement>("[data-action='resume']");
  if (resumeBtn) {
    resumeBtn.addEventListener("click", () => {
      void dispatchOverlayAction({ type: MESSAGE_TYPES.RESUME_SESSION });
    });
  }
  
  requireOverlayElement<HTMLButtonElement>("[data-action='stop']").addEventListener("click", () => {
    void dispatchOverlayAction({ type: MESSAGE_TYPES.STOP_SESSION });
  });
  requireOverlayElement<HTMLButtonElement>("[data-action='clear-terminal']").addEventListener("click", () => {
    void dispatchOverlayAction({ type: MESSAGE_TYPES.CLEAR_TERMINAL });
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
      <span data-slot="collapsed-info">R<span data-slot="round">0</span> · <span data-slot="next-hop">A → B</span></span>
    </div>
    <div class="chatgpt-bridge-overlay__body">
      <div class="chatgpt-bridge-overlay__status-panel">
        <div class="chatgpt-bridge-overlay__round-next">
          <span>${c.roundLabel}</span>
          <span class="chatgpt-bridge-overlay__value" data-slot="round">0</span>
          <span class="chatgpt-bridge-overlay__dot"></span>
          <span>${c.nextLabel}</span>
          <span class="chatgpt-bridge-overlay__value" data-slot="next-hop">A → B</span>
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

function renderOverlay(): void {
  const c = getOverlayCopy(overlayLocale);
  const { controls, display, overlaySettings } = overlaySnapshot;
  const canChangeBindings = overlaySnapshot.phase !== "running" && overlaySnapshot.phase !== "paused";

  requireOverlayElement("[data-slot='role']").textContent = formatRoleStatus(overlayLocale, overlaySnapshot.assignedRole);

  const roleDot = requireOverlayElement<HTMLElement>("[data-slot='role-dot']");
  if (overlaySnapshot.assignedRole) {
    roleDot.dataset.role = overlaySnapshot.assignedRole;
    roleDot.style.background = "rgba(201, 179, 122, 0.7)";
  } else {
    delete roleDot.dataset.role;
    roleDot.style.background = "";
  }

  const phaseBadge = requireOverlayElement<HTMLElement>("[data-slot='phase-badge']");
  phaseBadge.textContent = formatPhase(overlayLocale, overlaySnapshot.phase);
  phaseBadge.dataset.phase = overlaySnapshot.phase;

  requireOverlayElement("[data-slot='round']").textContent = String(overlaySnapshot.round);
  requireOverlayElement("[data-slot='next-hop']").textContent = overlaySnapshot.nextHop;
  requireOverlayElement("[data-slot='step']").textContent = display?.currentStep || c.idle;

  const issueRow = requireOverlayElement<HTMLElement>("[data-slot='issue-row']");
  const issueText = display?.lastIssue;
  if (!issueText || issueText === "None") {
    issueRow.hidden = true;
  } else {
    issueRow.hidden = false;
    requireOverlayElement("[data-slot='issue']").textContent = formatIssueLine(overlayLocale, issueText);
  }

  const starterBtns = overlay.querySelectorAll<HTMLButtonElement>("[data-starter]");
  starterBtns.forEach((btn) => {
    const isActive = btn.dataset.starter === overlaySnapshot.starter;
    btn.dataset.active = String(isActive);
  });

  const slider = requireOverlayElement<HTMLElement>(".chatgpt-bridge-overlay__starter-slider");
  slider.dataset.pos = overlaySnapshot.starter;

  const bindingBtns = overlay.querySelectorAll<HTMLButtonElement>("[data-bind-role]");
  bindingBtns.forEach((btn) => {
    const role = btn.dataset.bindRole as "A" | "B";
    const isActive = overlaySnapshot.assignedRole === role;
    btn.dataset.active = String(isActive);
    const statusEl = btn.querySelector(".chatgpt-bridge-overlay__binding-status");
    if (statusEl) {
      statusEl.textContent = isActive
        ? (role === "A" ? c.roleBoundA : c.roleBoundB)
        : c.unbind;
    }
  });

  const startBtn = overlay.querySelector<HTMLButtonElement>("[data-action='start']");
  const pauseBtn = overlay.querySelector<HTMLButtonElement>("[data-action='pause']");
  const resumeBtn = overlay.querySelector<HTMLButtonElement>("[data-action='resume']");
  const stopBtn = overlay.querySelector<HTMLButtonElement>("[data-action='stop']");

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

  requireOverlayElement<HTMLButtonElement>("[data-action='clear-terminal']").disabled = !controls?.canClearTerminal;
  requireOverlayElement<HTMLButtonElement>("[data-action='toggle-collapse']").textContent =
    overlaySettings?.collapsed ? c.collapseExpand : c.collapseCollapse;

  requireOverlayElement<HTMLButtonElement>("[data-bind-role='A']").disabled = !canChangeBindings;
  requireOverlayElement<HTMLButtonElement>("[data-bind-role='B']").disabled = !canChangeBindings;

  const collapsedRole = overlay.querySelector("[data-slot='collapsed-role']");
  if (collapsedRole) {
    collapsedRole.textContent = overlaySnapshot.assignedRole ? `Bound as ${overlaySnapshot.assignedRole}` : c.roleUnbound;
  }
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

function readThreadActivity():
  | { ok: true; result: { generating: boolean; latestAssistantHash: string | null; latestUserHash: string | null; composerText: string; sendButtonReady: boolean } }
  | { ok: false; error: string } {
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
       baseline: {
         userHash: submissionBaseline.userHash,
         generating: submissionBaseline.generating
       },
       composer,
       expectedText: text
     });

     // Capture debug information about the last acknowledgement
      lastAckDebug = {
        ok: acknowledgement.ok,
        signal: acknowledgement.ok ? acknowledgement.signal : null,
        evidence: acknowledgement.ok && "evidence" in acknowledgement ? acknowledgement.evidence : null,
        error: acknowledgement.ok ? null : ("error" in acknowledgement ? acknowledgement.error : "send_not_acknowledged"),
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
  sendButtonReady: boolean;
  userHash: string | null;
  expectedHash: string;
} {
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
}: {
  root: ParentNode;
  composer: Element;
}): Promise<HTMLButtonElement | null> {
  // Immediate check first
  const button = findSendButton(root, composer);
  if (button) {
    return button;
  }

  // Use MutationObserver to react to DOM changes (not throttled in background tabs)
  return new Promise<HTMLButtonElement | null>((resolve) => {
    const timeout = setTimeout(() => {
      observer.disconnect();
      resolve(null);
    }, 5000);

    const observer = new MutationObserver(() => {
      // Defer heavy check to next microtask to avoid blocking
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
}: {
  baseline: { userHash: string | null; generating: boolean; sendButtonReady: boolean };
  composer: Element;
  expectedText: string;
  postClickTimestamp?: number;
}): Promise<
  | { ok: true; signal: AckSignal; evidence: "strong" | "strong_with_auxiliary" }
  | { ok: false; error: "send_not_acknowledged"; signal: "none" }
> {
  const expectedHash = hashText(expectedText);
  const postClickTimestamp = Date.now();

  const input = {
    baselineUserHash: baseline.userHash,
    baselineGenerating: baseline.generating,
    baselineSendButtonReady: baseline.sendButtonReady,
    composer,
    expectedHash,
    expectedText,
    postClickTimestamp
  };

  const immediate = checkAckSignals(input);
  if (immediate && immediate.evidence !== "auxiliary_only") {
    return immediate as { ok: true; signal: AckSignal; evidence: "strong" | "strong_with_auxiliary" };
  }

  const startTime = Date.now();
  const pollingInterval = 200;
  const maxPollingTime = 10000;

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      observer.disconnect();
      pollingHandle && clearInterval(pollingHandle);
      resolve({ ok: false, error: "send_not_acknowledged", signal: "none" });
    }, maxPollingTime);

    const checkAndResolve = (result: CheckAckSignalsResult) => {
      if (result && result.evidence !== "auxiliary_only") {
        clearTimeout(timeout);
        observer.disconnect();
        pollingHandle && clearInterval(pollingHandle);
        resolve(result as { ok: true; signal: AckSignal; evidence: "strong" | "strong_with_auxiliary" });
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

    let pollingHandle: ReturnType<typeof setInterval> | null = null;
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