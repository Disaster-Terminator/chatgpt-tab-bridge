# P0 Regression Matrix

This matrix defines **executable acceptance gates** for the current reliability-focused relay scope.

> Scope rule: focus on the A/B main relay chain only (binding → source snapshot → payload build → target dispatch → dispatch verification → reply observation → next-hop transition → bounded stop/recovery → evidence export).

## Global execution rules

- Run infrastructure smoke first (`P0-1`) before any business relay lane.
- Every live ChatGPT-dependent run must end with explicit `PASS`, `FAIL`, or `SKIP` and record a debug report path.
- Preserve current script compatibility; add wrappers if needed, do not rename existing commands.

---

## P0-1: Infrastructure smoke

- **Purpose**: Prove the environment is valid for further relay testing.
- **Setup**:
  - ChatGPT account already logged in using the designated profile lane.
  - Built extension is loadable.
- **Command**:
  - `pnpm run auth:bootstrap-profile` (bootstrap when needed)
  - `pnpm run test:smoke`
- **Expected result**:
  - Logged-in state confirmed.
  - Extension loaded.
  - ChatGPT page testable.
- **Evidence artifact**:
  - Smoke log output + generated debug report path (if emitted).
- **Known limitations**:
  - Does not validate relay hops or round transitions.

## P0-2: One-hop relay

- **Purpose**: Validate a single successful relay from source to target.
- **Setup**:
  - Tab A has at least one assistant reply.
  - Tab B may be an empty thread.
  - A/B binding completed.
- **Command**:
  - `pnpm run test:real-hop` (or equivalent single-hop lane)
- **Expected result**:
  - A → B dispatch accepted.
  - B produces a new assistant reply.
- **Evidence artifact**:
  - Runtime event sequence + hop summary in debug report.
- **Known limitations**:
  - Real web timing variance can increase runtime or produce SKIP on infra instability.

## P0-3: Two-hop roundtrip

- **Purpose**: Verify round growth and direction switching.
- **Setup**:
  - Both tabs bind correctly.
  - At least one side can produce initial assistant content.
- **Command**:
  - `pnpm run test:e2e`
- **Expected result**:
  - A → B then B → A both succeed.
  - `round` increments correctly.
  - `nextHopSource` transitions correctly.
- **Evidence artifact**:
  - E2E output + state snapshots showing round/nextHopSource evolution.
- **Known limitations**:
  - Sensitive to ChatGPT latency and browser lifecycle events.

## P0-4: Empty starter guard

- **Purpose**: Ensure starter-side emptiness is blocked deterministically.
- **Setup**:
  - Selected starter tab contains no assistant message.
  - Target tab may be empty but bindable.
- **Command**:
  - Targeted regression test lane (unit/e2e path for starter-empty).
- **Expected result**:
  - Start is rejected.
  - Stop reason is `starter_empty`.
  - Empty target binding remains allowed.
- **Evidence artifact**:
  - Stop-state snapshot + classified reason in debug report.
- **Known limitations**:
  - Depends on accurate source snapshot detection.

## P0-5: Hidden target classification

- **Purpose**: Bound waiting behavior when target is not foreground-active.
- **Setup**:
  - Target tab is background/hidden.
  - Dispatch can be accepted but generation may not start.
- **Command**:
  - Hidden-target regression lane (real-hop/e2e scenario).
- **Expected result**:
  - Classifies hidden/inactive-related reason when no generation starts.
  - Must not wait indefinitely in `waiting_reply`.
- **Evidence artifact**:
  - Runtime events with classification and bounded timeout outcome.
- **Known limitations**:
  - Browser throttling policy may differ across runs/platforms.

## P0-6: Service worker suspend/recover

- **Purpose**: Validate watchdog behavior under MV3 worker lifecycle interruption.
- **Setup**:
  - Relay running.
  - Simulate or wait for worker suspend/wake cycle.
- **Command**:
  - Worker lifecycle regression lane (manual-assisted or scripted).
- **Expected result**:
  - Watchdog resumes relay safely, or
  - Relay stops with explicit, non-ambiguous reason.
- **Evidence artifact**:
  - Alarm/runtime lifecycle events + terminal classification in report.
- **Known limitations**:
  - Exact suspend timing is browser-managed and partly nondeterministic.

## P0-7: Overlay survival

- **Purpose**: Ensure in-page overlay remains available after DOM churn.
- **Setup**:
  - ChatGPT page loaded with overlay enabled.
  - Trigger DOM churn/navigation-like updates.
- **Command**:
  - Overlay resilience lane (smoke/semi/e2e as applicable).
- **Expected result**:
  - Overlay reattaches automatically.
  - Controls/state indicators remain functional.
- **Evidence artifact**:
  - UI observation log and/or runtime events for overlay reattach.
- **Known limitations**:
  - Visual timing differences can cause transient flicker.

---

## Baseline local gate

Run this local preflight before pushing changes that affect relay logic/docs tied to acceptance criteria:

```bash
pnpm run typecheck
pnpm run build
pnpm test
```
