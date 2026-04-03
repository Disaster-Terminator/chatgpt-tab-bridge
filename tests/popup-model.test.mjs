import test from "node:test";
import assert from "node:assert/strict";

import { PHASES } from "../src/extension/core/constants.mjs";
import { buildDisplay, deriveControls } from "../src/extension/core/popup-model.mjs";
import { createInitialState } from "../src/extension/core/state-machine.mjs";
import { parseChatGptThreadUrl } from "../src/extension/core/chatgpt-url.mjs";

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

  const controls = deriveControls(state);
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
  let controls = deriveControls(state);
  assert.equal(controls.canResume, true);
  assert.equal(controls.canSetOverride, true);
  assert.equal(controls.canPause, false);

  state.phase = PHASES.RUNNING;
  controls = deriveControls(state);
  assert.equal(controls.canPause, true);
  assert.equal(controls.canSetOverride, false);
  assert.equal(controls.canResume, false);
});

test("terminal clear gate blocks start until phase is cleared", () => {
  const state = bind(bind(createInitialState(), "A", 1), "B", 2);
  state.phase = PHASES.READY;
  state.requiresTerminalClear = true;

  const controls = deriveControls(state);
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
