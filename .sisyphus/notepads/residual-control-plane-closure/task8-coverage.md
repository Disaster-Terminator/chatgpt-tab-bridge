# Task 8: Unit Regression Lock

## Coverage Added

### New Tests in `tests/background-task6.test.mjs`

1. **`waitForSettledReply does not treat stale_target observation as hop_timeout progress`** (line ~568)
   - Verifies that when the observed tab has a different URL than expected, the observation is classified as `stale_target` and does NOT return `hop_timeout`
   - Classification: `stale_target` is distinct from both `hop_timeout` and `correct_target`

2. **`waitForSettledReply does not treat unreachable_target observation as hop_timeout progress`** (line ~605)
   - Verifies that when the target tab is unreachable (observation.ok === false), the observation is classified as `unreachable_target` and does NOT return `hop_timeout`
   - Classification: `unreachable_target` is distinct from `hop_timeout`

### Existing Coverage Verified

| Requirement | Test File | Line | Status |
|--------------|-----------|------|--------|
| waiting_reply impossible before acceptance | relay-core.test.mjs | 344-359 | ✅ covered |
| stable assistant hash while generating === true does not settle | polling-cancellation.test.mjs | 268-285 | ✅ covered |
| wrong/stale/unreachable target observations ≠ hop_timeout | background-task6.test.mjs | 408-458 (wrong) + new stale/unreachable | ✅ covered |
| correct-target observations that never settle → hop_timeout | background-task6.test.mjs | 517-567 | ✅ covered |
| acceptance weak-correlation blocked | relay-core.test.mjs | 325-342, 433-462 | ✅ covered |

## Result

- Tests: 129 passed, 0 failed
- All Task 8 requirements verified at unit level
