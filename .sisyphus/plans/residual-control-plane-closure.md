# Residual Control-Plane and Waiting Semantics Closure

## TL;DR
> **Summary**: On top of the recovered first-hop baseline, unify execution truth around a single hop-scoped control/observation contract so pause/resume, target observation, settled-reply gating, and timeout classification all derive from the same page-fact-first source.
> **Deliverables**:
> - hop-scoped truth contract for pending/active hop execution
> - corrected pause/resume override semantics across state-machine + popup/overlay
> - target observation and settle logic aligned to bound page facts
> - reclassified timeout / observation taxonomy without weakening Task 4/5 acceptance gate
> - expanded unit + Playwright coverage for A/B/default resume, tab-switch-free continuation, and waiting semantics
> **Effort**: Large
> **Parallel**: YES - 3 waves
> **Critical Path**: 1 → 2 → 6 → 7 → 10

## Context
### Original Request
- Close the residual control-plane / waiting semantics issues after first-hop recovery, not a small isolated bug.
- Treat these as one integrated closure round: resume override misbehavior, waiting-object mismatch, settled-reply premature advancement, and target timeout/freeze misclassification.
- Preserve session-first, page-fact-first, Task 4/5 acceptance gate, and the recovered root-only real-hop/e2e baseline.
- Do not reopen URL/login/stealth/popup-as-tab work, and do not use longer sleeps/timeouts as the main solution.

### Interview Summary
- The repo now has a working recovered baseline (`8d98662010c35e70d2f325a798be5b98c626064f`) where root-only real-hop and root-only e2e happy-path both pass.
- `state-machine.ts` owns `nextHopSource`, `nextHopOverride`, `round`, and phase transitions; `background.ts` executes the actual relay loop from `nextHopSource`; popup/overlay derive display/readiness from `nextHopOverride ?? nextHopSource`.
- Verification already enforces Task 4/5 page-fact acceptance by combining `requestThreadActivity()` + `getTargetLatestUserText()` with `evaluateSubmissionVerification()` / `evaluateSubmissionAcceptanceGate()` before entering `waiting <role> reply`.
- Settled reply is currently too weak because `waitForSettledReply()` only checks assistant hash stability and ignores same-sample `generating === false` and bound-target identity continuity.
- Current blind spots: no explicit automated coverage for resume A / resume B / default resume as separate branches, and no stable automated assertion for “no manual tab switch required to continue”.

### Metis Review (gaps addressed)
- Frame the work as **one hop-truth contract with four externally visible failure modes**.
- Preserve reducer-only state mutation and background-owned execution truth; popup/overlay may display but must not become correctness authorities.
- Add explicit acceptance for wrong-tab/wrong-thread observation, retryable-vs-terminal observation gaps, and dispatch timeout vs reply timeout taxonomy.
- Prevent scope creep into generalized architecture rewrite, selector redesign, or timeout inflation.

## Work Objectives
### Core Objective
Replace the current split execution truth (`nextHopSource`, `nextHopOverride`, popup-derived next hop, and multi-RPC observation assembly) with a hop-scoped pending execution contract so the extension always knows which bound page is being observed, when a reply is truly settled, and why a hop stopped.

### Deliverables
- A canonical hop-scoped runtime contract stored in background-owned reducer state and used by relay execution, popup readiness, and overlay display.
- Pause/resume semantics where override is one-shot **between-hop** intent and cannot silently redirect a hop that already entered verify/wait.
- Consolidated target observation sampling that binds target identity, latest user fact, latest assistant fact, and generation state to the same polling window.
- Tightened settled-reply predicate requiring target identity continuity, assistant change, stability threshold, and `generating === false`.
- Timeout/error taxonomy that separates dispatch/send timeout, acceptance-not-established, observation gap/unreachable target, and post-acceptance reply timeout.
- Test coverage additions across unit and Playwright layers plus documentation/evidence alignment where semantics changed.

### Definition of Done (verifiable conditions with commands)
- `pnpm run build` succeeds.
- `pnpm run typecheck` succeeds.
- `pnpm test` succeeds.
- Targeted regression commands for this round succeed, including:
  - `node --test tests/state-machine.test.mjs tests/popup-preflight.test.mjs`
  - `node --test tests/relay-core.test.mjs tests/polling-cancellation.test.mjs`
  - `pnpm run test:e2e -- --root-only --scenario happy-path --auth-state playwright/.auth/chatgpt.json --session-state playwright/.auth/chatgpt.session.json`
  - `pnpm run test:real-hop -- --root-only --auth-state playwright/.auth/chatgpt.json --session-state playwright/.auth/chatgpt.session.json`
- Page-fact evidence proves:
  - resume A resumes as `A -> B`
  - resume B resumes as `B -> A`
  - default resume continues the pending canonical next hop
  - no manual tab switch is required to continue the relay once the target reply has settled
  - `waiting <role> reply` is never entered before acceptance is independently established on the target page
  - next hop never starts while the prior target page is still streaming

