import type { BridgeRole, OverlaySettings } from "../shared/types.js";

export const APP_STATE_KEY = "chatgptBridgeRuntimeState";
export const OVERLAY_SETTINGS_KEY = "chatgptBridgeOverlaySettings";

export const ROLE_A: BridgeRole = "A";
export const ROLE_B: BridgeRole = "B";
export const ROLES = Object.freeze([ROLE_A, ROLE_B]);

export const PHASES = Object.freeze({
  IDLE: "idle",
  READY: "ready",
  RUNNING: "running",
  PAUSED: "paused",
  STOPPED: "stopped",
  ERROR: "error"
});

export const STOP_REASONS = Object.freeze({
  USER_STOP: "user_stop",
  STOP_MARKER: "stop_marker",
  MAX_ROUNDS: "max_rounds_reached",
  DUPLICATE_OUTPUT: "duplicate_output",
  HOP_TIMEOUT: "hop_timeout",
  BINDING_INVALID: "binding_invalid",
  STARTER_SETTLE_TIMEOUT: "starter_settle_timeout",
  TARGET_SETTLE_TIMEOUT: "target_settle_timeout",
  SUBMISSION_NOT_VERIFIED: "submission_not_verified"
});

export const ERROR_REASONS = Object.freeze({
  SELECTOR_FAILURE: "selector_failure",
  MESSAGE_SEND_FAILED: "message_send_failed",
  UNSUPPORTED_TAB: "unsupported_tab",
  EMPTY_ASSISTANT_REPLY: "empty_assistant_reply",
  INTERNAL_ERROR: "internal_error"
});

export const MESSAGE_TYPES = Object.freeze({
  GET_RUNTIME_STATE: "GET_RUNTIME_STATE",
  GET_POPUP_MODEL: "GET_POPUP_MODEL",
  GET_OVERLAY_MODEL: "GET_OVERLAY_MODEL",
  SET_BINDING: "SET_BINDING",
  CLEAR_BINDING: "CLEAR_BINDING",
  SET_STARTER: "SET_STARTER",
  START_SESSION: "START_SESSION",
  PAUSE_SESSION: "PAUSE_SESSION",
  RESUME_SESSION: "RESUME_SESSION",
  STOP_SESSION: "STOP_SESSION",
  CLEAR_TERMINAL: "CLEAR_TERMINAL",
  SET_NEXT_HOP_OVERRIDE: "SET_NEXT_HOP_OVERRIDE",
  SET_OVERLAY_ENABLED: "SET_OVERLAY_ENABLED",
  SET_OVERLAY_COLLAPSED: "SET_OVERLAY_COLLAPSED",
  SET_OVERLAY_POSITION: "SET_OVERLAY_POSITION",
  RESET_OVERLAY_POSITION: "RESET_OVERLAY_POSITION",
  GET_ASSISTANT_SNAPSHOT: "GET_ASSISTANT_SNAPSHOT",
  GET_THREAD_ACTIVITY: "GET_THREAD_ACTIVITY",
  GET_LAST_ACK_DEBUG: "GET_LAST_ACK_DEBUG",
  SEND_RELAY_MESSAGE: "SEND_RELAY_MESSAGE",
  SYNC_OVERLAY_STATE: "SYNC_OVERLAY_STATE",
  REQUEST_OPEN_POPUP: "REQUEST_OPEN_POPUP"
});

export const DEFAULT_SETTINGS = Object.freeze({
  maxRounds: 8,
  hopTimeoutMs: 60000,
  pollIntervalMs: 1500,
  settleSamplesRequired: 2,
  bridgeStatePrefix: "[BRIDGE_STATE]",
  continueMarker: "CONTINUE",
  stopMarker: "FREEZE"
});

export const DEFAULT_OVERLAY_SETTINGS = Object.freeze<OverlaySettings>({
  enabled: true,
  collapsed: false,
  position: null
});

export function otherRole(role: BridgeRole): BridgeRole {
  return role === ROLE_A ? ROLE_B : ROLE_A;
}
