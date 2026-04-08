2026-04-08 Task 4: Branch-locking tests verification

## Test Coverage Summary

### Verification Results
- `node --test tests/state-machine.test.mjs tests/popup-model.test.mjs tests/popup-preflight.test.mjs` - 49 tests PASS
- `pnpm test` - 116 tests PASS

### Requirement Mapping

| Requirement | Test File | Test Name | Status |
|-------------|------------|-----------|--------|
| resume override A | state-machine.test.mjs | resume with override A applies only at a between-hop boundary | ✓ |
| resume override B | state-machine.test.mjs | resume with override B applies only at a between-hop boundary | ✓ |
| resume without override | state-machine.test.mjs | resume without override preserves the canonical next hop | ✓ |
| pause during verifying with opposite override then resume preserves canonical hop | state-machine.test.mjs | canonical active hop carries verification identity independently of override fallback | ✓ |
| pause during waiting_reply with opposite override then resume preserves canonical hop | state-machine.test.mjs | pause and resume preserve waiting-reply hop identity before applying override | ✓ |
| popup/readiness uses canonical activeHop | popup-model.test.mjs | computeReadiness uses canonical activeHop.sourceRole when activeHop exists | ✓ |
| popup/readiness uses nextHopOverride when no activeHop | popup-model.test.mjs | computeReadiness uses nextHopOverride when no activeHop exists | ✓ |
| display uses canonical activeHop | popup-model.test.mjs | buildDisplay uses canonical activeHop.sourceRole when activeHop exists | ✓ |
| display uses nextHopOverride when no activeHop | popup-model.test.mjs | buildDisplay uses nextHopOverride when no activeHop exists | ✓ |
| canonical activeHop in verifying stage | popup-model.test.mjs, popup-preflight.test.mjs | multiple tests | ✓ |
| canonical activeHop in waiting_reply stage | popup-model.test.mjs, popup-preflight.test.mjs | multiple tests | ✓ |
| deferred override doesn't rewrite display when activeHop claimed | popup-model.test.mjs | deferred nextHopOverride does not rewrite display when activeHop is claimed | ✓ |
| contradictory controls blocked in claimed-hop states | popup-preflight.test.mjs | deriveControls consistent with activeHop semantics in verifying/waiting_reply stage | ✓ |
| contradictory controls blocked in preflight states | popup-preflight.test.mjs | deriveControls blocks start/resume when preflightPending is true | ✓ |

### Observations

1. **Tests are already comprehensive** - The partial Task 3 work already added the canonical activeHop tests that form the core of Task 4's regression locking.

2. **No duplication** - Each test serves a distinct purpose:
   - state-machine.test.mjs: Tests state reducer semantics (pause/resume/override application)
   - popup-model.test.mjs: Tests UI model functions (computeReadiness, buildDisplay, deriveControls)
   - popup-preflight.test.mjs: Tests preflight boundary and activeHop alignment

3. **No production code changes needed** - The tests verify the current intended semantics, which the existing implementation already supports.

4. **Scope maintained** - Tests remain focused on regression locking, not broadened to Task 5+ observation/settle/taxonomy work.

2026-04-08 Task 5 verification:
- `node --test tests/relay-core.test.mjs` - PASS (23 tests)
- `pnpm test` - PASS (118 tests)
- `pnpm run typecheck` - PASS
- `pnpm run build` - PASS
