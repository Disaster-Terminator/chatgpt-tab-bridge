import React, { useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  ChevronDown,
  ChevronUp,
  Monitor,
  PanelTopOpen,
  Play,
  Pause,
  RotateCcw,
  Square,
  Link2,
  Globe,
  Bug,
  Copy,
  GripHorizontal,
} from "lucide-react";

const phases = ["idle", "ready", "running", "paused", "stopped", "error"] as const;
const roles = ["Unbound", "A", "B"] as const;
const starters = ["A", "B"] as const;
const locales = ["zh-CN", "en"] as const;

type Phase = (typeof phases)[number];
type Role = (typeof roles)[number];
type Starter = (typeof starters)[number];
type Locale = (typeof locales)[number];

type State = {
  phase: Phase;
  role: Role;
  starter: Starter;
  round: number;
  nextHop: "A → B" | "B → A";
  step: string;
  issue: string;
  locale: Locale;
  overlayEnabled: boolean;
  collapsed: boolean;
  debugOpen: boolean;
};

const phaseTone: Record<Phase, string> = {
  idle: "bg-zinc-700/70 text-zinc-200 border-zinc-600/70",
  ready: "bg-sky-400/12 text-sky-200 border-sky-300/20",
  running: "bg-emerald-400/12 text-emerald-200 border-emerald-300/20",
  paused: "bg-amber-400/12 text-amber-200 border-amber-300/20",
  stopped: "bg-zinc-600/60 text-zinc-200 border-zinc-500/60",
  error: "bg-rose-400/12 text-rose-200 border-rose-300/20",
};

