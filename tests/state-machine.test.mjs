import test from "node:test";
import assert from "node:assert/strict";

import { parseChatGptThreadUrl } from "../src/extension/core/chatgpt-url.mjs";
import { ERROR_REASONS, PHASES, STOP_REASONS } from "../src/extension/core/constants.mjs";
import {
  canWriteOverride,
  createInitialState,
  reduceState
} from "../src/extension/core/state-machine.mjs";

function createBinding(role, tabId, url = `https://chatgpt.com/c/${role.toLowerCase()}-${tabId}`) {
  return {
    role,
    tabId,
    title: `${role} thread`,
    url,
    urlInfo: parseChatGptThreadUrl(url)
  };
}

test("bindings move idle to ready only when both roles are valid", () => {
  let state = createInitialState();
  state = reduceState(state, { type: "set_binding", role: "A", binding: createBinding("A", 1) });
  assert.equal(state.phase, PHASES.IDLE);

  state = reduceState(state, { type: "set_binding", role: "B", binding: createBinding("B", 2) });
  assert.equal(state.phase, PHASES.READY);
});

test("binding conflict does not allow the same thread to satisfy both roles", () => {
  let state = createInitialState();
  const binding = createBinding("A", 1, "https://chatgpt.com/c/shared-thread");

  state = reduceState(state, { type: "set_binding", role: "A", binding });
  state = reduceState(state, {
    type: "set_binding",
    role: "B",
    binding: {
      ...createBinding("B", 1, "https://chatgpt.com/c/shared-thread"),
      tabId: 1
    }
  });

  assert.equal(state.phase, PHASES.IDLE);
  assert.equal(state.bindings.B, null);
});

test("pause and resume preserve round while allowing one-shot override", () => {
  let state = createInitialState();
  state = reduceState(state, { type: "set_binding", role: "A", binding: createBinding("A", 1) });
  state = reduceState(state, { type: "set_binding", role: "B", binding: createBinding("B", 2) });
  state = reduceState(state, { type: "start" });
  state = reduceState(state, {
    type: "hop_completed",
    sourceRole: "A",
    targetRole: "B",
    sourceHash: "h1",
    targetHash: "h2"
  });
  state = reduceState(state, { type: "pause" });

  assert.equal(state.phase, PHASES.PAUSED);
  assert.equal(state.round, 1);
  assert.equal(canWriteOverride(state), true);

  state = reduceState(state, { type: "set_next_hop_override", role: "A" });
  assert.equal(state.nextHopOverride, "A");

  state = reduceState(state, { type: "resume" });
  assert.equal(state.phase, PHASES.RUNNING);
  assert.equal(state.round, 1);
  assert.equal(state.nextHopSource, "A");
  assert.equal(state.nextHopOverride, null);
});

test("override writes are ignored outside paused", () => {
  let state = createInitialState();
  state = reduceState(state, { type: "set_next_hop_override", role: "B" });
  assert.equal(state.nextHopOverride, null);

  state = reduceState(state, { type: "set_binding", role: "A", binding: createBinding("A", 1) });
  state = reduceState(state, { type: "set_binding", role: "B", binding: createBinding("B", 2) });
  assert.equal(state.phase, PHASES.READY);

  state = reduceState(state, { type: "set_next_hop_override", role: "B" });
  assert.equal(state.nextHopOverride, null);

  state = reduceState(state, { type: "start" });
  assert.equal(state.phase, PHASES.RUNNING);

  state = reduceState(state, { type: "set_next_hop_override", role: "B" });
  assert.equal(state.nextHopOverride, null);

  state = reduceState(state, {
    type: "selector_failure",
    reason: ERROR_REASONS.SELECTOR_FAILURE
  });
  assert.equal(state.phase, PHASES.ERROR);

  state = reduceState(state, { type: "set_next_hop_override", role: "B" });
  assert.equal(state.nextHopOverride, null);
});

test("paused override can be cleared explicitly", () => {
  let state = createInitialState();
  state = reduceState(state, { type: "set_binding", role: "A", binding: createBinding("A", 1) });
  state = reduceState(state, { type: "set_binding", role: "B", binding: createBinding("B", 2) });
  state = reduceState(state, { type: "start" });
  state = reduceState(state, { type: "pause" });
  state = reduceState(state, { type: "set_next_hop_override", role: "B" });
  assert.equal(state.nextHopOverride, "B");

  state = reduceState(state, { type: "set_next_hop_override", role: null });
  assert.equal(state.nextHopOverride, null);
});

test("invalid binding during run stops instead of erroring", () => {
  let state = createInitialState();
  state = reduceState(state, { type: "set_binding", role: "A", binding: createBinding("A", 1) });
  state = reduceState(state, { type: "set_binding", role: "B", binding: createBinding("B", 2) });
  state = reduceState(state, { type: "start" });
  state = reduceState(state, { type: "invalidate_binding", role: "A" });

  assert.equal(state.phase, PHASES.STOPPED);
  assert.equal(state.lastStopReason, STOP_REASONS.BINDING_INVALID);
});

