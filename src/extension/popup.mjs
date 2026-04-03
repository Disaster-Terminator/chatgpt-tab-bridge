import { MESSAGE_TYPES } from "./core/constants.mjs";

const elements = {
  phaseBadge: document.querySelector("#phaseBadge"),
  currentTabStatus: document.querySelector("#currentTabStatus"),
  bindAButton: document.querySelector("#bindAButton"),
  bindBButton: document.querySelector("#bindBButton"),
  unbindCurrentButton: document.querySelector("#unbindCurrentButton"),
  bindingA: document.querySelector("#bindingA"),
  bindingB: document.querySelector("#bindingB"),
  starterSelect: document.querySelector("#starterSelect"),
  overrideSelect: document.querySelector("#overrideSelect"),
  startButton: document.querySelector("#startButton"),
  pauseButton: document.querySelector("#pauseButton"),
  resumeButton: document.querySelector("#resumeButton"),
  stopButton: document.querySelector("#stopButton"),
  clearTerminalButton: document.querySelector("#clearTerminalButton"),
  roundValue: document.querySelector("#roundValue"),
  nextHopValue: document.querySelector("#nextHopValue"),
  issueValue: document.querySelector("#issueValue")
};

let currentTabId = null;
let currentModel = null;

wireEvents();
void refresh();

async function refresh() {
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
  } catch (error) {
    elements.currentTabStatus.textContent = error.message;
    elements.issueValue.textContent = error.message;
  }
}

function wireEvents() {
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
      role: elements.starterSelect.value
    });
  });

  elements.overrideSelect.addEventListener("change", () => {
    const role = elements.overrideSelect.value || null;
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
}

async function perform(message) {
  try {
    await sendMessage(message);
    await refresh();
  } catch (error) {
    elements.issueValue.textContent = error.message;
  }
}

function render(model) {
  const { state, currentTab, controls, display } = model;
  const canChangeBindings = state.phase !== "running" && state.phase !== "paused";
  elements.phaseBadge.textContent = state.phase;
  elements.bindingA.textContent = summarizeBinding(state.bindings.A);
  elements.bindingB.textContent = summarizeBinding(state.bindings.B);
  elements.roundValue.textContent = String(state.round);
  elements.nextHopValue.textContent = display.nextHop;
  elements.issueValue.textContent = state.lastError || state.lastStopReason || "None";
  elements.starterSelect.value = state.starter;
  elements.overrideSelect.value = state.nextHopOverride ?? "";

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

function summarizeBinding(binding) {
  if (!binding) {
    return "Unbound";
  }

  const label = binding.urlInfo?.kind === "project" ? "project thread" : "thread";
  return `${binding.title || label} (#${binding.tabId})`;
}

async function sendMessage(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response.ok) {
    throw new Error(response.error);
  }
  return response.result;
}
