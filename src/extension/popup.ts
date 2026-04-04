import { MESSAGE_TYPES } from "./core/constants.ts";
import { getPopupCopy, applyStaticCopy, formatPhase, type UiLocale } from "./copy/bridge-copy.ts";
import { readUiLocale, writeUiLocale } from "./ui/preferences.ts";
import type {
  BridgeRole,
  ClearBindingMessage,
  GetPopupModelMessage,
  OverlaySettings,
  PauseSessionMessage,
  PopupModel,
  ResetOverlayPositionMessage,
  ResumeSessionMessage,
  RuntimeResponse,
  RuntimeState,
  SetBindingMessage,
  SetNextHopOverrideMessage,
  SetOverlayEnabledMessage,
  SetOverlayCollapsedMessage,
  SetStarterMessage,
  StartSessionMessage,
  StopSessionMessage,
  ClearTerminalMessage
} from "./shared/types.js";

const REFRESH_INTERVAL_MS = 1000;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Operation timed out")), timeoutMs)
    )
  ]);
}

interface PopupElements {
  phaseBadge: HTMLElement;
  currentTabStatus: HTMLElement;
  bindAButton: HTMLButtonElement;
  bindBButton: HTMLButtonElement;
  unbindCurrentButton: HTMLButtonElement;
  bindingA: HTMLElement;
  bindingB: HTMLElement;
  localeSelect: HTMLSelectElement;
  overlayEnabledCheckbox: HTMLInputElement;
  defaultExpandedCheckbox: HTMLInputElement;
  resetOverlayPositionButton: HTMLButtonElement;
  starterSelect: HTMLSelectElement;
  overrideSelect: HTMLSelectElement;
  startButton: HTMLButtonElement;
  pauseButton: HTMLButtonElement;
  resumeButton: HTMLButtonElement;
  stopButton: HTMLButtonElement;
  clearTerminalButton: HTMLButtonElement;
  copyDebugButton: HTMLButtonElement;
  roundValue: HTMLElement;
  nextHopValue: HTMLElement;
  currentStepValue: HTMLElement;
  transportValue: HTMLElement;
  selectorValue: HTMLElement;
  issueValue: HTMLElement;
}

type PopupActionMessage =
  | ClearBindingMessage
  | ClearTerminalMessage
  | PauseSessionMessage
  | ResetOverlayPositionMessage
  | ResumeSessionMessage
  | SetBindingMessage
  | SetNextHopOverrideMessage
  | SetOverlayEnabledMessage
  | SetOverlayCollapsedMessage
  | SetStarterMessage
  | StartSessionMessage
  | StopSessionMessage;

type PopupMessage = GetPopupModelMessage | PopupActionMessage;

type OverlaySettingsResult = {
  state: RuntimeState;
  overlaySettings: OverlaySettings;
};

type PopupMessageResult<T extends PopupMessage> = T["type"] extends "GET_POPUP_MODEL"
  ? PopupModel
  : T["type"] extends "SET_OVERLAY_ENABLED" | "RESET_OVERLAY_POSITION"
    ? OverlaySettingsResult
    : RuntimeState;

const elements: PopupElements = {
  phaseBadge: requireElement<HTMLElement>("#phaseBadge"),
  currentTabStatus: requireElement<HTMLElement>("#currentTabStatus"),
  bindAButton: requireElement<HTMLButtonElement>("#bindAButton"),
  bindBButton: requireElement<HTMLButtonElement>("#bindBButton"),
  unbindCurrentButton: requireElement<HTMLButtonElement>("#unbindCurrentButton"),
  bindingA: requireElement<HTMLElement>("#bindingA"),
  bindingB: requireElement<HTMLElement>("#bindingB"),
  localeSelect: requireElement<HTMLSelectElement>("#localeSelect"),
  overlayEnabledCheckbox: requireElement<HTMLInputElement>("#overlayEnabledCheckbox"),
  defaultExpandedCheckbox: requireElement<HTMLInputElement>("#defaultExpandedCheckbox"),
  resetOverlayPositionButton: requireElement<HTMLButtonElement>("#resetOverlayPositionButton"),
  starterSelect: requireElement<HTMLSelectElement>("#starterSelect"),
  overrideSelect: requireElement<HTMLSelectElement>("#overrideSelect"),
  startButton: requireElement<HTMLButtonElement>("#startButton"),
  pauseButton: requireElement<HTMLButtonElement>("#pauseButton"),
  resumeButton: requireElement<HTMLButtonElement>("#resumeButton"),
  stopButton: requireElement<HTMLButtonElement>("#stopButton"),
  clearTerminalButton: requireElement<HTMLButtonElement>("#clearTerminalButton"),
  copyDebugButton: requireElement<HTMLButtonElement>("#copyDebugButton"),
  roundValue: requireElement<HTMLElement>("#roundValue"),
  nextHopValue: requireElement<HTMLElement>("#nextHopValue"),
  currentStepValue: requireElement<HTMLElement>("#currentStepValue"),
  transportValue: requireElement<HTMLElement>("#transportValue"),
  selectorValue: requireElement<HTMLElement>("#selectorValue"),
  issueValue: requireElement<HTMLElement>("#issueValue")
};

