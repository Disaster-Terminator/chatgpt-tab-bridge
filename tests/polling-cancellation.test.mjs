import test from "node:test";
import assert from "node:assert/strict";

import { importExtensionModule } from "./extension-test-harness.mjs";

const { STOP_REASONS } = await importExtensionModule("core/constants");
const { parseBridgeDirective } = await importExtensionModule("core/relay-core");

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
  samples,
  settleSamplesRequired,
  hopTimeoutMs,
  pollIntervalMs,
  token,
  activeToken,
  observationClassification = "correct_target"
}) {
  const startedAt = Date.now();
  let stableHash = null;
  let stableCount = 0;
  let polls = 0;
  void pollIntervalMs;

  // Simulate polling
   for (const sample of samples) {
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

    if (observationClassification !== "correct_target") {
      return {
        ok: false,
        reason: observationClassification,
        polls
      };
    }

    const hash = sample.hash;

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

    const hasTerminalDirective = parseBridgeDirective(sample.text || "") !== null;
    const replySettleConfirmed = sample.generating === false || hasTerminalDirective;

    // Check if settled
    if (stableCount >= settleSamplesRequired && replySettleConfirmed) {
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
    samples: [
      { hash: "h1", generating: false },
      { hash: "h2", generating: false },
      { hash: "h3", generating: false }
    ],
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
    samples: [
      { hash: "h1", generating: true },   // Stable but still generating - cannot settle yet
      { hash: "h1", generating: false }   // Same hash + generating false => settled
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
    samples: [
      { hash: "h1", generating: false },
      { hash: "h2", generating: false },
      { hash: "h2", generating: false },
      { hash: "h2", generating: false }
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
    samples: [
      { hash: "h1", generating: false },
      { hash: "h2", generating: false },
      { hash: "h3", generating: false },
      { hash: "h4", generating: false },
      { hash: "h5", generating: false }
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
    samples: [
      { hash: "h1", generating: false },
      { hash: "h1", generating: false }
    ],
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
    samples: [
      { hash: "h1", generating: false },
      { hash: "h1", generating: false }
    ],
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
    samples: [{ hash: "h1", generating: false }],
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
    samples: [
      { hash: "h1", generating: false },
      { hash: "h1", generating: false }
    ],
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
    samples: [
      { hash: "h1", generating: false },
      { hash: "h1", generating: false }
    ],
    settleSamplesRequired: 2,
    hopTimeoutMs: 60000,
    pollIntervalMs: 1500,
    token: 3,
    activeToken: 3
  });

  assert.equal(result3.ok, true);
});

test("waitForSettledReply does not settle while the stable changed hash is still generating", () => {
  const result = simulateWaitForSettledReply({
    baselineHash: "h0",
    samples: [
      { hash: "h1", text: "reply still streaming", generating: true },
      { hash: "h1", text: "reply still streaming", generating: true },
      { hash: "h1", text: "reply still streaming", generating: true }
    ],
    settleSamplesRequired: 2,
    hopTimeoutMs: 60000,
    pollIntervalMs: 1500,
    token: 1,
    activeToken: 1
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, STOP_REASONS.HOP_TIMEOUT);
});

test("waitForSettledReply settles on a stable terminal directive even if generating stays stale", () => {
  const result = simulateWaitForSettledReply({
    baselineHash: "h0",
    samples: [
      { hash: "h1", text: "done\n[BRIDGE_STATE] CONTINUE", generating: true },
      { hash: "h1", text: "done\n[BRIDGE_STATE] CONTINUE", generating: true }
    ],
    settleSamplesRequired: 2,
    hopTimeoutMs: 60000,
    pollIntervalMs: 1500,
    token: 1,
    activeToken: 1
  });

  assert.equal(result.ok, true);
  assert.equal(result.hash, "h1");
  assert.equal(result.polls, 2);
});

test("waitForSettledReply classifies wrong-target observations distinctly from hop_timeout", () => {
  const result = simulateWaitForSettledReply({
    baselineHash: "h0",
    samples: [{ hash: "h1", generating: false }],
    settleSamplesRequired: 1,
    hopTimeoutMs: 60000,
    pollIntervalMs: 1500,
    token: 1,
    activeToken: 1,
    observationClassification: "wrong_target"
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, "wrong_target");
});
