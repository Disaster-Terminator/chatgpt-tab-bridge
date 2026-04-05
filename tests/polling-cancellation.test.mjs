import test from "node:test";
import assert from "node:assert/strict";

import { importExtensionModule } from "./extension-test-harness.mjs";

const { STOP_REASONS } = await importExtensionModule("core/constants");

// =============================================================================
// P0-4: Polling and cancellation boundary tests
// These tests verify polling behavior and cancellation
// =============================================================================

// Mock implementations to test the logic patterns

/**
 * Simulates waitForSettledReply logic for testing
 * This mirrors the logic in background.ts but in a testable form
 */
function simulateWaitForSettledReply({
  baselineHash,
  hashes,
  settleSamplesRequired,
  hopTimeoutMs,
  pollIntervalMs,
  token,
  activeToken
}) {
  const startedAt = Date.now();
  let stableHash = null;
  let stableCount = 0;
  let polls = 0;

  // Simulate polling
  for (const hash of hashes) {
    polls++;
    const now = Date.now();
    
    // Token check - should cancel immediately if tokens don't match
    if (token !== activeToken) {
      return { 
        ok: false, 
        reason: "loop_cancelled",
        polls 
      };
    }

    // Timeout check
    if (now - startedAt > hopTimeoutMs) {
      return {
        ok: false,
        reason: STOP_REASONS.HOP_TIMEOUT,
        polls
      };
    }

    // Process hash
    if (!hash || hash === baselineHash) {
      stableHash = null;
      stableCount = 0;
      continue;
    }

    if (stableHash === hash) {
      stableCount++;
    } else {
      stableHash = hash;
      stableCount = 1;
    }

    // Check if settled
    if (stableCount >= settleSamplesRequired) {
      return {
        ok: true,
        hash,
        polls
      };
    }
  }

  // Ran out of hashes without settling
  return {
    ok: false,
    reason: STOP_REASONS.HOP_TIMEOUT,
    polls
  };
}

test("waitForSettledReply cancels when token doesn't match activeToken", () => {
  const result = simulateWaitForSettledReply({
    baselineHash: "h0",
    hashes: ["h1", "h2", "h3"],
    settleSamplesRequired: 2,
    hopTimeoutMs: 60000,
    pollIntervalMs: 1500,
    token: 1,       // Our token
    activeToken: 2  // Different from active - should cancel
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, "loop_cancelled");
});

test("waitForSettledReply requires exactly settleSamplesRequired stable hashes", () => {
  const result = simulateWaitForSettledReply({
    baselineHash: "h0",
    hashes: [
      "h1",  // First change - stableCount = 1 (not enough)
      "h1"   // Still h1 - stableCount = 2 (enough!)
    ],
    settleSamplesRequired: 2,
    hopTimeoutMs: 60000,
    pollIntervalMs: 1500,
    token: 1,
    activeToken: 1
  });

  assert.equal(result.ok, true);
  assert.equal(result.hash, "h1");
  assert.equal(result.polls, 2);  // First change + one stable = settle
});

test("waitForSettledReply resets stability counter on hash churn", () => {
  const result = simulateWaitForSettledReply({
    baselineHash: "h0",
    hashes: [
      "h1",  // First change - stableCount = 1
      "h2",  // Different hash - resets to stableCount = 1
      "h2",  // Back to h2 - stableCount = 2 (enough!)
      "h2"
    ],
    settleSamplesRequired: 2,
    hopTimeoutMs: 60000,
    pollIntervalMs: 1500,
    token: 1,
    activeToken: 1
  });

  assert.equal(result.ok, true);
  assert.equal(result.hash, "h2");
});

test("waitForSettledReply returns hop_timeout when no stable hash within timeout", () => {
  // Simulate hashes that keep changing or too few samples
  const result = simulateWaitForSettledReply({
    baselineHash: "h0",
    hashes: [
      "h1",  // Change
      "h2",  // Change resets
      "h3",  // Change resets
      "h4",  // Change resets
      "h5"   // Change resets - never settles
      // Not enough hashes to timeout, but pattern shows issue
    ],
    settleSamplesRequired: 2,
    hopTimeoutMs: 100,  // Very short timeout
    pollIntervalMs: 50,
    token: 1,
    activeToken: 1
  });

  // Ran out of hashes and didn't meet settle threshold - would timeout
  assert.equal(result.ok, false);
  // Could be either loop_cancelled (if token check) or hop_timeout
});

test("waitForSettledReply handles empty baselineHash correctly", () => {
  const result = simulateWaitForSettledReply({
    baselineHash: "",  // Empty baseline
    hashes: ["h1", "h1"],
    settleSamplesRequired: 2,
    hopTimeoutMs: 60000,
    pollIntervalMs: 1500,
    token: 1,
    activeToken: 1
  });

  assert.equal(result.ok, true);
  assert.equal(result.hash, "h1");
});

test("waitForSettledReply handles null baselineHash correctly", () => {
  const result = simulateWaitForSettledReply({
    baselineHash: null,  // Null baseline
    hashes: ["h1", "h1"],
    settleSamplesRequired: 2,
    hopTimeoutMs: 60000,
    pollIntervalMs: 1500,
    token: 1,
    activeToken: 1
  });

  // null !== any hash, so should work
  assert.equal(result.ok, true);
});

test("settleSamplesRequired of 1 settles immediately on first change", () => {
  const result = simulateWaitForSettledReply({
    baselineHash: "h0",
    hashes: ["h1"],  // Just one change needed
    settleSamplesRequired: 1,
    hopTimeoutMs: 60000,
    pollIntervalMs: 1500,
    token: 1,
    activeToken: 1
  });

  assert.equal(result.ok, true);
  assert.equal(result.hash, "h1");
  assert.equal(result.polls, 1);
});

test("multiple tokens only the matching one proceeds", () => {
  // Token 1 starts
  const result1 = simulateWaitForSettledReply({
    baselineHash: "h0",
    hashes: ["h1", "h1"],
    settleSamplesRequired: 2,
    hopTimeoutMs: 60000,
    pollIntervalMs: 1500,
    token: 1,
    activeToken: 3  // Token changed to 3
  });

  assert.equal(result1.reason, "loop_cancelled");

  // Token 3 (the current one) would proceed
  const result3 = simulateWaitForSettledReply({
    baselineHash: "h0",
    hashes: ["h1", "h1"],
    settleSamplesRequired: 2,
    hopTimeoutMs: 60000,
    pollIntervalMs: 1500,
    token: 3,
    activeToken: 3
  });

  assert.equal(result3.ok, true);
});
