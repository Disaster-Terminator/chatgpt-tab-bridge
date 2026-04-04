## 2026-04-04
- Added `tests/extension-test-harness.mjs` so tests resolve extension modules/source fixtures by extensionless stem instead of pinning `../src/extension/**/*.mjs` or raw `content-helpers.js` paths.
- Harness resolution prefers `src/extension` first, then `dist/extension`, with `.mjs`/`.js` fallback for modules and `.js`/`.mjs` fallback for raw source fixtures.

## 2026-04-04 (T6 - .mjs to .ts conversion)
- Updated `extension-test-harness.mjs` to include `.ts` in `moduleExtensions` and `sourceExtensions` arrays so tests can resolve `.ts` files.
- Added type annotations using existing `shared/types.ts` types (`BridgeRole`, `ChatGptUrlInfo`, `OverlaySettings`, `OverlayPosition`, `RuntimeState`).
- `background-helpers.ts`: Used `Pick<RuntimeState, "bindings">` for parameter typing to avoid importing full RuntimeState.
- `overlay-settings.ts`: Type-safe casting with `as OverlaySettings | undefined` since input is `unknown`.
- `constants.ts`: Uses `Object.freeze<OverlaySettings>()` for proper readonly inference.
- Test harness resolves `.ts` files via URL imports, no changes needed to test files themselves.

## 2026-04-04 (T7 - relay/state/popup TS conversion)
- Node's test harness loads source `.ts` files directly, so runtime imports inside converted modules must target existing `.ts` siblings instead of extension-shifted `.js` specifiers.
- `state-machine.ts` now exposes a discriminated `RuntimeStateEvent` union while keeping reducer semantics unchanged, including pause/resume round handling and terminal clear gating.
- Relay protocol helpers kept the exact `[BRIDGE_STATE] CONTINUE` / `[BRIDGE_STATE] FREEZE` marker strings so bridge protocol assertions stay byte-for-byte stable.

## 2026-04-04 (T9 - background TS conversion)
- `background.ts` uses typed storage helpers for the session/local split so runtime state still persists under `chrome.storage.session` while overlay settings stay in `chrome.storage.local`.
- Overlay sync now builds a shared typed snapshot helper reused by popup-model and broadcast paths, which preserved the exact overlay payload shape while removing duplicated untyped object literals.
- `waitForSettledReply()` needs a union that distinguishes timeout/loop-cancel reasons from selector failures so stop transitions remain `hop_timeout` while non-timeout fetch failures still flow into `selector_failure`.

## 2026-04-04 (F4 scope fidelity check)
- `constants.ts` keeps storage keys, phase values, stop reasons, error reasons, message types, and bridge markers byte-for-byte aligned with `constants.mjs`.
- `state-machine.ts` reducer flow matches historical `state-machine.mjs` transition semantics (`idle -> ready -> running -> paused -> stopped/error`, with terminal-clear gate intact).
- `content-script.ts` and `content-helpers.ts` preserve selector lists and send acknowledgement strategy from prior JS sources.

## 2026-04-04 (F2 quality debt)
- `content-script.ts` should import `MESSAGE_TYPES` from `core/constants.ts` and `OverlayModel` as a type-only import from `shared/types.ts` instead of redefining overlay protocol shapes locally.
- `state-machine.ts` can drop JSON clone assertions by explicitly cloning nested state branches; this preserves reducer behavior while avoiding `as RuntimeState`.
