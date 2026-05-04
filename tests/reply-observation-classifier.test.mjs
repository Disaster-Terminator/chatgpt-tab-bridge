import test from "node:test";
import assert from "node:assert/strict";

import { classifyReplyObservation } from "../src/extension/core/reply-observation-classifier.ts";

const baseInput = {
  expectedTargetId: "target-a",
  observedTargetId: "target-a",
  reachable: true,
  hidden: false,
  timedOut: false,
  generating: false,
  progressTick: 0,
  settleSamplesRequired: 3,
  settledStableSamples: 0,
  contentHashChanged: false
};

test("fixture: hidden target with no generation", () => {
  const result = classifyReplyObservation({
    ...baseInput,
    hidden: true
  });

  assert.equal(result.state, "hidden_no_generation");
});

test("fixture: stale generating target", () => {
  const result = classifyReplyObservation({
    ...baseInput,
    generating: true,
    progressTick: 0
  });

  assert.equal(result.state, "stale_target");
  assert.equal(result.debug.hasProgress, false);
});

test("fixture: reply pending without progress", () => {
  const result = classifyReplyObservation({
    ...baseInput,
    settledStableSamples: 1
  });

  assert.equal(result.state, "pending_no_progress");
  assert.equal(result.isPending, true);
  assert.equal(result.isSettledCandidate, false);
});

test("fixture: plain timeout", () => {
  const result = classifyReplyObservation({
    ...baseInput,
    timedOut: true
  });

  assert.equal(result.state, "timeout");
});

test("fixture: wrong target", () => {
  const result = classifyReplyObservation({
    ...baseInput,
    observedTargetId: "target-b"
  });

  assert.equal(result.state, "wrong_target");
});

test("fixture: unreachable target", () => {
  const result = classifyReplyObservation({
    ...baseInput,
    reachable: false
  });

  assert.equal(result.state, "unreachable_target");
});

test("fixture: correct target with stable confirmed sample", () => {
  const result = classifyReplyObservation({
    ...baseInput,
    settledStableSamples: 3
  });

  assert.equal(result.state, "correct_target");
  assert.equal(result.isSettledCandidate, true);
  assert.equal(result.debug.hasStableConfirmation, true);
});

test("hash change alone is not settled success", () => {
  const result = classifyReplyObservation({
    ...baseInput,
    contentHashChanged: true,
    settledStableSamples: 0
  });

  assert.equal(result.state, "pending_no_progress");
  assert.equal(result.isSettledCandidate, false);
});

test("pending generation remains pending and not settled", () => {
  const result = classifyReplyObservation({
    ...baseInput,
    generating: true,
    progressTick: 2,
    contentHashChanged: true
  });

  assert.equal(result.state, "pending_generation");
  assert.equal(result.isPending, true);
  assert.equal(result.isSettledCandidate, false);
});
