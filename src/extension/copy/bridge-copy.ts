export type UiLocale = "zh-CN" | "en";

export const DEFAULT_UI_LOCALE: UiLocale = "zh-CN";

// ── Copy dictionaries ──────────────────────────────────────────────

interface OverlayCopy {
  bridgeTitle: string;
  phaseReady: string;
  phaseRunning: string;
  phasePaused: string;
  phaseStopped: string;
  phaseError: string;
  phaseIdle: string;
  roleUnbound: string;
  roleBoundA: string;
  roleBoundB: string;
  roundLabel: string;
  nextLabel: string;
  stepLabel: string;
  issueLabel: string;
  starterLabel: string;
  starterA: string;
  starterB: string;
  bindA: string;
  bindB: string;
  unbind: string;
  start: string;
  pause: string;
  resume: string;
  stop: string;
  clear: string;
  popup: string;
  collapseExpand: string;
  collapseCollapse: string;
  none: string;
  idle: string;
}

export interface PopupCopy {
  eyebrow: string;
  title: string;
  sectionGlobalStatus: string;
  sectionSettings: string;
  sectionFallback: string;
  sectionDebug: string;
  debugSummary: string;
  labelStarter: string;
  labelMaxRoundsLimit: string;
  labelMaxRounds: string;
  maxRoundsHelp: string;
  maxRoundsDecrease: string;
  maxRoundsIncrease: string;
  roundUnit: string;
  labelOverride: string;
  labelEnableOverlay: string;
  labelEnableAmbientOverlay: string;
  labelDefaultExpanded: string;
  bindingA: string;
  bindingB: string;
  currentTab: string;
  unbind: string;
  start: string;
  pause: string;
  resume: string;
  stop: string;
  clearTerminal: string;
  openHelp: string;
  resetPosition: string;
  copyDebug: string;
  downloadDebug: string;
  copied: string;
  copiedDebugSnapshot: string;
  downloadedDebugSnapshot: string;
  failedToCopyDebugSnapshot: string;
  failedToDownloadDebugSnapshot: string;
  noActiveTab: string;
  unsupportedTab: string;
  tabBoundAs: (role: string) => string;
  tabEligible: (kind: string) => string;
  unbound: string;
  none: string;
  idle: string;
  roundLabel: string;
  nextHopLabel: string;
  currentStepLabel: string;
  transportLabel: string;
  selectorLabel: string;
  lastIssueLabel: string;
  threadLabel: string;
  projectThreadLabel: string;
  overrideNone: string;
  overrideA: string;
  overrideB: string;
  starterA: string;
  starterB: string;
  localeLabel: string;
  localeZh: string;
  localeEn: string;
  helpText: string;
  readinessLabel: string;
  blockReasons: Record<string, string>;
}

