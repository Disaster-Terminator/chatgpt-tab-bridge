# Architecture

## 1) Runtime surfaces

- **Background service worker (`src/extension/background.ts`)**  
  Relay orchestrator, state transitions, alarms/watchdog, runtime event logging, and message hub.
- **Content script (`src/extension/content-script.ts`)**  
  ChatGPT page bridge for DOM read/write, send triggers, and page-level probes.
- **Popup (`src/extension/popup.ts`)**  
  Global control/status surface for bindings, settings, and diagnostics entry points.
- **Overlay (`src/extension/ui/*`, `src/extension/overlay.css`)**  
  In-page operational controls and fast status visibility during live relay runs.
- **Debug/test server scripts (`scripts/*`)**  
  E2E orchestration, auth/profile lanes, smoke and real-hop diagnostics.

## 2) State model

Core runtime state centers on:

- **bindings**: Tab-role mapping for A/B.
- **phase**: `ready | running | paused | stopped | error` lifecycle.
- **activeHop**: Current source/target hop context.
- **nextHopSource**: Direction decision for the next relay cycle.
- **settings**: Runtime behavior toggles (overlay, diagnostics, policy flags).
- **stop/error reasons**: Bounded terminal outcomes with classification intent.

Design objective: transitions must be auditable and explainable, not implicit side effects.

## 3) Relay pipeline

Main chain (reliability scope):

1. **Source read**: fetch latest assistant artifact from starter/source tab.
2. **Payload build**: construct relay payload with protocol markers.
3. **Target dispatch**: inject input and trigger send on target tab.
4. **Dispatch verification**: prove send acceptance before waiting for reply.
5. **Reply observation**: classify generating/reply/timeout/hidden behaviors.
6. **Next-hop decision**: update round and `nextHopSource` deterministically.
7. **Bounded stop/recovery**: terminate with explicit reason or recover via watchdog.
8. **Evidence export**: persist runtime facts for reproducible diagnosis.

## 4) Browser lifecycle risks

- **MV3 service worker suspension**: background orchestration can be paused by browser lifecycle policy.
- **Hidden-tab throttling**: background targets may accept input but delay/skip visible generation.
- **Discarded/frozen tabs**: tab lifecycle events can invalidate expected DOM/control assumptions.
- **ChatGPT DOM churn**: frequent UI mutation can break selectors and overlay attachment points.

The system should classify these risks explicitly rather than failing silently.

## 5) Test lanes

- **Unit (`pnpm test`)**: deterministic logic and regression coverage.
- **Smoke (`pnpm run test:smoke`)**: baseline infra truth (logged in, extension loaded, page testable).
- **Auth lanes (`pnpm run auth:*`)**: profile/bootstrap and diagnostic replay workflows.
- **CDP lane (`pnpm run test:cdp-smoke`)**: alternate infrastructure carrier.
- **Real-hop (`pnpm run test:real-hop`)**: single-hop behavior on live ChatGPT pages.
- **E2E (`pnpm run test:e2e`)**: multi-hop/roundtrip reliability checks.

Use `docs/regression-matrix.md` as the executable P0 acceptance source of truth.