let currentTabId: number | null = null;
let currentModel: PopupModel | null = null;
let refreshTimerId: number | null = null;
let refreshInFlight: Promise<PopupModel | null> | null = null;
let currentLocale: UiLocale = readUiLocale();

applyStaticCopy(document.body, currentLocale);
document.documentElement.lang = currentLocale === "en" ? "en" : "zh-CN";

wireEvents();
void refresh();
startAutoRefresh();

async function refresh(): Promise<PopupModel | null> {
  if (refreshInFlight) {
    return refreshInFlight;
  }

  refreshInFlight = refreshLatestModel();
  try {
    return await refreshInFlight;
  } finally {
    refreshInFlight = null;
  }
}

async function refreshLatestModel(): Promise<PopupModel | null> {
  try {
    const [activeTab] = await chrome.tabs.query({
      active: true,
      currentWindow: true
    });

    currentTabId = activeTab?.id ?? null;
    const response = await sendMessage({
      type: MESSAGE_TYPES.GET_POPUP_MODEL,
      activeTabId: currentTabId
    });

    currentModel = response;
    render(response);
    return response;
  } catch (error) {
    const message = getErrorMessage(error);
    elements.currentTabStatus.textContent = message;
    elements.issueValue.textContent = message;
    return null;
  }
}

function wireEvents(): void {
  elements.bindAButton.addEventListener("click", () => {
    void perform({
      type: MESSAGE_TYPES.SET_BINDING,
      role: "A",
      tabId: currentTabId
    });
  });

  elements.bindBButton.addEventListener("click", () => {
    void perform({
      type: MESSAGE_TYPES.SET_BINDING,
      role: "B",
      tabId: currentTabId
    });
  });

  elements.unbindCurrentButton.addEventListener("click", async () => {
    if (!currentModel?.currentTab?.assignedRole) {
      return;
    }

    await perform({
      type: MESSAGE_TYPES.CLEAR_BINDING,
      role: currentModel.currentTab.assignedRole
    });
  });

  elements.starterSelect.addEventListener("change", () => {
    void perform({
      type: MESSAGE_TYPES.SET_STARTER,
      role: elements.starterSelect.value as BridgeRole
    });
  });

  elements.overrideSelect.addEventListener("change", () => {
    const role = toNullableRole(elements.overrideSelect.value);
    void perform({
      type: MESSAGE_TYPES.SET_NEXT_HOP_OVERRIDE,
      role
    });
  });

  elements.startButton.addEventListener("click", () => {
    void perform({
      type: MESSAGE_TYPES.START_SESSION
    });
  });

  elements.pauseButton.addEventListener("click", () => {
    void perform({
      type: MESSAGE_TYPES.PAUSE_SESSION
    });
  });

  elements.resumeButton.addEventListener("click", () => {
    void perform({
      type: MESSAGE_TYPES.RESUME_SESSION
    });
  });

  elements.stopButton.addEventListener("click", () => {
    void perform({
      type: MESSAGE_TYPES.STOP_SESSION
    });
  });

  elements.clearTerminalButton.addEventListener("click", () => {
    void perform({
      type: MESSAGE_TYPES.CLEAR_TERMINAL
    });
  });

  elements.copyDebugButton.addEventListener("click", () => {
    void copyDebugSnapshot();
  });

  elements.overlayEnabledCheckbox.addEventListener("change", () => {
    void perform({
      type: MESSAGE_TYPES.SET_OVERLAY_ENABLED,
      enabled: elements.overlayEnabledCheckbox.checked
    });
  });

  elements.resetOverlayPositionButton.addEventListener("click", () => {
    void perform({
      type: MESSAGE_TYPES.RESET_OVERLAY_POSITION
    });
  });

  elements.localeSelect.addEventListener("change", () => {
    const newLocale = elements.localeSelect.value as UiLocale;
    currentLocale = newLocale;
    writeUiLocale(newLocale);
    document.documentElement.lang = newLocale === "en" ? "en" : "zh-CN";
    applyStaticCopy(document.body, newLocale);
    if (currentModel) {
      render(currentModel);
    }
  });

  elements.defaultExpandedCheckbox.addEventListener("change", () => {
    void perform({
      type: MESSAGE_TYPES.SET_OVERLAY_COLLAPSED,
      collapsed: !elements.defaultExpandedCheckbox.checked
    });
  });
}

