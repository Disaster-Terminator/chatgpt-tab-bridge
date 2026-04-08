export type BridgeRole = "A" | "B";

export type RuntimePhase = "idle" | "ready" | "running" | "paused" | "stopped" | "error";

export type StopReason =
  | "user_stop"
  | "stop_marker"
  | "max_rounds_reached"
  | "duplicate_output"
  | "hop_timeout"
  | "binding_invalid"
  | "starter_settle_timeout"
  | "target_settle_timeout"
  | "submission_not_verified"
  | "bootstrap_seed_not_sent"
  | "dispatch_rejected"
  | "verification_failed"
  | "waiting_before_acceptance"
  | "url_not_available";

export type ErrorReason =
  | "selector_failure"
  | "message_send_failed"
  | "unsupported_tab"
  | "empty_assistant_reply"
  | "internal_error";

export type MessageType =
  | "GET_RUNTIME_STATE"
  | "GET_POPUP_MODEL"
  | "GET_OVERLAY_MODEL"
  | "SET_BINDING"
  | "CLEAR_BINDING"
  | "SET_STARTER"
  | "START_SESSION"
  | "PAUSE_SESSION"
  | "RESUME_SESSION"
  | "STOP_SESSION"
  | "CLEAR_TERMINAL"
  | "SET_NEXT_HOP_OVERRIDE"
  | "SET_OVERLAY_ENABLED"
  | "SET_OVERLAY_COLLAPSED"
  | "SET_OVERLAY_POSITION"
  | "RESET_OVERLAY_POSITION"
  | "GET_ASSISTANT_SNAPSHOT"
  | "GET_THREAD_ACTIVITY"
  | "GET_LAST_ACK_DEBUG"
  | "GET_LATEST_USER_TEXT"
  | "GET_RECENT_RUNTIME_EVENTS"
  | "SEND_RELAY_MESSAGE"
  | "SYNC_OVERLAY_STATE"
  | "REQUEST_OPEN_POPUP";

export type BridgeDirective = "CONTINUE" | "FREEZE";
export type RelayGuardReason = "stop_marker" | "duplicate_output" | "max_rounds_reached";

export interface ChatGptThreadUrlInfo {
  supported: true;
  kind: "project" | "regular";
  projectId: string | null;
  conversationId: string;
  normalizedUrl: string;
}

export interface UnsupportedChatGptUrlInfo {
  supported: false;
  kind: "unsupported";
  projectId: null;
  conversationId: null;
  normalizedUrl: string | null;
  reason: string;
}

export type ChatGptUrlInfo = ChatGptThreadUrlInfo | UnsupportedChatGptUrlInfo;

export type IdentityKind = "live_session" | "persistent_url";

export interface LiveSessionIdentity {
  kind: "live_session";
  tabId: number;
  role: BridgeRole;
  boundAt: string;
  observedSnapshot: {
    userMessageCount: number;
    assistantMessageCount: number;
    hasComposer: boolean;
    latestUserHash: string | null;
    latestAssistantHash: string | null;
  } | null;
  currentRound: number;
}

export interface PersistentUrlIdentity {
  kind: "persistent_url";
  tabId: number;
  role: BridgeRole;
  boundAt: string;
  url: string;
  urlInfo: ChatGptUrlInfo;
  currentRound: number;
}

export type SessionIdentity = LiveSessionIdentity | PersistentUrlIdentity;

export interface RuntimeBinding {
  role: BridgeRole;
  tabId: number;
  title: string;
  url: string;
  urlInfo: ChatGptUrlInfo | null;
  sessionIdentity: SessionIdentity | null;
  boundAt: string;
}

export interface RuntimeSettings {
  maxRounds: number;
  hopTimeoutMs: number;
  pollIntervalMs: number;
  settleSamplesRequired: number;
  bridgeStatePrefix: string;
  continueMarker: string;
  stopMarker: string;
}

export interface OverlayPosition {
  x: number;
  y: number;
}

export interface OverlaySettings {
  enabled: boolean;
  collapsed: boolean;
  position: OverlayPosition | null;
}

export interface RuntimeActivity {
  step: string;
  sourceRole: BridgeRole | null;
  targetRole: BridgeRole | null;
  pendingRound: number | null;
  lastActionAt: string | null;
  transport: string | null;
  selector: string | null;
}

export interface CompletedHop {
  sourceRole: BridgeRole;
  targetRole: BridgeRole;
  sourceHash: string | null;
  targetHash: string | null;
  round: number;
}

