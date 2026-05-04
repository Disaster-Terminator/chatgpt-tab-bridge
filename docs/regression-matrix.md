# Regression Matrix (P0)

This document defines executable P0 acceptance gates for the ChatGPT Tab Bridge reliability path.

This is the **v1 P0 matrix**. It intentionally covers the current main relay reliability path first; later matrices may split these into finer-grained gates such as stale-generating, debug-report export, and worker recovery sub-scenarios.

## Scope

Main-path only:

`A/B binding -> source snapshot -> payload build -> target dispatch -> dispatch verification -> reply observation -> next-hop transition -> bounded stop/recovery -> evidence export`

## Command policy

Only documented `package.json` scripts are used here. Do not reference future `check:*` wrappers until they exist in `package.json`.

---

## P0-1 smoke

- **Purpose**: Confirm environment and extension baseline is testable.
- **Setup**:
  - Browser profile is logged into ChatGPT Web.
  - `dist/extension` is built and loaded.
  - At least one ChatGPT tab is open.
- **Command**: `pnpm run test:smoke`
- **Expected result**:
  - Smoke script reports PASS for login/session and extension availability checks.
  - ChatGPT page probe is testable (no hard blocker).
- **Evidence artifact**:
  - Smoke console output with PASS/FAIL/SKIP markers.
  - Any generated debug snapshot/report path.
- **Known limitations**:
  - Requires local authenticated profile.
  - Can be affected by ChatGPT frontend/runtime changes.

## P0-2 one-hop

- **Purpose**: Validate one successful relay dispatch and target reply observation.
- **Setup**:
  - Tab A has a fresh assistant reply.
  - Tab B can be an empty/new thread.
  - A/B are bound correctly.
- **Command**: `pnpm run test:real-hop`
- **Expected result**:
  - Relay performs `A -> B` dispatch successfully.
  - B shows a new assistant reply after submission.
- **Evidence artifact**:
  - Runtime event trace of send accepted + reply observed.
  - Debug report JSON path.
- **Known limitations**:
  - Live-network and account-state dependent.
  - Timing-sensitive when ChatGPT is heavily loaded.

## P0-3 two-hop

- **Purpose**: Validate round accounting and next-hop state transition across two legs.
- **Setup**:
  - A/B both bound and responsive.
  - Starter side selected.
- **Command**: `pnpm run test:e2e`
- **Expected result**:
  - One round includes both `A -> B` and `B -> A` hops.
  - `round` increments correctly.
  - `nextHopSource` matches expected alternation.
- **Evidence artifact**:
  - E2E logs with hop order and state transitions.
  - Debug report JSON path.
- **Known limitations**:
  - Depends on stable browser lifecycle and ChatGPT responsiveness.

## P0-4 empty starter

- **Purpose**: Enforce starter-side non-empty precondition while allowing empty target binding.
- **Setup**:
  - Starter tab has no assistant reply.
  - Target tab may be empty.
- **Command**: `pnpm test`
- **Expected result**:
  - Start is rejected.
  - Stop reason is `starter_empty`.
  - Empty target binding is still valid.
- **Evidence artifact**:
  - Unit test output for starter-empty checks.
  - Runtime stop reason snapshot.
- **Known limitations**:
  - Depends on test fixture parity with runtime classification behavior.

## P0-5 hidden target

- **Purpose**: Bound hidden/inactive-target failure modes.
- **Setup**:
  - Target tab is not foreground.
  - Dispatch accepted but generation may not start due to hidden/inactive constraints.
- **Command**: `pnpm run test:e2e`
- **Expected result**:
  - Classified as hidden/inactive-related reason when generation does not begin.
  - Must not stay in unbounded `waiting_reply`.
- **Evidence artifact**:
  - Runtime classification event + stop/error reason.
  - Debug report JSON path with lifecycle facts.
- **Known limitations**:
  - Browser throttling behavior varies by machine, OS, and policy.

## P0-6 service worker recovery

- **Purpose**: Verify bounded handling of MV3 service-worker suspend/resume during relay.
- **Setup**:
  - Relay is running.
  - Simulate or wait for worker suspend/wakeup conditions.
- **Command**: `pnpm run test:e2e`
- **Expected result**:
  - Watchdog resumes progress OR relay terminates with explicit reason.
  - No silent stall.
- **Evidence artifact**:
  - Worker lifecycle runtime events.
  - Debug report JSON path.
- **Known limitations**:
  - Suspension timing is non-deterministic in local environments.

## P0-7 overlay survival

- **Purpose**: Ensure in-page overlay survives ChatGPT DOM churn.
- **Setup**:
  - Overlay enabled on ChatGPT page.
  - Trigger route/render changes or DOM replacement patterns.
- **Command**: `pnpm run test:semi`
- **Expected result**:
  - Overlay is re-attached and remains functional.
- **Evidence artifact**:
  - Semi-automated test logs and/or manual verification notes.
  - Optional screenshot/video capture.
- **Known limitations**:
  - DOM churn patterns may change with ChatGPT releases.

---

## Baseline local gate

Before P0 runs:

- `pnpm run typecheck`
- `pnpm run build`
- `pnpm test`

These baseline checks must pass before any live ChatGPT-dependent pass/fail signal is trusted.
