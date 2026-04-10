# Auth Carrier Baseline

This document is the current baseline for browser-auth carrier strategy in this repo.

It replaces the earlier experiment framing and should be treated as the source of truth for how browser testing is expected to acquire and reuse ChatGPT login state.

## Current baseline

Preferred primary path:

1. use **Playwright Chromium** as the test browser runtime
2. obtain login state by exporting `storageState({ indexedDB: true })` from a **real manually logged-in browser**
3. replay that state into Chromium + extension

Fallback path:

1. keep a **persistent real browser profile**
2. log in manually once
3. attach Playwright over **CDP**
4. reuse already-open ChatGPT tabs where possible
5. avoid extra `goto`, reload, or homepage reset on attach

## What is no longer primary

These are no longer the main strategy:

- exporting auth from one profile and replaying it into a different fresh browser as the default story
- auth-first / URL-first harness assumptions
- treating WSL Chrome as the only viable login-state source

They may still exist as compatibility/debugging utilities, but they are not the recommended baseline.

## Why the baseline changed

Current repo-local evidence shows:

- CDP attach itself is viable as a fallback carrier model
- exporting `storageState({ indexedDB: true })` from a real logged-in browser and replaying it into Playwright Chromium can preserve enough state to reach the ChatGPT main UI with the extension loaded
- current observed replay evidence included:
  - `title: "ChatGPT"`
  - `composer: true`
  - `overlay: true`

This proves that WSL Chrome is not the only practical login-state source.

## Recommended flows

### Primary: Chromium replay flow

1. launch a real browser and log in manually once
2. export carrier state from that browser:

```bash
CHATGPT_CDP_ENDPOINT=http://127.0.0.1:9333 pnpm run auth:export
```

3. validate replay in Playwright Chromium:

```bash
pnpm run test:storage-auth-smoke
```

4. run browser/product verification on top of the exported state:

```bash
pnpm run test:real-hop
pnpm run test:semi
pnpm run test:e2e
```

### Fallback: real browser CDP attach

1. launch a dedicated browser/profile:

```bash
pnpm run browser:cdp-launch
```

2. log in manually once in that browser
3. keep that browser running
4. validate attach:

```bash
CHATGPT_CDP_ENDPOINT=http://127.0.0.1:9333 pnpm run test:cdp-smoke
```

Use this path when Chromium replay is unsuitable or when you need to preserve the already-open real browser session exactly as-is.

## Script surface summary

Primary-facing scripts:

- `pnpm run auth:export`
- `pnpm run auth:verify`
- `pnpm run test:storage-auth-smoke`
- `pnpm run test:real-hop`
- `pnpm run test:semi`
- `pnpm run test:e2e`

Fallback / carrier utilities:

- `pnpm run browser:cdp-launch`
- `pnpm run test:cdp-smoke`
- `pnpm run auth:export:cdp-storage`

Legacy / compatibility:

- `pnpm run auth:export:legacy`
- `pnpm run test:real-hop:anon`
- `pnpm run test:semi:anon`
- `pnpm run test:e2e:anon`

## Constraints still true

- page-fact-first remains the truth source
- session-first / URL-later remains intact
- popup/runtime self-report is auxiliary only
- browser carrier work does **not** by itself prove the four business regressions are fixed

This document only defines how login state is carried into the browser harness.