const zhCN: { overlay: OverlayCopy; popup: PopupCopy } = {
  overlay: {
    bridgeTitle: "中继",
    phaseReady: "就绪",
    phaseRunning: "运行中",
    phasePaused: "已暂停",
    phaseStopped: "已停止",
    phaseError: "错误",
    phaseIdle: "空闲",
    roleUnbound: "未绑定",
    roleBoundA: "已绑定 A",
    roleBoundB: "已绑定 B",
    roundLabel: "轮次",
    nextLabel: "下一跳",
    stepLabel: "步骤",
    issueLabel: "问题",
    starterLabel: "起始侧",
    starterA: "A 起始",
    starterB: "B 起始",
    bindA: "绑定 A",
    bindB: "绑定 B",
    unbind: "空闲",
    start: "开始",
    pause: "暂停",
    resume: "恢复",
    stop: "停止",
    clear: "清空",
    popup: "面板",
    collapseExpand: "+",
    collapseCollapse: "−",
    none: "无",
    idle: "空闲"
  },
  popup: {
    eyebrow: "ChatGPT 中继",
    title: "设置",
    sectionGlobalStatus: "全局状态",
    sectionSettings: "设置",
    sectionFallback: "备用操作",
    sectionDebug: "调试",
    debugSummary: "调试信息",
    labelStarter: "起始侧",
    labelMaxRoundsLimit: "轮数限制",
    labelMaxRounds: "桥接轮数",
    maxRoundsHelp: "开启后到达目标轮数自动停止；关闭后显示为 ∞。",
    maxRoundsDecrease: "减少桥接轮数",
    maxRoundsIncrease: "增加桥接轮数",
    roundUnit: "轮",
    labelOverride: "暂停时下一跳覆盖",
    labelEnableOverlay: "启用悬浮窗",
    labelEnableAmbientOverlay: "全站状态提示",
    labelDefaultExpanded: "默认展开悬浮窗",
    bindingA: "绑定 A",
    bindingB: "绑定 B",
    currentTab: "当前标签页",
    unbind: "解绑",
    start: "开始",
    pause: "暂停",
    resume: "恢复",
    stop: "停止",
    clearTerminal: "清空终端",
    openHelp: "帮助",
    resetPosition: "重置位置",
    copyDebug: "复制调试快照",
    downloadDebug: "下载日志",
    copied: "调试快照已复制",
    copiedDebugSnapshot: "已复制调试快照",
    downloadedDebugSnapshot: "已下载调试日志",
    failedToCopyDebugSnapshot: "复制调试快照失败",
    failedToDownloadDebugSnapshot: "下载调试日志失败",
    noActiveTab: "无可用活动标签页。",
    unsupportedTab: "当前标签页不是支持的 ChatGPT 线程。",
    tabBoundAs: (role: string) => `当前标签页已绑定为 ${role}。`,
    tabEligible: (kind: string) => `当前标签页符合条件（${kind}）。`,
    unbound: "未绑定",
    none: "无",
    idle: "空闲",
    roundLabel: "轮次",
    nextHopLabel: "下一跳",
    currentStepLabel: "当前步骤",
    transportLabel: "传输",
    selectorLabel: "选择器",
    lastIssueLabel: "最后问题",
    threadLabel: "线程",
    projectThreadLabel: "项目线程",
    overrideNone: "不覆盖",
    overrideA: "A → B",
    overrideB: "B → A",
    starterA: "A 起始",
    starterB: "B 起始",
    localeLabel: "语言",
    localeZh: "中文",
    localeEn: "English",
    helpText: "覆盖仅在暂停时生效；清空终端可将已停止/错误状态重置为就绪。",
    readinessLabel: "无法启动:",
    blockReasons: {
      starter_generating: "起始侧正在生成中",
      starter_empty: "起始侧没有可转发回复",
      clear_terminal_required: "需要清空终端",
      missing_binding: "缺少绑定",
      preflight_pending: "等待起始侧就绪"
    }
  }
};

