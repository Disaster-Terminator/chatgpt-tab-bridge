# chatgpt-tab-bridge TypeScript Migration

## TL;DR
> **Summary**: Migrate the MV3 extension runtime to TypeScript in additive phases that lock current behavior first, introduce a real `dist/extension` build, then convert low-risk core modules before touching popup, background, and finally the DOM-coupled content layer.
> **Deliverables**:
> - real `pnpm run build` pipeline emitting `dist/extension`
> - TypeScript runtime sources for `core/`, `popup`, `background`, and `content-script`
> - preserved bridge protocol, state machine semantics, popup/overlay structure, and command surface
> - updated tests/scripts/docs targeting `dist/extension`
> **Effort**: Large
> **Parallel**: YES - 3 waves
> **Critical Path**: T1 baseline contracts → T2 build skeleton → T5 shared types/core contracts → T8 popup → T9 background → T10 content layer → T11 test/doc/path closure

## Context
### Original Request
Low-risk, phased, regression-safe TypeScript migration for the browser extension runtime, preserving bridge protocol semantics (`[BRIDGE_CONTEXT]`, `[BRIDGE_INSTRUCTION]`, `[BRIDGE_STATE] CONTINUE|FREEZE`), state-machine semantics, popup/overlay structure, selector strategy, test commands, and semi-automated integration flows.

### Interview Summary
- Runtime currently loads directly from `src/extension`; current build only validates files and syntax, it does not emit artifacts (`package.json:2-15`, `scripts/build-extension.mjs:5-12`).
- MV3 manifest points at `background.mjs`, `popup.html`, and ordered content-script injection of `content-helpers.js` then `content-script.js` (`src/extension/manifest.json:13-35`).
- Popup HTML and controls are part of the compatibility contract and must not be redesigned (`src/extension/popup.html:10-105`, `README.md:64-79`).
- Core modules already have focused unit tests and are the safest first TS migration targets (`tests/state-machine.test.mjs:22-187`, `tests/relay-core.test.mjs:14-74`, `tests/popup-model.test.mjs:20-70`, `tests/background-helpers.test.mjs:10-47`, `tests/chatgpt-url.test.mjs:6-31`).
- Smoke and semi scripts hardcode `src/extension` as unpacked extension path today (`scripts/smoke-extension-playwright.mjs:8-24`, `scripts/semi-bridge-playwright.mjs:9-25`).

### Metis Review (gaps addressed)
- Added a mandatory baseline characterization phase before runtime migration to lock protocol/state/UI behavior.
- Elevated build/path compatibility to a first-class migration concern: dist parity must exist before `.mjs`/`.js` → `.ts` renames.
- Added explicit guardrails for MV3 bundling: no code splitting for content scripts, no message/protocol renames, no selector cleanup.
- Added a dedicated test/path closure phase because unit tests and Playwright scripts currently import source paths directly.
- Applied a safer deviation from the “merge helper into content script immediately” preference: first preserve public behavior and tests, then collapse helper dependency into the bundled `content-script.js` only in the final content phase.

## Work Objectives
### Core Objective
Produce a TypeScript-based extension runtime and a real dist build while keeping behavior, protocol, state transitions, UI shape, and operator commands compatible with the current MV3 prototype.

### Deliverables
- `tsconfig.json` scoped to extension runtime sources.
- `scripts/build-extension.mjs` that emits `dist/extension` via esbuild and validates manifest/popup asset references.
- TypeScript sources under `src/extension/` for core modules, popup, background, and content runtime.
- Updated tests and Playwright scripts that work against the new build/output layout.
- README instructions updated to `dist/extension` for unpacked loading.

### Definition of Done (verifiable conditions with commands)
- `pnpm run build` exits 0 and emits `dist/extension`.
- `test -f dist/extension/manifest.json` exits 0.
- `test -f dist/extension/background.js` exits 0.
- `test -f dist/extension/popup.html` exits 0.
- `test -f dist/extension/popup.css` exits 0.
- `test -f dist/extension/content-script.js` exits 0.
- `pnpm test` exits 0.
- `pnpm run test:smoke` exits 0 using `dist/extension`.
- `pnpm run test:semi -- --url-a <thread-a> --url-b <thread-b>` is path-compatible with `dist/extension`; if URLs are omitted, the script must fail or skip with an explicit machine-readable reason rather than silent manual dependence.

### Must Have
- Preserve protocol tokens and runtime string values from `src/extension/core/constants.mjs:1-75` and `src/extension/core/relay-core.mjs:22-57`.
- Preserve state machine transitions and gates from `src/extension/core/state-machine.mjs:10-205` and `src/extension/core/state-machine.mjs:208-382`.
- Preserve popup control ids and text-bearing structure from `src/extension/popup.html:10-105`.
- Preserve storage split: runtime state in `chrome.storage.session`, overlay settings in `chrome.storage.local` (`src/extension/background.mjs:172-214`, `src/extension/background.mjs:221-238`).
- Preserve current commands in `package.json:2-15`.

