import test from "node:test";
import assert from "node:assert/strict";

import {
  buildRelayEnvelope,
  evaluatePostHopGuard,
  evaluatePreSendGuard,
  formatNextHop,
  guardReasonToStopReason,
  hashText,
  parseBridgeDirective
} from "../src/extension/core/relay-core.mjs";

test("buildRelayEnvelope includes bridge context, payload, and machine-readable tail instructions", () => {
  const envelope = buildRelayEnvelope({
    sourceRole: "A",
    round: 3,
    message: "hello"
  });

  assert.match(envelope, /^\[BRIDGE_CONTEXT\]/);
  assert.match(envelope, /source: A/);
  assert.match(envelope, /round: 3/);
  assert.match(envelope, /hello/);
  assert.match(envelope, /\[BRIDGE_STATE\] CONTINUE/);
  assert.match(envelope, /\[BRIDGE_STATE\] FREEZE/);
});

test("parseBridgeDirective reads the final machine-readable state line", () => {
  assert.equal(parseBridgeDirective("hello\n[BRIDGE_STATE] CONTINUE"), "CONTINUE");
  assert.equal(parseBridgeDirective("hello\n[BRIDGE_STATE] FREEZE"), "FREEZE");
  assert.equal(parseBridgeDirective("hello"), null);
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
    assistantText: "Done\n[BRIDGE_STATE] FREEZE",
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
