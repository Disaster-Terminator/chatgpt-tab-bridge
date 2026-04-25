import test from "node:test";
import assert from "node:assert/strict";

import { importExtensionModule } from "./extension-test-harness.mjs";

const { parseChatGptThreadUrl } = await importExtensionModule("core/chatgpt-url");
const { ERROR_REASONS, PHASES, STOP_REASONS } = await importExtensionModule("core/constants");
const {
  canWriteOverride,
  createInitialState,
  reduceState
} = await importExtensionModule("core/state-machine");

function createBinding(role, tabId, url = `https://chatgpt.com/c/${role.toLowerCase()}-${tabId}`) {
  return {
    role,
    tabId,
    title: `${role} thread`,
    url,
    urlInfo: parseChatGptThreadUrl(url),
    sessionIdentity: null
  };
}

function createLiveSessionBinding(role, tabId) {
  return {
    role,
    tabId,
    title: `${role} session`,
    url: "https://chatgpt.com/",
    urlInfo: parseChatGptThreadUrl("https://chatgpt.com/"),
    sessionIdentity: {
      kind: "live_session",
      tabId,
      role,
      boundAt: new Date().toISOString(),
      observedSnapshot: null,
      currentRound: 0
    }
  };
}

test("bindings move idle to ready only when both roles are valid", () => {
  let state = createInitialState();
  state = reduceState(state, { type: "set_binding", role: "A", binding: createBinding("A", 1) });
  assert.equal(state.phase, PHASES.IDLE);

  state = reduceState(state, { type: "set_binding", role: "B", binding: createBinding("B", 2) });
  assert.equal(state.phase, PHASES.READY);
});

test("runtime settings preserve max rounds when only toggling the round limit", () => {
  let state = createInitialState();
  state = reduceState(state, {
    type: "set_runtime_settings",
    settings: {
      maxRounds: 12
    }
  });
  state = reduceState(state, {
    type: "set_runtime_settings",
    settings: {
      maxRoundsEnabled: false
    }
  });

  assert.equal(state.settings.maxRounds, 12);
  assert.equal(state.settings.maxRoundsEnabled, false);
});

test("runtime settings ignore round limit changes while running", () => {
  let state = createInitialState();
  state = reduceState(state, { type: "set_binding", role: "A", binding: createBinding("A", 1) });
  state = reduceState(state, { type: "set_binding", role: "B", binding: createBinding("B", 2) });
  state = reduceState(state, { type: "start" });
  state = reduceState(state, {
    type: "set_runtime_settings",
    settings: {
      maxRoundsEnabled: false,
      maxRounds: 20
    }
  });

  assert.equal(state.settings.maxRoundsEnabled, true);
  assert.equal(state.settings.maxRounds, 8);
});

test("paused runtime settings accept round limit changes", () => {
  let state = createInitialState();
  state = reduceState(state, { type: "set_binding", role: "A", binding: createBinding("A", 1) });
  state = reduceState(state, { type: "set_binding", role: "B", binding: createBinding("B", 2) });
  state = reduceState(state, { type: "start" });
  state = reduceState(state, { type: "pause" });
  state = reduceState(state, {
    type: "set_runtime_settings",
    settings: {
      maxRoundsEnabled: false,
      maxRounds: 20
    }
  });

  assert.equal(state.phase, PHASES.PAUSED);
  assert.equal(state.settings.maxRoundsEnabled, false);
  assert.equal(state.settings.maxRounds, 20);
});

test("paused starter selection defers the next resume source", () => {
  let state = createInitialState();
  state = reduceState(state, { type: "set_binding", role: "A", binding: createBinding("A", 1) });
  state = reduceState(state, { type: "set_binding", role: "B", binding: createBinding("B", 2) });
  state = reduceState(state, { type: "start" });
  state = reduceState(state, { type: "pause" });
  state = reduceState(state, { type: "set_starter", role: "B" });

  assert.equal(state.phase, PHASES.PAUSED);
  assert.equal(state.starter, "B");
  assert.equal(state.nextHopOverride, "B");
  assert.deepEqual(state.activeHop, {
    sourceRole: "A",
    targetRole: "B",
    targetTabId: 2,
    round: 1,
    hopId: null,
    stage: "pending"
  });

  state = reduceState(state, { type: "resume" });
  assert.equal(state.nextHopSource, "B");
  assert.equal(state.nextHopOverride, null);
  assert.deepEqual(state.activeHop, {
    sourceRole: "B",
    targetRole: "A",
    targetTabId: 1,
    round: 1,
    hopId: null,
    stage: "pending"
  });
});