async function perform(message: PopupActionMessage): Promise<void> {
  try {
    await sendMessage(message);
    await refresh();
  } catch (error) {
    elements.issueValue.textContent = getErrorMessage(error);
  }
}

function render(model: PopupModel): void {
  const copy = getPopupCopy(currentLocale);
  const { state, currentTab, controls, display, overlaySettings } = model;
  const canChangeBindings = state.phase !== "running" && state.phase !== "paused";
  elements.phaseBadge.textContent = formatPhase(currentLocale, state.phase);
  elements.phaseBadge.dataset.phase = state.phase;
  elements.bindingA.textContent = summarizeBinding(state.bindings.A);
  elements.bindingB.textContent = summarizeBinding(state.bindings.B);
  elements.roundValue.textContent = String(state.round);
  elements.nextHopValue.textContent = display.nextHop;
  elements.currentStepValue.textContent = display.currentStep || copy.idle;
  elements.transportValue.textContent = display.transport || copy.none;
  elements.selectorValue.textContent = display.selector || copy.none;
  elements.issueValue.textContent = state.lastError || state.lastStopReason || copy.none;
  elements.starterSelect.value = state.starter;
  elements.overrideSelect.value = state.nextHopOverride ?? "";
  elements.overlayEnabledCheckbox.checked = overlaySettings?.enabled ?? true;
  elements.localeSelect.value = currentLocale;

  if (!currentTab) {
    elements.currentTabStatus.textContent = copy.noActiveTab;
  } else if (!currentTab.urlInfo.supported) {
    elements.currentTabStatus.textContent = copy.unsupportedTab;
  } else {
    elements.currentTabStatus.textContent = currentTab.assignedRole
      ? copy.tabBoundAs(currentTab.assignedRole)
      : copy.tabEligible(currentTab.urlInfo.kind);
  }

  elements.bindAButton.disabled = !currentTab?.urlInfo?.supported || !canChangeBindings;
  elements.bindBButton.disabled = !currentTab?.urlInfo?.supported || !canChangeBindings;
  elements.unbindCurrentButton.disabled = !currentTab?.assignedRole || !canChangeBindings;
  elements.startButton.disabled = !controls.canStart;
  elements.pauseButton.disabled = !controls.canPause;
  elements.resumeButton.disabled = !controls.canResume;
  elements.stopButton.disabled = !controls.canStop;
  elements.clearTerminalButton.disabled = !controls.canClearTerminal;
  elements.starterSelect.disabled = !controls.canSetStarter;
  elements.overrideSelect.disabled = !controls.canSetOverride;

  const starterOptions = elements.starterSelect.options;
  starterOptions[0].textContent = copy.starterA;
  starterOptions[1].textContent = copy.starterB;

  const overrideOptions = elements.overrideSelect.options;
  overrideOptions[0].textContent = copy.overrideNone;
  overrideOptions[1].textContent = copy.overrideA;
  overrideOptions[2].textContent = copy.overrideB;
}

async function copyDebugSnapshot(): Promise<void> {
  const latestModel = (await refresh()) ?? currentModel;
  if (!latestModel) {
    elements.issueValue.textContent = "No data available";
    return;
  }

  if (!currentTabId) {
    elements.issueValue.textContent = getPopupCopy(currentLocale).unsupportedTab;
    return;
  }

  let ackDebug: any = null;
  try {
    ackDebug = await withTimeout(
      chrome.tabs.sendMessage(currentTabId, { type: MESSAGE_TYPES.GET_LAST_ACK_DEBUG }),
      5000
    );
  } catch (error) {
    console.warn("Failed to fetch ack debug:", error);
  }

  const payload = buildDebugSnapshot(latestModel, ackDebug);

  try {
    await navigator.clipboard.writeText(payload);
    elements.issueValue.textContent = getPopupCopy(currentLocale).copied;
  } catch {
    const fallback = document.createElement("textarea");
    fallback.value = payload;
    fallback.setAttribute("readonly", "true");
    fallback.style.position = "fixed";
    fallback.style.opacity = "0";
    document.body.appendChild(fallback);
    fallback.select();
    document.execCommand("copy");
    fallback.remove();
    elements.issueValue.textContent = getPopupCopy(currentLocale).copied;
  }
}

