import test from "node:test";
import assert from "node:assert/strict";

import { importExtensionModule } from "./extension-test-harness.mjs";

const {
  buildRelayEnvelope,
  evaluatePostHopGuard,
  evaluatePreSendGuard,
  evaluateSubmissionVerification,
  formatNextHop,
  guardReasonToStopReason,
  hashText,
  parseBridgeDirective
} = await importExtensionModule("core/relay-core");

test("buildRelayEnvelope includes bridge context, payload, and machine-readable tail instructions", () => {
  const envelope = buildRelayEnvelope({
    sourceRole: "A",
    round: 3,
    message: "hello"
  });
  const lines = envelope.split("\n");

  assert.equal(lines[0], "[BRIDGE_CONTEXT]");
  assert.equal(lines[1], "source: A");
  assert.equal(lines[2], "round: 3");
  assert.equal(lines[4], "hello");
  assert.equal(lines[6], "[BRIDGE_INSTRUCTION]");
  assert.equal(lines[9], "[BRIDGE_STATE] CONTINUE");
  assert.equal(lines[10], "or");
  assert.equal(lines[11], "[BRIDGE_STATE] FREEZE");
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

test("evaluateSubmissionVerification fails when latest user text did not change", () => {
  const result = evaluateSubmissionVerification({
    baselineUserHash: "h1",
    baselineGenerating: false,
    baselineLatestUserText: "same text",
    currentUserHash: "h1",
    currentGenerating: true,
    currentLatestUserText: "same text",
    relayPayloadText: "[BRIDGE_CONTEXT]\nsource: A"
  });

  assert.equal(result.verified, false);
  assert.equal(result.reason, "not_verified");
});

test("evaluateSubmissionVerification fails when latest user text is unrelated to payload", () => {
  const result = evaluateSubmissionVerification({
    baselineUserHash: "h1",
    baselineGenerating: false,
    baselineLatestUserText: "old baseline",
    currentUserHash: "h2",
    currentGenerating: true,
    currentLatestUserText: "completely unrelated message",
    relayPayloadText: "[BRIDGE_CONTEXT]\nsource: A\nround: 2\nbridged payload"
  });

  assert.equal(result.verified, false);
  assert.equal(result.reason, "not_verified");
});

test("evaluateSubmissionVerification passes when user hash changed with payload correlation", () => {
  const payload = "[BRIDGE_CONTEXT]\nsource: A\nround: 2\nhello relay";
  const result = evaluateSubmissionVerification({
    baselineUserHash: "h1",
    baselineGenerating: false,
    baselineLatestUserText: "old baseline",
    currentUserHash: "h2",
    currentGenerating: false,
    currentLatestUserText: `${payload}\n[BRIDGE_INSTRUCTION]`,
    relayPayloadText: payload
  });

  assert.equal(result.verified, true);
  assert.equal(result.reason, "payload_accepted");
});

test("evaluateSubmissionVerification generation branch requires text change with payload correlation", () => {
  const payload = "[BRIDGE_CONTEXT]\nsource: B\nround: 3\nforwarded content";
  const result = evaluateSubmissionVerification({
    baselineUserHash: "h1",
    baselineGenerating: false,
    baselineLatestUserText: "before hop",
    currentUserHash: "h1",
    currentGenerating: true,
    currentLatestUserText: `${payload}\nextra line`,
    relayPayloadText: payload
  });

  assert.equal(result.verified, true);
  assert.equal(result.reason, "generation_with_user_changed");
});