test("invalid binding after stop moves stopped to idle", () => {
  let state = createInitialState();
  state = reduceState(state, { type: "set_binding", role: "A", binding: createBinding("A", 1) });
  state = reduceState(state, { type: "set_binding", role: "B", binding: createBinding("B", 2) });
  state = reduceState(state, { type: "start" });
  state = reduceState(state, { type: "stop", reason: STOP_REASONS.USER_STOP });

  state = reduceState(state, { type: "invalidate_binding", role: "A" });
  assert.equal(state.phase, PHASES.IDLE);
  assert.equal(state.bindings.A, null);
});

test("selector failure enters error", () => {
  let state = createInitialState();
  state = reduceState(state, { type: "set_binding", role: "A", binding: createBinding("A", 1) });
  state = reduceState(state, { type: "set_binding", role: "B", binding: createBinding("B", 2) });
  state = reduceState(state, { type: "start" });
  state = reduceState(state, {
    type: "selector_failure",
    reason: ERROR_REASONS.SELECTOR_FAILURE
  });

  assert.equal(state.phase, PHASES.ERROR);
  assert.equal(state.lastError, ERROR_REASONS.SELECTOR_FAILURE);
});

test("clearTerminal then start is the only round reset gate", () => {
  let state = createInitialState();
  state = reduceState(state, { type: "set_binding", role: "A", binding: createBinding("A", 1) });
  state = reduceState(state, { type: "set_binding", role: "B", binding: createBinding("B", 2) });
  state = reduceState(state, { type: "start" });
  state = reduceState(state, {
    type: "hop_completed",
    sourceRole: "A",
    targetRole: "B",
    sourceHash: "h1",
    targetHash: "h2"
  });
  state = reduceState(state, { type: "stop", reason: STOP_REASONS.USER_STOP });

  assert.equal(state.round, 1);
  assert.equal(state.phase, PHASES.STOPPED);
  assert.equal(state.requiresTerminalClear, true);

  state = reduceState(state, { type: "start" });
  assert.equal(state.phase, PHASES.STOPPED);
  assert.equal(state.round, 1);

  state = reduceState(state, { type: "set_binding", role: "A", binding: createBinding("A", 3) });
  assert.equal(state.phase, PHASES.STOPPED);
  assert.equal(state.round, 1);

  state = reduceState(state, { type: "clear_terminal" });
  assert.equal(state.phase, PHASES.READY);
  assert.equal(state.round, 1);
  assert.equal(state.requiresTerminalClear, false);

  state = reduceState(state, { type: "start" });
  assert.equal(state.phase, PHASES.RUNNING);
  assert.equal(state.round, 0);
});

test("clearTerminal is required after error before a fresh start can reset round", () => {
  let state = createInitialState();
  state = reduceState(state, { type: "set_binding", role: "A", binding: createBinding("A", 1) });
  state = reduceState(state, { type: "set_binding", role: "B", binding: createBinding("B", 2) });
  state = reduceState(state, { type: "start" });
  state = reduceState(state, {
    type: "hop_completed",
    sourceRole: "A",
    targetRole: "B",
    sourceHash: "h1",
    targetHash: "h2"
  });
  state = reduceState(state, {
    type: "selector_failure",
    reason: ERROR_REASONS.SELECTOR_FAILURE
  });

  assert.equal(state.phase, PHASES.ERROR);
  assert.equal(state.round, 1);
  assert.equal(state.requiresTerminalClear, true);

  state = reduceState(state, { type: "start" });
  assert.equal(state.phase, PHASES.ERROR);
  assert.equal(state.round, 1);

  state = reduceState(state, { type: "clear_terminal" });
  assert.equal(state.phase, PHASES.READY);
  assert.equal(state.round, 1);

  state = reduceState(state, { type: "start" });
  assert.equal(state.phase, PHASES.RUNNING);
  assert.equal(state.round, 0);
});

test("runtime activity is updated while running and on pause", () => {
  let state = createInitialState();
  state = reduceState(state, { type: "set_binding", role: "A", binding: createBinding("A", 1) });
  state = reduceState(state, { type: "set_binding", role: "B", binding: createBinding("B", 2) });
  state = reduceState(state, { type: "start" });

  assert.equal(state.runtimeActivity.step, "starting");
  assert.equal(state.runtimeActivity.pendingRound, 1);

  state = reduceState(state, {
    type: "set_runtime_activity",
    activity: {
      step: "waiting B reply",
      sourceRole: "A",
      targetRole: "B",
      transport: "sent",
      selector: "waiting_reply"
    }
  });
  assert.equal(state.runtimeActivity.step, "waiting B reply");
  assert.equal(state.runtimeActivity.transport, "sent");

  state = reduceState(state, { type: "pause" });
  assert.equal(state.runtimeActivity.step, "paused");
});