function buildDebugSnapshot(model: PopupModel, ackDebug: any): string {
  const copy = getPopupCopy(currentLocale);
  const { state, currentTab, display } = model;

  const tabStatus = currentTab?.assignedRole
    ? copy.tabBoundAs(currentTab.assignedRole)
    : currentTab?.urlInfo?.supported
      ? copy.tabEligible(currentTab.urlInfo.kind)
      : copy.unsupportedTab;

  const lines = [
    copy.title,
    "",
    `${formatPhase(currentLocale, state.phase)}`,
    tabStatus,
    `A: ${summarizeBinding(state.bindings.A)}`,
    `B: ${summarizeBinding(state.bindings.B)}`,
    `${copy.labelStarter}: ${state.starter}`,
    `${copy.roundLabel}: ${state.round}`,
    `${copy.nextHopLabel}: ${display.nextHop}`,
    `${copy.currentStepLabel}: ${display.currentStep || copy.idle}`,
    `${copy.transportLabel}: ${display.transport || copy.none}`,
    `${copy.selectorLabel}: ${display.selector || copy.none}`,
    `${copy.lastIssueLabel}: ${state.lastError || state.lastStopReason || copy.none}`
  ];

  if (ackDebug) {
    lines.push(
      "",
      "Ack Debug:",
      `  Timestamp: ${new Date(ackDebug.timestamp).toISOString()}`,
      `  Expected (hash): ${ackDebug?.baseline?.expectedHash || 'N/A'}`,
      `  Baseline:`,
      `    userHash: ${ackDebug?.baseline?.userHash || 'N/A'}`,
      `    composerText: ${ackDebug?.baseline?.composerText ? ackDebug.baseline.composerText.substring(0, 60) + (ackDebug.baseline.composerText.length > 60 ? '...' : '') : 'N/A'}`,
      `    generating: ${ackDebug?.baseline?.generating ?? 'N/A'}`,
      `  After:`,
      `    latestUserHash: ${ackDebug?.after?.latestUserHash || 'N/A'}`,
      `    composerText: ${ackDebug?.after?.composerText ? ackDebug.after.composerText.substring(0, 60) + (ackDebug.after.composerText.length > 60 ? '...' : '') : 'N/A'}`,
      `    generating: ${ackDebug?.after?.generating ?? 'N/A'}`,
      `  Signal: ${ackDebug?.signal || 'none'}`,
      `  Timed out: ${ackDebug?.timedOut ?? false}`,
      `  Error: ${ackDebug?.error || 'none'}`
    );
  }

  return lines.join("\n");
}

function summarizeBinding(copy: PopupCopy, binding: RuntimeState["bindings"][BridgeRole]): string {
  if (!binding) {
    return copy.unbound;
  }

  const label = binding.urlInfo?.kind === "project" ? copy.projectThreadLabel : copy.threadLabel;
  return `${binding.title || label} (#${binding.tabId})`;
}

async function sendMessage<T extends PopupMessage>(message: T): Promise<PopupMessageResult<T>> {
  const response = await chrome.runtime.sendMessage(message) as RuntimeResponse<PopupMessageResult<T>>;
  if (!response.ok) {
    throw new Error("error" in response ? response.error : "runtime_message_failed");
  }
  return response.result;
}

function startAutoRefresh(): void {
  if (refreshTimerId !== null) {
    return;
  }

  refreshTimerId = window.setInterval(() => {
    void refresh().catch((error) => {
      console.error("Refresh failed:", error);
      // Don't let errors stop the refresh cycle
    });
  }, REFRESH_INTERVAL_MS);

  window.addEventListener("beforeunload", () => {
    if (refreshTimerId !== null) {
      window.clearInterval(refreshTimerId);
      refreshTimerId = null;
    }
  }, { once: true });
}

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Missing required popup element: ${selector}`);
  }

  return element;
}

function toNullableRole(value: string): BridgeRole | null {
  return value === "A" || value === "B" ? value : null;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