### Must Have
- Background service worker remains canonical runtime truth.
- Reducer-owned state for any field that changes hop choice, readiness, or wait semantics.
- Task 4/5 acceptance gate preserved: no waiting-reply without independent target acceptance evidence.
- Page facts outrank popup/runtime text in both product logic and validation logic.
- Runtime evidence and stop taxonomy capture last observed fact rather than generic timeout wording.

### Must NOT Have (guardrails, AI slop patterns, scope boundaries)
- No reopening URL/login/stealth/popup-as-tab or first-hop architecture work.
- No fallback to `activeTab` or foreground focus as execution truth.
- No “just increase timeout / add sleep” fix strategy.
- No UI-only patch that leaves background execution semantics inconsistent.
- No runtime self-report used as primary acceptance evidence.
- No weakening of `submission_not_verified` / waiting-before-acceptance protections.

## Verification Strategy
> ZERO HUMAN INTERVENTION - all verification is agent-executed.
- Test decision: tests-after with targeted red/green-first execution inside each task; preserve existing Node test runner and Playwright layers.
- QA policy: Every task includes agent-executed scenarios with page-fact assertions where the product behavior depends on page state.
- Evidence: `.sisyphus/evidence/task-{N}-{slug}.{ext}`

## Execution Strategy
### Parallel Execution Waves
> Target: 5-8 tasks per wave. <3 per wave (except final) = under-splitting.
> Extract shared dependencies as Wave-1 tasks for max parallelism.

Wave 1: canonical truth contract and control-surface alignment (Tasks 1-4)
Wave 2: observation, settle, and taxonomy refactor (Tasks 5-8)
Wave 3: Playwright regression coverage, docs/evidence alignment, full regression hardening (Tasks 9-11)

### Dependency Matrix (full, all tasks)
- 1 blocks 2, 3, 5, 6, 7, 9, 10, 11
- 2 blocks 3, 6, 9
- 3 depends on 1 and 2
- 4 depends on 1 and 2; feeds 9
- 5 depends on 1; blocks 6, 7, 8, 10
- 6 depends on 1, 2, 5; blocks 7, 9, 10
- 7 depends on 5 and 6; blocks 8, 10, 11
- 8 depends on 5 and 7
- 9 depends on 2, 3, 4, 6
- 10 depends on 5, 6, 7, 8, 9
- 11 depends on 7, 9, 10

### Agent Dispatch Summary (wave → task count → categories)
- Wave 1 → 4 tasks → `deep` x2, `unspecified-high` x1, `quick` x1
- Wave 2 → 4 tasks → `deep` x3, `unspecified-high` x1
- Wave 3 → 3 tasks → `unspecified-high` x2, `writing` x1

## TODOs
> Implementation + Test = ONE task. Never separate.
> EVERY task MUST have: Agent Profile + Parallelization + QA Scenarios.

