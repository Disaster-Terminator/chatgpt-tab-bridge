import {
  applyComposerText,
  checkAckSignals,
  evaluateDispatchAcceptanceSignal,
  findBestComposer,
  findLatestUserMessageHash,
  findSendButton,
  hashText,
  isElementVisible,
  isGenerationInProgressFromDoc,
  isLatestUserAfterLatestAssistantFromDoc,
  isReplyGenerationInProgressFromDoc,
  normalizeText,
  readComposerText,
  stillContainsExpectedPayload,
  triggerComposerSend
} from "./content-helpers.ts";
import { APP_STATE_KEY, MESSAGE_TYPES, OVERLAY_SETTINGS_KEY } from "./core/constants.ts";
import { getOverlayCopy, formatPhase, formatRoleStatus, formatStarter, formatStepLine, formatIssueLine, type UiLocale } from "./copy/bridge-copy.ts";
import { readUiLocale, observeUiLocale } from "./ui/preferences.ts";
import type {
  RelayDispatchEvidence,
  RelayDispatchSignal,
  RelayMessageResponse,
  OverlayModel,
  PopupControls,
  RuntimeDisplay,
  RuntimeMessage,
  RuntimeResponse,
  ThreadActivityResponse,
   ExecutionReadiness,
   TargetObservationSample
} from "./shared/types.js";
import type { ChromePort } from "./shared/globals";

const overlay = createOverlay();
let keepAlivePort: ChromePort | null = connectKeepAlivePort();
let refreshTimerId: number | null = null;
const isChatGptPage = window.location.hostname === "chatgpt.com";
const defaultControls: PopupControls = {
  canStart: false,
  canPause: false,
  canResume: false,
  canStop: false,
  canClearTerminal: false,
  canSetStarter: false,
  canSetOverride: false,
  canSetSettings: false
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

  return undefined;
});

bindOverlayEvents();
renderOverlay();
void refreshOverlayModel();
startOverlayRefreshLoop();
observeRuntimeStorageChanges();

