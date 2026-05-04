import test from "node:test";
import assert from "node:assert/strict";

import { importExtensionModule } from "./extension-test-harness.mjs";

const { classifyReplyObservation, REPLY_OBSERVATION_STATES } = await importExtensionModule(
  "core/reply-observation-classifier"
);

function baseInput(overrides = {}) {
  return {
    matchesTarget: true,
    reachable: true,
    hidden: false,
    generating: false,
    replyPending: false,
    timedOut: false,
    assistantHashChanged: false,
    progressStale: false,
    confirmedSamples: 0,
    settleSamplesRequired: 2,
    ...overrides
  };
}

test("hidden target with no generation maps to hidden_no_generation", () => {
  const result = classifyReplyObservation(
    baseInput({
      hidden: true,
      generating: false,
      confirmedSamples: 1
    })
  );

  assert.equal(result.state, REPLY_OBSERVATION_STATES.HIDDEN_NO_GENERATION);
  assert.equal(result.settled, false);
});

test("stale generating target maps to stale_target and never settles", () => {
  const result = classifyReplyObservation(
    baseInput({
      generating: true,
      progressStale: true,
      assistantHashChanged: true,
      confirmedSamples: 2
    })
  );

  assert.equal(result.state, REPLY_OBSERVATION_STATES.STALE_TARGET);
  assert.equal(result.settled, false);
  assert.equal(result.debug.progressStale, true);
});

test("reply pending without progress remains pending_generation", () => {
  const result = classifyReplyObservation(
    baseInput({
      replyPending: true,
      assistantHashChanged: false,
      confirmedSamples: 2
    })
  );

  assert.equal(result.state, REPLY_OBSERVATION_STATES.PENDING_GENERATION);
  assert.equal(result.settled, false);
});

test("plain timeout maps to timeout", () => {
  const result = classifyReplyObservation(baseInput({ timedOut: true }));

  assert.equal(result.state, REPLY_OBSERVATION_STATES.TIMEOUT);
  assert.equal(result.settled, false);
});

test("wrong target maps to wrong_target", () => {
  const result = classifyReplyObservation(baseInput({ matchesTarget: false }));

  assert.equal(result.state, REPLY_OBSERVATION_STATES.WRONG_TARGET);
  assert.equal(result.settled, false);
});

test("unreachable target maps to unreachable_target", () => {
  const result = classifyReplyObservation(baseInput({ reachable: false }));

  assert.equal(result.state, REPLY_OBSERVATION_STATES.UNREACHABLE_TARGET);
  assert.equal(result.settled, false);
});

test("correct target with stable confirmed sample settles", () => {
  const result = classifyReplyObservation(
    baseInput({
      confirmedSamples: 2,
      settleSamplesRequired: 2
    })
  );

  assert.equal(result.state, REPLY_OBSERVATION_STATES.CORRECT_TARGET);
  assert.equal(result.settled, true);
  assert.equal(result.debug.confirmationReached, true);
});

test("hash change alone is not equivalent to settled success", () => {
  const result = classifyReplyObservation(
    baseInput({
      assistantHashChanged: true,
      confirmedSamples: 0,
      settleSamplesRequired: 2
    })
  );

  assert.equal(result.state, REPLY_OBSERVATION_STATES.PENDING_NO_PROGRESS);
  assert.equal(result.settled, false);
});