- [ ] 1. Introduce canonical hop-truth contract

  **What to do**: Add a hop-scoped pending execution/observation contract to background-owned runtime state so the system can represent one concrete in-flight hop (`sessionId`, `round`, `sourceRole`, `targetRole`, `targetTabId`, verification hop id, baseline facts, phase/status). Keep this contract reducer-owned, persist it atomically with state, and make it the only execution truth for post-dispatch verify/wait phases.
  **Must NOT do**: Do not rewrite unrelated extension architecture, add new persistence layers, or move canonical truth into popup/overlay state.

  **Recommended Agent Profile**:
  - Category: `deep` - Reason: shared contract touches state shape, reducer semantics, and background orchestration.
  - Skills: [`debug-like-expert`] - why: helps keep the control-plane model causal and evidence-driven.
  - Omitted: [`test`] - why not needed: this task includes focused verification but is primarily a state-contract refactor.

  **Parallelization**: Can Parallel: NO | Wave 1 | Blocks: 2, 3, 4, 5, 6, 7, 9, 10, 11 | Blocked By: none

  **References** (executor has NO interview context - be exhaustive):
  - Pattern: `src/extension/shared/types.ts:136-172` - existing runtime truth fields that currently stop at `runtimeActivity` and do not capture hop-scoped execution identity.
  - Pattern: `src/extension/core/state-machine.ts:269-340` - start/resume currently mutate `nextHopSource` and `runtimeActivity` without a dedicated pending-hop object.
  - Pattern: `src/extension/background.ts:686-1140` - relay loop currently re-derives execution truth from global state each iteration.
  - Pattern: `src/extension/background.ts:1347-1465` - popup/overlay snapshots currently derive display state from non-canonical fields.

  **Acceptance Criteria** (agent-executable only):
  - [ ] Type definitions and persisted runtime state contain one explicit hop-scoped truth object used by background execution paths.
  - [ ] No background execution branch in verify/wait phases relies on `nextHopOverride ?? nextHopSource` after the hop contract exists.
  - [ ] `pnpm run typecheck` passes.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: Contract compiles and is background-owned
    Tool: Bash
    Steps: Run `pnpm run typecheck`; then run `node --test tests/state-machine.test.mjs`
    Expected: Typecheck passes and reducer tests continue passing with the new state shape
    Evidence: .sisyphus/evidence/task-1-hop-truth-contract.txt

  Scenario: No UI-derived execution fallback remains
    Tool: Bash
    Steps: Run targeted assertions added in reducer/background tests that fail if verify/wait phases derive source/target from popup-style fallback instead of canonical hop state
    Expected: Tests pass only when execution truth is taken from the hop contract
    Evidence: .sisyphus/evidence/task-1-hop-truth-contract-edge.txt
  ```

  **Commit**: YES | Message: `refactor(control-plane): introduce canonical hop truth` | Files: `["src/extension/shared/types.ts", "src/extension/core/state-machine.ts", "src/extension/background.ts"]`

- [ ] 2. Lock pause/resume override semantics to between-hop intent

  **What to do**: Rework pause/resume semantics so `nextHopOverride` is one-shot **between-hop** intent only. If pause occurs after a hop has already opened verify/wait, resume must honor that pending hop instead of silently redirecting source/target. Consume and clear override only when a fresh hop is actually selected, not merely when resume is clicked.
  **Must NOT do**: Do not remove override entirely, do not change round-reset semantics, and do not weaken `clearTerminal -> ready -> start` as the fresh-session gate.

  **Recommended Agent Profile**:
  - Category: `deep` - Reason: reducer + background orchestration semantics must stay consistent across phases.
  - Skills: [`debug-like-expert`] - why: the failure is causal and phase-sensitive.
  - Omitted: [`review`] - why not needed: this is implementation, not post-change review.

  **Parallelization**: Can Parallel: NO | Wave 1 | Blocks: 3, 4, 6, 9 | Blocked By: 1

  **References** (executor has NO interview context - be exhaustive):
  - Pattern: `src/extension/core/state-machine.ts:307-358` - current pause/resume/override implementation eagerly consumes override on resume.
  - Pattern: `src/extension/core/state-machine.ts:360-395` - hop completion flips `nextHopSource` after success.
  - Pattern: `src/extension/background.ts:490-569` - start/resume both run starter preflight from `state.nextHopSource`.
  - Test: `tests/state-machine.test.mjs:80-147` - current coverage only proves one-shot override write/clear, not full A/B/default semantics or pending-hop precedence.

  **Acceptance Criteria** (agent-executable only):
  - [ ] Resume with override `A` yields actual next hop `A -> B`.
  - [ ] Resume with override `B` yields actual next hop `B -> A`.
  - [ ] Resume with no override preserves the canonical pending next hop.
  - [ ] Resume during an already-open verify/wait phase cannot redirect that in-flight hop.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: A / B / default resume branches are correct in reducer + background semantics
    Tool: Bash
    Steps: Run `node --test tests/state-machine.test.mjs tests/popup-preflight.test.mjs`
    Expected: New tests for override=A, override=B, and default resume all pass, including pending-hop precedence assertions
    Evidence: .sisyphus/evidence/task-2-resume-branches.txt

  Scenario: Resume cannot steal an already-open pending hop
    Tool: Bash
    Steps: Run targeted tests that pause during verifying/waiting and then resume with an opposite override
    Expected: Tests prove the original pending target is still waited first and override is deferred until the next fresh hop
    Evidence: .sisyphus/evidence/task-2-resume-pending-hop.txt
  ```

  **Commit**: YES | Message: `fix(control-plane): honor pending hop across resume` | Files: `["src/extension/core/state-machine.ts", "src/extension/background.ts", "tests/state-machine.test.mjs"]`

