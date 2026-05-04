import test from "node:test";
import assert from "node:assert/strict";

import { importExtensionModule } from "./extension-test-harness.mjs";

const { buildDebugReport } = await importExtensionModule("core/debug-report");
const { createInitialState } = await importExtensionModule("core/state-machine");

function bound(role, tabId, title, url) {
  return {
    role,
    tabId,
    title,
    url,
    urlInfo: null,
    sessionIdentity: null,
    isEmptyThread: null,
    boundAt: "2026-05-04T00:00:00.000Z"
  };
}

test("schemaVersion is 1", () => {
  const state = createInitialState();
  const report = buildDebugReport({ state });
  assert.equal(report.schemaVersion, 1);
});

test("includes issue advice for hop_timeout stop reason", () => {
  const state = createInitialState();
  state.lastStopReason = "hop_timeout";

  const report = buildDebugReport({ state });
  assert.equal(report.issueAdvice?.code, "hop_timeout");
  assert.ok(Array.isArray(report.issueAdvice?.advice));
  assert.ok(report.issueAdvice.advice.length > 0);
});

test("truncates long runtime event strings", () => {
  const state = createInitialState();
  const giant = "x".repeat(1200);

  const report = buildDebugReport({
    state,
    recentRuntimeEvents: [{
      id: "event-1",
      level: "info",
      category: giant,
      phaseStep: giant,
      timestamp: "2026-05-04T00:00:00.000Z",
      sourceRole: "A",
      targetRole: "B",
      round: 1,
      dispatchReadbackSummary: giant,
      sendTriggerMode: giant,
      verificationBaseline: giant,
      verificationPollSample: giant,
      verificationVerdict: giant
    }]
  });

  assert.equal(report.recentRuntimeEvents.length, 1);
  const event = report.recentRuntimeEvents[0];
  assert.match(String(event.dispatchReadbackSummary), /\[truncated:/);
  assert.ok(String(event.dispatchReadbackSummary).length < 400);
});

test("null/optional inputs do not throw", () => {
  const state = createInitialState();
  state.bindings.A = null;
  state.bindings.B = null;

  assert.doesNotThrow(() => buildDebugReport({
    state,
    overlaySettings: null,
    recentRuntimeEvents: null
  }));
});

test("binding/title/url giant blobs are sanitized", () => {
  const state = createInitialState();
  const giant = "blob".repeat(300);
  state.bindings.A = bound("A", 12, giant, giant);

  const report = buildDebugReport({ state });
  assert.ok(String(report.bindings.A.title).length < 400);
  assert.ok(String(report.bindings.A.url).length < 400);
  assert.ok(!String(report.bindings.A.title).includes(giant));
});
