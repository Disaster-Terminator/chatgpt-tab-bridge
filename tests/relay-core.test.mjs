import test from "node:test";
import assert from "node:assert/strict";

import { importExtensionModule } from "./extension-test-harness.mjs";

const {
  buildRelayEnvelope,
  evaluatePostHopGuard,
  evaluatePreSendGuard,
  evaluateSubmissionAcceptanceGate,
  evaluateSubmissionVerification,
  formatNextHop,
  guardReasonToStopReason,
  hashText,
  parseBridgeDirective
} = await importExtensionModule("core/relay-core");

function buildVerificationInputFromObservationSamples({ baseline, current, relayPayloadText, expectedHopId }) {
  return {
    baselineUserHash: baseline.latestUser.hash,
    baselineGenerating: baseline.generating,
    baselineLatestUserText: baseline.latestUser.text,
    currentUserHash: current.latestUser.hash,
    currentGenerating: current.generating,
    currentLatestUserText: current.latestUser.text,
    relayPayloadText,
    expectedHopId
  };
}

function createObservationSample({
  latestUserText = null,
  latestAssistantText = null,
  generating = false,
  replyPending = false,
  composerAvailable = true,
  sendButtonReady = true
} = {}) {
  return {
    identity: {
      url: "https://chatgpt.com/c/test-thread",
      pathname: "/c/test-thread",
      title: "ChatGPT"
    },
    latestUser: {
      present: latestUserText !== null,
      text: latestUserText,
      hash: latestUserText ? hashText(latestUserText) : null
    },
    latestAssistant: {
      present: latestAssistantText !== null,
      text: latestAssistantText,
      hash: latestAssistantText ? hashText(latestAssistantText) : null
    },
    generating,
    replyPending,
    composer: {
      available: composerAvailable,
      text: "",
      sendButtonReady
    }
  };
}

test("buildRelayEnvelope starts with payload, then keeps compact bridge metadata and machine-readable tail", () => {
  const hopId = "s1-r3-abc123";
  const envelope = buildRelayEnvelope({
    sourceRole: "A",
    round: 3,
    message: "hello",
    hopId
  });

  assert.ok(envelope.startsWith(`hello\n\n[BRIDGE_META hop=${hopId}]`));
  assert.ok(envelope.includes(`[BRIDGE_META hop=${hopId}]`));
  assert.equal(envelope.includes("[BRIDGE_CONTEXT]"), false);
  assert.equal(envelope.includes("source: A"), false);
  assert.equal(envelope.includes("round: 3"), false);
  assert.ok(envelope.includes("hello"));
  assert.ok(envelope.includes("[BRIDGE_INSTRUCTION]"));
  assert.ok(envelope.includes("[BRIDGE_STATE] CONTINUE"));
  assert.ok(envelope.includes("[BRIDGE_STATE] FREEZE"));
});

test("buildRelayEnvelope localizes the natural-language tail instruction", () => {
  const zhEnvelope = buildRelayEnvelope({
    sourceRole: "B",
    round: 1,
    message: "继续讨论这个问题",
    instructionLocale: "zh-CN"
  });
  const enEnvelope = buildRelayEnvelope({
    sourceRole: "B",
    round: 1,
    message: "Continue this discussion",
    instructionLocale: "en"
  });

  assert.ok(zhEnvelope.includes("继续上方桥接内容的讨论。"));
  assert.ok(zhEnvelope.includes("请在回复最后单独输出一行状态:"));
  assert.ok(enEnvelope.includes("Continue the discussion from the bridged content above."));
  assert.ok(enEnvelope.includes("End your reply with exactly one final line:"));
  assert.ok(zhEnvelope.includes("[BRIDGE_STATE] CONTINUE"));
  assert.ok(enEnvelope.includes("[BRIDGE_STATE] CONTINUE"));
});

test("parseBridgeDirective reads the final machine-readable state line", () => {
  assert.equal(parseBridgeDirective("hello\n[BRIDGE_STATE] CONTINUE"), "CONTINUE");
  assert.equal(parseBridgeDirective("hello\n[BRIDGE_STATE] FREEZE"), "FREEZE");
  assert.equal(parseBridgeDirective("hello"), null);
});

