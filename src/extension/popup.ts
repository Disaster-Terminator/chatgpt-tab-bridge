import { MESSAGE_TYPES } from "./core/constants.ts";
import { getPopupCopy, applyStaticCopy, formatPhase, type UiLocale, type PopupCopy } from "./copy/bridge-copy.ts";
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
  RuntimeEvent,
  RuntimeState,
  SetBindingMessage,
  SetAmbientOverlayEnabledMessage,
  SetNextHopOverrideMessage,
  SetOverlayEnabledMessage,
  SetOverlayCollapsedMessage,
  SetRuntimeSettingsMessage,
  SetStarterMessage,
  StartSessionMessage,
  StopSessionMessage,
  ClearTerminalMessage
} from "./shared/types.js";

const REFRESH_INTERVAL_MS = 1000;
const MIN_MAX_ROUNDS = 1;
const MAX_MAX_ROUNDS = 50;

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
  bindingA: HTMLElement;
  bindingB: HTMLElement;
  localeSelect: HTMLSelectElement;
  maxRoundsRange: HTMLInputElement;
  maxRoundsValue: HTMLElement;
  maxRoundsEnabledCheckbox: HTMLInputElement;
  decreaseMaxRoundsButton: HTMLButtonElement;
  increaseMaxRoundsButton: HTMLButtonElement;
  overlayEnabledCheckbox: HTMLInputElement;
  ambientOverlayEnabledCheckbox: HTMLInputElement;
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
  downloadDebugButton: HTMLButtonElement;
  openHelpButton: HTMLButtonElement;
  roundValue: HTMLElement;
  nextHopValue: HTMLElement;
  currentStepValue: HTMLElement;
  currentStepValueDebug: HTMLElement;
  transportValue: HTMLElement;
  selectorValue: HTMLElement;
  issueValue: HTMLElement;
  issueValueDebug: HTMLElement;
  issueRow: HTMLElement;
  issueAdviceBlock: HTMLElement;
  issueTitle: HTMLElement;
  issueExplanation: HTMLElement;
  issueSuggestion: HTMLElement;
  copyFeedback: HTMLElement;
  readinessRow: HTMLElement;
  readinessReason: HTMLElement;
}

