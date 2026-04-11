import test from "node:test";
import assert from "node:assert/strict";

import { importExtensionModule } from "./extension-test-harness.mjs";

const { PHASES } = await importExtensionModule("core/constants");
const { buildDisplay, deriveControls, computeReadiness } = await importExtensionModule("core/popup-model");
const { createInitialState } = await importExtensionModule("core/state-machine");
const { parseChatGptThreadUrl } = await importExtensionModule("core/chatgpt-url");

function bind(state, role, tabId) {
  state.bindings[role] = {
    role,
    tabId,
    title: `${role} thread`,
    url: `https://chatgpt.com/c/${role}-${tabId}`,
    urlInfo: parseChatGptThreadUrl(`https://chatgpt.com/c/${role}-${tabId}`)
  };
  return state;
}

test("ready enables start and starter, but not run-time controls", () => {
  const state = bind(bind(createInitialState(), "A", 1), "B", 2);
  state.phase = PHASES.READY;

  const readiness = computeReadiness(state, null);
  const controls = deriveControls(state, readiness);
  assert.equal(controls.canStart, true);
  assert.equal(controls.canSetStarter, true);
  assert.equal(controls.canPause, false);
  assert.equal(controls.canResume, false);
  assert.equal(controls.canStop, false);
  assert.equal(controls.canSetOverride, false);
});

test("paused enables override and resume, running does not", () => {
  const state = bind(bind(createInitialState(), "A", 1), "B", 2);

  state.phase = PHASES.PAUSED;
  let readiness = computeReadiness(state, null);
  let controls = deriveControls(state, readiness);
  assert.equal(controls.canResume, true);
  assert.equal(controls.canSetOverride, true);
  assert.equal(controls.canPause, false);

  state.phase = PHASES.RUNNING;
  readiness = computeReadiness(state, null);
  controls = deriveControls(state, readiness);
  assert.equal(controls.canPause, true);
  assert.equal(controls.canSetOverride, false);
  assert.equal(controls.canResume, false);
});

test("terminal clear gate blocks start until phase is cleared", () => {
  const state = bind(bind(createInitialState(), "A", 1), "B", 2);
  state.phase = PHASES.READY;
  state.requiresTerminalClear = true;

  const readiness = computeReadiness(state, null);
  const controls = deriveControls(state, readiness);
  assert.equal(controls.canStart, false);
});

test("buildDisplay exposes runtime activity and last issue", () => {
  const state = bind(bind(createInitialState(), "A", 1), "B", 2);
  state.runtimeActivity.step = "waiting B reply";
  state.runtimeActivity.transport = "button";
  state.runtimeActivity.selector = "waiting_reply";
  state.lastError = "message_send_failed:send_button_disabled";

  const display = buildDisplay(state);
  assert.equal(display.currentStep, "waiting B reply");
  assert.equal(display.transport, "button");
  assert.equal(display.selector, "waiting_reply");
  assert.equal(display.lastIssue, "message_send_failed:send_button_disabled");
});

// =============================================================================
// Task 3: Canonical activeHop alignment tests
// =============================================================================

test("computeReadiness uses canonical activeHop.sourceRole when activeHop exists", () => {
  const state = bind(bind(createInitialState(), "A", 1), "B", 2);
  state.phase = PHASES.RUNNING;
  state.nextHopSource = "A";
  state.nextHopOverride = null; // Should NOT be used
  
  // Create canonical activeHop with different sourceRole
  state.activeHop = {
    sourceRole: "B",
    targetRole: "A",
    round: 1,
    hopId: "hop-1",
    stage: "running"
  };

  const readiness = computeReadiness(state, null);
  // sourceRole should come from activeHop, not nextHopSource
  assert.equal(readiness.sourceRole, "B", "Should use canonical activeHop.sourceRole");
});

test("computeReadiness uses nextHopOverride when no activeHop exists", () => {
  const state = bind(bind(createInitialState(), "A", 1), "B", 2);
  state.phase = PHASES.PAUSED;
  state.nextHopSource = "A";
  state.nextHopOverride = "B"; // Should be used when no activeHop
  state.activeHop = null;

  const readiness = computeReadiness(state, null);
  assert.equal(readiness.sourceRole, "B", "Should use nextHopOverride when no activeHop");
});