- [ ] 3. Align popup and overlay with canonical execution truth

  **What to do**: Update popup/overlay display and readiness logic so they present canonical hop truth instead of inferring `sourceRole` from `nextHopOverride ?? nextHopSource`. Keep override as an editable preview only when paused between hops; when a pending hop exists, the UI must display the actual executing/waited hop and block contradictory controls.
  **Must NOT do**: Do not add UX redesign work, do not derive execution truth from `activeTab`, and do not mask discrepancies with copy-only changes.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: cross-cutting UI-state alignment with strong correctness constraints but limited visual scope.
  - Skills: [`test`] - why: UI-state logic must ship with targeted regression tests.
  - Omitted: [`frontend-design`] - why not needed: this is semantic alignment, not visual redesign.

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: 9 | Blocked By: 1, 2

  **References** (executor has NO interview context - be exhaustive):
  - Pattern: `src/extension/core/popup-model.ts:5-73` - current readiness/display logic derives `sourceRole` from override-or-nextHop fallback.
  - Pattern: `src/extension/background.ts:1347-1465` - popup/overlay model assembly currently samples the same fallback source role.
  - Pattern: `src/extension/content-script.ts:393-420` - overlay renders current step/next hop from synced snapshot and must remain display-only.
  - Test: `tests/popup-preflight.test.mjs:39-122` - existing tests already expose step/readiness mismatch and can be extended for canonical-hop display behavior.

  **Acceptance Criteria** (agent-executable only):
  - [ ] Popup and overlay show the canonical pending/executing hop when one exists.
  - [ ] Override controls are enabled only when paused between hops, not while a pending verify/wait contract is active.
  - [ ] `waiting A settle`, `waiting B settle`, `verifying X submission`, and `waiting X reply` all map to consistent readiness/control states.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: UI shows canonical hop, not override drift
    Tool: Bash
    Steps: Run `node --test tests/popup-preflight.test.mjs`
    Expected: Tests prove display/readiness use canonical pending hop and no longer drift when override preview differs
    Evidence: .sisyphus/evidence/task-3-popup-overlay-alignment.txt

  Scenario: Preflight and waiting states block contradictory controls
    Tool: Bash
    Steps: Run targeted popup-model tests for `waiting A settle`, `waiting B settle`, `verifying B submission`, and `waiting A reply`
    Expected: `canResume`, `canSetOverride`, and readiness flags match the actual pending state contract
    Evidence: .sisyphus/evidence/task-3-popup-overlay-edge.txt
  ```

  **Commit**: YES | Message: `fix(control-plane): align popup with canonical hop truth` | Files: `["src/extension/core/popup-model.ts", "src/extension/background.ts", "tests/popup-preflight.test.mjs"]`

- [ ] 4. Expand branch-locking tests for control-plane semantics

  **What to do**: Add or refactor targeted Node tests that lock the new contract semantics before Wave 2 refactors rely on them: resume A/B/default, override clearing timing, pending-hop precedence, and UI blocking during preflight/verify/wait. Prefer explicit regression names tied to the four user-reported failures.
  **Must NOT do**: Do not rely only on existing happy-path assertions, and do not fake correctness by snapshotting text without phase/role assertions.

  **Recommended Agent Profile**:
  - Category: `quick` - Reason: test-layer expansion on top of the newly defined semantics.
  - Skills: [`test`] - why: pure regression-locking task.
  - Omitted: [`debug-like-expert`] - why not needed: contract decisions are already fixed by Tasks 1-3.

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: 9 | Blocked By: 1, 2

  **References** (executor has NO interview context - be exhaustive):
  - Test: `tests/state-machine.test.mjs:80-147` - current pause/override coverage to extend.
  - Test: `tests/popup-preflight.test.mjs:39-139` - preflight/readiness regression patterns.
  - Pattern: `src/extension/core/state-machine.ts:321-358` - semantics under test.
  - Pattern: `src/extension/core/popup-model.ts:17-50` - readiness and source role derivation under test.

  **Acceptance Criteria** (agent-executable only):
  - [ ] Tests fail against the old semantics and pass only with the new canonical-hop rules.
  - [ ] There is explicit coverage for override A, override B, default resume, and paused-with-pending-hop cases.
  - [ ] There is explicit coverage for UI/readiness behavior during preflight, verifying, and waiting-reply states.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: Control-plane regression suite passes
    Tool: Bash
    Steps: Run `node --test tests/state-machine.test.mjs tests/popup-preflight.test.mjs`
    Expected: All new branch-locking tests pass
    Evidence: .sisyphus/evidence/task-4-control-plane-tests.txt

  Scenario: Old single-branch blind spot is eliminated
    Tool: Bash
    Steps: Verify the test output includes dedicated cases for A, B, and default resume plus pending-hop precedence
    Expected: The suite proves all three branches and the edge case, not just one resume path
    Evidence: .sisyphus/evidence/task-4-control-plane-tests-edge.txt
  ```

  **Commit**: YES | Message: `test(control-plane): lock resume and readiness branches` | Files: `["tests/state-machine.test.mjs", "tests/popup-preflight.test.mjs"]`

