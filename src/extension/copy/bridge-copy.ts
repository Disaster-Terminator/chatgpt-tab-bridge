export type UiLocale = "zh-CN" | "en" | "bilingual";

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

interface PopupCopy {
  eyebrow: string;
  title: string;
  sectionCurrentTab: string;
  sectionBindings: string;
  sectionOverlay: string;
  sectionRunControls: string;
  sectionFallback: string;
  sectionDebug: string;
  debugSummary: string;
  labelStarter: string;
  labelOverride: string;
  labelEnableOverlay: string;
  labelDefaultExpanded: string;
  bindA: string;
  bindB: string;
  unbind: string;
  start: string;
  pause: string;
  resume: string;
  stop: string;
  clearTerminal: string;
  resetPosition: string;
  copyDebug: string;
  copied: string;
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
  overrideNone: string;
  overrideA: string;
  overrideB: string;
  starterA: string;
  starterB: string;
  localeLabel: string;
  localeZh: string;
  localeEn: string;
  localeBilingual: string;
  helpText: string;
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
    unbind: "解绑",
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
    title: "控制面板",
    sectionCurrentTab: "当前标签页",
    sectionBindings: "绑定",
    sectionOverlay: "悬浮窗",
    sectionRunControls: "运行控制",
    sectionFallback: "备用操作",
    sectionDebug: "调试",
    debugSummary: "调试信息",
    labelStarter: "起始侧",
    labelOverride: "暂停时下一跳覆盖",
    labelEnableOverlay: "启用悬浮窗",
    labelDefaultExpanded: "默认展开悬浮窗",
    bindA: "绑定 A",
    bindB: "绑定 B",
    unbind: "解绑",
    start: "开始",
    pause: "暂停",
    resume: "恢复",
    stop: "停止",
    clearTerminal: "清空终端",
    resetPosition: "重置位置",
    copyDebug: "复制调试快照",
    copied: "调试快照已复制",
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
    overrideNone: "不覆盖",
    overrideA: "A → B",
    overrideB: "B → A",
    starterA: "A 起始",
    starterB: "B 起始",
    localeLabel: "语言",
    localeZh: "中文",
    localeEn: "English",
    localeBilingual: "双语",
    helpText: "覆盖仅在暂停时生效；清空终端可将已停止/错误状态重置为就绪。"
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
    unbind: "Unbind",
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
    title: "Popup control surface",
    sectionCurrentTab: "Current tab",
    sectionBindings: "Bindings",
    sectionOverlay: "Overlay",
    sectionRunControls: "Run controls",
    sectionFallback: "Fallback",
    sectionDebug: "Debug",
    debugSummary: "Debug info",
    labelStarter: "Starter side",
    labelOverride: "Paused next hop override",
    labelEnableOverlay: "Enable overlay",
    labelDefaultExpanded: "Default expanded overlay",
    bindA: "Bind A",
    bindB: "Bind B",
    unbind: "Unbind current tab",
    start: "Start",
    pause: "Pause",
    resume: "Resume",
    stop: "Stop",
    clearTerminal: "Clear terminal",
    resetPosition: "Reset position",
    copyDebug: "Copy debug snapshot",
    copied: "Debug snapshot copied",
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
    overrideNone: "No override",
    overrideA: "A → B",
    overrideB: "B → A",
    starterA: "A starts",
    starterB: "B starts",
    localeLabel: "Language",
    localeZh: "中文",
    localeEn: "English",
    localeBilingual: "Bilingual",
    helpText: "Override only applies while paused; Clear returns stopped/error to ready."
  }
};

// ── Bilingual helper ───────────────────────────────────────────────

function toBilingual(zh: string, en: string): string {
  return `${zh} ${en}`;
}

// ── Public API ─────────────────────────────────────────────────────

export function getOverlayCopy(locale: UiLocale): OverlayCopy {
  if (locale === "bilingual") {
    const z = zhCN.overlay;
    const e = en.overlay;
    return {
      bridgeTitle: toBilingual(z.bridgeTitle, e.bridgeTitle),
      phaseReady: toBilingual(z.phaseReady, e.phaseReady),
      phaseRunning: toBilingual(z.phaseRunning, e.phaseRunning),
      phasePaused: toBilingual(z.phasePaused, e.phasePaused),
      phaseStopped: toBilingual(z.phaseStopped, e.phaseStopped),
      phaseError: toBilingual(z.phaseError, e.phaseError),
      phaseIdle: toBilingual(z.phaseIdle, e.phaseIdle),
      roleUnbound: toBilingual(z.roleUnbound, e.roleUnbound),
      roleBoundA: toBilingual(z.roleBoundA, e.roleBoundA),
      roleBoundB: toBilingual(z.roleBoundB, e.roleBoundB),
      roundLabel: toBilingual(z.roundLabel, e.roundLabel),
      nextLabel: toBilingual(z.nextLabel, e.nextLabel),
      stepLabel: toBilingual(z.stepLabel, e.stepLabel),
      issueLabel: toBilingual(z.issueLabel, e.issueLabel),
      starterLabel: toBilingual(z.starterLabel, e.starterLabel),
      starterA: toBilingual(z.starterA, e.starterA),
      starterB: toBilingual(z.starterB, e.starterB),
      bindA: toBilingual(z.bindA, e.bindA),
      bindB: toBilingual(z.bindB, e.bindB),
      unbind: toBilingual(z.unbind, e.unbind),
      start: toBilingual(z.start, e.start),
      pause: toBilingual(z.pause, e.pause),
      resume: toBilingual(z.resume, e.resume),
      stop: toBilingual(z.stop, e.stop),
      clear: toBilingual(z.clear, e.clear),
      popup: toBilingual(z.popup, e.popup),
      collapseExpand: e.collapseExpand,
      collapseCollapse: e.collapseCollapse,
      none: toBilingual(z.none, e.none),
      idle: toBilingual(z.idle, e.idle)
    };
  }
  return locale === "en" ? en.overlay : zhCN.overlay;
}