export interface RuntimeState {
  phase: RuntimePhase;
  bindings: Record<BridgeRole, RuntimeBinding | null>;
  settings: RuntimeSettings;
  starter: BridgeRole;
  nextHopSource: BridgeRole;
  nextHopOverride: BridgeRole | null;
  round: number;
  sessionId: number;
  pendingFreshSession: boolean;
  requiresTerminalClear: boolean;
  lastStopReason: string | null;
  lastError: string | null;
  lastCompletedHop: CompletedHop | null;
  lastForwardedHashes: Record<BridgeRole, string | null>;
  lastAssistantHashes: Record<BridgeRole, string | null>;
  runtimeActivity: RuntimeActivity;
  updatedAt: string;
}

export interface PopupControls {
  canStart: boolean;
  canPause: boolean;
  canResume: boolean;
  canStop: boolean;
  canClearTerminal: boolean;
  canSetStarter: boolean;
  canSetOverride: boolean;
}

export interface RuntimeDisplay {
  nextHop: string;
  currentStep: string;
  lastActionAt: string | null;
  transport: string | null;
  selector: string | null;
  lastIssue: string;
}

export interface PopupCurrentTab {
  id: number | undefined;
  title: string;
  url: string;
  urlInfo: ChatGptUrlInfo;
  assignedRole: BridgeRole | null;
}

export interface PopupModel {
  state: RuntimeState;
  overlaySettings: OverlaySettings;
  currentTab: PopupCurrentTab | null;
  controls: PopupControls;
  display: RuntimeDisplay;
  readiness: ExecutionReadiness;
}

export interface OverlayModel {
  phase: RuntimePhase;
  round: number;
  nextHop: string;
  requiresTerminalClear: boolean;
  assignedRole: BridgeRole | null;
  starter: BridgeRole;
  controls: PopupControls;
  display: RuntimeDisplay;
  overlaySettings: OverlaySettings;
  readiness: ExecutionReadiness;
  currentTabId: number | null;
}

export interface AssistantSnapshot {
  text: string;
  hash: string;
}

export type AssistantSnapshotResponse =
  | { ok: true; result: AssistantSnapshot }
  | { ok: false; error: string };

export interface ThreadActivity {
  generating: boolean;
  latestAssistantHash: string | null;
  latestUserHash: string | null;
  composerText: string;
  sendButtonReady: boolean;
  composerAvailable: boolean;
}

export type ThreadActivityResponse =
  | { ok: true; result: ThreadActivity }
  | { ok: false; error: string };

export type BlockReason =
  | "starter_generating"
  | "clear_terminal_required"
  | "missing_binding"
  | "preflight_pending";

export interface ExecutionReadiness {
  starterReady: boolean;
  preflightPending: boolean;
  blockReason: BlockReason | null;
  sourceRole: BridgeRole | null;
}

export type RelaySendMode = "button" | "form_submit" | "button_missing" | "button_disabled";

export type RelayDispatchSignal =
  | "user_message_added"
  | "generation_started"
  | "trigger_consumed"
  | "composer_cleared"
  | "none";

export interface RelayDispatchEvidence {
  baselineUserHash: string | null;
  currentUserHash: string | null;
  baselineGenerating: boolean;
  currentGenerating: boolean;
  baselineComposerPreview: string;
  preTriggerText: string;
  postTriggerText: string;
  latestUserPreview: string | null;
  textChanged: boolean;
  payloadReleased: boolean;
  buttonStateChanged: boolean;
  ackSignal: RelayDispatchSignal;
  attempts: number;
}

export type RelayMessageResponse =
  | {
      ok: true;
      mode: RelaySendMode;
      applyMode: string;
      dispatchAccepted: true;
      dispatchSignal: Exclude<RelayDispatchSignal, "composer_cleared" | "none">;
      dispatchEvidence: RelayDispatchEvidence;
      error: null;
    }
  | {
      ok: false;
      mode?: RelaySendMode;
      applyMode?: string;
      dispatchAccepted?: false;
      dispatchSignal?: RelayDispatchSignal;
      dispatchEvidence?: RelayDispatchEvidence;
      dispatchErrorCode?: string;
      error: string;
    };

export interface MessageBase {
  type: MessageType;
}

export interface GetRuntimeStateMessage extends MessageBase {
  type: "GET_RUNTIME_STATE";
}

export interface GetPopupModelMessage extends MessageBase {
  type: "GET_POPUP_MODEL";
  activeTabId?: number | null;
}

export interface GetOverlayModelMessage extends MessageBase {
  type: "GET_OVERLAY_MODEL";
}

export interface SetBindingMessage extends MessageBase {
  type: "SET_BINDING";
  role: BridgeRole;
  tabId?: number | null;
}

export interface ClearBindingMessage extends MessageBase {
  type: "CLEAR_BINDING";
  role?: BridgeRole | null;
}