const en: { overlay: OverlayCopy; popup: PopupCopy } = {
  overlay: {
    bridgeTitle: "Bridge",
    phaseReady: "Ready",
    phaseRunning: "Running",
    phasePaused: "Paused",
    phaseStopped: "Stopped",
    phaseError: "Error",
    phaseIdle: "Idle",
    roleUnbound: "Unbound",
    roleBoundA: "Bound as A",
    roleBoundB: "Bound as B",
    roundLabel: "Round",
    nextLabel: "Next",
    stepLabel: "Step",
    issueLabel: "Issue",
    starterLabel: "Starter",
    starterA: "A starts",
    starterB: "B starts",
    bindA: "Bind A",
    bindB: "Bind B",
    unbind: "Idle",
    start: "Start",
    pause: "Pause",
    resume: "Resume",
    stop: "Stop",
    clear: "Clear",
    popup: "Popup",
    collapseExpand: "+",
    collapseCollapse: "−",
    none: "None",
    idle: "idle"
  },
  popup: {
    eyebrow: "ChatGPT Bridge",
    title: "Settings",
    sectionGlobalStatus: "Global status",
    sectionSettings: "Settings",
    sectionFallback: "Fallback",
    sectionDebug: "Debug",
    debugSummary: "Debug info",
    labelStarter: "Starter side",
    labelMaxRoundsLimit: "Round limit",
    labelMaxRounds: "Bridge rounds",
    maxRoundsHelp: "When enabled, stops after the selected count; disabled shows ∞.",
    maxRoundsDecrease: "Decrease bridge rounds",
    maxRoundsIncrease: "Increase bridge rounds",
    roundUnit: "rounds",
    labelOverride: "Paused next hop override",
    labelEnableOverlay: "Enable overlay",
    labelEnableAmbientOverlay: "Site-wide status hint",
    labelDefaultExpanded: "Default expanded overlay",
    bindingA: "Binding A",
    bindingB: "Binding B",
    currentTab: "Current tab",
    unbind: "Unbind",
    start: "Start",
    pause: "Pause",
    resume: "Resume",
    stop: "Stop",
    clearTerminal: "Clear terminal",
    openHelp: "Help",
    resetPosition: "Reset position",
    copyDebug: "Copy debug snapshot",
    downloadDebug: "Download logs",
    copied: "Debug snapshot copied",
    copiedDebugSnapshot: "Copied debug snapshot",
    downloadedDebugSnapshot: "Downloaded debug log",
    failedToCopyDebugSnapshot: "Failed to copy debug snapshot",
    failedToDownloadDebugSnapshot: "Failed to download debug log",
    noActiveTab: "No active tab available.",
    unsupportedTab: "Current tab is not a supported ChatGPT thread.",
    tabBoundAs: (role: string) => `Current tab is bound as ${role}.`,
    tabEligible: (kind: string) => `Current tab is eligible (${kind}).`,
    unbound: "Unbound",
    none: "None",
    idle: "idle",
    roundLabel: "Round",
    nextHopLabel: "Next hop",
    currentStepLabel: "Current step",
    transportLabel: "Transport",
    selectorLabel: "Selector",
    lastIssueLabel: "Last issue",
    threadLabel: "thread",
    projectThreadLabel: "project thread",
    overrideNone: "No override",
    overrideA: "A → B",
    overrideB: "B → A",
    starterA: "A starts",
    starterB: "B starts",
    localeLabel: "Language",
    localeZh: "Chinese",
    localeEn: "English",
    helpText: "Override only applies while paused; Clear returns stopped/error to ready.",
    readinessLabel: "Cannot start:",
    blockReasons: {
      starter_generating: "Starter is still generating",
      starter_empty: "Starter has no reply to forward",
      clear_terminal_required: "Terminal must be cleared",
      missing_binding: "Missing binding",
      preflight_pending: "Waiting for starter to settle"
    }
  }
};

// ── Public API ─────────────────────────────────────────────────────

export function getOverlayCopy(locale: UiLocale): OverlayCopy {
  return locale === "en" ? en.overlay : zhCN.overlay;
}

export function getPopupCopy(locale: UiLocale): PopupCopy {
  return locale === "en" ? en.popup : zhCN.popup;
}

// ── Formatter helpers ──────────────────────────────────────────────

export function formatPhase(locale: UiLocale, phase: string): string {
  const c = getOverlayCopy(locale);
  switch (phase) {
    case "ready": return c.phaseReady;
    case "running": return c.phaseRunning;
    case "paused": return c.phasePaused;
    case "stopped": return c.phaseStopped;
    case "error": return c.phaseError;
    default: return c.phaseIdle;
  }
}

export function formatRoleStatus(locale: UiLocale, assignedRole: string | null): string {
  const c = getOverlayCopy(locale);
  if (!assignedRole) return c.roleUnbound;
  return assignedRole === "A" ? c.roleBoundA : c.roleBoundB;
}

export function formatStarter(locale: UiLocale, role: string): string {
  const c = getOverlayCopy(locale);
  return role === "A" ? c.starterA : c.starterB;
}

export function formatStepLine(locale: UiLocale, step: string | null): string {
  const c = getOverlayCopy(locale);
  const s = step || c.idle;
  return `${c.stepLabel}: ${s}`;
}

export function formatIssueLine(locale: UiLocale, issue: string | null): string {
  const c = getOverlayCopy(locale);
  const i = issue || c.none;
  return `${c.issueLabel}: ${i}`;
}

// ── Static copy application ────────────────────────────────────────

export function applyStaticCopy(root: HTMLElement | Document, locale: UiLocale): void {
  const c = getPopupCopy(locale);
  root.querySelectorAll<HTMLElement>("[data-copy]").forEach((el) => {
    const rawKey = el.dataset.copy;
    if (!rawKey) return;
    const key = rawKey as keyof typeof c;
    const value = c[key];
    if (typeof value === "string") {
      el.textContent = value;
    }
  });
}