### Must NOT Have (guardrails, AI slop patterns, scope boundaries)
- Must NOT redesign popup or overlay DOM structure.
- Must NOT rename bridge markers, message types, stop reasons, error reasons, storage keys, or state phase values.
- Must NOT rewrite `findLatestAssistantElement`, `findBestComposer`, or send acknowledgement strategy except where required to make TS/build succeed without semantic drift.
- Must NOT introduce React, Vue, Vite, Tailwind, Zustand, or a new frontend architecture.
- Must NOT delete dependencies or tests without proof and a dedicated audit task.
- Must NOT bundle unrelated cleanup/refactor work into migration commits.

## Verification Strategy
> ZERO HUMAN INTERVENTION — all verification is agent-executed.
- Test decision: tests-after with characterization-first expansion.
- Frameworks: Node native test runner for unit contracts, Playwright scripts for smoke/semi, shell assertions for dist parity.
- QA policy: every task includes automated happy-path and failure/edge scenarios.
- Evidence: `.sisyphus/evidence/task-{N}-{slug}.{ext}`

## Execution Strategy
### Parallel Execution Waves
> Target: 5-8 tasks per wave. <3 per wave (except final) = under-splitting.

Wave 1: baseline contracts, build skeleton, path abstraction

Wave 2: shared types + pure core conversions, popup migration

Wave 3: background migration, content migration, script/doc closure

### Dependency Matrix (full, all tasks)
- T1 blocks T2-T11.
- T2 blocks T3-T11.
- T3 blocks T11.
- T4 blocks T11.
- T5 blocks T6-T10.
- T6 blocks T8-T10.
- T7 blocks T8-T10.
- T8 blocks T11.
- T9 blocks T10-T11.
- T10 blocks T11.
- T11 blocks final verification only.

### Agent Dispatch Summary (wave → task count → categories)
- Wave 1 → 4 tasks → unspecified-high / quick
- Wave 2 → 4 tasks → unspecified-high / quick
- Wave 3 → 3 tasks → unspecified-high / deep

## TODOs
> Implementation + Test = ONE task. Never separate.
> EVERY task MUST have: Agent Profile + Parallelization + QA Scenarios.

