# Strategic Reset - Issues & Blockers

## Task 4: Four-Beat Observation Contract

### Issues Encountered

1. **TypeScript Narrowing Issue**: After refactoring, TypeScript couldn't narrow the type properly for the comparison `payloadCorrelationStrength !== "none"`. Resolved by using an intermediate variable but then simplified logic to just check `userTurnChanged` since that already implies correlation exists.

2. **Test API Changes**: Original tests used `result.reason === "payload_accepted"` which needed to be updated to new string values (`"payload_accepted_strong"`). Also `userHashChanged` property doesn't exist in new result - replaced with `userTurnChanged` and checking current vs baseline user hash manually.

3. **Missing userHashChanged in New Interface**: The test tried to assert `result.userHashChanged` but the new result uses `userTurnChanged` instead. Fixed test to use correct property name.

### Gotchas

1. **Backward Compatibility**: The new `evaluateSubmissionVerification()` has a breaking change - previously weak correlation (bridge context present but no hop ID match) would pass if user hash changed. Now it correctly returns `verified: false` for weak correlation, requiring strong hop binding.

2. **Background.ts Not Changed**: The verification poll loop in background.ts still only checks `verificationResult.verified`. This is fine for now since strong binding is required, but Task 5 will need to consume the granular fields for state progression gating.

### Technical Debt

1. **RuntimeEvent Not Extended**: The `verificationVerdict` field in `RuntimeEvent` captures the reason string but could be enhanced to include the full result object for richer debugging in Task 5.

## Task 4 Fix: Generation Start False Positive

### Issue

Manual QA found that `evaluateSubmissionVerification()` was returning `verified: true` with reason `"generation_started_with_payload"` even when:
- `hopBindingStrength === "none"`
- `payloadCorrelationStrength === "weak"`
- Only text overlap >= 50%, no hop-bound proof

This violated the task boundary - weak/none hop binding must NOT masquerade as hop-bound acceptance.

### Fix Applied

Changed the generation-start verification path at line 470 in relay-core.ts:

```typescript
// BEFORE (buggy):
if (generationSettlementStrength === "strong" && userTurnChanged) {

// AFTER (fixed):  
if (generationSettlementStrength === "strong" && userTurnChanged && payloadCorrelationStrength === "strong") {
```

Now generation start only verifies when there's STRONG payload correlation (hop ID matched), not weak correlation alone.

### Test Added

Added regression test "REGRESSION: generation start with weak correlation only must NOT verify" that specifically covers:
- baselineGenerating=false, currentGenerating=true
- user text changed
- text overlap is weak only (no bridge context / no hop binding)
- expected result: verified === false

## Task 5: Coordinator Acceptance Gating

### Issues Encountered

1. **Build/Test Coupling via Dist**: `tests/extension-test-harness.mjs` resolves `dist/extension/` before `src/extension/`, so targeted tests only exercise the new gating logic after running `pnpm run build`.

### Gotchas

1. **Acceptance Is Narrower Than Dispatch**: `dispatchAccepted === true` still only means the observation window opened. Any code that treats the dispatch event itself as success-like progress would reintroduce the original false-progress bug.
2. **Generated JS Carries a Hint**: `lsp_diagnostics` on `dist/extension/background.js` reports an existing TypeScript hint (`checkRole` declared but never read). It is non-blocking and did not affect `pnpm run typecheck` or `pnpm run build`.

## Task 7: First-Hop Timing Race

### Issues Encountered

1. **Beat-3/Beat-4 Coupling In Content Script**: `waitForDispatchAcceptance()` previously required `generation_started` and `payloadReleased` together, which could reject a legitimate send when ChatGPT entered an early generation/user-turn transition before the composer/button state settled in the same poll.
2. **Real-Hop Verdict Ordering Bug**: `scripts/real-hop-playwright.mjs` checked runtime `dispatch_rejected` / `verification_failed` before persisting same-cycle page-fact acceptance, allowing auxiliary runtime evidence to incorrectly beat the primary page proof path.

### Gotchas

1. **`trigger_consumed` Is Not Acceptance Proof**: It only means beat 3 has credible page reaction and the observation window may stay open. Beat 4 is still decided later by Task 4/5 hop-bound verification.
2. **Real-Hop `--skip-bootstrap` Still Depends On Local Preconditions**: The script still requires valid auth files and manual page setup. This task improved verdict integrity, not the auth/bootstrap workflow.

### Runtime Blocker

3. **Cookie Banner Helper Parameter Drift**: `dismissCookieBanner(page)` already required a page object, but `bootstrapAnonymousThread()` still called it twice with no argument. This caused `pnpm run test:real-hop` to crash immediately with `Cannot read properties of undefined (reading 'locator')` before bootstrap could test any real-hop behavior.

## Task 8: Multi-Round Harness Issues

### Issues Encountered

1. **E2E Was Still URL-First In Practice**: The existing `createEnv()` path required supported thread URLs for manual/bootstrap flows, which directly conflicted with the Task 7 session-first proof and blocked root-only multi-round verification.
2. **Happy Path Only Proved A First-Hop-Like Moment**: The old scenario slept, checked one target snapshot, and then moved on to pause/resume/stop. That could not prove that round 2 waited for round 1 acceptance.
3. **Overlay Binding Was The Fragile Automation Path**: The repo already had the stronger popup-runtime binding helper from Task 7, but e2e still used overlay clicks. Reusing the popup path removed that mismatch.

### Gotchas

1. **Page Fact Alone Is Not Enough For Round Attribution**: To classify multi-round failures correctly, the harness still needs per-round runtime events as auxiliary evidence; page facts remain primary, but the runtime event round number is what lets the harness say which hop failed.
2. **Root-Only Still Needs A Source Assistant Reply**: Session-first does not mean message-free. The harness must seed source A with a minimal assistant reply before starting relay, otherwise the coordinator correctly stops on `empty_assistant_reply`.

## Task 6: Testing Hierarchy Documentation

### Gotchas

1. **Hierarchy Already Existed Implicitly**: The README already had text explaining "real-hop 是唯一验证真实 first-hop 发送的测试", but it was too easy to miss. Made it explicit with a table and explicit pass/fail rules.
2. **Task 7/8 Evidence Informs Documentation**: The verified behavior from Task 7 (first-hop on root-only/session-first) and Task 8 (multi-round on same path) now forms the factual baseline for the documentation refresh.

## Final Wave Rejection Follow-up (2026-04-08 11:16 UTC)

### Fixed Mismatches

1. **README Over-Claimed Harness Freedom**: Product docs said no-URL / no-login paths worked without making clear that the current Playwright harness still hard-requires exported auth files at startup. README now documents that gap explicitly.
2. **E2E Asserted Impossible Phase Values**: Several auxiliary scenarios expected popup phase values like `waiting` / `preflight` / `settling`, but those concepts only exist in `runtimeActivity.step`. The assertions now read `currentStep` and keep `phase` aligned with the real enum.
