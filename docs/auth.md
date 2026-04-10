# Auth Carrier Modes

## Primary path

The primary browser-auth carrier for this repo is now:

1. use **Playwright Chromium**
2. keep a fixed **persistent Playwright profile** (`userDataDir`)
3. load the extension in that profile
4. log into ChatGPT manually once
5. close and reopen the same profile for future smoke runs

Why this is primary:

- it preserves the full browser profile that Playwright persistent contexts are designed to reuse
- it supports extension loading directly
- it avoids relying on `storageState` as a persistent-context initializer, which is not a trustworthy baseline here

Primary commands:

```bash
pnpm run auth:bootstrap-profile
pnpm run test:smoke
```

`auth:bootstrap-profile` is the one-time bootstrap lane for manual login in the persistent Playwright profile.

`test:smoke` is the repeatable infrastructure gate and answers only:

1. is ChatGPT still logged in?
2. is the extension loaded?
3. is the page testable?

Only when all three are true should later business-regression lanes resume.

## Fallback path

Fallback carrier for this repo is:

1. keep a **persistent real browser profile**
2. log in manually once
3. keep that profile on disk
4. attach Playwright over **CDP**
5. verify only the same minimal infrastructure contract

Commands:

```bash
pnpm run browser:cdp-launch
CHATGPT_CDP_ENDPOINT=http://127.0.0.1:9333 pnpm run test:cdp-smoke
```

Use this path when the Playwright persistent profile lane is unsuitable or fails to hold login.

## Diagnostic-only paths

These commands remain useful, but they are **diagnostic only** and are not the default auth carrier story:

```bash
pnpm run auth:export
pnpm run auth:verify
pnpm run test:storage-auth-smoke
CHATGPT_CDP_ENDPOINT=http://127.0.0.1:9333 pnpm run auth:export:cdp-storage
```

They help answer questions like:

- what cookies/origins/session material were exported?
- does replay work in a clean context?
- what is missing from replay compared with a real persistent profile?

They do **not** define the primary carrier.

## Why `storageState` is not primary

This repo now assumes the following external constraints are real:

- Playwright issue `#31129`: extension loading and `storageState` replay are not a trustworthy combined baseline
- Playwright issue `#7634`: persistent-context initialization from `storageState` has long been a feature gap
- Playwright issue `#14949`: setting storage/session state for persistent context remains an unresolved problem area

Repo-local evidence also showed:

- extension load is proven
- current `storageState` replay is **not** proven
- the same exported auth material failed even in plain `browser.newContext({ storageState })`

So exported JSON replay is retained for diagnostics, not promoted as the main carrier.

## Legacy compatibility

These scripts still exist for compatibility/investigation and should not be read as primary guidance:

- `pnpm run auth:export:legacy`
- `pnpm run test:real-hop:auth`
- `pnpm run test:semi:auth`
- `pnpm run test:e2e:auth`