export function getPopupCopy(locale: UiLocale): PopupCopy {
  if (locale === "bilingual") {
    const z = zhCN.popup;
    const e = en.popup;
    return {
      eyebrow: toBilingual(z.eyebrow, e.eyebrow),
      title: toBilingual(z.title, e.title),
      sectionCurrentTab: toBilingual(z.sectionCurrentTab, e.sectionCurrentTab),
      sectionBindings: toBilingual(z.sectionBindings, e.sectionBindings),
      sectionOverlay: toBilingual(z.sectionOverlay, e.sectionOverlay),
      sectionRunControls: toBilingual(z.sectionRunControls, e.sectionRunControls),
      sectionFallback: toBilingual(z.sectionFallback, e.sectionFallback),
      sectionDebug: toBilingual(z.sectionDebug, e.sectionDebug),
      debugSummary: toBilingual(z.debugSummary, e.debugSummary),
      labelStarter: toBilingual(z.labelStarter, e.labelStarter),
      labelOverride: toBilingual(z.labelOverride, e.labelOverride),
      labelEnableOverlay: toBilingual(z.labelEnableOverlay, e.labelEnableOverlay),
      labelDefaultExpanded: toBilingual(z.labelDefaultExpanded, e.labelDefaultExpanded),
      bindA: toBilingual(z.bindA, e.bindA),
      bindB: toBilingual(z.bindB, e.bindB),
      unbind: toBilingual(z.unbind, e.unbind),
      start: toBilingual(z.start, e.start),
      pause: toBilingual(z.pause, e.pause),
      resume: toBilingual(z.resume, e.resume),
      stop: toBilingual(z.stop, e.stop),
      clearTerminal: toBilingual(z.clearTerminal, e.clearTerminal),
      resetPosition: toBilingual(z.resetPosition, e.resetPosition),
      copyDebug: toBilingual(z.copyDebug, e.copyDebug),
      copied: toBilingual(z.copied, e.copied),
      noActiveTab: toBilingual(z.noActiveTab, e.noActiveTab),
      unsupportedTab: toBilingual(z.unsupportedTab, e.unsupportedTab),
      tabBoundAs: (role: string) => toBilingual(z.tabBoundAs(role), e.tabBoundAs(role)),
      tabEligible: (kind: string) => toBilingual(z.tabEligible(kind), e.tabEligible(kind)),
      unbound: toBilingual(z.unbound, e.unbound),
      none: toBilingual(z.none, e.none),
      idle: toBilingual(z.idle, e.idle),
      roundLabel: toBilingual(z.roundLabel, e.roundLabel),
      nextHopLabel: toBilingual(z.nextHopLabel, e.nextHopLabel),
      currentStepLabel: toBilingual(z.currentStepLabel, e.currentStepLabel),
      transportLabel: toBilingual(z.transportLabel, e.transportLabel),
      selectorLabel: toBilingual(z.selectorLabel, e.selectorLabel),
      lastIssueLabel: toBilingual(z.lastIssueLabel, e.lastIssueLabel),
      overrideNone: toBilingual(z.overrideNone, e.overrideNone),
      overrideA: toBilingual(z.overrideA, e.overrideA),
      overrideB: toBilingual(z.overrideB, e.overrideB),
      starterA: toBilingual(z.starterA, e.starterA),
      starterB: toBilingual(z.starterB, e.starterB),
      localeLabel: toBilingual(z.localeLabel, e.localeLabel),
      localeZh: toBilingual(z.localeZh, e.localeZh),
      localeEn: toBilingual(z.localeEn, e.localeEn),
      localeBilingual: toBilingual(z.localeBilingual, e.localeBilingual),
      helpText: toBilingual(z.helpText, e.helpText)
    };
  }
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
    const key = el.dataset.copy;
    if (!key) return;
    const value = (c as unknown as Record<string, unknown>)[key];
    if (typeof value === "string") {
      el.textContent = value;
    }
  });
}
