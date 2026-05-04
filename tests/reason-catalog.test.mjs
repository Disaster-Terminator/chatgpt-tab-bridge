import test from "node:test";
import assert from "node:assert/strict";

import { ERROR_REASONS, STOP_REASONS } from "../src/extension/core/constants.ts";
import {
  describeErrorReason,
  describeStopReason
} from "../src/extension/core/reason-catalog.ts";

test("describeStopReason covers every STOP_REASONS value", () => {
  for (const reason of Object.values(STOP_REASONS)) {
    const description = describeStopReason(reason);

    assert.equal(description.reason, reason);
    assert.ok(description.title.length > 0);
    assert.ok(description.summary.length > 0);
    assert.ok(description.nextAction.length > 0);
    assert.ok(["info", "warning", "error"].includes(description.severity));
  }
});

test("describeErrorReason covers every ERROR_REASONS value", () => {
  for (const reason of Object.values(ERROR_REASONS)) {
    const description = describeErrorReason(reason);

    assert.equal(description.reason, reason);
    assert.ok(description.title.length > 0);
    assert.ok(description.summary.length > 0);
    assert.ok(description.nextAction.length > 0);
    assert.equal(description.severity, "error");
  }
});

test("unknown stop reason fallback is stable", () => {
  const unknown = describeStopReason("not_a_real_reason");
  const unknownAgain = describeStopReason(undefined);

  assert.deepEqual(unknown, {
    title: "Stopped",
    severity: "warning",
    summary: "The bridge stopped for an unrecognized reason.",
    nextAction: "Review the latest runtime event details and retry.",
    reason: "unknown_stop_reason"
  });
  assert.deepEqual(unknownAgain, unknown);
});

test("unknown error reason fallback is stable", () => {
  const unknown = describeErrorReason("not_a_real_reason");
  const unknownAgain = describeErrorReason(null);

  assert.deepEqual(unknown, {
    title: "Error",
    severity: "error",
    summary: "The bridge hit an unrecognized error reason.",
    nextAction: "Retry the action and collect diagnostics if it persists.",
    reason: "unknown_error_reason"
  });
  assert.deepEqual(unknownAgain, unknown);
});

test("normal stop reasons are not classified as error severity", () => {
  const normalStops = [
    STOP_REASONS.USER_STOP,
    STOP_REASONS.STOP_MARKER,
    STOP_REASONS.MAX_ROUNDS,
    STOP_REASONS.DUPLICATE_OUTPUT
  ];

  for (const reason of normalStops) {
    const description = describeStopReason(reason);
    assert.notEqual(description.severity, "error");
  }
});