test("evaluateSubmissionVerification accepts compact bridge meta hop binding", () => {
  const hopId = "s7-r2-hop1";
  const payload = `bridged content\n\n[BRIDGE_META hop=${hopId}]\n\n[BRIDGE_INSTRUCTION]`;
  const result = evaluateSubmissionVerification({
    baselineUserHash: "h1",
    baselineGenerating: false,
    baselineLatestUserText: "old baseline",
    currentUserHash: "h2",
    currentGenerating: false,
    currentLatestUserText: payload,
    relayPayloadText: payload,
    expectedHopId: hopId
  });

  assert.equal(result.verified, true);
  assert.equal(result.hopBindingStrength, "strong");
  assert.equal(result.details.extractedHopId, hopId);
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

test("evaluatePostHopGuard ignores max rounds when the round limit is disabled", () => {
  const result = evaluatePostHopGuard({
    assistantText: "continue",
    round: 99,
    maxRoundsEnabled: false,
    maxRounds: 8
  });

  assert.equal(result.shouldStop, false);
  assert.equal(result.reason, null);
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
  assert.equal(result.userTurnChanged, false);
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

test("evaluateSubmissionVerification passes when user hash changed with STRONG hop binding", () => {
  const hopId = "s7-r2-hop1";
  const payload = `[BRIDGE_CONTEXT]\nsource: A\nround: 2\nhop: ${hopId}\nhello relay`;
  const result = evaluateSubmissionVerification({
    baselineUserHash: "h1",
    baselineGenerating: false,
    baselineLatestUserText: "old baseline",
    currentUserHash: "h2",
    currentGenerating: false,
    currentLatestUserText: `${payload}\n[BRIDGE_INSTRUCTION]`,
    relayPayloadText: payload,
    expectedHopId: hopId
  });

  assert.equal(result.verified, true);
  assert.equal(result.hopBindingStrength, "strong");
  assert.equal(result.payloadCorrelationStrength, "strong");
  assert.equal(result.userTurnHopBinding, "strong");
  assert.equal(result.userTurnChanged, true);
});

test("evaluateSubmissionVerification passes when generation started with payload correlation (strong hop binding)", () => {
  const hopId = "s7-r3-hop2";
  const payload = `[BRIDGE_CONTEXT]\nsource: B\nround: 3\nhop: ${hopId}\nforwarded content`;
  const result = evaluateSubmissionVerification({
    baselineUserHash: "h1",
    baselineGenerating: false,
    baselineLatestUserText: "before hop",
    currentUserHash: "h1",
    currentGenerating: true,
    currentLatestUserText: `${payload}\nextra line`,
    relayPayloadText: payload,
    expectedHopId: hopId
  });

  assert.equal(result.verified, true);
  assert.equal(result.generationSettlementStrength, "strong");
  assert.equal(result.hopBindingStrength, "strong");
});

test("evaluateSubmissionVerification fails when expected hop marker is missing (weak correlation)", () => {
  const payload = "[BRIDGE_CONTEXT]\nsource: A\nround: 4\nhop: s8-r4-hop9\nrelay text";
  const result = evaluateSubmissionVerification({
    baselineUserHash: "h1",
    baselineGenerating: false,
    baselineLatestUserText: "before hop",
    currentUserHash: "h2",
    currentGenerating: false,
    currentLatestUserText: "[BRIDGE_CONTEXT]\nsource: A\nround: 4\nhop: different-hop\nrelay text",
    relayPayloadText: payload,
    expectedHopId: "s8-r4-hop9"
  });

  assert.equal(result.verified, false);
  assert.equal(result.hopBindingStrength, "weak");
  assert.equal(result.userTurnHopBinding, "weak");
});

test("evaluateSubmissionVerification: weak text overlap without hop binding exposes as weak correlation", () => {
  const result = evaluateSubmissionVerification({
    baselineUserHash: "h1",
    baselineGenerating: false,
    baselineLatestUserText: "before",
    currentUserHash: "h2",
    currentGenerating: false,
    currentLatestUserText: "some overlapping text from the relay payload that is similar enough",
    relayPayloadText: "some overlapping text from the relay payload that is similar enough but no bridge context"
  });

  assert.equal(result.verified, false);
  assert.equal(result.hopBindingStrength, "none");
  assert.equal(result.payloadCorrelationStrength, "weak");
  assert.equal(result.userTurnChanged, true);
});

test("evaluateSubmissionVerification: generation transition alone does not become hop-bound proof without payload correlation", () => {
  const result = evaluateSubmissionVerification({
    baselineUserHash: "h1",
    baselineGenerating: false,
    baselineLatestUserText: "before",
    currentUserHash: "h1",
    currentGenerating: true,
    currentLatestUserText: "user text changed but no payload correlation",
    relayPayloadText: "completely different payload text"
  });

  assert.equal(result.verified, false);
  assert.equal(result.generationSettlementStrength, "strong");
  assert.equal(result.payloadCorrelationStrength, "none");
});

test("evaluateSubmissionVerification: weak hop binding returns verified=false despite user hash change", () => {
  const payload = "[BRIDGE_CONTEXT]\nsource: A\nround: 1\nsome content";
  const result = evaluateSubmissionVerification({
    baselineUserHash: "h1",
    baselineGenerating: false,
    baselineLatestUserText: "old",
    currentUserHash: "h2",
    currentGenerating: false,
    currentLatestUserText: "[BRIDGE_CONTEXT]\nsource: A\nround: 1\nsome content",
    relayPayloadText: payload,
    expectedHopId: "s1-r1-hop1"
  });

  assert.equal(result.verified, false);
  assert.equal(result.hopBindingStrength, "weak");
  assert.equal(result.userTurnHopBinding, "weak");
  assert.equal(result.userTurnChanged, true);
});

test("evaluateSubmissionVerification: assistantSettlementStrength is unavailable (as specified)", () => {
  const hopId = "s7-r2-hop1";
  const payload = `[BRIDGE_CONTEXT]\nsource: A\nround: 2\nhop: ${hopId}\nhello relay`;
  const result = evaluateSubmissionVerification({
    baselineUserHash: "h1",
    baselineGenerating: false,
    baselineLatestUserText: "old baseline",
    currentUserHash: "h2",
    currentGenerating: false,
    currentLatestUserText: `${payload}\n[BRIDGE_INSTRUCTION]`,
    relayPayloadText: payload,
    expectedHopId: hopId
  });

  assert.equal(result.assistantSettlementStrength, "unavailable");
});

test("evaluateSubmissionVerification: details contain all evidence fields", () => {
  const hopId = "test-hop-id";
  const payload = `[BRIDGE_CONTEXT]\nsource: A\nround: 1\nhop: ${hopId}\ntest`;
  const result = evaluateSubmissionVerification({
    baselineUserHash: "h1",
    baselineGenerating: false,
    baselineLatestUserText: "baseline",
    currentUserHash: "h2",
    currentGenerating: true,
    currentLatestUserText: `${payload}\ninstruction`,
    relayPayloadText: payload,
    expectedHopId: hopId
  });

  assert.ok(result.details.baselineUserHash);
  assert.ok(result.details.currentUserHash);
  assert.ok(result.details.expectedHopId);
  assert.ok(result.details.textOverlapRatio >= 0);
  assert.ok(result.details.containsBridgeContext === true || result.details.containsBridgeContext === false);
});

test("REGRESSION: generation start with weak correlation only must NOT verify", () => {
  const result = evaluateSubmissionVerification({
    baselineUserHash: "h1",
    baselineGenerating: false,
    baselineLatestUserText: "before",
    currentUserHash: "h1",
    currentGenerating: true,
    currentLatestUserText: "some overlapping text from the payload",
    relayPayloadText: "some overlapping text from the payload but no bridge context"
  });

  assert.equal(result.verified, false, "generation start with weak correlation must not verify");
  assert.equal(result.generationSettlementStrength, "strong");
  assert.equal(result.payloadCorrelationStrength, "weak");
  assert.equal(result.hopBindingStrength, "none");
});

test("evaluateSubmissionAcceptanceGate keeps weak correlation out of verification-passed semantics", () => {
  const verification = evaluateSubmissionVerification({
    baselineUserHash: "h1",
    baselineGenerating: false,
    baselineLatestUserText: "before hop",
    currentUserHash: "h2",
    currentGenerating: false,
    currentLatestUserText: "[BRIDGE_CONTEXT]\nsource: A\nround: 4\nhop: different-hop\nrelay text",
    relayPayloadText: "[BRIDGE_CONTEXT]\nsource: A\nround: 4\nhop: s8-r4-hop9\nrelay text",
    expectedHopId: "s8-r4-hop9"
  });
  const gate = evaluateSubmissionAcceptanceGate(verification);

  assert.equal(gate.acceptedEquivalentEvidence, false);
  assert.equal(gate.waitingReplyAllowed, false);
  assert.equal(gate.weakCorrelationOnly, true);
  assert.equal(gate.reason, "acceptance_not_established_weak_correlation");
});

test("evaluateSubmissionAcceptanceGate forbids waiting-reply before acceptance exists", () => {
  const verification = evaluateSubmissionVerification({
    baselineUserHash: "h1",
    baselineGenerating: false,
    baselineLatestUserText: "same text",
    currentUserHash: "h1",
    currentGenerating: true,
    currentLatestUserText: "same text",
    relayPayloadText: "[BRIDGE_CONTEXT]\nsource: A"
  });
  const gate = evaluateSubmissionAcceptanceGate(verification);

  assert.equal(gate.acceptedEquivalentEvidence, false);
  assert.equal(gate.waitingReplyAllowed, false);
  assert.equal(gate.reason, "acceptance_not_established_no_user_turn_change");
});

test("evaluateSubmissionAcceptanceGate allows progress for strong hop-bound acceptance with user-hash change", () => {
  const hopId = "s7-r2-hop1";
  const payload = `[BRIDGE_CONTEXT]\nsource: A\nround: 2\nhop: ${hopId}\nhello relay`;
  const verification = evaluateSubmissionVerification({
    baselineUserHash: "h1",
    baselineGenerating: false,
    baselineLatestUserText: "old baseline",
    currentUserHash: "h2",
    currentGenerating: false,
    currentLatestUserText: `${payload}\n[BRIDGE_INSTRUCTION]`,
    relayPayloadText: payload,
    expectedHopId: hopId
  });
  const gate = evaluateSubmissionAcceptanceGate(verification);

  assert.equal(gate.acceptedEquivalentEvidence, true);
  assert.equal(gate.waitingReplyAllowed, true);
  assert.equal(gate.weakCorrelationOnly, false);
  assert.equal(gate.reason, "acceptance_established_user_hash_changed");
});

test("evaluateSubmissionAcceptanceGate allows progress for strong hop-bound generation start", () => {
  const hopId = "s7-r3-hop2";
  const payload = `[BRIDGE_CONTEXT]\nsource: B\nround: 3\nhop: ${hopId}\nforwarded content`;
  const verification = evaluateSubmissionVerification({
    baselineUserHash: "h1",
    baselineGenerating: false,
    baselineLatestUserText: "before hop",
    currentUserHash: "h1",
    currentGenerating: true,
    currentLatestUserText: `${payload}\nextra line`,
    relayPayloadText: payload,
    expectedHopId: hopId
  });
  const gate = evaluateSubmissionAcceptanceGate(verification);

  assert.equal(gate.acceptedEquivalentEvidence, true);
  assert.equal(gate.waitingReplyAllowed, true);
  assert.equal(gate.weakCorrelationOnly, false);
  assert.equal(gate.reason, "acceptance_established_generation_started");
});

test("unified observation samples preserve strong acceptance semantics", () => {
  const hopId = "s9-r4-hop7";
  const relayPayloadText = `[BRIDGE_CONTEXT]\nsource: A\nround: 4\nhop: ${hopId}\nbridged content`;
  const baseline = createObservationSample({
    latestUserText: "before hop",
    latestAssistantText: "previous assistant",
    generating: false
  });
  const current = createObservationSample({
    latestUserText: `${relayPayloadText}\n[BRIDGE_INSTRUCTION]`,
    latestAssistantText: "previous assistant",
    generating: true
  });

  const verification = evaluateSubmissionVerification(
    buildVerificationInputFromObservationSamples({
      baseline,
      current,
      relayPayloadText,
      expectedHopId: hopId
    })
  );
  const gate = evaluateSubmissionAcceptanceGate(verification);

  assert.equal(verification.verified, true);
  assert.equal(verification.hopBindingStrength, "strong");
  assert.equal(verification.payloadCorrelationStrength, "strong");
  assert.equal(gate.acceptedEquivalentEvidence, true);
  assert.equal(gate.waitingReplyAllowed, true);
});

test("unified observation samples keep weak correlation out of acceptance", () => {
  const relayPayloadText = "[BRIDGE_CONTEXT]\nsource: A\nround: 4\nhop: s8-r4-hop9\nrelay text";
  const baseline = createObservationSample({
    latestUserText: "before hop",
    latestAssistantText: "assistant before hop",
    generating: false
  });
  const current = createObservationSample({
    latestUserText: "[BRIDGE_CONTEXT]\nsource: A\nround: 4\nhop: different-hop\nrelay text",
    latestAssistantText: "assistant before hop",
    generating: false
  });

  const verification = evaluateSubmissionVerification(
    buildVerificationInputFromObservationSamples({
      baseline,
      current,
      relayPayloadText,
      expectedHopId: "s8-r4-hop9"
    })
  );
  const gate = evaluateSubmissionAcceptanceGate(verification);

  assert.equal(verification.verified, false);
  assert.equal(verification.hopBindingStrength, "weak");
  assert.equal(gate.acceptedEquivalentEvidence, false);
  assert.equal(gate.waitingReplyAllowed, false);
  assert.equal(gate.reason, "acceptance_not_established_weak_correlation");
});