- [ ] 5. Consolidate target observation into one coherent sample contract

  **What to do**: Introduce a single content-script observation RPC (or equivalent unified sampling path) that returns bound-thread facts needed by verification and settle polling in one sample window: target identity checks, latest user fact, latest assistant fact, generation flag, composer availability, and any observation error classification needed by background. Keep existing helper behavior reusable where possible.
  **Must NOT do**: Do not remove Task 4/5 acceptance logic, do not collapse target/user/assistant facts into runtime text only, and do not use multiple asynchronous RPCs for one logical sample after this refactor.

  **Recommended Agent Profile**:
  - Category: `deep` - Reason: page-fact collection contract is the root input to verify/wait/taxonomy behavior.
  - Skills: [`debug-like-expert`] - why: sampling drift and stale-instance bugs need precise root-cause handling.
  - Omitted: [`frontend-design`] - why not needed: content-script behavior only.

  **Parallelization**: Can Parallel: NO | Wave 2 | Blocks: 6, 7, 8, 10 | Blocked By: 1

  **References** (executor has NO interview context - be exhaustive):
  - Pattern: `src/extension/content-script.ts:575-628` - current assistant snapshot and thread activity are sampled separately.
  - Pattern: `src/extension/content-script.ts:1131-1156` - latest user text is a third independent query.
  - Pattern: `src/extension/background.ts:913-955` - verification currently stitches multiple RPCs into one logical decision.
  - Pattern: `src/extension/background.ts:1213-1259` - baseline capture also relies on split sampling.

  **Acceptance Criteria** (agent-executable only):
  - [ ] Background can obtain a single coherent observation sample for target verification and settle polling.
  - [ ] The new sample includes enough facts to distinguish wrong-target/unreachable/streaming/stable states without querying three separate RPCs.
  - [ ] Existing page-fact acceptance behavior remains representable from the new sample contract.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: Unified observation contract supports verification inputs
    Tool: Bash
    Steps: Run `pnpm run typecheck` and targeted Node tests covering observation sample shape and mapping into verification logic
    Expected: Typecheck passes and tests prove one sample contains the required target facts
    Evidence: .sisyphus/evidence/task-5-observation-contract.txt

  Scenario: Stale / missing sub-sample drift is eliminated
    Tool: Bash
    Steps: Run targeted tests that would previously combine mismatched user/assistant/generation reads across separate RPCs
    Expected: Tests pass only when verification/waiting consumes one coherent sample window
    Evidence: .sisyphus/evidence/task-5-observation-contract-edge.txt
  ```

  **Commit**: YES | Message: `refactor(observation): unify target sample contract` | Files: `["src/extension/content-script.ts", "src/extension/background.ts", "src/extension/shared/types.ts"]`

- [ ] 6. Bind verification and waiting to the canonical target page

  **What to do**: Refactor background verify/wait flow so it always observes the target bound in the canonical hop contract, never whichever role/display the popup currently implies. Use the unified sample from Task 5 to keep target identity, latest user fact, and generation fact aligned through baseline capture, verification polling, waiting-reply entry, and hop completion.
  **Must NOT do**: Do not fall back to `activeTab`, do not silently switch target identity mid-hop, and do not allow runtime events to declare success without matching page facts.

  **Recommended Agent Profile**:
  - Category: `deep` - Reason: this is the core execution-path repair for the “manual tab switch required” failure mode.
  - Skills: [`debug-like-expert`] - why: tab reachability / stale-page / target-role mismatch are the central failure modes.
  - Omitted: [`test`] - why not needed: verification exists inside the task but the main work is runtime logic.

  **Parallelization**: Can Parallel: NO | Wave 2 | Blocks: 7, 9, 10 | Blocked By: 1, 2, 5

  **References** (executor has NO interview context - be exhaustive):
  - Pattern: `src/extension/background.ts:686-1140` - current loop calculates source/target once, but verification/wait logic can still drift through split observation and UI-derived display semantics.
  - Pattern: `src/extension/background.ts:571-669` - target preflight uses bound tab id and should stay canonical.
  - Pattern: `src/extension/background.ts:1347-1465` - popup/overlay model sampling must reflect the canonical hop, not choose it.
  - Evidence/Test: `scripts/real-hop-playwright.mjs:451-590` - current page-fact-first acceptance must continue to hold while removing the manual-tab-switch class of failure.

  **Acceptance Criteria** (agent-executable only):
  - [ ] Waiting for a reply always targets the bound `targetTabId` from the canonical hop contract.
  - [ ] Relay continuation does not require manually focusing or switching to the target page.
  - [ ] Wrong-target / unreachable-target cases are surfaced as classified observation failures, not silently treated as successful wait progress.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: Canonical target continues without manual tab switch
    Tool: Bash
    Steps: Run targeted Playwright regression that starts a hop, leaves focus on the opposite page, and waits for continuation
    Expected: Relay advances based on the bound target page facts without manual navigation to that page
    Evidence: .sisyphus/evidence/task-6-target-observation.json

  Scenario: Wrong-target or unreachable target is not misread as waiting progress
    Tool: Bash
    Steps: Run targeted regression or unit-level background tests that simulate stale/unreachable target samples during verify/wait
    Expected: The system classifies the issue explicitly and does not continue as if it were observing the correct target
    Evidence: .sisyphus/evidence/task-6-target-observation-edge.json
  ```

  **Commit**: YES | Message: `fix(waiting): bind verify and wait to canonical target` | Files: `["src/extension/background.ts", "src/extension/content-script.ts", "tests/relay-core.test.mjs"]`