- [x] 1. Freeze Baseline Contracts and Risk Map

  **What to do**: Add or extend characterization coverage that locks current protocol/state/UI invariants before any TS conversion. Capture the migration file map and risk inventory in repo-facing docs or test comments as needed, but do not change runtime behavior. Add explicit checks for protocol markers, state-machine reset gate, override semantics, and popup control enablement semantics already described in `README.md:26-53` and `README.md:95-119`.
  **Must NOT do**: Must NOT rename runtime files; must NOT change manifest, popup, or content behavior in this task.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` — Reason: requires careful contract extraction without behavior drift.
  - Skills: [`test`] — needed for characterization-first regression coverage.
  - Omitted: [`lint`] — formatting is not the goal here.

  **Parallelization**: Can Parallel: NO | Wave 1 | Blocks: T2-T11 | Blocked By: none

  **References**:
  - Pattern: `README.md:26-53` — canonical state semantics and clear-terminal gate.
  - Pattern: `src/extension/core/constants.mjs:1-75` — runtime string contract for phases, reasons, messages, keys.
  - Pattern: `src/extension/core/relay-core.mjs:22-57` — protocol envelope and directive parsing contract.
  - Pattern: `tests/state-machine.test.mjs:22-187` — existing transition coverage.
  - Pattern: `tests/relay-core.test.mjs:14-74` — existing protocol coverage.
  - Pattern: `tests/popup-model.test.mjs:20-70` — popup control/display contract.

  **Acceptance Criteria**:
  - [ ] `pnpm test` passes with added characterization coverage.
  - [ ] Tests explicitly assert `[BRIDGE_CONTEXT]`, `[BRIDGE_INSTRUCTION]`, and `[BRIDGE_STATE] CONTINUE|FREEZE` invariants.
  - [ ] Tests explicitly assert `clearTerminal -> ready -> start` remains the only round-reset gate.
  - [ ] Tests explicitly assert paused override remains writeable only in `paused`.

  **QA Scenarios**:
  ```
  Scenario: Protocol/state characterization passes
    Tool: Bash
    Steps: run `pnpm test`
    Expected: exit code 0; output includes passing tests for relay core, state machine, popup model, and helpers
    Evidence: .sisyphus/evidence/task-1-baseline-contracts.txt

  Scenario: Regression guard catches protocol drift
    Tool: Bash
    Steps: temporarily inspect the targeted test names after implementation by running `node --test tests/relay-core.test.mjs tests/state-machine.test.mjs`
    Expected: exit code 0; named tests covering protocol/state semantics are present and passing
    Evidence: .sisyphus/evidence/task-1-baseline-contracts-focused.txt
  ```

  **Commit**: YES | Message: `test(contracts): lock bridge and state machine behavior before ts migration` | Files: `tests/*.test.mjs`

- [x] 2. Build Real dist/extension Pipeline

  **What to do**: Add `tsconfig.json` and rewrite `scripts/build-extension.mjs` into a real build that clears `dist/extension`, runs esbuild multi-entry for extension runtime TS entrypoints, copies static assets (`manifest.json`, `popup.html`, `popup.css`, `overlay.css`), rewrites manifest/popup script references to emitted filenames if needed, and validates both manifest-declared files and popup HTML asset references. Build output target is `dist/extension/background.js`, `dist/extension/popup.js`, and `dist/extension/content-script.js` with no code splitting for the content layer.
  **Must NOT do**: Must NOT migrate runtime business logic yet; must NOT redesign file layout beyond the dist output contract.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` — Reason: build topology change with MV3 compatibility constraints.
  - Skills: [`test`] — needed for build verification scripting.
  - Omitted: [`frontend-design`] — no UI work.

  **Parallelization**: Can Parallel: NO | Wave 1 | Blocks: T3-T11 | Blocked By: T1

  **References**:
  - Pattern: `package.json:2-15` — command names must remain stable.
  - Pattern: `scripts/build-extension.mjs:5-63` — current validation-only behavior to replace.
  - Pattern: `src/extension/manifest.json:13-35` — MV3 asset contract to preserve.
  - Pattern: `src/extension/popup.html:7-8` and `src/extension/popup.html:105-105` — popup asset references that must also be validated.
  - Pattern: `README.md:147-153` — documented meaning of `pnpm run build` to update after dist build exists.

  **Acceptance Criteria**:
  - [ ] `pnpm run build` exits 0.
  - [ ] `dist/extension` is recreated from scratch and contains emitted runtime JS plus copied static assets.
  - [ ] Manifest references in `dist/extension/manifest.json` all resolve to existing files.
  - [ ] `popup.html` references in `dist/extension/popup.html` resolve to existing files.

  **QA Scenarios**:
  ```
  Scenario: Dist build emits a loadable extension tree
    Tool: Bash
    Steps: run `pnpm run build && test -f dist/extension/manifest.json && test -f dist/extension/background.js && test -f dist/extension/popup.html && test -f dist/extension/popup.css && test -f dist/extension/content-script.js`
    Expected: exit code 0; all expected artifacts exist
    Evidence: .sisyphus/evidence/task-2-build-pipeline.txt

  Scenario: Broken asset references fail the validator
    Tool: Bash
    Steps: run the build's built-in validation path after implementation review and confirm it rejects missing manifest/popup refs by exercising the validation function in a controlled test or script fixture
    Expected: non-zero result for missing asset fixture; zero for real build
    Evidence: .sisyphus/evidence/task-2-build-validation.txt
  ```

  **Commit**: YES | Message: `build(extension): emit dist artifacts for mv3 ts migration` | Files: `tsconfig.json`, `scripts/build-extension.mjs`, build-support files

- [x] 3. Centralize Extension Path Resolution for Smoke/Semi/Manual Loading

  **What to do**: Introduce one shared path-resolution contract for extension loading so smoke/semi scripts and docs stop hardcoding `src/extension`. Default all automated validation to `dist/extension`; if a fallback or override is needed, use one explicit env/flag contract shared by both scripts and docs.
  **Must NOT do**: Must NOT change script names or operator flags except to add backwards-compatible optional path override support.

  **Recommended Agent Profile**:
  - Category: `quick` — Reason: bounded script/docs path refactor.
  - Skills: [`test`] — needed for script-level verification.
  - Omitted: [`review`] — not required for this isolated closure.

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: T11 | Blocked By: T2

  **References**:
  - Pattern: `scripts/smoke-extension-playwright.mjs:8-24` — current hardcoded extension path.
  - Pattern: `scripts/semi-bridge-playwright.mjs:9-25` — current hardcoded extension path.
  - Pattern: `README.md:185-190` — current manual loading path documentation.

  **Acceptance Criteria**:
  - [ ] `pnpm run test:smoke` loads from `dist/extension` without manual edits.
  - [ ] `pnpm run test:semi -- --url-a <thread-a> --url-b <thread-b>` accepts the same operator flags and uses the centralized extension path.
  - [ ] README load path points to `dist/extension`.

  **QA Scenarios**:
  ```
  Scenario: Smoke script resolves dist path automatically
    Tool: Bash
    Steps: run `pnpm run build && pnpm run test:smoke`
    Expected: exit code 0; output includes overlay smoke pass and popup smoke pass using dist artifacts
    Evidence: .sisyphus/evidence/task-3-smoke-path.txt

  Scenario: Semi script reports missing URL inputs predictably or uses provided URLs with dist path
    Tool: Bash
    Steps: run `pnpm run build && pnpm run test:semi -- --url-a https://chatgpt.com/c/example-a --url-b https://chatgpt.com/c/example-b` in a controlled environment or capture explicit skip/error contract when live session is unavailable
    Expected: script uses centralized extension path and emits a machine-readable success/skip/failure reason rather than path errors
    Evidence: .sisyphus/evidence/task-3-semi-path.txt
  ```

  **Commit**: YES | Message: `test(paths): centralize extension loading to dist output` | Files: `scripts/*.mjs`, `README.md`, shared path helper if added

- [x] 4. Decouple Tests from Source Extension Suffixes

  **What to do**: Update unit tests and helper harnesses so they no longer assume direct `.mjs` or raw `content-helpers.js` source paths forever. Introduce a stable import/fixture strategy compatible with phased TS migration, while preserving `pnpm test` and Node's native test runner.
  **Must NOT do**: Must NOT convert the whole test suite to TypeScript in this migration.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` — Reason: test harnesses currently depend on concrete source file extensions and raw script execution.
  - Skills: [`test`] — needed to keep the existing runner shape.
  - Omitted: [`lint`] — not needed.

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: T11 | Blocked By: T2

  **References**:
  - Pattern: `tests/state-machine.test.mjs:4-10` — direct `.mjs` imports.
  - Pattern: `tests/relay-core.test.mjs:4-12` — direct `.mjs` imports.
  - Pattern: `tests/content-helpers.test.mjs:6-15` — raw file execution of `content-helpers.js` and reliance on `globalThis.ChatGptBridgeContent`.

  **Acceptance Criteria**:
  - [ ] `pnpm test` continues to pass after introducing the stable test import strategy.
  - [ ] No test imports are blocked on runtime source suffix churn during later phases.
  - [ ] Helper-specific tests can validate equivalent behavior after helper internals move into TS/module form.

  **QA Scenarios**:
  ```
  Scenario: Unit test harness survives path abstraction
    Tool: Bash
    Steps: run `pnpm test`
    Expected: exit code 0; no module-not-found errors from `.mjs`/`.js` path churn
    Evidence: .sisyphus/evidence/task-4-test-harness.txt

  Scenario: Helper fixture still validates composer behavior
    Tool: Bash
    Steps: run `node --test tests/content-helpers.test.mjs`
    Expected: exit code 0; helper behavior coverage remains active after import strategy change
    Evidence: .sisyphus/evidence/task-4-helper-harness.txt
  ```

  **Commit**: YES | Message: `test(harness): make regression tests resilient to ts path migration` | Files: `tests/*.test.mjs`, supporting test helpers

- [x] 5. Introduce Shared Type Contracts and Extension Ambient Types

  **What to do**: Create shared TS type definitions for runtime state, bindings, overlay settings, runtime activity, message payloads, popup model, overlay model, and relay guards. Add minimal ambient declarations for `chrome.*` and any extension-specific globals if external typings are not adopted. Scope `tsconfig.json` initially to `src/extension/**` only.
  **Must NOT do**: Must NOT change runtime string values or convert business logic in this task.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` — Reason: defines contracts that unblock all later TS files.
  - Skills: [`test`] — type scaffolding must preserve test and build success.
  - Omitted: [`react-best-practices`] — irrelevant.

  **Parallelization**: Can Parallel: NO | Wave 2 | Blocks: T6-T10 | Blocked By: T2

  **References**:
  - API/Type: `src/extension/core/constants.mjs:1-75` — authoritative runtime string contracts.
  - API/Type: `src/extension/core/state-machine.mjs:10-48` — canonical runtime state shape.
  - API/Type: `src/extension/background.mjs:107-169` — message boundary and message-type dispatch.
  - API/Type: `src/extension/background.mjs:599-637` — popup/overlay model shapes.
  - API/Type: `src/extension/content-script.js:21-37` — overlay snapshot shape.

  **Acceptance Criteria**:
  - [ ] `pnpm run build` passes with shared types present and no runtime logic migration yet.
  - [ ] Type contracts cover state, bindings, overlay settings, message envelopes, popup model, and overlay model.
  - [ ] No runtime constant values change.

  **QA Scenarios**:
  ```
  Scenario: Type scaffolding integrates without runtime churn
    Tool: Bash
    Steps: run `pnpm run build && pnpm test`
    Expected: both commands exit 0; no emitted-path or contract regressions
    Evidence: .sisyphus/evidence/task-5-shared-types.txt

  Scenario: Message contract coverage remains stable
    Tool: Bash
    Steps: run `node --test tests/state-machine.test.mjs tests/popup-model.test.mjs tests/relay-core.test.mjs`
    Expected: exit code 0; contract tests still pass after introducing TS types
    Evidence: .sisyphus/evidence/task-5-contract-tests.txt
  ```

  **Commit**: YES | Message: `refactor(types): define shared extension runtime contracts` | Files: `src/extension/shared/types.ts` or `src/extension/core/types.ts`, ambient declarations, `tsconfig.json`

- [x] 6. Migrate Low-Risk Core Utility Modules to TypeScript

  **What to do**: Convert `constants`, `chatgpt-url`, `background-helpers`, and `overlay-settings` to TS first. Preserve exported function names, constant values, and normalization semantics. Update stable import surfaces so both build and tests continue to work.
  **Must NOT do**: Must NOT alter protocol strings, storage keys, URL parsing behavior, or overlay normalization behavior.

  **Recommended Agent Profile**:
  - Category: `quick` — Reason: small pure modules with direct unit coverage.
  - Skills: [`test`] — existing focused tests provide fast safety net.
  - Omitted: [`review`] — not necessary for this atomic conversion.

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: T8-T10 | Blocked By: T5

  **References**:
  - Pattern: `src/extension/core/constants.mjs:1-75` — constant export surface to preserve.
  - Pattern: `src/extension/core/chatgpt-url.mjs:1-43` — URL parser behavior.
  - Pattern: `src/extension/core/background-helpers.mjs:1-26` — binding/tab-id helper semantics.
  - Pattern: `src/extension/core/overlay-settings.mjs:1-29` — overlay settings normalization.
  - Test: `tests/chatgpt-url.test.mjs:6-31`
  - Test: `tests/background-helpers.test.mjs:10-47`

  **Acceptance Criteria**:
  - [ ] `pnpm test` passes after converting these modules.
  - [ ] Export names and runtime values remain compatible.
  - [ ] `pnpm run build` passes with TS imports wired.

  **QA Scenarios**:
  ```
  Scenario: Utility module conversions preserve existing tests
    Tool: Bash
    Steps: run `pnpm test`
    Expected: exit code 0; url/background-helper tests remain green
    Evidence: .sisyphus/evidence/task-6-utility-core.txt

  Scenario: Dist build still emits compatible runtime assets
    Tool: Bash
    Steps: run `pnpm run build`
    Expected: exit code 0; emitted extension artifacts still present
    Evidence: .sisyphus/evidence/task-6-utility-build.txt
  ```

  **Commit**: YES | Message: `refactor(core): migrate utility modules to typescript` | Files: `src/extension/core/constants.ts`, `chatgpt-url.ts`, `background-helpers.ts`, `overlay-settings.ts`, import updates

- [x] 7. Migrate Protocol and State Core to TypeScript

  **What to do**: Convert `relay-core.mjs`, `state-machine.mjs`, and `popup-model.mjs` to TS. Make the `reduceState` event parameter a discriminated union. Add explicit return types for reducer helpers, guards, display builders, and protocol utilities while preserving behavior.
  **Must NOT do**: Must NOT change state transitions, round semantics, stop/error mapping, or protocol text layout.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` — Reason: these modules define the behavioral core and shared types.
  - Skills: [`test`] — strong contract coverage exists and must remain green.
  - Omitted: [`code-optimizer`] — not in scope.

  **Parallelization**: Can Parallel: NO | Wave 2 | Blocks: T8-T10 | Blocked By: T5

  **References**:
  - Pattern: `src/extension/core/relay-core.mjs:22-57` — envelope/build/parse contract.
  - Pattern: `src/extension/core/relay-core.mjs:59-135` — guard behavior and stop mapping.
  - Pattern: `src/extension/core/state-machine.mjs:51-87` — event-dispatch switch to convert into discriminated union.
  - Pattern: `src/extension/core/state-machine.mjs:170-205` — start/reset gate behavior.
  - Pattern: `src/extension/core/state-machine.mjs:222-255` — override consume-once behavior.
  - Pattern: `src/extension/core/state-machine.mjs:304-342` — stopped/error terminal semantics.
  - Pattern: `src/extension/core/popup-model.mjs:4-26` — derived controls/display contract.
  - Test: `tests/state-machine.test.mjs:22-187`
  - Test: `tests/relay-core.test.mjs:14-74`
  - Test: `tests/popup-model.test.mjs:20-70`

  **Acceptance Criteria**:
  - [ ] `pnpm test` passes.
  - [ ] `reduceState` event input is represented as a discriminated union in TS.
  - [ ] Bridge protocol tests still assert exact marker strings.
  - [ ] No state-machine characterization test changes expectation values.

  **QA Scenarios**:
  ```
  Scenario: Core behavior remains unchanged after TS conversion
    Tool: Bash
    Steps: run `pnpm test`
    Expected: exit code 0; state-machine, relay-core, and popup-model tests pass unchanged in meaning
    Evidence: .sisyphus/evidence/task-7-state-protocol.txt

  Scenario: Dist build consumes converted core modules successfully
    Tool: Bash
    Steps: run `pnpm run build`
    Expected: exit code 0; no import-resolution or emitted-asset regressions
    Evidence: .sisyphus/evidence/task-7-state-protocol-build.txt
  ```

  **Commit**: YES | Message: `refactor(core): migrate protocol and state modules to typescript` | Files: `src/extension/core/relay-core.ts`, `state-machine.ts`, `popup-model.ts`, import updates

- [x] 8. Migrate popup.mjs to popup.ts Without UI Drift

  **What to do**: Convert the popup controller to TS, type the DOM element map, message payloads, and `sendMessage`/`perform`/`refreshLatestModel`/`buildDebugSnapshot` return paths. Keep popup HTML structure, ids, labels, refresh cadence, and control flow unchanged.
  **Must NOT do**: Must NOT redesign popup HTML/CSS or rename any element ids.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` — Reason: browser runtime wiring with DOM types and message contracts.
  - Skills: [`test`] — smoke and model-based validation required.
  - Omitted: [`frontend-design`] — UI redesign forbidden.

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: T11 | Blocked By: T6, T7

  **References**:
  - Pattern: `src/extension/popup.html:10-105` — id and structure contract.
  - Pattern: `src/extension/popup.mjs:5-29` — DOM element map to type exactly.
  - Pattern: `src/extension/popup.mjs:53-74` — popup-model refresh behavior.
  - Pattern: `src/extension/popup.mjs:76-165` — event wiring to preserve.
  - Pattern: `src/extension/popup.mjs:176-213` — render enable/disable semantics.
  - Pattern: `src/extension/popup.mjs:269-275` — message response contract.
  - Test: `tests/popup-model.test.mjs:20-70`
  - External: `scripts/smoke-extension-playwright.mjs:48-58` — popup smoke contract.

  **Acceptance Criteria**:
  - [ ] `pnpm run build` emits `dist/extension/popup.js` and `dist/extension/popup.html` references it correctly.
  - [ ] `pnpm run test:smoke` passes.
  - [ ] Popup control ids and text queried by smoke/semi scripts remain unchanged.

  **QA Scenarios**:
  ```
  Scenario: Popup still opens and exposes stable controls
    Tool: Bash
    Steps: run `pnpm run build && pnpm run test:smoke`
    Expected: exit code 0; popup smoke pass confirms `#bindAButton` and `#startButton`
    Evidence: .sisyphus/evidence/task-8-popup-smoke.txt

  Scenario: Popup model errors surface through typed message boundary
    Tool: Bash
    Steps: run `pnpm test` and ensure popup-model tests plus any popup contract tests pass after conversion
    Expected: exit code 0; no message-boundary regressions
    Evidence: .sisyphus/evidence/task-8-popup-model.txt
  ```

  **Commit**: YES | Message: `refactor(popup): migrate popup controller to typescript` | Files: `src/extension/popup.ts`, popup asset reference updates, related imports

- [x] 9. Migrate background.mjs to background.ts While Preserving Runtime Semantics

  **What to do**: Convert the service worker to TS, type message dispatch, storage access, runtime state persistence, overlay sync snapshots, and reply-settling helpers. Add explicit return types for `handleMessage`, `getPopupModel`, `getOverlayModel`, `waitForSettledReply`, and related helpers. Preserve session/local storage layering, keepalive behavior, loop token cancellation, and stop/error transitions.
  **Must NOT do**: Must NOT alter session lifecycle semantics, stop/error reason strings, or request/response payload semantics.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` — Reason: MV3 background service worker is central runtime surface with storage and tab APIs.
  - Skills: [`test`] — unit + smoke + semi-path verification required.
  - Omitted: [`github-workflows`] — irrelevant.

  **Parallelization**: Can Parallel: YES | Wave 3 | Blocks: T10-T11 | Blocked By: T6, T7

  **References**:
  - Pattern: `src/extension/background.mjs:41-61` — install/startup/keepalive port behavior.
  - Pattern: `src/extension/background.mjs:63-97` — binding invalidation on tab removal/url change.
  - Pattern: `src/extension/background.mjs:99-169` — message dispatch boundary.
  - Pattern: `src/extension/background.mjs:172-214` — session/local storage layering.
  - Pattern: `src/extension/background.mjs:221-238` — state persistence and active-loop reset.
  - Pattern: `src/extension/background.mjs:448-597` — wait-for-reply and stop conditions.
  - Pattern: `src/extension/background.mjs:599-637` — popup/overlay model return shape.
  - Pattern: `src/extension/background.mjs:648-679` — overlay broadcast snapshot shape.

  **Acceptance Criteria**:
  - [ ] `pnpm run build` passes and emits `dist/extension/background.js`.
  - [ ] `pnpm test` passes.
  - [ ] `pnpm run test:smoke` passes.
  - [ ] Semi script remains path-compatible and control-state compatible with the migrated background.

  **QA Scenarios**:
  ```
  Scenario: Background migration preserves popup/overlay smoke path
    Tool: Bash
    Steps: run `pnpm run build && pnpm run test:smoke`
    Expected: exit code 0; overlay injects and popup opens from migrated background service worker
    Evidence: .sisyphus/evidence/task-9-background-smoke.txt

  Scenario: Background state semantics remain compatible with control flows
    Tool: Bash
    Steps: run `pnpm test && pnpm run test:semi -- --url-a https://chatgpt.com/c/example-a --url-b https://chatgpt.com/c/example-b` in supported environment or capture explicit skip contract
    Expected: unit tests pass and semi script reaches either PASS or explicit environment-bound skip without path/runtime-type failures
    Evidence: .sisyphus/evidence/task-9-background-semi.txt
  ```

  **Commit**: YES | Message: `refactor(background): migrate service worker to typescript` | Files: `src/extension/background.ts`, related imports/types

- [x] 10. Migrate content helpers and content script to TypeScript With Equivalent DOM Behavior

  **What to do**: Convert `content-helpers.js` and `content-script.js` to TS. Replace the runtime `globalThis.ChatGptBridgeContent` dependency with explicit module imports inside the source graph, but emit a single public `dist/extension/content-script.js` artifact for the manifest. Preserve selector order, composer detection order, send acknowledgement strategy, overlay shape, and snapshot logic. Update helper-specific tests to validate the imported TS/module surface rather than relying on an ambient global.
  **Must NOT do**: Must NOT rewrite `findLatestAssistantElement`, `findBestComposer`, send-button strategy, or overlay action semantics except for type/build compatibility.

  **Recommended Agent Profile**:
  - Category: `deep` — Reason: highest-risk DOM-coupled surface with helper/runtime coupling.
  - Skills: [`test`] — requires fixture, smoke, and script-level regression coverage.
  - Omitted: [`make-interfaces-feel-better`] — UI polish forbidden.

  **Parallelization**: Can Parallel: NO | Wave 3 | Blocks: T11 | Blocked By: T6, T7, T9

  **References**:
  - Pattern: `src/extension/content-script.js:1-19` — current helper global and duplicated message constants.
  - Pattern: `src/extension/content-script.js:39-72` — content-script message handling.
  - Pattern: `src/extension/content-script.js:199-289` — overlay DOM structure and render semantics.
  - Pattern: `src/extension/content-script.js:357-477` — assistant snapshot, send pipeline, button wait behavior.
  - Pattern: `src/extension/content-script.js:436-454` — `findLatestAssistantElement` selector order to preserve.
  - Pattern: `tests/content-helpers.test.mjs:16-151` — helper behavior contract.
  - External: `scripts/smoke-extension-playwright.mjs:31-58` — overlay injection and popup-opening smoke contract.
  - External: `scripts/semi-bridge-playwright.mjs:53-109` — overlay bind/start/pause/resume/stop semi contract.

  **Acceptance Criteria**:
  - [ ] `pnpm run build` passes and manifest references only the intended dist content artifact(s).
  - [ ] `pnpm test` passes, including helper behavior tests adapted to TS/module form.
  - [ ] `pnpm run test:smoke` passes with overlay injection intact.
  - [ ] `pnpm run test:semi` remains path-compatible and control-flow compatible.

  **QA Scenarios**:
  ```
  Scenario: Content layer migration preserves overlay injection and popup reachability
    Tool: Bash
    Steps: run `pnpm run build && pnpm run test:smoke`
    Expected: exit code 0; overlay appears on `chatgpt.com`, exposes extension id, popup opens
    Evidence: .sisyphus/evidence/task-10-content-smoke.txt

  Scenario: Content helper and relay send contracts remain stable
    Tool: Bash
    Steps: run `pnpm test && pnpm run test:semi -- --url-a https://chatgpt.com/c/example-a --url-b https://chatgpt.com/c/example-b` in supported environment or capture explicit skip contract
    Expected: helper tests pass and semi flow reaches PASS/explicit skip without selector-path regressions
    Evidence: .sisyphus/evidence/task-10-content-semi.txt
  ```

  **Commit**: YES | Message: `refactor(content): migrate content runtime to typescript` | Files: `src/extension/content-script.ts`, helper TS modules, manifest/build wiring, related tests

- [x] 11. Close the Migration: Commands, Docs, and Final Dist Compatibility

  **What to do**: Update remaining tests, script messaging, and README documentation so the repo consistently describes and exercises `dist/extension` as the unpacked extension path. Audit package dependencies discovered during migration and mark uncertain ones for follow-up instead of deleting them without proof.
  **Must NOT do**: Must NOT remove dependencies speculatively or change public command names.

  **Recommended Agent Profile**:
  - Category: `quick` — Reason: bounded closure and documentation alignment.
  - Skills: [`test`] — final command validation required.
  - Omitted: [`update-readme`] — generic README workflow not required.

  **Parallelization**: Can Parallel: YES | Wave 3 | Blocks: final verification only | Blocked By: T2, T3, T4, T8, T9, T10

  **References**:
  - Pattern: `package.json:2-15` — command names must stay identical.
  - Pattern: `README.md:138-190` — commands and unpacked-load instructions to update.
  - Pattern: `scripts/smoke-extension-playwright.mjs:46-58` — expected smoke output markers.
  - Pattern: `scripts/semi-bridge-playwright.mjs:80-109` — expected semi output/control markers.

  **Acceptance Criteria**:
  - [ ] `pnpm run build` passes.
  - [ ] `pnpm test` passes.
  - [ ] `pnpm run test:smoke` passes.
  - [ ] `pnpm run test:semi` is path-compatible with dist output and emits explicit success/skip/failure signals.
  - [ ] README instructs loading `dist/extension` in Edge.

  **QA Scenarios**:
  ```
  Scenario: Full command surface remains intact
    Tool: Bash
    Steps: run `pnpm run build && pnpm test && pnpm run test:smoke`
    Expected: all commands exit 0 with unchanged command names
    Evidence: .sisyphus/evidence/task-11-command-surface.txt

  Scenario: Dist-based semi/manual path is documented and script-compatible
    Tool: Bash
    Steps: inspect README/load instructions after `pnpm run build`; run `pnpm run test:semi -- --url-a https://chatgpt.com/c/example-a --url-b https://chatgpt.com/c/example-b` in supported environment or capture explicit skip contract
    Expected: docs point to `dist/extension`; semi script no longer hardcodes `src/extension`
    Evidence: .sisyphus/evidence/task-11-docs-and-semi.txt
  ```

  **Commit**: YES | Message: `docs(test): align commands and unpacked loading with dist extension` | Files: `README.md`, `scripts/*.mjs`, `package.json` if script internals need wiring only

## Final Verification Wave (MANDATORY — after ALL implementation tasks)
> 4 review agents run in PARALLEL. ALL must APPROVE. Present consolidated results to user and get explicit "okay" before completing.
> **Do NOT auto-proceed after verification. Wait for user's explicit approval before marking work complete.**
> **Never mark F1-F4 as checked before getting user's okay.** Rejection or user feedback -> fix -> re-run -> present again -> wait for okay.
- [ ] F1. Plan Compliance Audit — oracle
- [ ] F2. Code Quality Review — unspecified-high
- [ ] F3. Real Manual QA — unspecified-high (+ playwright if UI)
- [ ] F4. Scope Fidelity Check — deep

## Commit Strategy
- Keep one behavior surface per commit; do not mix build topology and multiple runtime surfaces.
- Recommended commit order:
  1. baseline characterization only
  2. dist build skeleton
  3. path resolution closure
  4. test harness decoupling
  5. shared type contracts
  6. low-risk utility core
  7. protocol/state core
  8. popup migration
  9. background migration
  10. content migration
  11. docs/command closure
- Every commit must leave `pnpm run build` and the smallest relevant test subset passing.

## Success Criteria
- Bridge protocol text and state markers remain byte-compatible with current tests and runtime.
- State machine preserves `idle -> ready -> running -> paused -> stopped/error` semantics and `clearTerminal -> ready -> start` reset behavior.
- Popup and overlay controls preserve ids, labels, and enable/disable semantics used by smoke/semi scripts.
- `dist/extension` becomes the canonical unpacked extension load path.
- `pnpm run build`, `pnpm test`, `pnpm run test:smoke`, and dist-compatible `pnpm run test:semi` all have explicit success paths.