function connectKeepAlivePort(): ChromePort {
  const port = chrome.runtime.connect({
    name: "bridge-tab-keepalive"
  });

  port.onMessage.addListener((message) => {
    if (
      typeof message === "object" &&
      message !== null &&
      "type" in message &&
      (message as RuntimeMessage).type === MESSAGE_TYPES.SYNC_OVERLAY_STATE
    ) {
      overlaySnapshot = {
        ...overlaySnapshot,
        ...((message as { snapshot?: OverlayModel }).snapshot ?? {})
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

function startOverlayRefreshLoop(): void {
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

function observeRuntimeStorageChanges(): void {
  chrome.storage?.onChanged?.addListener((changes, areaName) => {
    const stateChanged = areaName === "session" && APP_STATE_KEY in changes;
    const settingsChanged = areaName === "local" && OVERLAY_SETTINGS_KEY in changes;

    if (stateChanged || settingsChanged) {
      void refreshOverlayModel();
    }
  });
}

function bindOverlayEvents(): void {
  requireOverlayElement<HTMLButtonElement>("[data-bind-role='A']").addEventListener("click", () => {
    const action = overlaySnapshot.assignedRole === "A"
      ? { type: MESSAGE_TYPES.CLEAR_BINDING, role: "A" as const }
      : { type: MESSAGE_TYPES.SET_BINDING, role: "A" as const, tabId: overlaySnapshot.currentTabId };
    void dispatchOverlayAction(action);
  });

  requireOverlayElement<HTMLButtonElement>("[data-bind-role='B']").addEventListener("click", () => {
    const action = overlaySnapshot.assignedRole === "B"
      ? { type: MESSAGE_TYPES.CLEAR_BINDING, role: "B" as const }
      : { type: MESSAGE_TYPES.SET_BINDING, role: "B" as const, tabId: overlaySnapshot.currentTabId };
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
    const response = await chrome.runtime.sendMessage(message);
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
  const isAmbient = !isChatGptPage;
  const hasIssue = Boolean(display?.lastIssue && display.lastIssue !== "None");
  const ambientVisible =
    overlaySnapshot.phase === "running" ||
    overlaySnapshot.phase === "paused" ||
    overlaySnapshot.phase === "stopped" ||
    overlaySnapshot.phase === "error" ||
    hasIssue;

  // Expose currentTabId as DOM signal for runner synchronization
  const overlayRoot = overlay as HTMLElement;
  overlayRoot.dataset.tabId = overlaySnapshot.currentTabId !== null ? String(overlaySnapshot.currentTabId) : "";

  setOverlaySlotText("role", formatRoleStatus(overlayLocale, overlaySnapshot.assignedRole));

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

  setOverlaySlotText("round", formatRoundProgress(overlaySnapshot));
  setOverlaySlotText("next-hop", overlaySnapshot.nextHop);
  setOverlaySlotText("step", display?.currentStep || c.idle);

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
    btn.disabled = !controls?.canSetStarter;
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
  overlay.classList.toggle("chatgpt-bridge-overlay--ambient", isAmbient);
  overlay.classList.toggle("chatgpt-bridge-overlay--collapsed", Boolean(overlaySettings?.collapsed) && !isAmbient);
  overlay.hidden = isAmbient
    ? overlaySettings?.ambientEnabled !== true || !ambientVisible
    : overlaySettings?.enabled === false;
  applyOverlayPosition(overlaySettings?.position ?? null);

  requireOverlayElement<HTMLButtonElement>("[data-action='clear-terminal']").disabled = !controls?.canClearTerminal;
  requireOverlayElement<HTMLButtonElement>("[data-action='toggle-collapse']").textContent =
    overlaySettings?.collapsed ? c.collapseExpand : c.collapseCollapse;

  requireOverlayElement<HTMLButtonElement>("[data-bind-role='A']").disabled = !canChangeBindings;
  requireOverlayElement<HTMLButtonElement>("[data-bind-role='B']").disabled = !canChangeBindings;

  const collapsedRole = overlay.querySelector("[data-slot='collapsed-role']");
  if (collapsedRole) {
    collapsedRole.textContent = formatRoleStatus(overlayLocale, overlaySnapshot.assignedRole);
  }
}

function formatRoundProgress(model: OverlayModel): string {
  return `${model.round} / ${model.maxRoundsEnabled ? model.maxRounds : "∞"}`;
}

function setOverlaySlotText(slot: string, text: string): void {
  overlay.querySelectorAll<HTMLElement>(`[data-slot='${slot}']`).forEach((node) => {
    node.textContent = text;
  });
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

function readThreadActivity(): ThreadActivityResponse {
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

function readTargetObservationSample(): { ok: true; result: TargetObservationSample } {
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
      page: {
        hidden: document.hidden,
        visibilityState: document.visibilityState,
        focused: document.hasFocus(),
        wasDiscarded: typeof (document as any).wasDiscarded === "boolean" ? (document as any).wasDiscarded : null,
        prerendering: typeof (document as any).prerendering === "boolean" ? (document as any).prerendering : null
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

function readLatestMessageFacts(role: "user" | "assistant"): TargetObservationSample["latestUser"] {
  const latestMessage = findLatestMessageElement(role);
  const text = latestMessage ? normalizeText(latestMessage.textContent || "") : null;

  return {
    present: text !== null,
    text,
    hash: text ? hashText(text) : null
  };
}

async function sendRelayMessage(text: string): Promise<{
  ok: boolean;
  mode?: string;
  applyMode?: string;
  dispatchAccepted?: boolean;
  dispatchSignal?: RelayDispatchSignal;
  dispatchEvidence?: RelayDispatchEvidence;
  dispatchErrorCode?: string;
  error?: string | null;
}> {
  try {
    const composer = findBestComposer(document);
    if (!composer) {
      const response: RelayMessageResponse = {
        ok: false,
        dispatchAccepted: false,
        dispatchSignal: "none",
        dispatchErrorCode: "dispatch_trigger_rejected",
        error: "composer_not_found"
      };
      recordAckDebug({
        outcome: "failed",
        reason: "composer_not_found",
        response
      });
      return {
        ...response
      };
    }

    const submissionBaseline = captureSubmissionBaseline(text);
    const applyMode = applyComposerText(composer, text);

    const composerTextBeforeTrigger = readComposerText(composer);
    const readbackValid = validateComposerReadback(composerTextBeforeTrigger, text);

    if (!readbackValid) {
      const failedEvidence: RelayDispatchEvidence = {
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

      const response: RelayMessageResponse = {
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
        response
      });

      return {
        ...response
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
      const failedEvidence: RelayDispatchEvidence = {
        baselineUserHash: submissionBaseline.userHash,
        currentUserHash: findLatestUserMessageHash(),
        baselineGenerating: submissionBaseline.generating,
        currentGenerating: isGenerationInProgressFromDoc(),
        baselineComposerPreview: submissionBaseline.composerText.slice(0, 120),
        preTriggerText: composerTextBeforeTrigger.slice(0, 120),
        postTriggerText: readComposerText(composer).slice(0, 120),
        latestUserPreview: latestUserTextResponse.ok
          ? latestUserTextResponse.text?.slice(0, 120) ?? null
          : null,
        textChanged: false,
        payloadReleased: false,
        buttonStateChanged: false,
        ackSignal: "none",
        attempts: 1
      };

      const response: RelayMessageResponse = {
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
        response
      });

      return {
        ...response
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
      const response: RelayMessageResponse = {
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
        response
      });

      return {
        ...response
      };
    }

    const response: RelayMessageResponse = {
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
    const response: RelayMessageResponse = {
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

interface SendButtonState {
  disabled: boolean;
  visible: boolean;
}

interface DispatchAcceptanceInput {
  composer: Element;
  text: string;
  baseline: ReturnType<typeof captureSubmissionBaseline>;
  preTriggerComposerText: string;
  sendButton: HTMLButtonElement | null;
  sendButtonBefore: SendButtonState | null;
}

interface DispatchAcceptanceResult {
  accepted: true;
  signal: "user_message_added" | "generation_started" | "trigger_consumed";
  evidence: RelayDispatchEvidence;
}

interface DispatchRejectedResult {
  accepted: false;
  signal: RelayDispatchSignal;
  evidence: RelayDispatchEvidence;
}

type DispatchAcceptanceOutcome = DispatchAcceptanceResult | DispatchRejectedResult;

function captureSendButtonState(sendButton: HTMLButtonElement | null): SendButtonState | null {
  if (!sendButton) {
    return null;
  }

  return {
    disabled: sendButton.disabled,
    visible: isElementVisible(sendButton)
  };
}

function hasButtonStateChanged(
  before: SendButtonState | null,
  after: SendButtonState | null
): boolean {
  if (!before || !after) {
    return false;
  }

  return before.disabled !== after.disabled || before.visible !== after.visible;
}

async function waitForDispatchAcceptance(input: DispatchAcceptanceInput): Promise<DispatchAcceptanceOutcome> {
  const timeoutMs = 5000;
  const pollIntervalMs = 150;
  const startedAt = Date.now();

  let attempts = 0;
  let lastSignal: RelayDispatchSignal = "none";

  let lastEvidence: RelayDispatchEvidence = {
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

function recordAckDebug(payload: Record<string, unknown>): void {
  lastAckDebug = {
    timestamp: new Date().toISOString(),
    ...payload
  };
}

function validateComposerReadback(composerText: string, expectedText: string): boolean {
  if (!composerText || !expectedText) {
    return false;
  }
  
  const normalizedComposer = normalizeText(composerText);
  const normalizedExpected = normalizeText(expectedText);
  
  if (normalizedComposer.includes(normalizedExpected)) {
    return true;
  }
  
  const expectedWords = normalizedExpected.split(/\s+/).filter(w => w.length > 0);
  const composerWords = normalizedComposer.split(/\s+/).filter(w => w.length > 0);
  
  if (expectedWords.length === 0) {
    return false;
  }
  
  let matchCount = 0;
  for (const word of expectedWords) {
    if (composerWords.some(cw => cw.includes(word) || word.includes(cw))) {
      matchCount++;
    }
  }
  
  const overlap = matchCount / expectedWords.length;
  return overlap >= 0.8;
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
  composerAvailable: boolean;
  userHash: string | null;
  latestUserText: string | null;
  expectedHash: string;
} {
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

function getLatestUserText(): { ok: true; text: string | null } | { ok: false; error: string } {
  return {
    ok: true,
    text: readTargetObservationSample().result.latestUser.text
  };
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