- [ ] 7. Tighten settled-reply gating and timeout taxonomy

  **What to do**: Redefine settled reply so background waits for a coherent target sample that proves: target identity still matches, assistant state changed from baseline, the changed assistant state is stable for the configured sample count, and `generating === false`. Rework stop/error classification so dispatch-time timeout, acceptance-not-established, observation failures, and post-acceptance reply timeout are distinct and evidence-backed.
  **Must NOT do**: Do not “fix” this by increasing timeout or settle sample counts alone, and do not let runtime self-report outrank page facts.

  **Recommended Agent Profile**:
  - Category: `deep` - Reason: the defect is semantic, timing-sensitive, and central to the remaining residual bugs.
  - Skills: [`debug-like-expert`] - why: this task explicitly separates similar-looking failure classes.
  - Omitted: [`review`] - why not needed: implementation and regression work first.

  **Parallelization**: Can Parallel: NO | Wave 2 | Blocks: 8, 10, 11 | Blocked By: 5, 6

  **References** (executor has NO interview context - be exhaustive):
  - Pattern: `src/extension/background.ts:1263-1345` - send timeout and settled-reply polling currently flatten multiple failure classes.
  - Pattern: `src/extension/core/relay-core.ts:366-464` - acceptance gate already separates strong vs weak acceptance and must remain intact.
  - Pattern: `src/extension/content-script.ts:603-628` - generation state currently exists but is not coupled to settled assistant polling.
  - README: `README.md:86-105` - current runtime-visible categories that must stay semantically aligned after the taxonomy refactor.

  **Acceptance Criteria** (agent-executable only):
  - [ ] Next hop cannot start while the prior target sample still reports `generating === true`.
  - [ ] A “message later appeared” case is either classified as observer/classification failure or eliminated; it is not mislabeled as a plain reply timeout.
  - [ ] Dispatch/send timeout, observation failure, acceptance failure, and post-acceptance reply timeout emit distinct stop/error outcomes with matching evidence.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: Streaming reply does not settle early
    Tool: Bash
    Steps: Run `node --test tests/relay-core.test.mjs tests/polling-cancellation.test.mjs`
    Expected: New tests prove stable assistant hash while `generating === true` does not count as settled
    Evidence: .sisyphus/evidence/task-7-settle-taxonomy.txt

  Scenario: Timeout classes are distinguished by last observed fact
    Tool: Bash
    Steps: Run targeted tests that simulate dispatch timeout, observer gap, acceptance failure, and post-acceptance reply timeout
    Expected: Each case maps to a distinct classified outcome instead of a generic `hop_timeout`
    Evidence: .sisyphus/evidence/task-7-settle-taxonomy-edge.txt
  ```

  **Commit**: YES | Message: `fix(waiting): tighten settle semantics and classify timeouts` | Files: `["src/extension/background.ts", "src/extension/core/relay-core.ts", "tests/polling-cancellation.test.mjs", "tests/relay-core.test.mjs"]`

- [ ] 8. Lock relay-core and polling regressions at unit level

  **What to do**: Extend unit tests to make the new acceptance/settle/taxonomy semantics non-regressible: strong-vs-weak acceptance still works, `waiting_reply` cannot occur before acceptance, streaming cannot settle early, observation failures do not masquerade as timeouts, and retryable sampling gaps remain retryable until the correct classified stop threshold is reached.
  **Must NOT do**: Do not dilute product semantics just to simplify tests, and do not replace page-fact assertions with runtime text snapshots.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: pure regression hardening around nuanced logic.
  - Skills: [`test`] - why: high-value unit regression expansion.
  - Omitted: [`debug-like-expert`] - why not needed: the semantics are already fixed in Task 7.

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: 10 | Blocked By: 5, 7

  **References** (executor has NO interview context - be exhaustive):
  - Test: `tests/relay-core.test.mjs:84-356` - acceptance/verification cases to extend.
  - Test: `tests/polling-cancellation.test.mjs:15-238` - current simulated settle polling that must gain generation/identity semantics.
  - Pattern: `src/extension/core/relay-core.ts:379-589` - acceptance logic that must stay intact while settling logic tightens elsewhere.
  - Pattern: `src/extension/background.ts:1283-1345` - runtime wait behavior mirrored in the polling tests.

  **Acceptance Criteria** (agent-executable only):
  - [ ] Unit tests explicitly cover the user-reported early-settle bug and timeout misclassification bug.
  - [ ] Acceptance-gate regressions remain green: no weak-correlation path can enter waiting reply.
  - [ ] Retryable vs terminal observation behavior is verified.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: Verification and polling suites pass with new semantics
    Tool: Bash
    Steps: Run `node --test tests/relay-core.test.mjs tests/polling-cancellation.test.mjs`
    Expected: All new acceptance/settle/taxonomy regressions pass
    Evidence: .sisyphus/evidence/task-8-relay-polling-tests.txt

  Scenario: Waiting-reply-before-acceptance remains impossible
    Tool: Bash
    Steps: Verify test output includes dedicated cases for weak correlation, waiting-before-acceptance, and streaming-not-settled
    Expected: The regression suite proves the gate remains closed until strong acceptance exists
    Evidence: .sisyphus/evidence/task-8-relay-polling-tests-edge.txt
  ```

  **Commit**: YES | Message: `test(waiting): lock acceptance and settle regressions` | Files: `["tests/relay-core.test.mjs", "tests/polling-cancellation.test.mjs"]`