function cls(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function PhaseBadge({ phase }: { phase: Phase }) {
  return (
    <div
      className={cls(
        "inline-flex h-6 items-center rounded-full border px-2 text-[9px] font-medium uppercase tracking-[0.16em]",
        phaseTone[phase],
      )}
    >
      {phase}
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <div className="text-[9px] uppercase tracking-[0.2em] text-zinc-500">{children}</div>;
}

function PillButton({
  active,
  children,
  onClick,
}: {
  active?: boolean;
  children: React.ReactNode;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cls(
        "h-9 rounded-full px-3 text-sm transition",
        active
          ? "bg-zinc-100 text-zinc-900 shadow-[0_8px_20px_rgba(255,255,255,0.08)]"
          : "bg-zinc-900/80 text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100",
      )}
    >
      {children}
    </button>
  );
}

function SegmentedStarter({
  value,
  onChange,
}: {
  value: Starter;
  onChange: (value: Starter) => void;
}) {
  return (
    <div className="rounded-[16px] border border-zinc-800/72 bg-[linear-gradient(180deg,rgba(13,14,18,0.9),rgba(9,10,14,0.94))] px-2.5 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.016)]">
      <div className="mb-1.5 flex items-center justify-between px-0.5">
        <span className="text-[9px] uppercase tracking-[0.2em] text-zinc-500">Starter</span>
        <span className="text-[9px] tracking-[0.08em] text-zinc-600">A / B</span>
      </div>

      <div className="relative rounded-[14px] border border-zinc-800/72 bg-black/46 p-[3px] shadow-[inset_0_1px_0_rgba(255,255,255,0.01)]">
        <motion.div
          initial={false}
          animate={{ left: value === "A" ? "3px" : "calc(50% + 1px)" }}
          transition={{ type: "spring", stiffness: 430, damping: 34, mass: 0.62 }}
          className="absolute top-[3px] bottom-[3px] z-0 w-[calc(50%-4px)] rounded-[11px] border border-white/5 bg-[linear-gradient(180deg,rgba(255,255,255,0.045),rgba(255,255,255,0.016))] shadow-[0_4px_12px_rgba(0,0,0,0.16),inset_0_1px_0_rgba(255,255,255,0.025)]"
        />

        <div className="relative z-10 grid grid-cols-2 gap-[3px]">
          {starters.map((item) => {
            const active = item === value;
            return (
              <button
                key={item}
                onClick={() => onChange(item)}
                className={cls(
                  "h-9 rounded-[11px] text-center transition-colors duration-200",
                  active ? "text-zinc-100" : "text-zinc-500 hover:text-zinc-200",
                )}
              >
                <span className={cls("text-[13px] font-semibold tracking-[0.01em]", active && "text-[#f1ede3]")}>{item}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ActionButton({
  icon,
  children,
  tone = "secondary",
  disabled = false,
}: {
  icon?: React.ReactNode;
  children: React.ReactNode;
  tone?: "primary" | "secondary" | "ghost";
  disabled?: boolean;
}) {
  const toneClass = {
    primary:
      "border border-[#c9b37a]/28 bg-[linear-gradient(180deg,rgba(73,61,35,0.72),rgba(34,30,24,0.96))] text-[#ead9a6] shadow-[0_8px_18px_rgba(0,0,0,0.18)] hover:border-[#c9b37a]/40 hover:text-[#f2e5bf]",
    secondary:
      "border border-zinc-800 bg-[linear-gradient(180deg,rgba(31,32,38,0.96),rgba(19,20,24,0.96))] text-zinc-100 hover:border-zinc-700 hover:bg-zinc-800/90",
    ghost:
      "border border-zinc-800/90 bg-transparent text-zinc-400 hover:border-zinc-700 hover:text-zinc-200",
  }[tone];

  return (
    <button
      disabled={disabled}
      className={cls(
        "flex h-9 items-center justify-center gap-2 rounded-[14px] px-3 text-[13px] font-medium transition",
        disabled
          ? "cursor-not-allowed border border-zinc-900 bg-zinc-950/80 text-zinc-600"
          : toneClass,
      )}
    >
      {icon}
      <span>{children}</span>
    </button>
  );
}

function BindingRoleButton({
  role,
  active,
  disabled = false,
}: {
  role: "A" | "B";
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      disabled={disabled}
      className={cls(
        "flex h-10 items-center justify-between rounded-[14px] border px-3 text-left transition",
        disabled
          ? "cursor-not-allowed border-zinc-900 bg-zinc-950/80 text-zinc-600"
          : active
            ? "border-[#c9b37a]/18 bg-[linear-gradient(180deg,rgba(42,37,27,0.5),rgba(17,17,20,0.92))] text-zinc-100 shadow-[0_8px_20px_rgba(0,0,0,0.16)]"
            : "border-zinc-800/90 bg-transparent text-zinc-300 hover:border-zinc-700 hover:text-zinc-100",
      )}
    >
      <div className="flex items-center gap-2">
        <Link2 className={cls("h-4 w-4", active ? "text-[#dbc38f]" : "text-zinc-400")} />
        <span className="text-[13px] font-medium">{role}</span>
      </div>
      <span
        className={cls(
          "inline-flex h-4 items-center rounded-full border px-1.5 text-[8px] uppercase tracking-[0.16em]",
          active
            ? "border-[#c9b37a]/16 bg-[#c9b37a]/7 text-[#c9b37a]"
            : "border-zinc-800/90 bg-zinc-950/65 text-zinc-500",
        )}
      >
        {active ? "Bound" : "Idle"}
      </span>
    </button>
  );
}

function SessionToolbar({
  controls,
}: {
  controls: {
    canStart: boolean;
    canPause: boolean;
    canResume: boolean;
    canStop: boolean;
  };
}) {
  const primary = controls.canPause
    ? { key: "pause", label: "Pause", icon: <Pause className="h-4 w-4" />, enabled: true }
    : controls.canResume
      ? { key: "resume", label: "Resume", icon: <RotateCcw className="h-4 w-4" />, enabled: true }
      : { key: "start", label: "Start", icon: <Play className="h-4 w-4" />, enabled: controls.canStart };

  const stopVisible = controls.canStop;

  return (
    <div className="rounded-[14px] border border-zinc-800/84 bg-[linear-gradient(180deg,rgba(13,14,18,0.9),rgba(9,10,14,0.94))] p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.015)]">
      <div className="grid grid-cols-[1fr_auto] items-center gap-1">
        <button
          disabled={!primary.enabled}
          className={cls(
            "flex h-9 min-w-0 items-center justify-center gap-2 rounded-[11px] border px-3 text-[12px] font-medium transition",
            primary.enabled
              ? "border-[#c9b37a]/18 bg-[linear-gradient(180deg,rgba(60,51,31,0.5),rgba(27,24,21,0.96))] text-[#ead9a6] shadow-[0_4px_12px_rgba(0,0,0,0.12)] hover:border-[#c9b37a]/28 hover:text-[#f1e2b6]"
              : "cursor-not-allowed border-zinc-900 bg-zinc-950/72 text-zinc-600",
          )}
        >
          {primary.icon}
          <span>{primary.label}</span>
        </button>

        {stopVisible ? (
          <button className="flex h-9 w-9 items-center justify-center rounded-[11px] border border-zinc-800/90 bg-transparent text-zinc-300 transition hover:border-zinc-700 hover:bg-zinc-900/72 hover:text-zinc-100">
            <Square className="h-4 w-4" />
          </button>
        ) : (
          <div className="w-0" />
        )}
      </div>
    </div>
  );
}

function UtilityToolbar({ canClear }: { canClear: boolean }) {
  return (
    <div className="rounded-[14px] border border-zinc-800/82 bg-[linear-gradient(180deg,rgba(13,14,18,0.88),rgba(9,10,14,0.93))] p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.012)]">
      <div className="grid grid-cols-2 gap-1">
        <button
          disabled={!canClear}
          className={cls(
            "flex h-8.5 items-center justify-center gap-2 rounded-[11px] border px-3 text-[12px] font-medium transition",
            canClear
              ? "border-zinc-800/88 bg-transparent text-zinc-300 hover:border-zinc-700 hover:bg-zinc-900/68 hover:text-zinc-100"
              : "cursor-not-allowed border-zinc-900 bg-zinc-950/72 text-zinc-600",
          )}
        >
          <span>Clear</span>
        </button>

        <button className="flex h-8.5 items-center justify-center gap-1.5 rounded-[11px] border border-zinc-800/88 bg-transparent px-2 text-[12px] font-medium text-zinc-300 transition hover:border-zinc-700 hover:bg-zinc-900/68 hover:text-zinc-100">
          <PanelTopOpen className="h-4 w-4" />
          <span>Popup</span>
        </button>
      </div>
    </div>
  );
}

function StatusPanel({
  round,
  nextHop,
  step,
  issue,
}: {
  round: number;
  nextHop: State["nextHop"];
  step: string;
  issue: string;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2 text-[10px] text-zinc-400">
        <span className="uppercase tracking-[0.18em] text-zinc-500">Round</span>
        <span className="text-[12px] font-medium text-zinc-100">{round}</span>
        <span className="h-1 w-1 rounded-full bg-zinc-700" />
        <span className="uppercase tracking-[0.18em] text-zinc-500">Next</span>
        <span className="text-[12px] font-medium text-zinc-100">{nextHop}</span>
      </div>

      <div className="rounded-[12px] border border-zinc-800/76 bg-[linear-gradient(180deg,rgba(11,15,22,0.58),rgba(8,10,15,0.82))] px-2.5 py-2">
        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.18em] text-zinc-500">
          <span className="inline-flex h-1.5 w-1.5 rounded-full bg-sky-300/80 shadow-[0_0_8px_rgba(125,211,252,0.24)]" />
          <span>Step</span>
        </div>
        <div className="mt-1 text-[13px] font-medium text-zinc-100">{step}</div>
        {issue !== "None" ? (
          <div className="mt-2 rounded-[10px] border border-amber-400/16 bg-amber-400/6 px-2 py-1.5 text-[11px] text-amber-200/90">
            {issue}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function OverlayPreview({ state }: { state: State }) {
  const controls = useMemo(() => {
    return {
      canBind: state.phase === "idle" || state.phase === "ready" || state.phase === "stopped" || state.phase === "error",
      canStart: state.phase === "ready",
      canPause: state.phase === "running",
      canResume: state.phase === "paused",
      canStop: state.phase === "running" || state.phase === "paused",
      canClear: state.phase === "stopped" || state.phase === "error",
    };
  }, [state]);

  return (
    <div className="rounded-[32px] border border-zinc-800 bg-[linear-gradient(180deg,rgba(17,18,22,1),rgba(8,9,12,1))] p-4 shadow-[0_30px_100px_rgba(0,0,0,0.45)] md:p-6">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <div className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">Overlay preview</div>
          <div className="mt-2 text-xl font-semibold text-zinc-100">Overlay / 高频主操作面</div>
          <div className="mt-2 max-w-xl text-sm leading-6 text-zinc-400">
            更克制的小面板比例。重点是 round / next / step / starter / session control，避免解释性标题和多余说明。
          </div>
        </div>
      </div>

      <div className="relative overflow-hidden rounded-[28px] border border-zinc-800 bg-zinc-950/80 min-h-[700px]">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.04),transparent_28%)]" />
        <div className="absolute left-0 right-0 top-0 h-14 border-b border-zinc-800 bg-zinc-950/85" />
        <div className="absolute left-0 top-14 bottom-0 w-[220px] border-r border-zinc-800 bg-zinc-950/78" />
        <div className="absolute inset-x-[250px] top-24 bottom-8 space-y-5">
          <div className="h-20 rounded-[26px] border border-zinc-800 bg-zinc-900/45" />
          <div className="h-28 rounded-[26px] border border-zinc-800 bg-zinc-900/45" />
          <div className="h-48 rounded-[26px] border border-zinc-800 bg-zinc-900/45" />
          <div className="h-24 rounded-[26px] border border-zinc-800 bg-zinc-900/45" />
        </div>

        {state.overlayEnabled ? (
          <div className="absolute right-5 top-5">
            <motion.aside
              initial={false}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              className="w-[288px] rounded-[24px] border border-[#9f8457]/28 bg-[radial-gradient(circle_at_top_right,rgba(214,186,125,0.06),transparent_28%),linear-gradient(180deg,rgba(28,29,34,0.98),rgba(9,10,14,0.98))] p-3.5 shadow-[0_24px_72px_rgba(0,0,0,0.52)] backdrop-blur-xl"
            >
              <div className="flex items-center justify-between gap-2.5">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-[#dbc38f]">
                    <GripHorizontal className="h-4 w-4" />
                    <span className="text-[12px] font-semibold uppercase tracking-[0.18em]">Bridge</span>
                  </div>
                  <div className="mt-1 flex items-center gap-1.5 text-[10px] text-zinc-500">
                    <span className={cls("inline-block h-1.5 w-1.5 rounded-full", state.role === "Unbound" ? "bg-zinc-600" : "bg-[#c9b37a]/70")} />
                    <span>{state.role === "Unbound" ? "Role · Unbound" : `Role · ${state.role}`}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <PhaseBadge phase={state.phase} />
                  <button className="flex h-7 w-7 items-center justify-center rounded-[12px] border border-zinc-800 bg-zinc-950/70 text-zinc-300 transition hover:border-zinc-700 hover:text-zinc-100">
                    {state.collapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {state.collapsed ? (
                <div className="mt-4 flex items-center justify-between text-sm text-zinc-300">
                  <span>{state.role === "Unbound" ? "Unbound" : `Bound as ${state.role}`}</span>
                  <span>R{state.round}</span>
                  <span>{state.nextHop}</span>
                </div>
              ) : (
                <>
                  <div className="mt-1.5">
                    <StatusPanel round={state.round} nextHop={state.nextHop} step={state.step} issue={state.issue} />
                  </div>

                  <div className="mt-2">
                    <SegmentedStarter value={state.starter} onChange={() => {}} />
                  </div>

                  <div className="mt-2 rounded-[16px] border border-zinc-800/80 bg-[linear-gradient(180deg,rgba(14,15,20,0.88),rgba(9,10,14,0.94))] p-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.014)]">
                    <div>
                      <Label>Binding</Label>
                      <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                        <BindingRoleButton role="A" active={state.role === "A"} disabled={!controls.canBind && state.role !== "A"} />
                        <BindingRoleButton role="B" active={state.role === "B"} disabled={!controls.canBind && state.role !== "B"} />
                      </div>
                    </div>

                    <div className="mt-2 border-t border-zinc-800/72 pt-2">
                      <Label>Session</Label>
                      <div className="mt-1.5">
                        <SessionToolbar
                          controls={{
                            canStart: controls.canStart,
                            canPause: controls.canPause,
                            canResume: controls.canResume,
                            canStop: controls.canStop,
                          }}
                        />
                      </div>
                    </div>

                    <div className="mt-2 border-t border-zinc-800/72 pt-2">
                      <Label>Utility</Label>
                      <div className="mt-1.5">
                        <UtilityToolbar canClear={controls.canClear} />
                      </div>
                    </div>
                  </div>
                </>
              )}
            </motion.aside>
          </div>
        ) : (
          <div className="absolute right-8 top-8 rounded-[24px] border border-zinc-800 bg-zinc-950/85 px-5 py-4 text-sm text-zinc-500">
            Overlay disabled
          </div>
        )}
      </div>
    </div>
  );
}

function PopupPreview({ state }: { state: State }) {
  const isZh = state.locale === "zh-CN";
  const t = {
    popup: isZh ? "Popup" : "Popup",
    title: isZh ? "设置" : "Settings",
    subtitle: isZh ? "总览、设置与调试入口" : "Overview, settings and debug access",
    globalStatus: isZh ? "全局状态" : "Global status",
    bridge: "Bridge",
    popupHint: isZh ? "仅负责全局概览与低频控制。" : "Overview and low-frequency controls only.",
    round: isZh ? "轮次" : "Round",
    next: isZh ? "下一跳" : "Next",
    step: isZh ? "步骤" : "Step",
    bindingA: isZh ? "绑定 A" : "Binding A",
    bindingB: isZh ? "绑定 B" : "Binding B",
    currentTab: isZh ? "当前标签页" : "Current tab",
    currentTabValueA: isZh ? "当前页" : "Current tab",
    currentTabValueB: isZh ? "当前页" : "Current tab",
    threadA: isZh ? "线程 A / 标签 #18" : "Thread A / tab #18",
    threadB: isZh ? "线程 B / 标签 #21" : "Thread B / tab #21",
    role: isZh ? `角色 · ${state.role}` : `Role · ${state.role}`,
    eligible: isZh ? "可绑定项目线程" : "Eligible project thread",
    settings: isZh ? "设置" : "Settings",
    language: isZh ? "语言" : "Language",
    enableOverlay: isZh ? "启用悬浮窗" : "Enable overlay",
    defaultExpanded: isZh ? "默认展开" : "Default expanded",
    resetPosition: isZh ? "重置悬浮窗位置" : "Reset overlay position",
    fallback: isZh ? "备用操作" : "Fallback",
    override: isZh ? "暂停态下一跳覆盖" : "Paused next hop override",
    overrideHint: isZh ? "仅在暂停时可编辑" : "Only editable when paused",
    clearTerminal: isZh ? "清空终端" : "Clear terminal",
    openHelp: isZh ? "打开帮助" : "Open help",
    debug: isZh ? "调试" : "Debug",
    debugHint: isZh ? "默认折叠" : "Collapsed by default",
    issue: isZh ? "问题" : "Issue",
    transport: isZh ? "传输" : "Transport",
    selector: isZh ? "选择器" : "Selector",
    copyDebug: isZh ? "复制调试快照" : "Copy debug snapshot",
  };

  return (
    <div className="mx-auto w-full max-w-[404px] rounded-[26px] border border-zinc-800/84 bg-[radial-gradient(circle_at_top_right,rgba(214,186,125,0.035),transparent_24%),linear-gradient(180deg,rgba(22,23,28,0.98),rgba(10,11,15,0.98))] p-3.5 shadow-[0_24px_72px_rgba(0,0,0,0.4)]">
      <div className="mb-3.5">
        <div className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">{t.popup}</div>
        <div className="mt-1 text-[18px] font-semibold text-zinc-100">{t.title}</div>
        <div className="mt-1 text-[12px] text-zinc-500">{t.subtitle}</div>
      </div>

      <div className="space-y-2.5">
        <section className="rounded-[17px] border border-zinc-800/82 bg-[linear-gradient(180deg,rgba(14,15,20,0.9),rgba(9,10,14,0.94))] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.014)]">
          <div className="flex items-start justify-between gap-3">
            <div>
              <Label>{t.globalStatus}</Label>
              <div className="mt-1 text-[15px] font-semibold text-zinc-100">{t.bridge}</div>
              <div className="mt-1 text-[12px] text-zinc-500">{t.popupHint}</div>
            </div>
            <PhaseBadge phase={state.phase} />
          </div>

          <div className="mt-2.5 space-y-2">
            <div className="flex items-center gap-2 text-[10px] text-zinc-400">
              <span className="uppercase tracking-[0.18em] text-zinc-500">{t.round}</span>
              <span className="font-medium text-zinc-100">{state.round}</span>
              <span className="h-1 w-1 rounded-full bg-zinc-700" />
              <span className="uppercase tracking-[0.18em] text-zinc-500">{t.next}</span>
              <span className="font-medium text-zinc-100">{state.nextHop}</span>
            </div>
            <div className="rounded-[12px] border border-zinc-800/78 bg-[linear-gradient(180deg,rgba(11,15,22,0.54),rgba(8,10,15,0.8))] px-2.5 py-2">
              <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.18em] text-zinc-500">
                <span className="inline-flex h-1.5 w-1.5 rounded-full bg-sky-300/80 shadow-[0_0_8px_rgba(125,211,252,0.2)]" />
                <span>{t.step}</span>
              </div>
              <div className="mt-1 text-[13px] font-medium text-zinc-100">{state.step}</div>
              {state.issue !== "None" ? (
                <div className="mt-2 rounded-[10px] border border-amber-400/16 bg-amber-400/6 px-2 py-1.5 text-[11px] text-amber-200/90">
                  {state.issue}
                </div>
              ) : null}
            </div>
          </div>

          <div className="mt-2.5 grid grid-cols-2 gap-2">
            <div className="rounded-[12px] border border-zinc-800/78 bg-zinc-900/38 px-2.5 py-2">
              <div className="text-[9px] uppercase tracking-[0.18em] text-zinc-500">{t.bindingA}</div>
              <div className="mt-1.5 text-[12px] font-medium text-zinc-100">{state.role === "A" ? t.currentTabValueA : t.threadA}</div>
            </div>
            <div className="rounded-[12px] border border-zinc-800/78 bg-zinc-900/38 px-2.5 py-2">
              <div className="text-[9px] uppercase tracking-[0.18em] text-zinc-500">{t.bindingB}</div>
              <div className="mt-1.5 text-[12px] font-medium text-zinc-100">{state.role === "B" ? t.currentTabValueB : t.threadB}</div>
            </div>
          </div>

          <div className="mt-2 rounded-[12px] border border-zinc-800/78 bg-zinc-900/38 px-2.5 py-2">
            <div className="text-[9px] uppercase tracking-[0.18em] text-zinc-500">{t.currentTab}</div>
            <div className="mt-1.5 text-[12px] font-medium text-zinc-100">{state.role === "Unbound" ? t.eligible : t.role}</div>
          </div>
        </section>

        <section className="rounded-[17px] border border-zinc-800/82 bg-[linear-gradient(180deg,rgba(14,15,20,0.9),rgba(9,10,14,0.94))] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.014)]">
          <Label>{t.settings}</Label>
          <div className="mt-1.5 space-y-1.5">
            <div className="flex items-center justify-between rounded-[12px] border border-zinc-800/78 bg-zinc-900/38 px-2.5 py-2 text-[12px]">
              <span className="text-zinc-400">{t.language}</span>
              <div className="rounded-full border border-zinc-800/90 bg-zinc-950/68 px-2 py-1 text-zinc-100">{state.locale}</div>
            </div>
            <div className="flex items-center justify-between rounded-[12px] border border-zinc-800/78 bg-zinc-900/38 px-2.5 py-2 text-[12px]">
              <span className="text-zinc-400">{t.enableOverlay}</span>
              <div className={cls("relative h-5 w-10 rounded-full transition", state.overlayEnabled ? "bg-zinc-200" : "bg-zinc-700")}>
                <div className={cls("absolute top-0.5 h-4 w-4 rounded-full bg-zinc-950 transition", state.overlayEnabled ? "left-[20px]" : "left-0.5")} />
              </div>
            </div>
            <div className="flex items-center justify-between rounded-[12px] border border-zinc-800/78 bg-zinc-900/38 px-2.5 py-2 text-[12px]">
              <span className="text-zinc-400">{t.defaultExpanded}</span>
              <div className={cls("relative h-5 w-10 rounded-full transition", !state.collapsed ? "bg-zinc-200" : "bg-zinc-700")}>
                <div className={cls("absolute top-0.5 h-4 w-4 rounded-full bg-zinc-950 transition", !state.collapsed ? "left-[20px]" : "left-0.5")} />
              </div>
            </div>
            <button className="flex w-full items-center justify-between rounded-[12px] border border-zinc-800/78 bg-zinc-900/38 px-2.5 py-2 text-[12px] font-medium text-zinc-300 transition hover:border-zinc-700 hover:bg-zinc-900/64 hover:text-zinc-100">
              <span>{t.resetPosition}</span>
              <RotateCcw className="h-4 w-4 text-zinc-400" />
            </button>
          </div>
        </section>

        <section className="rounded-[17px] border border-zinc-800/82 bg-[linear-gradient(180deg,rgba(14,15,20,0.9),rgba(9,10,14,0.94))] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.014)]">
          <Label>{t.fallback}</Label>
          <div className="mt-1.5 rounded-[12px] border border-zinc-800/78 bg-zinc-900/38 px-2.5 py-2">
            <div className="text-[9px] uppercase tracking-[0.18em] text-zinc-500">{t.override}</div>
            <div className="mt-1.5 text-[12px] text-zinc-500">{t.overrideHint}</div>
          </div>
          <div className="mt-1.5 grid grid-cols-2 gap-1.5">
            <button className="flex h-8.5 items-center justify-center rounded-[11px] border border-zinc-800/88 bg-transparent px-3 text-[12px] font-medium text-zinc-300 transition hover:border-zinc-700 hover:bg-zinc-900/68 hover:text-zinc-100">
              {t.clearTerminal}
            </button>
            <button className="flex h-8.5 items-center justify-center rounded-[11px] border border-zinc-800/88 bg-transparent px-3 text-[12px] font-medium text-zinc-300 transition hover:border-zinc-700 hover:bg-zinc-900/68 hover:text-zinc-100">
              {t.openHelp}
            </button>
          </div>
        </section>

        <section className="rounded-[17px] border border-zinc-800/82 bg-[linear-gradient(180deg,rgba(14,15,20,0.9),rgba(9,10,14,0.94))] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.014)]">
          <button className="flex w-full items-center justify-between text-left">
            <div className="flex items-center gap-2 text-zinc-200">
              <Bug className="h-4 w-4" />
              <span className="text-[13px] font-medium">{t.debug}</span>
            </div>
            {state.debugOpen ? <ChevronUp className="h-4 w-4 text-zinc-400" /> : <ChevronDown className="h-4 w-4 text-zinc-400" />}
          </button>

          {state.debugOpen ? (
            <div className="mt-1.5 space-y-1.5">
              {[
                [t.step, state.step],
                [t.issue, state.issue],
                [t.transport, "dom"],
                [t.selector, "textarea[data-testid=prompt-textarea]"],
              ].map(([k, v]) => (
                <div key={k} className="rounded-[12px] border border-zinc-800/78 bg-zinc-900/38 px-2.5 py-2 text-[12px] text-zinc-200">
                  <span className="text-zinc-500">{k}: </span>
                  <span>{v}</span>
                </div>
              ))}
              <button className="flex w-full items-center justify-between rounded-[12px] border border-zinc-800/88 bg-zinc-100 px-3 py-2 text-[12px] font-medium text-zinc-900">
                <span>{t.copyDebug}</span>
                <Copy className="h-4 w-4" />
              </button>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}

function ControlPanel({
  state,
  setState,
}: {
  state: State;
  setState: React.Dispatch<React.SetStateAction<State>>;
}) {
  return (
    <div className="rounded-[30px] border border-zinc-800 bg-[linear-gradient(180deg,rgba(20,21,26,0.98),rgba(10,11,15,0.98))] p-5 shadow-[0_24px_80px_rgba(0,0,0,0.4)]">
      <div className="mb-5 flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">Preview controls</div>
          <div className="mt-2 text-xl font-semibold text-zinc-100">状态预览</div>
          <div className="mt-2 text-sm leading-6 text-zinc-400">只用于切换预览状态，帮助继续迭代比例、层级和交互感。</div>
        </div>
        <div className="rounded-2xl border border-zinc-800 bg-zinc-950/80 px-3 py-2 text-xs text-zinc-400">Canvas</div>
      </div>

      <div className="space-y-5">
        <div>
          <Label>Phase</Label>
          <div className="mt-2 flex flex-wrap gap-2">
            {phases.map((item) => (
              <PillButton key={item} active={state.phase === item} onClick={() => setState((s) => ({ ...s, phase: item }))}>
                {item}
              </PillButton>
            ))}
          </div>
        </div>

        <div className="grid gap-5 md:grid-cols-2">
          <div>
            <Label>Role</Label>
            <div className="mt-2 flex flex-wrap gap-2">
              {roles.map((item) => (
                <PillButton key={item} active={state.role === item} onClick={() => setState((s) => ({ ...s, role: item }))}>
                  {item}
                </PillButton>
              ))}
            </div>
          </div>
          <div>
            <Label>Locale</Label>
            <div className="mt-2 flex flex-wrap gap-2">
              {locales.map((item) => (
                <PillButton key={item} active={state.locale === item} onClick={() => setState((s) => ({ ...s, locale: item }))}>
                  {item}
                </PillButton>
              ))}
            </div>
          </div>
        </div>

        <div className="grid gap-5 md:grid-cols-2">
          <div>
            <Label>Starter</Label>
            <div className="mt-2 flex gap-2">
              {starters.map((item) => (
                <PillButton key={item} active={state.starter === item} onClick={() => setState((s) => ({ ...s, starter: item }))}>
                  {item}
                </PillButton>
              ))}
            </div>
          </div>
          <div>
            <Label>Round</Label>
            <div className="mt-2 rounded-[18px] border border-zinc-800 bg-zinc-950/80 px-4 py-3 text-zinc-100">{state.round}</div>
            <input
              type="range"
              min={0}
              max={12}
              value={state.round}
              onChange={(e) => setState((s) => ({ ...s, round: Number(e.target.value) }))}
              className="mt-3 w-full accent-zinc-300"
            />
          </div>
        </div>

        <div className="grid gap-5 md:grid-cols-2">
          <button
            onClick={() => setState((s) => ({ ...s, overlayEnabled: !s.overlayEnabled }))}
            className="flex items-center justify-between rounded-[20px] border border-zinc-800 bg-zinc-950/80 px-4 py-4 text-left"
          >
            <div>
              <div className="text-sm font-medium text-zinc-100">Overlay</div>
              <div className="mt-1 text-sm text-zinc-500">启用或隐藏 overlay</div>
            </div>
            <Monitor className="h-5 w-5 text-zinc-400" />
          </button>
          <button
            onClick={() => setState((s) => ({ ...s, collapsed: !s.collapsed }))}
            className="flex items-center justify-between rounded-[20px] border border-zinc-800 bg-zinc-950/80 px-4 py-4 text-left"
          >
            <div>
              <div className="text-sm font-medium text-zinc-100">Collapsed</div>
              <div className="mt-1 text-sm text-zinc-500">切换 overlay 展开 / 折叠</div>
            </div>
            <PanelTopOpen className="h-5 w-5 text-zinc-400" />
          </button>
        </div>

        <div>
          <Label>Issue / Step</Label>
          <div className="mt-2 grid gap-3 md:grid-cols-2">
            <input
              value={state.step}
              onChange={(e) => setState((s) => ({ ...s, step: e.target.value }))}
              className="h-12 rounded-[18px] border border-zinc-800 bg-zinc-950/80 px-4 text-sm text-zinc-100 outline-none placeholder:text-zinc-600"
              placeholder="step"
            />
            <input
              value={state.issue === "None" ? "" : state.issue}
              onChange={(e) => setState((s) => ({ ...s, issue: e.target.value.trim() ? e.target.value : "None" }))}
              className="h-12 rounded-[18px] border border-zinc-800 bg-zinc-950/80 px-4 text-sm text-zinc-100 outline-none placeholder:text-zinc-600"
              placeholder="issue"
            />
          </div>
        </div>

        <button
          onClick={() => setState((s) => ({ ...s, debugOpen: !s.debugOpen }))}
          className="flex w-full items-center justify-between rounded-[20px] border border-zinc-800 bg-zinc-950/80 px-4 py-4 text-left"
        >
          <div>
            <div className="text-sm font-medium text-zinc-100">Debug fold</div>
            <div className="mt-1 text-sm text-zinc-500">切换 popup 里的 Debug 折叠态</div>
          </div>
          <Globe className="h-5 w-5 text-zinc-400" />
        </button>
      </div>
    </div>
  );
}

export default function ChatgptTabBridgePreview() {
  const [state, setState] = useState<State>({
    phase: "ready",
    role: "A",
    starter: "A",
    round: 3,
    nextHop: "A → B",
    step: "waiting B reply",
    issue: "None",
    locale: "zh-CN",
    overlayEnabled: true,
    collapsed: false,
    debugOpen: false,
  });

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.05),transparent_24%),linear-gradient(180deg,#111216_0%,#090a0d_100%)] text-zinc-100">
      <div className="mx-auto max-w-[1600px] px-6 py-8 md:px-8 md:py-10">
        <div className="mb-8 max-w-3xl">
          <div className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">ChatGPT Tab Bridge</div>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight md:text-4xl">前端预览继续迭代版</h1>
          <p className="mt-3 text-sm leading-7 text-zinc-400 md:text-base">
            这一版把重心放在更克制的面板比例、弱化“按钮墙”感、重做 starter 的 A/B 同级 segmented control，以及把 popup 收敛成真正的低频设置面。
          </p>
        </div>

        <div className="grid gap-6 xl:grid-cols-[380px_minmax(0,1fr)_450px]">
          <ControlPanel state={state} setState={setState} />
          <OverlayPreview state={state} />
          <PopupPreview state={state} />
        </div>
      </div>
    </div>
  );
}
