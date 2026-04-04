import { MESSAGE_TYPES } from "./core/constants.ts";
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
  SetStarterMessage,
  StartSessionMessage,
  StopSessionMessage,
  ClearTerminalMessage
} from "./shared/types.js";

const REFRESH_INTERVAL_MS = 1000;

interface PopupElements {
  phaseBadge: HTMLElement;
  currentTabStatus: HTMLElement;
  bindAButton: HTMLButtonElement;
  bindBButton: HTMLButtonElement;
  unbindCurrentButton: HTMLButtonElement;
  bindingA: HTMLElement;
  bindingB: HTMLElement;
  overlayEnabledCheckbox: HTMLInputElement;
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
  overlayEnabledCheckbox: requireElement<HTMLInputElement>("#overlayEnabledCheckbox"),
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
  const { state, currentTab, controls, display, overlaySettings } = model;
  const canChangeBindings = state.phase !== "running" && state.phase !== "paused";
  elements.phaseBadge.textContent = state.phase;
  elements.bindingA.textContent = summarizeBinding(state.bindings.A);
  elements.bindingB.textContent = summarizeBinding(state.bindings.B);
  elements.roundValue.textContent = String(state.round);
  elements.nextHopValue.textContent = display.nextHop;
  elements.currentStepValue.textContent = display.currentStep || "idle";
  elements.transportValue.textContent = display.transport || "None";
  elements.selectorValue.textContent = display.selector || "None";
  elements.issueValue.textContent = state.lastError || state.lastStopReason || "None";
  elements.starterSelect.value = state.starter;
  elements.overrideSelect.value = state.nextHopOverride ?? "";
  elements.overlayEnabledCheckbox.checked = overlaySettings?.enabled ?? true;

  if (!currentTab) {
    elements.currentTabStatus.textContent = "No active tab available.";
  } else if (!currentTab.urlInfo.supported) {
    elements.currentTabStatus.textContent =
      "Current tab is not a supported ChatGPT thread.";
  } else {
    elements.currentTabStatus.textContent = currentTab.assignedRole
      ? `Current tab is bound as ${currentTab.assignedRole}.`
      : `Current tab is eligible (${currentTab.urlInfo.kind}).`;
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
}

async function copyDebugSnapshot(): Promise<void> {
  const latestModel = (await refresh()) ?? currentModel;
  if (!latestModel) {
    return;
  }

  const payload = buildDebugSnapshot(latestModel);

  try {
    await navigator.clipboard.writeText(payload);
    elements.issueValue.textContent = "Debug snapshot copied";
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
    elements.issueValue.textContent = "Debug snapshot copied";
  }
}

function buildDebugSnapshot(model: PopupModel): string {
  const { state, currentTab, display } = model;

  return [
    "ChatGPT Bridge",
    "",
    `Phase: ${state.phase}`,
    `Current tab: ${currentTab?.assignedRole ? `bound as ${currentTab.assignedRole}` : currentTab?.urlInfo?.supported ? "eligible" : "unsupported"}`,
    `Binding A: ${summarizeBinding(state.bindings.A)}`,
    `Binding B: ${summarizeBinding(state.bindings.B)}`,
    `Starter: ${state.starter}`,
    `Round: ${state.round}`,
    `Next hop: ${display.nextHop}`,
    `Current step: ${display.currentStep || "idle"}`,
    `Transport: ${display.transport || "None"}`,
    `Selector: ${display.selector || "None"}`,
    `Last issue: ${state.lastError || state.lastStopReason || "None"}`
  ].join("\n");
}

function summarizeBinding(binding: RuntimeState["bindings"][BridgeRole]): string {
  if (!binding) {
    return "Unbound";
  }

  const label = binding.urlInfo?.kind === "project" ? "project thread" : "thread";
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
    void refresh();
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