test("buildDisplay uses canonical activeHop.sourceRole when activeHop exists", () => {
  const state = bind(bind(createInitialState(), "A", 1), "B", 2);
  state.nextHopSource = "A";
  state.nextHopOverride = null;
  state.activeHop = {
    sourceRole: "B",
    targetRole: "A",
    round: 1,
    hopId: "hop-1",
    stage: "running"
  };

  const display = buildDisplay(state);
  // nextHop should be B -> A, not A -> B
  assert.equal(display.nextHop, "B -> A", "Should use canonical activeHop for display");
});

test("buildDisplay uses nextHopOverride when no activeHop exists", () => {
  const state = bind(bind(createInitialState(), "A", 1), "B", 2);
  state.nextHopSource = "A";
  state.nextHopOverride = "B";
  state.activeHop = null;

  const display = buildDisplay(state);
  assert.equal(display.nextHop, "B -> A", "Should use nextHopOverride when no activeHop");
});

test("computeReadiness uses canonical activeHop when stage is verifying", () => {
  const state = bind(bind(createInitialState(), "A", 1), "B", 2);
  state.phase = PHASES.RUNNING;
  state.nextHopSource = "A";
  state.nextHopOverride = "A";
  state.activeHop = {
    sourceRole: "B",
    targetRole: "A",
    round: 1,
    hopId: "hop-1",
    stage: "verifying"
  };

  const readiness = computeReadiness(state, null);
  assert.equal(readiness.sourceRole, "B", "Should use activeHop in verifying stage");
});

test("computeReadiness uses canonical activeHop when stage is waiting_reply", () => {
  const state = bind(bind(createInitialState(), "A", 1), "B", 2);
  state.phase = PHASES.RUNNING;
  state.nextHopSource = "A";
  state.nextHopOverride = "A";
  state.activeHop = {
    sourceRole: "B",
    targetRole: "A",
    round: 1,
    hopId: "hop-1",
    stage: "waiting_reply"
  };

  const readiness = computeReadiness(state, null);
  assert.equal(readiness.sourceRole, "B", "Should use activeHop in waiting_reply stage");
});

test("buildDisplay uses canonical activeHop when stage is verifying", () => {
  const state = bind(bind(createInitialState(), "A", 1), "B", 2);
  state.nextHopSource = "A";
  state.nextHopOverride = "A";
  state.activeHop = {
    sourceRole: "B",
    targetRole: "A",
    round: 1,
    hopId: "hop-1",
    stage: "verifying"
  };

  const display = buildDisplay(state);
  assert.equal(display.nextHop, "B -> A", "Should use activeHop in verifying stage for display");
});

test("buildDisplay uses canonical activeHop when stage is waiting_reply", () => {
  const state = bind(bind(createInitialState(), "A", 1), "B", 2);
  state.nextHopSource = "A";
  state.nextHopOverride = "A";
  state.activeHop = {
    sourceRole: "B",
    targetRole: "A",
    round: 1,
    hopId: "hop-1",
    stage: "waiting_reply"
  };

  const display = buildDisplay(state);
  assert.equal(display.nextHop, "B -> A", "Should use activeHop in waiting_reply stage for display");
});

test("deferred nextHopOverride does not rewrite display when activeHop is claimed", () => {
  const state = bind(bind(createInitialState(), "A", 1), "B", 2);
  state.phase = PHASES.PAUSED;
  state.nextHopSource = "A";
  state.nextHopOverride = "B"; // Deferred override should NOT affect display
  state.activeHop = {
    sourceRole: "A", // Canonical activeHop from before pause
    targetRole: "B",
    round: 1,
    hopId: "hop-1",
    stage: "pending"
  };

  const display = buildDisplay(state);
  // Should show A -> B from activeHop, not B -> A from override
  assert.equal(display.nextHop, "A -> B", "Override should not rewrite active display");
  
  const readiness = computeReadiness(state, null);
  assert.equal(readiness.sourceRole, "A", "Override should not rewrite active readiness");
});

test("fresh pending boundary display uses nextHopOverride before resume", () => {
  const state = bind(bind(createInitialState(), "A", 1), "B", 2);
  state.phase = PHASES.PAUSED;
  state.nextHopSource = "B";
  state.nextHopOverride = "A";
  state.activeHop = {
    sourceRole: "B",
    targetRole: "A",
    round: 2,
    hopId: null,
    stage: "pending"
  };

  const display = buildDisplay(state);
  const readiness = computeReadiness(state, null);

  assert.equal(display.nextHop, "A -> B", "Fresh pending boundary should preview override in display");
  assert.equal(readiness.sourceRole, "A", "Fresh pending boundary should preview override in readiness");
});