test("resume falls back to paused starter when override is missing", () => {
  let state = createInitialState();
  state = reduceState(state, { type: "set_binding", role: "A", binding: createBinding("A", 1) });
  state = reduceState(state, { type: "set_binding", role: "B", binding: createBinding("B", 2) });
  state = reduceState(state, { type: "start" });
  state = reduceState(state, { type: "pause" });
  state.starter = "B";
  state.nextHopOverride = null;

  state = reduceState(state, { type: "resume" });

  assert.equal(state.phase, PHASES.RUNNING);
  assert.equal(state.nextHopSource, "B");
  assert.deepEqual(state.activeHop, {
    sourceRole: "B",
    targetRole: "A",
    targetTabId: 1,
    round: 1,
    hopId: null,
    stage: "pending"
  });
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

test("two live sessions with same normalized root URL can both bind if tabIds differ", () => {
  let state = createInitialState();
  state = reduceState(state, { type: "set_binding", role: "A", binding: createLiveSessionBinding("A", 1) });
  state = reduceState(state, { type: "set_binding", role: "B", binding: createLiveSessionBinding("B", 2) });

  assert.equal(state.phase, PHASES.READY);
  assert.ok(state.bindings.A);
  assert.ok(state.bindings.B);
});

test("resume with override A applies only at a between-hop boundary", () => {
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
  assert.deepEqual(state.activeHop, {
    sourceRole: "B",
    targetRole: "A",
    targetTabId: 1,
    round: 2,
    hopId: null,
    stage: "pending"
  });

  state = reduceState(state, { type: "set_next_hop_override", role: "A" });
  assert.equal(state.nextHopOverride, "A");

  state = reduceState(state, { type: "resume" });
  assert.equal(state.phase, PHASES.RUNNING);
  assert.equal(state.round, 1);
  assert.equal(state.nextHopSource, "A");
  assert.equal(state.nextHopOverride, null);
  assert.deepEqual(state.activeHop, {
    sourceRole: "A",
    targetRole: "B",
    targetTabId: 2,
    round: 2,
    hopId: null,
    stage: "pending"
  });
});

test("resume with override B applies only at a between-hop boundary", () => {
  let state = createInitialState();
  state = reduceState(state, { type: "set_binding", role: "A", binding: createBinding("A", 1) });
  state = reduceState(state, { type: "set_binding", role: "B", binding: createBinding("B", 2) });
  state = reduceState(state, { type: "start" });
  state = reduceState(state, { type: "pause" });

  assert.deepEqual(state.activeHop, {
    sourceRole: "A",
    targetRole: "B",
    targetTabId: 2,
    round: 1,
    hopId: null,
    stage: "pending"
  });

  state = reduceState(state, { type: "set_next_hop_override", role: "B" });
  state = reduceState(state, { type: "resume" });

  assert.equal(state.phase, PHASES.RUNNING);
  assert.equal(state.round, 0);
  assert.equal(state.nextHopSource, "B");
  assert.equal(state.nextHopOverride, null);
  assert.deepEqual(state.activeHop, {
    sourceRole: "B",
    targetRole: "A",
    targetTabId: 1,
    round: 1,
    hopId: null,
    stage: "pending"
  });
});

test("resume without override preserves the canonical next hop", () => {
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

  const pausedHop = structuredClone(state.activeHop);
  state = reduceState(state, { type: "resume" });

  assert.equal(state.phase, PHASES.RUNNING);
  assert.equal(state.nextHopSource, "B");
  assert.equal(state.nextHopOverride, null);
  assert.deepEqual(state.activeHop, pausedHop);
});

test("claimed verifying hop keeps canonical identity until pause settles at the next boundary", () => {
  let state = createInitialState();
  state = reduceState(state, { type: "set_binding", role: "A", binding: createBinding("A", 1) });
  state = reduceState(state, { type: "set_binding", role: "B", binding: createBinding("B", 2) });
  state = reduceState(state, { type: "start" });

  state = reduceState(state, {
    type: "set_execution_hop",
    hop: {
      sourceRole: "A",
      targetRole: "B",
      targetTabId: 2,
      round: 1,
      hopId: "hop-1",
      stage: "verifying"
    }
  });
  assert.deepEqual(state.activeHop, {
    sourceRole: "A",
    targetRole: "B",
    targetTabId: 2,
    round: 1,
    hopId: "hop-1",
    stage: "verifying"
  });

  state = reduceState(state, { type: "pause" });
  assert.equal(state.phase, PHASES.RUNNING);
  assert.equal(state.runtimeActivity.step, "pause_requested");
  state = reduceState(state, { type: "set_next_hop_override", role: "B" });
  assert.equal(state.nextHopOverride, null);
  assert.deepEqual(state.activeHop, {
    sourceRole: "A",
    targetRole: "B",
    targetTabId: 2,
    round: 1,
    hopId: "hop-1",
    stage: "verifying"
  });

  state = reduceState(state, {
    type: "hop_completed",
    sourceRole: "A",
    targetRole: "B",
    sourceHash: "h1",
    targetHash: "h2"
  });

  assert.equal(state.phase, PHASES.PAUSED);
  state = reduceState(state, { type: "set_next_hop_override", role: "B" });
  assert.equal(state.nextHopOverride, "B");
  assert.equal(state.nextHopSource, "B");
  assert.deepEqual(state.activeHop, {
    sourceRole: "B",
    targetRole: "A",
    targetTabId: 1,
    round: 2,
    hopId: null,
    stage: "pending"
  });
});

test("claimed waiting-reply hop pauses at next boundary before applying override", () => {
  let state = createInitialState();
  state = reduceState(state, { type: "set_binding", role: "A", binding: createBinding("A", 1) });
  state = reduceState(state, { type: "set_binding", role: "B", binding: createBinding("B", 2) });
  state = reduceState(state, { type: "start" });

  state = reduceState(state, {
    type: "set_execution_hop",
    hop: {
      sourceRole: "A",
      targetRole: "B",
      targetTabId: 2,
      round: 1,
      hopId: "hop-2",
      stage: "waiting_reply"
    }
  });

  state = reduceState(state, { type: "pause" });
  assert.equal(state.phase, PHASES.RUNNING);
  assert.equal(state.runtimeActivity.step, "pause_requested");
  state = reduceState(state, { type: "set_next_hop_override", role: "B" });
  assert.equal(state.nextHopOverride, null);

  state = reduceState(state, {
    type: "hop_completed",
    sourceRole: "A",
    targetRole: "B",
    sourceHash: "h1",
    targetHash: "h2"
  });

  assert.equal(state.phase, PHASES.PAUSED);
  state = reduceState(state, { type: "set_next_hop_override", role: "B" });
  state = reduceState(state, { type: "resume" });

  assert.equal(state.phase, PHASES.RUNNING);
  assert.equal(state.nextHopSource, "B");
  assert.equal(state.nextHopOverride, null);
  assert.deepEqual(state.activeHop, {
    sourceRole: "B",
    targetRole: "A",
    targetTabId: 1,
    round: 2,
    hopId: null,
    stage: "pending"
  });
});

test("pause during a claimed hop pauses at the next fresh pending boundary", () => {
  let state = createInitialState();
  state = reduceState(state, { type: "set_binding", role: "A", binding: createBinding("A", 1) });
  state = reduceState(state, { type: "set_binding", role: "B", binding: createBinding("B", 2) });
  state = reduceState(state, { type: "start" });
  state = reduceState(state, {
    type: "set_execution_hop",
    hop: {
      sourceRole: "A",
      targetRole: "B",
      targetTabId: 2,
      round: 1,
      hopId: "hop-claimed",
      stage: "waiting_reply"
    }
  });

  state = reduceState(state, { type: "pause" });
  assert.equal(state.phase, PHASES.RUNNING);
  assert.equal(state.runtimeActivity.step, "pause_requested");

  state = reduceState(state, {
    type: "hop_completed",
    sourceRole: "A",
    targetRole: "B",
    sourceHash: "h1",
    targetHash: "h2"
  });

  assert.equal(state.phase, PHASES.PAUSED);
  assert.deepEqual(state.activeHop, {
    sourceRole: "B",
    targetRole: "A",
    targetTabId: 1,
    round: 2,
    hopId: null,
    stage: "pending"
  });
  assert.equal(state.runtimeActivity.step, "paused");
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
