# Testing Lanes

## Infrastructure smoke first

The default infrastructure gate is now the persistent Playwright profile lane:

```bash
pnpm run auth:bootstrap-profile
pnpm run test:smoke
```

`auth:bootstrap-profile` is the one-time manual-login bootstrap for the fixed Playwright Chromium profile.

`test:smoke` is the repeatable gate. It proves only:

1. ChatGPT is logged in
2. the extension is loaded
3. the page is testable

It does **not** bind tabs, seed source prompts, run hops, or validate provided-thread continuity.

## Fallback infrastructure smoke

If the Playwright persistent profile lane is unsuitable, use the dedicated real-browser profile + CDP attach lane:

```bash
pnpm run browser:cdp-launch
CHATGPT_CDP_ENDPOINT=http://127.0.0.1:9333 pnpm run test:cdp-smoke
```

This must satisfy the same minimal contract as `test:smoke` before any business-regression testing resumes.

## Diagnostic replay lane

Storage replay is now diagnostic-only:

```bash
pnpm run auth:export
pnpm run auth:verify
pnpm run test:storage-auth-smoke
```

Interpretation:

- `PASS`: exported replay happened to work in that diagnostic lane
- `FAIL`: meaningful diagnostic result; does **not** by itself invalidate the primary persistent-profile carrier

Do not treat this lane as the default browser-auth baseline.

## Business lanes stay paused until smoke passes

The following stay out of scope until infrastructure smoke proves all three facts at once:

1. logged in
2. extension loaded
3. page testable

Paused work:

- four business regressions
- provided-thread continuity
- post-bind drift
- auth-backed source-seed expansion

## Authenticity and control-flow lanes

`real-hop`, `semi`, and `e2e` remain higher-level lanes. They are not the infrastructure truth source and should not be used to decide the auth carrier baseline.
