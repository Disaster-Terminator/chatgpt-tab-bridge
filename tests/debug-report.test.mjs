import test from "node:test";
import assert from "node:assert/strict";

import { buildDebugReport } from "../src/extension/core/debug-report.ts";
import { PHASES, STOP_REASONS } from "../src/extension/core/constants.ts";

function makeState(overrides = {}) {
  return {
    phase: PHASES.STOPPED,
    bindings: {
      A: null,
      B: null
    },
    settings: {
      maxRoundsEnabled: true,
      maxRounds: 12,
      hopTimeoutMs: 25000,
      pollIntervalMs: 900,
      settleSamplesRequired: 2,
      bridgeStatePrefix: "[BRIDGE_STATE]",
      continueMarker: "CONTINUE",
      stopMarker: "FREEZE"
    },
    starter: "A",
    nextHopSource: "A",
    nextHopOverride: null,
    round: 0,
    sessionId: 1,
    pendingFreshSession: false,
    requiresTerminalClear: false,
    lastStopReason: STOP_REASONS.HOP_TIMEOUT,
    lastError: null,
    activeHop: null,
    lastCompletedHop: null,
    lastForwardedHashes: { A: null, B: null },
    lastAssistantHashes: { A: null, B: null },
    runtimeActivity: {
      step: "idle",
      sourceRole: null,
      targetRole: null,
      pendingRound: null,
      lastActionAt: null,
      transport: null,
      selector: null
    },
    updatedAt: new Date().toISOString(),
    ...overrides
  };
}

function makeEvent(overrides = {}) {
  return {
    id: "evt-1",
    level: "info",
    category: "relay",
    phaseStep: "reply_poll",
    timestamp: new Date().toISOString(),
    sourceRole: "A",
    targetRole: "B",
    round: 2,
    dispatchReadbackSummary: "ok",
    sendTriggerMode: "keyboard",
    verificationBaseline: "baseline",
    verificationPollSample: "poll",
    verificationVerdict: "accepted",
    ...overrides
  };
}

test("schemaVersion is 1", () => {
  const report = buildDebugReport({ runtimeState: makeState() });
  assert.equal(report.schemaVersion, 1);
});

test("hop_timeout produces catalog-derived issue advice", () => {
  const report = buildDebugReport({ runtimeState: makeState({ lastStopReason: STOP_REASONS.HOP_TIMEOUT }) });
  assert.equal(report.issueAdvice.reason, STOP_REASONS.HOP_TIMEOUT);
  assert.equal(report.issueAdvice.title, "Hop timeout");
});

test("long runtime event strings are truncated", () => {
  const giant = "x".repeat(2000);
  const report = buildDebugReport({
    runtimeState: makeState(),
    recentRuntimeEvents: [makeEvent({ dispatchReadbackSummary: giant, verificationVerdict: giant })]
  });

  assert.ok(report.recentRuntimeEvents[0].dispatchReadbackSummary.length < 300);
  assert.ok(report.recentRuntimeEvents[0].verificationVerdict.length < 300);
  assert.notEqual(report.recentRuntimeEvents[0].dispatchReadbackSummary, giant);
});

test("giant tab title and url blobs are sanitized", () => {
  const giant = "blob-".repeat(500);
  const report = buildDebugReport({
    runtimeState: makeState({
      bindings: {
        A: { tabId: 10, title: giant, url: `https://chatgpt.com/c/${giant}`, boundAt: new Date().toISOString() },
        B: null
      }
    })
  });

  assert.ok(report.bindings.A.title.length < 150);
  assert.ok(report.bindings.A.url.length < 250);
  assert.notEqual(report.bindings.A.title, giant);
});

test("missing overlay and runtime events do not throw", () => {
  assert.doesNotThrow(() => buildDebugReport({ runtimeState: makeState(), overlaySettings: null }));
  assert.doesNotThrow(() => buildDebugReport({ runtimeState: makeState(), recentRuntimeEvents: null }));
});

test("output is json serializable", () => {
  const report = buildDebugReport({ runtimeState: makeState(), recentRuntimeEvents: [makeEvent()] });
  assert.doesNotThrow(() => JSON.stringify(report));
});

test("serialized report is much smaller than giant input blob", () => {
  const giant = "payload-".repeat(5000);
  const giantInput = {
    runtimeState: makeState({
      bindings: {
        A: { tabId: 1, title: giant, url: giant, boundAt: giant },
        B: null
      },
      lastError: giant
    }),
    recentRuntimeEvents: Array.from({ length: 100 }, (_, idx) =>
      makeEvent({ id: `evt-${idx}`, dispatchReadbackSummary: giant, verificationBaseline: giant })
    )
  };

  const report = buildDebugReport(giantInput);
  const inputSize = JSON.stringify(giantInput).length;
  const outputSize = JSON.stringify(report).length;

  assert.ok(outputSize < inputSize / 8);
  assert.ok(report.recentRuntimeEvents.length <= 25);
});