- [ ] 9. Extend Playwright control-flow coverage for resume and continuation semantics

  **What to do**: Upgrade the Playwright non-authenticity layers so they finally reflect the residual control-plane semantics instead of only a single override happy path. Add explicit resume A / resume B / default resume coverage, and add a continuation scenario that keeps focus on the opposite page while the bound target is expected to complete.
  **Must NOT do**: Do not let semi/e2e become the truth source for authenticity, do not remove real-hop as the sole page-fact-first acceptance layer, and do not add brittle sleeps where page/state assertions can be used.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: multi-script regression coverage with scenario coordination.
  - Skills: [`test`] - why: Playwright scenario work.
  - Omitted: [`browse`] - why not needed: existing repo scripts already provide browser automation.

  **Parallelization**: Can Parallel: YES | Wave 3 | Blocks: 10, 11 | Blocked By: 2, 3, 4, 6

  **References** (executor has NO interview context - be exhaustive):
  - Test: `scripts/semi-bridge-playwright.mjs:147-199` - current single-branch pause/override/resume control flow.
  - Test: `scripts/e2e-bridge-playwright.mjs:77-84` - scenario registry for e2e extensions.
  - Test: `scripts/e2e-bridge-playwright.mjs:194-240` - `waitForAcceptedHop()` page-fact checks already available for richer regression scenarios.
  - Manifest scripts: `package.json:2-14` - supported regression commands and auth-aware variants.

  **Acceptance Criteria** (agent-executable only):
  - [ ] Semi/e2e include explicit resume A, resume B, and default resume assertions.
  - [ ] At least one Playwright scenario proves relay continuation without manually switching to the responding tab.
  - [ ] These layers continue to describe themselves as control/scenario regressions, not authenticity truth.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: Resume A / B / default coverage passes in Playwright
    Tool: Bash
    Steps: Run the targeted semi/e2e scenarios added for resume override branches
    Expected: All three branches pass with explicit next-hop assertions
    Evidence: .sisyphus/evidence/task-9-playwright-resume.json

  Scenario: Continuation does not require manual target focus
    Tool: Bash
    Steps: Run the new e2e scenario that keeps focus away from the responding target page during a reply cycle
    Expected: The bridge continues based on canonical target observation, not active-tab focus
    Evidence: .sisyphus/evidence/task-9-playwright-continuation.json
  ```

  **Commit**: YES | Message: `test(e2e): cover resume branches and continuation semantics` | Files: `["scripts/semi-bridge-playwright.mjs", "scripts/e2e-bridge-playwright.mjs", "scripts/_playwright-bridge-helpers.mjs"]`

- [ ] 10. Preserve and strengthen page-fact-first authenticity verification

  **What to do**: Update real-hop and any supporting verification helpers only as needed to prove the new semantics without weakening authenticity. Add assertions/evidence for: no waiting-reply before acceptance, no premature next hop while streaming, and successful continuation without manual focus change when the scenario is reproducible under automation.
  **Must NOT do**: Do not convert real-hop into runtime-self-report verification, and do not treat semi/e2e success as authenticity proof.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: authenticity harness must remain strict while incorporating new page-fact signals.
  - Skills: [`test`] - why: regression harness work.
  - Omitted: [`debug-like-expert`] - why not needed: core runtime semantics should already be fixed by previous tasks.

  **Parallelization**: Can Parallel: NO | Wave 3 | Blocks: 11 | Blocked By: 5, 6, 7, 8, 9

  **References** (executor has NO interview context - be exhaustive):
  - Test: `scripts/real-hop-playwright.mjs:451-590` - existing independent-acceptance-before-waiting-reply guardrail.
  - Test: `scripts/e2e-bridge-playwright.mjs:167-192` - hop failure classification helper that should stay subordinate to page facts.
  - README: `README.md:146-160` and `README.md:220-236` - existing test-layer semantics and evidence expectations.
  - Baseline fact: user-confirmed root-only real-hop and root-only e2e happy path already pass on commit `8d98662010c35e70d2f325a798be5b98c626064f`; keep those green.

  **Acceptance Criteria** (agent-executable only):
  - [ ] Real-hop still fails if waiting-reply appears before independent target acceptance.
  - [ ] Real-hop now also catches premature next-hop advancement while the target is still streaming.
  - [ ] Root-only authenticity regression still passes on the repaired branch.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: Authenticity harness remains page-fact-first
    Tool: Bash
    Steps: Run `pnpm run test:real-hop -- --root-only --auth-state playwright/.auth/chatgpt.json --session-state playwright/.auth/chatgpt.session.json`
    Expected: PASS with evidence showing independent acceptance before waiting-reply and no premature settle
    Evidence: .sisyphus/evidence/task-10-real-hop/summary.json

  Scenario: Premature settle / waiting-before-acceptance regression is rejected
    Tool: Bash
    Steps: Run the targeted real-hop/e2e regression path or helper assertions that simulate those invalid sequences
    Expected: Harness rejects those sequences instead of passing on runtime self-report
    Evidence: .sisyphus/evidence/task-10-real-hop-edge.json
  ```

  **Commit**: YES | Message: `test(real-hop): preserve authenticity while adding waiting guards` | Files: `["scripts/real-hop-playwright.mjs", "scripts/e2e-bridge-playwright.mjs", "README.md"]`

