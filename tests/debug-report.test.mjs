import test from "node:test";
import assert from "node:assert/strict";

import { importExtensionModule } from "./extension-test-harness.mjs";

const { createInitialState } = await importExtensionModule("core/state-machine");
const { buildDebugReport } = await importExtensionModule("core/debug-report");

function buildLongText(size = 1200) {
  return "x".repeat(size);
}

test("buildDebugReport sets schemaVersion to 1", () => {
  const report = buildDebugReport({ state: createInitialState() });
  assert.equal(report.schemaVersion, 1);
});

test("buildDebugReport includes issue advice for hop_timeout", () => {
  const state = createInitialState();
  state.lastStopReason = "hop_timeout";

  const report = buildDebugReport({ state });
  assert.equal(typeof report.issueAdvice, "string");
  assert.match(report.issueAdvice, /timeout/i);
});

test("buildDebugReport truncates long runtime event free text", () => {
  const state = createInitialState();
  const giant = buildLongText();

  const report = buildDebugReport({
    state,
    recentRuntimeEvents: [{
      id: "evt-1",
      level: "warn",
      category: giant,
      phaseStep: giant,
      timestamp: "2026-05-04T00:00:00.000Z",
      sourceRole: "A",
      targetRole: "B",
      round: 3,
      dispatchReadbackSummary: giant,
      sendTriggerMode: giant,
      verificationBaseline: giant,
      verificationPollSample: giant,
      verificationVerdict: giant
    }]
  });

  const event = report.recentRuntimeEvents[0];
  assert.ok(event.dispatchReadbackSummary.length < giant.length);
  assert.ok(event.dispatchReadbackSummary.endsWith("…"));
});

test("buildDebugReport handles missing optional fields", () => {
  const state = createInitialState();
  state.lastError = null;

  assert.doesNotThrow(() => {
    buildDebugReport({
      state,
      overlaySettings: null,
      recentRuntimeEvents: null
    });
  });
});

test("buildDebugReport does not leak raw giant text blobs from tabs or urls", () => {
  const state = createInitialState();
  const giant = buildLongText(1800);
  state.bindings.A = {
    role: "A",
    tabId: 7,
    title: giant,
    url: `https://chatgpt.com/c/${giant}`,
    urlInfo: null,
    sessionIdentity: null,
    isEmptyThread: false,
    boundAt: "2026-05-04T00:00:00.000Z"
  };

  const report = buildDebugReport({ state });
  const serialized = JSON.stringify(report);

  assert.ok(serialized.length < giant.length);
  assert.equal(report.bindings.A.title.length < giant.length, true);
  assert.equal(report.bindings.A.url.length < state.bindings.A.url.length, true);
});
