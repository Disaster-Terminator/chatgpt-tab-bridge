import test from "node:test";
import assert from "node:assert/strict";

import { importExtensionModule } from "./extension-test-harness.mjs";

const { PHASES, STOP_REASONS } = await importExtensionModule("core/constants");
const { createInitialState, reduceState } = await importExtensionModule("core/state-machine");
const { computeReadiness, deriveControls, buildDisplay } = await importExtensionModule("core/popup-model");

// =============================================================================
// P0-2: Preflight boundary tests
// These tests expose bugs in preflight detection and source settle handling
// =============================================================================

function createTestState(overrides = {}) {
  let state = createInitialState();
  state.bindings.A = {
    role: "A",
    tabId: 1,
    title: "Thread A",
    url: "https://chatgpt.com/c/thread-a",
    urlInfo: { supported: true, kind: "regular", normalizedUrl: "thread-a" }
  };
  state.bindings.B = {
    role: "B",
    tabId: 2,
    title: "Thread B",
    url: "https://chatgpt.com/c/thread-b",
    urlInfo: { supported: true, kind: "regular", normalizedUrl: "thread-b" }
  };
  state.phase = PHASES.READY;
  state.starter = "A";
  state.nextHopSource = "A";
  
  // Apply overrides
  return { ...state, ...overrides };
}

test("computeReadiness marks preflight_pending for waiting starter settle step", () => {
  // This test exposes the bug: background sets "waiting A settle" but popup-model checks "waiting starter"
  const state = createTestState({
    phase: PHASES.RUNNING,
    runtimeActivity: {
      step: "waiting A settle",
      sourceRole: "A",
      targetRole: "B",
      pendingRound: 1,
      transport: "preflight",
      selector: "starter_generating"
    }
  });

  const readiness = computeReadiness(state, null);
  
  // BUG: Currently returns false because step is "waiting A settle" not "waiting starter"
  // After fix: should return true
  assert.equal(readiness.preflightPending, true, "Bug exposed: preflightPending should be true for 'waiting A settle' step");
});

test("computeReadiness marks preflight_pending for waiting B settle step", () => {
  const state = createTestState({
    phase: PHASES.RUNNING,
    runtimeActivity: {
      step: "waiting B settle",
      sourceRole: "B",
      targetRole: "A",
      pendingRound: 2,
      transport: "preflight",
      selector: "starter_generating"
    }
  });

  const readiness = computeReadiness(state, null);
  // This should also detect preflight
  assert.equal(readiness.preflightPending, true, "preflightPending should be true for 'waiting B settle'");
});

test("deriveControls blocks start when preflightPending is true", () => {
  // When in READY phase with preflight from a previous run still lingering
  // This is an edge case - preflight typically happens during RUNNING
  // But we test that the readiness.preflightPending flag blocks start correctly
  const state = createTestState({
    phase: PHASES.READY,
    runtimeActivity: {
      step: "ready",  // Normal ready state
      sourceRole: null,
      targetRole: null,
      pendingRound: 0,
      transport: null,
      selector: null
    }
  });

  // Simulate a case where preflightPending is somehow true during READY
  // This could happen if there's a race condition or state drift
  const readiness = computeReadiness(state, null);
  
  // Override preflightPending to test the control logic
  const testReadiness = { ...readiness, preflightPending: true };
  const controls = deriveControls(state, testReadiness);
  assert.equal(controls.canStart, false, "Start should be blocked when preflightPending is true");
});

test("deriveControls blocks resume when preflightPending is true", () => {
  const state = createTestState({
    phase: PHASES.PAUSED,
    runtimeActivity: {
      step: "paused",
      sourceRole: "A",
      targetRole: "B",
      pendingRound: 1,
      transport: null,
      selector: null
    }
  });

  // Override preflightPending to test the control logic  
  const readiness = computeReadiness(state, null);
  const testReadiness = { ...readiness, preflightPending: true };
  const controls = deriveControls(state, testReadiness);
  assert.equal(controls.canResume, false, "Resume should be blocked when preflightPending is true");
});

test("computeReadiness does not mark preflight for non-settle waiting steps", () => {
  const state = createTestState({
    phase: PHASES.RUNNING,
    runtimeActivity: {
      step: "waiting B reply",  // Normal waiting, not preflight
      sourceRole: "A",
      targetRole: "B",
      pendingRound: 1,
      transport: "sent",
      selector: "waiting_reply"
    }
  });

  const readiness = computeReadiness(state, null);
  assert.equal(readiness.preflightPending, false, "Normal waiting should not be preflight");
});

test("buildDisplay shows starter_settle_timeout in lastIssue", () => {
  const state = createTestState({
    phase: PHASES.STOPPED,
    lastStopReason: STOP_REASONS.STARTER_SETTLE_TIMEOUT
  });

  const display = buildDisplay(state);
  // Abnormal stop reason should show in lastIssue
  assert.equal(display.lastIssue, STOP_REASONS.STARTER_SETTLE_TIMEOUT);
});

test("buildDisplay shows hop_timeout in lastIssue", () => {
  const state = createTestState({
    phase: PHASES.STOPPED,
    lastStopReason: STOP_REASONS.HOP_TIMEOUT
  });

  const display = buildDisplay(state);
  assert.equal(display.lastIssue, STOP_REASONS.HOP_TIMEOUT);
});

test("computeReadiness returns preflightPending false for idle phase", () => {
  const state = createTestState({
    phase: PHASES.IDLE,
    runtimeActivity: {
      step: "idle",
      sourceRole: null,
      targetRole: null,
      pendingRound: 0,
      transport: null,
      selector: null
    }
  });

  const readiness = computeReadiness(state, null);
  assert.equal(readiness.preflightPending, false);
});

test("computeReadiness returns preflightPending false for ready phase", () => {
  const state = createTestState({
    phase: PHASES.READY,
    runtimeActivity: {
      step: "ready",
      sourceRole: null,
      targetRole: null,
      pendingRound: 0,
      transport: null,
      selector: null
    }
  });

  const readiness = computeReadiness(state, null);
  assert.equal(readiness.preflightPending, false);
});

test("computeReadiness returns preflightPending false for stopped phase", () => {
  const state = createTestState({
    phase: PHASES.STOPPED,
    runtimeActivity: {
      step: "stopped",
      sourceRole: null,
      targetRole: null,
      pendingRound: 1,
      transport: null,
      selector: null
    }
  });

  const readiness = computeReadiness(state, null);
  assert.equal(readiness.preflightPending, false);
});

test("starterReady is false when source is generating", () => {
  const state = createTestState({
    phase: PHASES.READY,
    starter: "A"
  });

  // Simulate source A is generating
  const readiness = computeReadiness(state, { generating: true });
  assert.equal(readiness.starterReady, false, "starterReady should be false when source is generating");
});

test("starterReady is true when source is not generating", () => {
  const state = createTestState({
    phase: PHASES.READY,
    starter: "A"
  });

  const readiness = computeReadiness(state, { generating: false });
  assert.equal(readiness.starterReady, true);
});