- [ ] 11. Align documentation and evidence taxonomy with shipped semantics

  **What to do**: Update README and any evidence/export summaries so the shipped semantics now accurately describe: canonical hop truth, pause/resume override behavior, waiting/settle rules, and timeout/observation classification. Document the updated regression layer responsibilities without overstating e2e/semi authenticity.
  **Must NOT do**: Do not add marketing prose, and do not change docs in ways that contradict runtime behavior or test harness outputs.

  **Recommended Agent Profile**:
  - Category: `writing` - Reason: semantics/documentation alignment after technical changes.
  - Skills: [`update-readme`] - why: README and operational guidance need a precise final sync.
  - Omitted: [`frontend-design`] - why not needed: no UI design work.

  **Parallelization**: Can Parallel: YES | Wave 3 | Blocks: none | Blocked By: 7, 9, 10

  **References** (executor has NO interview context - be exhaustive):
  - README: `README.md:30-48` - current pause/resume/override semantics.
  - README: `README.md:86-105` - runtime-visible failure/diagnostic categories.
  - README: `README.md:146-236` - acceptance-layer semantics and authenticity hierarchy.
  - Evidence pattern: `scripts/real-hop-playwright.mjs:451-590` and existing `tmp/real-hop-*/summary.json` export structure.

  **Acceptance Criteria** (agent-executable only):
  - [ ] README matches the implemented override, waiting, settle, and taxonomy semantics.
  - [ ] README continues to state that real-hop is the sole authenticity gate.
  - [ ] Evidence/export naming no longer implies generic timeout when the implementation can classify a narrower cause.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: Documentation matches shipped semantics
    Tool: Bash
    Steps: Read updated README sections and run the targeted regression commands they reference
    Expected: Commands and semantics described in README match actual passing behavior
    Evidence: .sisyphus/evidence/task-11-docs-alignment.txt

  Scenario: Evidence taxonomy uses the new classified language
    Tool: Bash
    Steps: Inspect generated regression evidence artifacts after Tasks 9-10 complete
    Expected: Exported summaries/logs distinguish classified failures instead of flattening them into generic timeout wording
    Evidence: .sisyphus/evidence/task-11-docs-alignment-edge.txt
  ```

  **Commit**: YES | Message: `docs(waiting): align control-plane and evidence semantics` | Files: `["README.md", "scripts/real-hop-playwright.mjs", "scripts/e2e-bridge-playwright.mjs"]`

## Final Verification Wave (MANDATORY — after ALL implementation tasks)
> 4 review agents run in PARALLEL. ALL must APPROVE. Present consolidated results to user and get explicit "okay" before completing.
> **Do NOT auto-proceed after verification. Wait for user's explicit approval before marking work complete.**
> **Never mark F1-F4 as checked before getting user's okay.** Rejection or user feedback -> fix -> re-run -> present again -> wait for okay.
- [ ] F1. Plan Compliance Audit — oracle
- [ ] F2. Code Quality Review — unspecified-high
- [ ] F3. Real Manual QA — unspecified-high (+ playwright if UI)
- [ ] F4. Scope Fidelity Check — deep

## Commit Strategy
- Commit 1: `test(control-plane): lock resume and waiting regressions`
- Commit 2: `refactor(control-plane): unify hop execution truth`
- Commit 3: `fix(waiting): tighten settle gating and timeout classification`
- Commit 4: `test(e2e): cover continuation semantics and docs alignment`

## Success Criteria
- Resume override A / B / default are all correct from state-machine through popup/overlay display and actual relay execution.
- Waiting object always matches the bound target page actually expected to respond.
- Settled reply means “same target page, assistant changed, stable for N samples, generating false,” not merely “assistant hash changed twice”.
- A real “message later appeared” case no longer gets flattened into generic timeout; it is either classified correctly or eliminated.
- Task 4/5 acceptance gate and recovered first-hop baseline remain intact.