type PopupActionMessage =
  | ClearBindingMessage
  | ClearTerminalMessage
  | PauseSessionMessage
  | ResetOverlayPositionMessage
  | ResumeSessionMessage
  | SetAmbientOverlayEnabledMessage
  | SetBindingMessage
  | SetNextHopOverrideMessage
  | SetOverlayEnabledMessage
  | SetOverlayCollapsedMessage
  | SetRuntimeSettingsMessage
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
  bindingA: requireElement<HTMLElement>("#bindingA"),
  bindingB: requireElement<HTMLElement>("#bindingB"),
  localeSelect: requireElement<HTMLSelectElement>("#localeSelect"),
  maxRoundsRange: requireElement<HTMLInputElement>("#maxRoundsRange"),
  maxRoundsValue: requireElement<HTMLElement>("#maxRoundsValue"),
  maxRoundsEnabledCheckbox: requireElement<HTMLInputElement>("#maxRoundsEnabledCheckbox"),
  decreaseMaxRoundsButton: requireElement<HTMLButtonElement>("#decreaseMaxRoundsButton"),
  increaseMaxRoundsButton: requireElement<HTMLButtonElement>("#increaseMaxRoundsButton"),
  overlayEnabledCheckbox: requireElement<HTMLInputElement>("#overlayEnabledCheckbox"),
  ambientOverlayEnabledCheckbox: requireElement<HTMLInputElement>("#ambientOverlayEnabledCheckbox"),
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
  downloadDebugButton: requireElement<HTMLButtonElement>("#downloadDebugButton"),
  openHelpButton: requireElement<HTMLButtonElement>("#openHelpButton"),
  roundValue: requireElement<HTMLElement>("#roundValue"),
  nextHopValue: requireElement<HTMLElement>("#nextHopValue"),
  currentStepValue: requireElement<HTMLElement>("#currentStepValue"),
  currentStepValueDebug: requireElement<HTMLElement>("#currentStepValueDebug"),
  transportValue: requireElement<HTMLElement>("#transportValue"),
  selectorValue: requireElement<HTMLElement>("#selectorValue"),
  issueValue: requireElement<HTMLElement>("#issueValue"),
  issueValueDebug: requireElement<HTMLElement>("#issueValueDebug"),
  issueRow: requireElement<HTMLElement>("#issueRow"),
  issueAdviceBlock: requireElement<HTMLElement>("#issueAdviceBlock"),
  issueTitle: requireElement<HTMLElement>("#issueTitle"),
  issueExplanation: requireElement<HTMLElement>("#issueExplanation"),
  issueSuggestion: requireElement<HTMLElement>("#issueSuggestion"),
  copyFeedback: requireElement<HTMLElement>("#copyFeedback"),
  readinessRow: requireElement<HTMLElement>("#readinessRow"),
  readinessReason: requireElement<HTMLElement>("#readinessReason")
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

  elements.downloadDebugButton.addEventListener("click", () => {
    void downloadDebugSnapshot();
  });

  elements.openHelpButton.addEventListener("click", () => {
    window.open("https://github.com/raystorm1/chatgpt-tab-bridge#readme", "_blank");
  });

  elements.overlayEnabledCheckbox.addEventListener("change", () => {
    void perform({
      type: MESSAGE_TYPES.SET_OVERLAY_ENABLED,
      enabled: elements.overlayEnabledCheckbox.checked
    });
  });

  elements.ambientOverlayEnabledCheckbox.addEventListener("change", () => {
    void perform({
      type: MESSAGE_TYPES.SET_AMBIENT_OVERLAY_ENABLED,
      enabled: elements.ambientOverlayEnabledCheckbox.checked
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

  elements.maxRoundsRange.addEventListener("input", () => {
    renderMaxRoundsValue(Number(elements.maxRoundsRange.value));
  });

  elements.maxRoundsRange.addEventListener("change", () => {
    void updateMaxRounds(Number(elements.maxRoundsRange.value));
  });

  elements.maxRoundsEnabledCheckbox.addEventListener("change", () => {
    void perform({
      type: MESSAGE_TYPES.SET_RUNTIME_SETTINGS,
      settings: {
        maxRoundsEnabled: elements.maxRoundsEnabledCheckbox.checked
      }
    });
  });

  elements.decreaseMaxRoundsButton.addEventListener("click", () => {
    void updateMaxRounds(Number(elements.maxRoundsRange.value) - 1);
  });

  elements.increaseMaxRoundsButton.addEventListener("click", () => {
    void updateMaxRounds(Number(elements.maxRoundsRange.value) + 1);
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
  const { state, currentTab, controls, display, overlaySettings, readiness } = model;
  elements.phaseBadge.textContent = formatPhase(currentLocale, state.phase);
  elements.phaseBadge.dataset.phase = state.phase;
  elements.bindingA.textContent = summarizeBinding(copy, state.bindings.A);
  elements.bindingB.textContent = summarizeBinding(copy, state.bindings.B);
  elements.roundValue.textContent = formatRoundProgress(state.settings.maxRoundsEnabled, state.round, state.settings.maxRounds);
  elements.nextHopValue.textContent = display.nextHop;
  elements.currentStepValue.textContent = display.currentStep || copy.idle;
  elements.currentStepValueDebug.textContent = display.currentStep || copy.idle;
  elements.transportValue.textContent = display.transport || copy.none;
  elements.selectorValue.textContent = display.selector || copy.none;

  if (display.lastIssue && display.lastIssue !== "None") {
    elements.issueRow.hidden = false;
    elements.issueValue.textContent = display.lastIssue;
    elements.issueValueDebug.textContent = display.lastIssue;
  } else {
    elements.issueRow.hidden = true;
    elements.issueValueDebug.textContent = copy.none;
  }

  if (display.issueAdvice) {
    elements.issueAdviceBlock.hidden = false;
    elements.issueTitle.textContent = `Last issue: ${display.issueAdvice.title}`;
    elements.issueExplanation.textContent = `Reason: ${display.issueAdvice.code} — ${display.issueAdvice.explanation}`;
    elements.issueSuggestion.textContent = `Suggestion: ${display.issueAdvice.suggestedAction}`;
  } else {
    elements.issueAdviceBlock.hidden = true;
  }

  elements.starterSelect.value = state.starter;
  elements.overrideSelect.value = state.nextHopOverride ?? "";
  elements.localeSelect.value = currentLocale;
  setMaxRoundsControl(state.settings.maxRounds, state.settings.maxRoundsEnabled);
  elements.overlayEnabledCheckbox.checked = overlaySettings.enabled;
  elements.ambientOverlayEnabledCheckbox.checked = overlaySettings.ambientEnabled;
  elements.defaultExpandedCheckbox.checked = !overlaySettings.collapsed;

  const toggle = elements.overlayEnabledCheckbox.closest<HTMLElement>(".popup__toggle");
  if (toggle) {
    toggle.dataset.checked = String(elements.overlayEnabledCheckbox.checked);
  }

  const ambientToggle = elements.ambientOverlayEnabledCheckbox.closest<HTMLElement>(".popup__toggle");
  if (ambientToggle) {
    ambientToggle.dataset.checked = String(elements.ambientOverlayEnabledCheckbox.checked);
  }

  const expandedToggle = elements.defaultExpandedCheckbox.closest<HTMLElement>(".popup__toggle");
  if (expandedToggle) {
    expandedToggle.dataset.checked = String(elements.defaultExpandedCheckbox.checked);
  }

  if (!currentTab) {
    elements.currentTabStatus.textContent = copy.noActiveTab;
  } else if (!currentTab.urlInfo.supported) {
    elements.currentTabStatus.textContent = copy.unsupportedTab;
  } else {
    elements.currentTabStatus.textContent = currentTab.assignedRole
      ? copy.tabBoundAs(currentTab.assignedRole)
      : copy.tabEligible(currentTab.urlInfo.kind);
  }

  elements.startButton.disabled = !controls.canStart;
  elements.pauseButton.disabled = !controls.canPause;
  elements.resumeButton.disabled = !controls.canResume;
  elements.stopButton.disabled = !controls.canStop;
  elements.clearTerminalButton.disabled = !controls.canClearTerminal;
  elements.starterSelect.disabled = !controls.canSetStarter;
  elements.overrideSelect.disabled = !controls.canSetOverride;
  elements.maxRoundsRange.disabled = !controls.canSetSettings;
  elements.maxRoundsEnabledCheckbox.disabled = !controls.canSetSettings;
  elements.decreaseMaxRoundsButton.disabled =
    !controls.canSetSettings || !state.settings.maxRoundsEnabled || state.settings.maxRounds <= MIN_MAX_ROUNDS;
  elements.increaseMaxRoundsButton.disabled =
    !controls.canSetSettings || !state.settings.maxRoundsEnabled || state.settings.maxRounds >= MAX_MAX_ROUNDS;
  elements.decreaseMaxRoundsButton.setAttribute("aria-label", copy.maxRoundsDecrease);
  elements.increaseMaxRoundsButton.setAttribute("aria-label", copy.maxRoundsIncrease);

  const maxRoundsToggle = elements.maxRoundsEnabledCheckbox.closest<HTMLElement>(".popup__toggle");
  if (maxRoundsToggle) {
    maxRoundsToggle.dataset.checked = String(elements.maxRoundsEnabledCheckbox.checked);
  }

  if (readiness.blockReason) {
    elements.readinessRow.hidden = false;
    const reasonKey = readiness.blockReason;
    elements.readinessReason.textContent = copy.blockReasons?.[reasonKey] || copy.none;
  } else {
    elements.readinessRow.hidden = true;
  }

  const starterOptions = elements.starterSelect.options;
  starterOptions[0].textContent = copy.starterA;
  starterOptions[1].textContent = copy.starterB;

  const overrideOptions = elements.overrideSelect.options;
  overrideOptions[0].textContent = copy.overrideNone;
  overrideOptions[1].textContent = copy.overrideA;
  overrideOptions[2].textContent = copy.overrideB;
}

function showCopyFeedback(message: string, isSuccess: boolean): void {
  const feedback = elements.copyFeedback;
  feedback.textContent = message;
  feedback.className = "popup__copy-feedback";
  feedback.classList.add(isSuccess ? "popup__copy-feedback--success" : "popup__copy-feedback--error");
  feedback.hidden = false;

  // Auto-hide after 1.8 seconds
  setTimeout(() => {
    feedback.hidden = true;
  }, 1800);
}

async function copyDebugSnapshot(): Promise<void> {
  const payload = await collectDebugSnapshotPayload();
  if (!payload) {
    showCopyFeedback(getPopupCopy(currentLocale).failedToCopyDebugSnapshot, false);
    return;
  }

  try {
    await navigator.clipboard.writeText(payload);
    showCopyFeedback(getPopupCopy(currentLocale).copiedDebugSnapshot, true);
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
    showCopyFeedback(getPopupCopy(currentLocale).copiedDebugSnapshot, true);
  }
}

async function downloadDebugSnapshot(): Promise<void> {
  const copy = getPopupCopy(currentLocale);
  const payload = await collectDebugSnapshotPayload();
  if (!payload) {
    showCopyFeedback(copy.failedToDownloadDebugSnapshot, false);
    return;
  }

  try {
    const blob = new Blob([payload], {
      type: "text/plain;charset=utf-8"
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `chatgpt-tab-bridge-debug-${formatFileTimestamp(new Date())}.txt`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    showCopyFeedback(copy.downloadedDebugSnapshot, true);
  } catch (error) {
    console.warn("Failed to download debug snapshot:", error);
    showCopyFeedback(copy.failedToDownloadDebugSnapshot, false);
  }
}

async function collectDebugSnapshotPayload(): Promise<string | null> {
  const latestModel = (await refresh()) ?? currentModel;
  if (!latestModel) {
    return null;
  }

  const ackTarget = resolveAckDebugTarget(latestModel, currentTabId);
  if (!ackTarget.tabId) {
    return null;
  }

  let ackDebug: any = null;
  let runtimeEvents: RuntimeEvent[] = [];
  try {
    ackDebug = await withTimeout(
      chrome.tabs.sendMessage(ackTarget.tabId, { type: MESSAGE_TYPES.GET_LAST_ACK_DEBUG }),
      5000
    );
  } catch (error) {
    console.warn("Failed to fetch ack debug:", error);
  }

  try {
    const eventsResponse = await withTimeout(
      chrome.runtime.sendMessage({
        type: MESSAGE_TYPES.GET_RECENT_RUNTIME_EVENTS
      }),
      5000
    ) as RuntimeResponse<RuntimeEvent[]>;
    runtimeEvents = eventsResponse.ok ? eventsResponse.result : [];
  } catch (error) {
    console.warn("Failed to fetch runtime events:", error);
  }

  return buildDebugSnapshot(latestModel, ackDebug, ackTarget, runtimeEvents);
}

function buildDebugSnapshot(
  model: PopupModel,
  ackDebug: any,
  ackTarget: { role: BridgeRole | null; tabId: number | null; source: string },
  runtimeEvents: RuntimeEvent[] = []
): string {
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
    `A: ${summarizeBinding(copy, state.bindings.A)}`,
    `B: ${summarizeBinding(copy, state.bindings.B)}`,
    `${copy.labelStarter}: ${state.starter}`,
    `${copy.roundLabel}: ${formatRoundProgress(state.settings.maxRoundsEnabled, state.round, state.settings.maxRounds)}`,
    `${copy.nextHopLabel}: ${display.nextHop}`,
    `${copy.currentStepLabel}: ${display.currentStep || copy.idle}`,
    `${copy.transportLabel}: ${display.transport || copy.none}`,
    `${copy.selectorLabel}: ${display.selector || copy.none}`,
    `${copy.lastIssueLabel}: ${display.lastIssue || copy.none}`,
    `Ack target: ${ackTarget.role ?? "current"} (#${ackTarget.tabId ?? "N/A"}, ${ackTarget.source})`
  ];

  if (ackDebug && ackDebug.ok === false && ackDebug.error) {
    lines.push("", "Ack Debug:", `  Error: ${ackDebug.error}`);
  } else if (ackDebug) {
    const response = ackDebug.response ?? {};
    const evidence = response.dispatchEvidence ?? {};
    lines.push(
      "",
      "Ack Debug:",
      `  Timestamp: ${formatTimestamp(ackDebug.timestamp)}`,
      `  Outcome: ${ackDebug.outcome || "unknown"}`,
      `  Reason: ${ackDebug.reason || "none"}`,
      `  Accepted: ${response.dispatchAccepted ?? response.ok ?? "N/A"}`,
      `  Mode: ${response.applyMode || "unknown"}:${response.mode || "unknown"}`,
      `  Signal: ${response.dispatchSignal || evidence.ackSignal || "none"}`,
      `  Error code: ${response.dispatchErrorCode || "none"}`,
      `  Error: ${response.error || "none"}`,
      `  Expected (hash): ${ackDebug?.baseline?.expectedHash || evidence.expectedHash || "N/A"}`,
      `  Baseline:`,
      `    userHash: ${ackDebug?.baseline?.userHash || evidence.baselineUserHash || "N/A"}`,
      `    composerText: ${preview(ackDebug?.baseline?.composerText ?? evidence.baselineComposerPreview)}`,
      `    generating: ${ackDebug?.baseline?.generating ?? evidence.baselineGenerating ?? "N/A"}`,
      `  Evidence:`,
      `    currentUserHash: ${evidence.currentUserHash || "N/A"}`,
      `    currentGenerating: ${evidence.currentGenerating ?? "N/A"}`,
      `    payloadReleased: ${evidence.payloadReleased ?? "N/A"}`,
      `    textChanged: ${evidence.textChanged ?? "N/A"}`,
      `    buttonStateChanged: ${evidence.buttonStateChanged ?? "N/A"}`,
      `    attempts: ${evidence.attempts ?? "N/A"}`,
      `    latestUser: ${preview(evidence.latestUserPreview)}`
    );
  }

  if (runtimeEvents.length > 0) {
    lines.push("", "Runtime Events:");
    for (const event of runtimeEvents.slice(-10)) {
      lines.push(
        `  ${formatTimestamp(event.timestamp)} [${event.level ?? "info"}:${event.category ?? "runtime"}] ${event.phaseStep} ${event.sourceRole ?? "-"}->${event.targetRole ?? "-"} r${event.round}`,
        `    summary: ${event.dispatchReadbackSummary}`,
        `    mode: ${event.sendTriggerMode}`,
        `    baseline: ${event.verificationBaseline}`,
        `    poll: ${event.verificationPollSample}`,
        `    verdict: ${event.verificationVerdict}`
      );
    }
  }

  return lines.join("\n");
}

function resolveAckDebugTarget(
  model: PopupModel,
  fallbackTabId: number | null
): { role: BridgeRole | null; tabId: number | null; source: string } {
  const { state } = model;
  const role =
    state.activeHop?.targetRole ??
    state.runtimeActivity.targetRole ??
    model.currentTab?.assignedRole ??
    null;
  const tabId =
    state.activeHop?.targetTabId ??
    (role ? state.bindings[role]?.tabId ?? null : null) ??
    fallbackTabId;

  return {
    role,
    tabId,
    source: state.activeHop?.targetTabId
      ? "active-hop"
      : role && state.bindings[role]?.tabId
        ? "runtime-target-role"
        : "active-tab"
  };
}

function formatTimestamp(value: unknown): string {
  if (!value) {
    return "N/A";
  }
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

function formatFileTimestamp(value: Date): string {
  return value.toISOString().replace(/[:.]/g, "-");
}

function formatRoundProgress(enabled: boolean, round: number, maxRounds: number): string {
  return `${round} / ${enabled ? maxRounds : "∞"}`;
}

function preview(value: unknown): string {
  const text = String(value ?? "");
  if (!text) {
    return "N/A";
  }
  return text.length > 80 ? `${text.slice(0, 80)}...` : text;
}

function summarizeBinding(copy: PopupCopy, binding: RuntimeState["bindings"][BridgeRole]): string {
  if (!binding) {
    return copy.unbound;
  }

  const label = binding.urlInfo?.kind === "project" ? copy.projectThreadLabel : copy.threadLabel;
  return `${binding.title || label} (#${binding.tabId})`;
}

async function updateMaxRounds(value: number): Promise<void> {
  const maxRounds = clampMaxRounds(value);
  setMaxRoundsControl(maxRounds, elements.maxRoundsEnabledCheckbox.checked);
  await perform({
    type: MESSAGE_TYPES.SET_RUNTIME_SETTINGS,
    settings: {
      maxRounds
    }
  });
}

function setMaxRoundsControl(value: number, enabled: boolean): void {
  const maxRounds = clampMaxRounds(value);
  elements.maxRoundsRange.value = String(maxRounds);
  elements.maxRoundsEnabledCheckbox.checked = enabled;
  elements.maxRoundsRange.closest<HTMLElement>(".popup__round-control")?.setAttribute(
    "data-unlimited",
    String(!enabled)
  );
  renderMaxRoundsValue(maxRounds, enabled);
}

function renderMaxRoundsValue(value: number, enabled = elements.maxRoundsEnabledCheckbox.checked): void {
  elements.maxRoundsValue.textContent = enabled ? String(clampMaxRounds(value)) : "∞";
}

function clampMaxRounds(value: number): number {
  if (!Number.isFinite(value)) {
    return 8;
  }
  return Math.min(MAX_MAX_ROUNDS, Math.max(MIN_MAX_ROUNDS, Math.round(value)));
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
