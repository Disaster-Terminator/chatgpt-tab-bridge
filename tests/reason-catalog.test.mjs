import test from "node:test";
import assert from "node:assert/strict";

import { ERROR_REASONS, STOP_REASONS } from "../src/extension/core/constants.ts";
import {
  describeErrorReason,
  describeIssueReason,
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

test("known colon-suffixed error reason resolves to base reason", () => {
  const description = describeErrorReason("message_send_failed:send_button_disabled");

  assert.equal(description.reason, ERROR_REASONS.MESSAGE_SEND_FAILED);
  assert.equal(description.title, "Message send failed");
  assert.equal(description.severity, "error");
});

test("known colon-suffixed stop reason resolves to base reason", () => {
  const description = describeStopReason("hop_timeout:relay_ack_missing");

  assert.equal(description.reason, STOP_REASONS.HOP_TIMEOUT);
  assert.equal(description.title, "Hop timeout");
  assert.equal(description.severity, "warning");
});

test("describeIssueReason prefers normalized error reason over stop reason", () => {
  const description = describeIssueReason("message_send_failed:send_button_disabled");

  assert.equal(description.reason, ERROR_REASONS.MESSAGE_SEND_FAILED);
  assert.equal(description.severity, "error");
  assert.equal(description.title, "Message send failed");
});

test("unknown colon-suffixed reason preserves stable unknown fallback", () => {
  const unknownStop = describeStopReason("not_a_real_reason:extra_context");
  const unknownError = describeErrorReason("not_a_real_reason:extra_context");

  assert.equal(unknownStop.reason, "unknown_stop_reason");
  assert.equal(unknownError.reason, "unknown_error_reason");
});
