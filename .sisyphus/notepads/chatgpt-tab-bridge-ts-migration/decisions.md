## 2026-04-04
- Centralized test imports behind a harness file to keep Node's native test runner unchanged while insulating tests from phased source extension churn.
- Kept test assertions intact; only import/fixture loading changed so coverage and expected behavior remain stable.

## 2026-04-04 (T7)
- Deleted the migrated `.mjs` source files so the test harness resolves the new TypeScript modules first and exercises the converted implementations directly.
- Left `parseBridgeDirective`'s hard-coded marker parsing behavior intact to preserve current protocol semantics while only tightening types and return contracts.

## 2026-04-04 (T9)
- Kept the source manifest pointed at `background.mjs` and updated the build entrypoint/map instead of rewriting source-manifest semantics during the migration; `dist/extension/manifest.json` still resolves to `background.js` at build time.
- Preserved the background loop's cancellation behavior by keeping the global `activeLoopToken` reset on every non-running state transition and by returning the existing `loop_cancelled` sentinel only from the settle-wait helper.

## 2026-04-04 (F4)
- Approved scope fidelity for TS migration because protocol tokens, message/state constants, reducer transitions, popup DOM ids/structure, and content selector strategy remained mechanically equivalent to original `.mjs`/`.js` runtime.

## 2026-04-04 (F2)
- Kept `normalizeBinding()` conservative: invalid role/tab payloads now return `null` instead of relying on unchecked casts, preserving the existing invalid-binding path in the reducer.
- Added warning logs to the two previously empty content-script catches so transient runtime issues are still ignored functionally but no longer disappear silently during debugging.

## 2026-04-04 (typecheck cleanup pass)
- Exported Chrome ambient helper interfaces from `shared/globals.d.ts` and imported `ChromePort`/`ChromeMessageSender`/`ChromeTab` where used to avoid module-scope type visibility gaps.
- Replaced `innerText` reads in content-script message scraping paths with `textContent` normalization to keep DOM extraction behavior while matching `Element` typings.

## 2026-04-04 (send ack RCA)
- Treat the first-hop `send_message_timeout` as an acknowledgement-detection failure first, not a relay-core guard failure: pre/post-hop guards are downstream of the send-ack path and do not explain the immediate user report.
- Prefer a future fix that acknowledges send success from multiple independent signals (modern stop-button detection, user-message insertion, composer change/polling) instead of coupling generation-start detection to composer text mutation.
- Any future timeout handling should assume background-tab timer throttling and avoid relying on a single content-script `setTimeout(5000)` fallback to beat the background's 15s timeout race.
