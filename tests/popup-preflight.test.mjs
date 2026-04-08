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

// =============================================================================
// Task 3: Canonical activeHop alignment with preflight
// =============================================================================

test("computeReadiness uses canonical activeHop in verifying stage", () => {
  const state = createTestState({
    phase: PHASES.RUNNING,
    nextHopSource: "A",
    nextHopOverride: null,
    activeHop: {
      sourceRole: "B",
      targetRole: "A",
      round: 1,
      hopId: "hop-1",
      stage: "verifying"
    },
    runtimeActivity: {
      step: "verifying B -> A",
      sourceRole: "B",
      targetRole: "A",
      pendingRound: 1,
      transport: "observe",
      selector: "observation_window"
    }
  });

  const readiness = computeReadiness(state, null);
  assert.equal(readiness.sourceRole, "B", "Should use canonical activeHop in verifying stage");
});

test("computeReadiness uses canonical activeHop in waiting_reply stage", () => {
  const state = createTestState({
    phase: PHASES.RUNNING,
    nextHopSource: "A",
    nextHopOverride: null,
    activeHop: {
      sourceRole: "B",
      targetRole: "A",
      round: 1,
      hopId: "hop-1",
      stage: "waiting_reply"
    },
    runtimeActivity: {
      step: "waiting B reply",
      sourceRole: "B",
      targetRole: "A",
      pendingRound: 1,
      transport: "sent",
      selector: "waiting_reply"
    }
  });

  const readiness = computeReadiness(state, null);
  assert.equal(readiness.sourceRole, "B", "Should use canonical activeHop in waiting_reply stage");
});

test("buildDisplay uses canonical activeHop in verifying stage", () => {
  const state = createTestState({
    phase: PHASES.RUNNING,
    nextHopSource: "A",
    nextHopOverride: null,
    activeHop: {
      sourceRole: "B",
      targetRole: "A",
      round: 1,
      hopId: "hop-1",
      stage: "verifying"
    },
    runtimeActivity: {
      step: "verifying B -> A",
      sourceRole: "B",
      targetRole: "A",
      pendingRound: 1,
      transport: "observe",
      selector: "observation_window"
    }
  });

  const display = buildDisplay(state);
  assert.equal(display.nextHop, "B -> A", "Should use canonical activeHop for display in verifying stage");
});

test("buildDisplay uses canonical activeHop in waiting_reply stage", () => {
  const state = createTestState({
    phase: PHASES.RUNNING,
    nextHopSource: "A",
    nextHopOverride: null,
    activeHop: {
      sourceRole: "B",
      targetRole: "A",
      round: 1,
      hopId: "hop-1",
      stage: "waiting_reply"
    },
    runtimeActivity: {
      step: "waiting B reply",
      sourceRole: "B",
      targetRole: "A",
      pendingRound: 1,
      transport: "sent",
      selector: "waiting_reply"
    }
  });

  const display = buildDisplay(state);
  assert.equal(display.nextHop, "B -> A", "Should use canonical activeHop for display in waiting_reply stage");
});

test("deferred nextHopOverride does not affect display when activeHop is active", () => {
  const state = createTestState({
    phase: PHASES.PAUSED,
    nextHopSource: "A",
    nextHopOverride: "B", // Deferred override - should NOT affect display
    activeHop: {
      sourceRole: "A", // Canonical activeHop from before pause
      targetRole: "B",
      round: 1,
      hopId: "hop-1",
      stage: "pending"
    }
  });

  const display = buildDisplay(state);
  // Should show A -> B from activeHop, not B -> A from override
  assert.equal(display.nextHop, "A -> B", "Override should not rewrite display when activeHop exists");
});

test("deferred nextHopOverride does not affect readiness when activeHop is active", () => {
  const state = createTestState({
    phase: PHASES.PAUSED,
    nextHopSource: "A",
    nextHopOverride: "B", // Deferred override - should NOT affect readiness
    activeHop: {
      sourceRole: "A", // Canonical activeHop from before pause
      targetRole: "B",
      round: 1,
      hopId: "hop-1",
      stage: "pending"
    }
  });

  const readiness = computeReadiness(state, null);
  assert.equal(readiness.sourceRole, "A", "Override should not rewrite readiness when activeHop exists");
});

test("deriveControls consistent with activeHop semantics in verifying stage", () => {
  const state = createTestState({
    phase: PHASES.RUNNING,
    nextHopSource: "A",
    nextHopOverride: null,
    activeHop: {
      sourceRole: "B",
      targetRole: "A",
      round: 1,
      hopId: "hop-1",
      stage: "verifying"
    },
    runtimeActivity: {
      step: "verifying B -> A",
      sourceRole: "B",
      targetRole: "A",
      pendingRound: 1,
      transport: "observe",
      selector: "observation_window"
    }
  });

  const readiness = computeReadiness(state, null);
  const controls = deriveControls(state, readiness);
  
  // Verify: activeHop in verifying stage should NOT allow setOverride
  // because there's a canonical claimed hop
  assert.equal(controls.canSetOverride, false, "Should not allow override when canonical hop is verifying");
});

test("deriveControls consistent with activeHop semantics in waiting_reply stage", () => {
  const state = createTestState({
    phase: PHASES.RUNNING,
    nextHopSource: "A",
    nextHopOverride: null,
    activeHop: {
      sourceRole: "B",
      targetRole: "A",
      round: 1,
      hopId: "hop-1",
      stage: "waiting_reply"
    },
    runtimeActivity: {
      step: "waiting B reply",
      sourceRole: "B",
      targetRole: "A",
      pendingRound: 1,
      transport: "sent",
      selector: "waiting_reply"
    }
  });

  const readiness = computeReadiness(state, null);
  const controls = deriveControls(state, readiness);
  
  // waiting_reply: should NOT allow setOverride because hop is in-flight
  assert.equal(controls.canSetOverride, false, "Should not allow override when canonical hop is waiting_reply");
});
