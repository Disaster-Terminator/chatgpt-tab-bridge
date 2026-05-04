import test from "node:test";
import assert from "node:assert/strict";

import { STOP_REASONS } from "../src/extension/core/constants.ts";
import { buildDebugReport } from "../src/extension/core/debug-report.ts";

function makeInput(overrides = {}) {
  return {
    state: {
      phase: "running",
      bindings: {
        A: { tabId: 1, title: "Tab A", url: "https://chatgpt.com/c/a" },
        B: { tabId: 2, title: "Tab B", url: "https://chatgpt.com/c/b" }
      },
      settings: {
        maxRounds: 6,
        maxRoundsEnabled: true,
        stopMarker: "[BRIDGE_STATE] FREEZE",
        hopTimeoutMs: 15000,
        pollIntervalMs: 800,
        settleSamplesRequired: 2,
        bridgeStatePrefix: "[BRIDGE_STATE]",
        continueMarker: "CONTINUE"
      },
      activeHop: {
        sourceRole: "A",
        targetRole: "B",
        targetTabId: 2,
        round: 3,
        stage: "await_target_reply",
        hopId: "hop-3"
      },
      lastStopReason: null,
      lastError: null
    },
    overlaySettings: {
      enabled: true,
      ambientEnabled: false,
      collapsed: false,
      position: { x: 1, y: 2 }
    },
    recentRuntimeEvents: [],
    generatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides
  };
}

test("schemaVersion === 1", () => {
  const report = buildDebugReport(makeInput());
  assert.equal(report.schemaVersion, 1);
});

test("hop_timeout produces catalog advice", () => {
  const report = buildDebugReport(makeInput({
    state: { ...makeInput().state, lastStopReason: STOP_REASONS.HOP_TIMEOUT }
  }));

  assert.equal(report.issueAdvice.reason, STOP_REASONS.HOP_TIMEOUT);
  assert.equal(report.issueAdvice.title, "Hop timeout");
  assert.equal(report.issueAdvice.severity, "warning");
});

test("long runtime event strings are truncated", () => {
  const huge = "x".repeat(1000);
  const report = buildDebugReport(makeInput({
    recentRuntimeEvents: [{
      id: "evt-1",
      timestamp: "2026-01-01T00:00:00.000Z",
      level: "info",
      category: "relay",
      phaseStep: huge,
      sourceRole: "A",
      targetRole: "B",
      round: 1,
      dispatchReadbackSummary: huge,
      sendTriggerMode: huge,
      verificationBaseline: huge,
      verificationPollSample: huge,
      verificationVerdict: huge
    }]
  }));

  const evt = report.recentRuntimeEvents[0];
  assert.ok(evt.phaseStep.length < 500);
  assert.ok(evt.dispatchReadbackSummary.length < 500);
  assert.ok(evt.verificationVerdict.endsWith("…"));
});

test("giant tab title/url blobs are sanitized", () => {
  const huge = "A".repeat(10000);
  const report = buildDebugReport(makeInput({
    state: {
      ...makeInput().state,
      bindings: {
        A: { tabId: 1, title: huge, url: `https://chatgpt.com/c/${huge}` },
        B: null
      }
    }
  }));

  assert.ok(report.bindings.A.title.length < 1000);
  assert.ok(report.bindings.A.url.length < 1000);
  assert.notEqual(report.bindings.A.title, huge);
});

test("null overlay/events do not throw", () => {
  const report = buildDebugReport(makeInput({ overlaySettings: null, recentRuntimeEvents: null }));
  assert.equal(report.overlaySettings, null);
  assert.deepEqual(report.recentRuntimeEvents, []);
});

test("output serializes and is much smaller than giant input", () => {
  const huge = "Z".repeat(400000);
  const input = makeInput({
    state: {
      ...makeInput().state,
      lastError: huge,
      bindings: {
        A: { tabId: 1, title: huge, url: huge },
        B: { tabId: 2, title: huge, url: huge }
      }
    },
    recentRuntimeEvents: Array.from({ length: 200 }, (_, i) => ({
      id: `evt-${i}`,
      timestamp: "2026-01-01T00:00:00.000Z",
      level: "debug",
      category: "relay",
      phaseStep: huge,
      sourceRole: "A",
      targetRole: "B",
      round: i,
      dispatchReadbackSummary: huge,
      sendTriggerMode: huge,
      verificationBaseline: huge,
      verificationPollSample: huge,
      verificationVerdict: huge
    }))
  });

  const inputJson = JSON.stringify(input);
  const reportJson = JSON.stringify(buildDebugReport(input));

  assert.ok(reportJson.length < inputJson.length / 50);
});