export interface SetStarterMessage extends MessageBase {
  type: "SET_STARTER";
  role: BridgeRole;
}

export interface StartSessionMessage extends MessageBase {
  type: "START_SESSION";
}

export interface PauseSessionMessage extends MessageBase {
  type: "PAUSE_SESSION";
}

export interface ResumeSessionMessage extends MessageBase {
  type: "RESUME_SESSION";
}

export interface StopSessionMessage extends MessageBase {
  type: "STOP_SESSION";
}

export interface ClearTerminalMessage extends MessageBase {
  type: "CLEAR_TERMINAL";
}

export interface SetNextHopOverrideMessage extends MessageBase {
  type: "SET_NEXT_HOP_OVERRIDE";
  role: BridgeRole | null;
}

export interface SetOverlayEnabledMessage extends MessageBase {
  type: "SET_OVERLAY_ENABLED";
  enabled: boolean;
}

export interface SetOverlayCollapsedMessage extends MessageBase {
  type: "SET_OVERLAY_COLLAPSED";
  collapsed: boolean;
}

export interface SetOverlayPositionMessage extends MessageBase {
  type: "SET_OVERLAY_POSITION";
  position: OverlayPosition | null;
}

export interface ResetOverlayPositionMessage extends MessageBase {
  type: "RESET_OVERLAY_POSITION";
}

export interface GetAssistantSnapshotMessage extends MessageBase {
  type: "GET_ASSISTANT_SNAPSHOT";
}

export interface GetThreadActivityMessage extends MessageBase {
  type: "GET_THREAD_ACTIVITY";
}

export interface GetLastAckDebugMessage extends MessageBase {
  type: "GET_LAST_ACK_DEBUG";
}

export interface GetLatestUserTextMessage extends MessageBase {
  type: "GET_LATEST_USER_TEXT";
}

export interface GetRecentRuntimeEventsMessage extends MessageBase {
  type: "GET_RECENT_RUNTIME_EVENTS";
}

export interface RuntimeEvent {
  id: string;
  phaseStep: string;
  timestamp: string;
  sourceRole: BridgeRole | null;
  targetRole: BridgeRole | null;
  round: number;
  dispatchReadbackSummary: string;
  sendTriggerMode: string;
  verificationBaseline: string;
  verificationPollSample: string;
  verificationVerdict: string;
}

export interface SendRelayMessageRequest extends MessageBase {
  type: "SEND_RELAY_MESSAGE";
  text: string;
}

export interface SyncOverlayStateMessage extends MessageBase {
  type: "SYNC_OVERLAY_STATE";
  snapshot: OverlayModel;
}

export interface RequestOpenPopupMessage extends MessageBase {
  type: "REQUEST_OPEN_POPUP";
}

export type RuntimeMessage =
  | GetRuntimeStateMessage
  | GetPopupModelMessage
  | GetOverlayModelMessage
  | SetBindingMessage
  | ClearBindingMessage
  | SetStarterMessage
  | StartSessionMessage
  | PauseSessionMessage
  | ResumeSessionMessage
  | StopSessionMessage
  | ClearTerminalMessage
  | SetNextHopOverrideMessage
  | SetOverlayEnabledMessage
  | SetOverlayCollapsedMessage
  | SetOverlayPositionMessage
  | ResetOverlayPositionMessage
  | GetAssistantSnapshotMessage
  | GetThreadActivityMessage
  | GetLastAckDebugMessage
  | GetLatestUserTextMessage
  | GetRecentRuntimeEventsMessage
  | SendRelayMessageRequest
  | SyncOverlayStateMessage
  | RequestOpenPopupMessage;

export type RuntimeResponse<T> =
  | { ok: true; result: T }
  | { ok: false; error: string };

export interface PreSendGuardResult {
  shouldStop: boolean;
  reason: Extract<RelayGuardReason, "stop_marker" | "duplicate_output"> | null;
  isEmpty: boolean;
}

export interface PostHopGuardResult {
  shouldStop: boolean;
  reason: Extract<RelayGuardReason, "stop_marker" | "max_rounds_reached"> | null;
}

export interface ContentBridgeGlobal {
  applyComposerText(composer: Element | null, text: string): string;
  findBestComposer(root: ParentNode | null): Element | null;
  findSendButton(root: ParentNode | null, composer: Element | null): HTMLButtonElement | null;
  hashText(value: unknown): string;
  isElementVisible(element: Element | null): boolean;
  normalizeText(value: unknown): string;
  readComposerText(composer: Element | null): string;
  triggerComposerSend(input: {
    root: ParentNode | null;
    composer: Element | null;
    sendButton?: HTMLButtonElement | null;
  }): {
    ok: boolean;
    mode: RelaySendMode;
    error?: string;
  };
}
