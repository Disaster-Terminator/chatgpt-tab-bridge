import test from "node:test";
import assert from "node:assert/strict";

import { ERROR_REASONS, STOP_REASONS } from "../src/extension/core/constants.ts";
import { describeErrorReason, describeStopReason } from "../src/extension/core/reason-catalog.ts";

test("describeStopReason covers every STOP_REASONS value", () => {
  for (const reason of Object.values(STOP_REASONS)) {
    const described = describeStopReason(reason);
    assert.equal(described.reason, reason);
    assert.ok(described.title.length > 0);
    assert.ok(described.summary.length > 0);
    assert.ok(described.nextAction.length > 0);
    assert.match(described.severity, /^(info|warning|error)$/);
  }
});

test("describeErrorReason covers every ERROR_REASONS value", () => {
  for (const reason of Object.values(ERROR_REASONS)) {
    const described = describeErrorReason(reason);
    assert.equal(described.reason, reason);
    assert.ok(described.title.length > 0);
    assert.ok(described.summary.length > 0);
    assert.ok(described.nextAction.length > 0);
    assert.match(described.severity, /^(info|warning|error)$/);
  }
});

test("unknown reason fallback is stable", () => {
  const unknownStop = describeStopReason("not_real_reason");
  assert.deepEqual(unknownStop, {
    title: "Unknown stop reason",
    severity: "warning",
    summary: "The relay stopped for an unrecognized reason.",
    nextAction: "Review logs and retry; update diagnostics mapping if this recurs.",
    reason: "not_real_reason"
  });

  const nullStop = describeStopReason(null);
  assert.deepEqual(nullStop, {
    title: "Unknown stop reason",
    severity: "warning",
    summary: "The relay stopped for an unrecognized reason.",
    nextAction: "Review logs and retry; update diagnostics mapping if this recurs.",
    reason: "unknown_stop_reason"
  });

  const unknownError = describeErrorReason(undefined);
  assert.deepEqual(unknownError, {
    title: "Unknown error reason",
    severity: "warning",
    summary: "The relay stopped for an unrecognized reason.",
    nextAction: "Review logs and retry; update diagnostics mapping if this recurs.",
    reason: "unknown_error_reason"
  });
});

test("normal stops are not classified as error severity", () => {
  const normalStopReasons = [
    STOP_REASONS.USER_STOP,
    STOP_REASONS.STOP_MARKER,
    STOP_REASONS.MAX_ROUNDS,
    STOP_REASONS.DUPLICATE_OUTPUT
  ];

  for (const reason of normalStopReasons) {
    const described = describeStopReason(reason);
    assert.notEqual(described.severity, "error");
  }
});
