# Architecture

## 1) Runtime surfaces

- **Background service worker (`background.ts`)**
  - Owns relay orchestration, lifecycle coordination, stop/error classification, alarms/watchdog, and debug event buffering.
- **Content script (`content-script.ts`)**
  - Executes ChatGPT page read/write operations: snapshot, compose/send, and observation probes.
- **Popup (`popup.ts`)**
  - Provides state overview, runtime settings, and low-frequency diagnostics controls.
- **Overlay (`overlay.*`)**
  - In-page control/status UI, intended to survive route/DOM churn and reflect live phase/hop status.
- **Debug server/scripts (`scripts/*`)**
  - Local test + diagnostics entry points for smoke/semi/real-hop/e2e lanes.

## 2) State model

Key runtime state includes:

- **bindings**: A/B tab assignment and starter side.
- **phase**: `ready | running | paused | stopped | error`.
- **activeHop**: current relay leg metadata.
- **nextHopSource**: next side expected to read/send.
- **settings**: runtime behavior flags and overlay preferences.
- **stop/error reasons**: bounded terminal outcomes with diagnostic intent.

## 3) Relay pipeline

1. **Source read**: fetch latest assistant snapshot from source side.
2. **Payload build**: construct bounded relay payload.
3. **Target dispatch**: write payload to target input and send.
4. **Dispatch verification**: confirm acceptance/send signal.
5. **Reply wait/observation**: detect generating/progress/completion or classify bounded failure.
6. **Next hop transition**: update round and `nextHopSource`, continue or stop.

## 4) Browser lifecycle risks

- **MV3 suspension**: worker can be suspended and resumed unexpectedly.
- **Hidden-tab throttling**: background tabs may delay or suppress generation.
- **Discarded/frozen tabs**: tab lifecycle can invalidate assumptions mid-hop.
- **ChatGPT DOM churn**: selectors and container mounts may change over time.

System behavior is reliability-first: no unbounded wait loops; prefer explicit classification + evidence capture.

## 5) Test lanes

- **Unit**: deterministic logic and classification checks (`pnpm test`).
- **Smoke**: environment/profile readiness (`pnpm run test:smoke`).
- **Auth/profile checks**: persistent profile/session validity workflows (`pnpm run auth:bootstrap-profile`, `pnpm run auth:verify`).
- **CDP-assisted checks**: browser lifecycle visibility and diagnostics (`pnpm run browser:cdp-launch`, `pnpm run test:cdp-smoke`).
- **Real-hop**: one live relay hop (`pnpm run test:real-hop`).
- **Semi**: semi-automated overlay/bridge checks (`pnpm run test:semi`).
- **E2E**: multi-hop/round-trip validation (`pnpm run test:e2e`).

See `docs/regression-matrix.md` for P0 executable acceptance scenarios.
