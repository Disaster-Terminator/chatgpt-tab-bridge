import test from "node:test";
import assert from "node:assert/strict";

import {
  buildRelayEnvelope,
  evaluatePostHopGuard,
  evaluatePreSendGuard,
  formatNextHop,
  guardReasonToStopReason,
  hashText
} from "../src/extension/core/relay-core.mjs";

test("buildRelayEnvelope includes continue marker, source, round, and payload", () => {
  const envelope = buildRelayEnvelope({
    sourceRole: "A",
    round: 3,
    message: "hello"
  });

  assert.match(envelope, /^\[CONTINUE\]/);
  assert.match(envelope, /source: A/);
  assert.match(envelope, /round: 3/);
  assert.match(envelope, /hello/);
});

test("evaluatePreSendGuard stops on duplicate output", () => {
  const sourceHash = hashText("same reply");
  const result = evaluatePreSendGuard({
    sourceText: "same reply",
    sourceHash,
    lastForwardedSourceHash: sourceHash
  });

  assert.equal(result.shouldStop, true);
  assert.equal(result.reason, "duplicate_output");
});

test("evaluatePostHopGuard stops on stop marker and max rounds", () => {
  const stopMarker = evaluatePostHopGuard({
    assistantText: "[FREEZE]\nDone",
    round: 1,
    maxRounds: 8
  });
  assert.equal(stopMarker.shouldStop, true);
  assert.equal(stopMarker.reason, "stop_marker");

  const maxRounds = evaluatePostHopGuard({
    assistantText: "continue",
    round: 8,
    maxRounds: 8
  });
  assert.equal(maxRounds.shouldStop, true);
  assert.equal(maxRounds.reason, "max_rounds_reached");
});

test("formatNextHop expresses source to target direction", () => {
  assert.equal(formatNextHop("A"), "A -> B");
  assert.equal(formatNextHop("B"), "B -> A");
});

test("guardReasonToStopReason preserves explicit stop reasons", () => {
  assert.equal(guardReasonToStopReason("stop_marker"), "stop_marker");
  assert.equal(guardReasonToStopReason("duplicate_output"), "duplicate_output");
  assert.equal(guardReasonToStopReason("max_rounds_reached"), "max_rounds_reached");
});
