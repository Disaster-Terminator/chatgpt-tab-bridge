2026-04-08 Task 1: reducer-owned `activeHop` is now the canonical hop-scoped execution record for running work.
2026-04-08 Task 1: verify/wait state in `background.ts` now consumes `activeHop` round/source/target identity instead of reconstructing hop truth from UI-facing fallback fields.
2026-04-08 Task 1: targeted state-machine tests lock that paused override writes do not mutate canonical in-flight hop truth until resume consumes the override.
2026-04-08 Task 2: `nextHopOverride` is now consumed only when resume materializes a genuinely fresh pending hop; claimed hops keep their canonical `activeHop` identity across pause/resume.
2026-04-08 Task 2: a paused `verifying` or `waiting_reply` hop now carries its override intent forward for the next fresh boundary instead of letting resume rewrite the in-flight hop.
2026-04-08 Task 5: one content-script DOM pass can provide page identity, latest user facts, latest assistant facts, generation state, and composer facts together; background no longer needs to stitch `GET_THREAD_ACTIVITY` with `GET_LATEST_USER_TEXT` for verification.
2026-04-08 Task 5: compatibility is safest when the unified sample stays fact-only and the existing `evaluateSubmissionVerification()` / `evaluateSubmissionAcceptanceGate()` continue to consume mapped raw facts unchanged.
