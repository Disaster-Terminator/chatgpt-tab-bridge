# Auth Carrier Baseline

This document is the current browser-auth carrier baseline for this repo.

It only defines how login state is carried into the browser harness. It does not claim any of the four business regressions are fixed.

## Current baseline

### Primary

Use **Playwright Chromium persistent profile + extension loaded + one-time manual login**.

Operator flow:

```bash
pnpm run auth:bootstrap-profile
pnpm run test:smoke
```

What this proves:

1. login persists in the same Playwright profile
2. extension loads in that profile
3. overlay / popup / runtime are available
4. the page is testable

### Fallback

Use **real browser profile + CDP attach**.

Operator flow:

```bash
pnpm run browser:cdp-launch
CHATGPT_CDP_ENDPOINT=http://127.0.0.1:9333 pnpm run test:cdp-smoke
```

Use this when the primary persistent-profile lane is unsuitable.

### Diagnostic-only

Use exported replay only for diagnosis, not as the main auth carrier:

```bash
pnpm run auth:export
pnpm run auth:verify
pnpm run test:storage-auth-smoke
CHATGPT_CDP_ENDPOINT=http://127.0.0.1:9333 pnpm run auth:export:cdp-storage
```

These commands answer “what replay material exists?” and “does replay happen to work?”, but they do not define the baseline.

## Why the baseline changed

External evidence:

- Playwright issue `#31129`: extension loading and `storageState` replay are not a trustworthy combined path
- Playwright issue `#7634`: persistent-context initialization from `storageState` remains a longstanding feature gap
- Playwright issue `#14949`: persistent-context storage/session initialization remains unsettled

Repo-local evidence:

- extension loading is proven: service worker / overlay / popup / runtime are all good
- current `storageState` replay is not proven: current result is `unauthenticated_auth_cta_visible`
- the same exported auth package also failed in ordinary `browser.newContext({ storageState })`

Therefore exported replay remains diagnostic-only.

## Script surface summary

Primary-facing scripts:

- `pnpm run auth:bootstrap-profile`
- `pnpm run test:smoke`

Fallback scripts:

- `pnpm run browser:cdp-launch`
- `pnpm run test:cdp-smoke`

Diagnostic scripts:

- `pnpm run auth:export`
- `pnpm run auth:verify`
- `pnpm run test:storage-auth-smoke`
- `pnpm run auth:export:cdp-storage`

Legacy / compatibility:

- `pnpm run auth:export:legacy`
- `pnpm run test:real-hop:anon`
- `pnpm run test:semi:anon`
- `pnpm run test:e2e:anon`

## Gate for resuming business regressions

Do not resume later regression lanes until one smoke path proves all three at once:

1. logged in
2. extension loaded
3. page testable
