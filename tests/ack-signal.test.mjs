import test from "node:test";
import assert from "node:assert/strict";

import { isComposerTrulyCleared, stillContainsExpectedPayload } from "../src/extension/content-helpers.ts";

test("isComposerTrulyCleared returns true for empty composer", () => {
  const result = isComposerTrulyCleared("", "hello world");
  assert.equal(result, true);
});

test("isComposerTrulyCleared returns true for whitespace-only composer", () => {
  const result = isComposerTrulyCleared("   \n\t  ", "hello world");
  assert.equal(result, true);
});

test("isComposerTrulyCleared returns false when composer still contains expected payload", () => {
  const result = isComposerTrulyCleared("hello world", "hello world");
  assert.equal(result, false);
});

test("isComposerTrulyCleared returns false when composer contains most of payload (minor normalization)", () => {
  const result = isComposerTrulyCleared("hello world extra", "hello world");
  assert.equal(result, false);
});

test("isComposerTrulyCleared returns true when composer is cleared (different content)", () => {
  const result = isComposerTrulyCleared("completely different text", "hello world");
  assert.equal(result, true);
});

test("isComposerTrulyCleared returns true when composer contains less than 50% of payload (mostly cleared)", () => {
  const result = isComposerTrulyCleared("hello", "hello world this is a much longer test");
  assert.equal(result, true);
});

test("stillContainsExpectedPayload returns true for exact match", () => {
  const result = stillContainsExpectedPayload("hello world", "hello world");
  assert.equal(result, true);
});

test("stillContainsExpectedPayload returns true for partial match above threshold", () => {
  const result = stillContainsExpectedPayload("hello world test", "hello world");
  assert.equal(result, true);
});

test("stillContainsExpectedPayload returns false for partial match below threshold", () => {
  const result = stillContainsExpectedPayload("hello", "hello world this is a long test");
  assert.equal(result, false);
});

test("stillContainsExpectedPayload returns false for empty inputs", () => {
  const result = stillContainsExpectedPayload("", "hello");
  assert.equal(result, false);
});

test("stillContainsExpectedPayload returns false when current has no overlap", () => {
  const result = stillContainsExpectedPayload("foo bar baz", "hello world");
  assert.equal(result, false);
});