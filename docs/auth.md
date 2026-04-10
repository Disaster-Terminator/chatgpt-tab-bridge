# Auth Carrier Modes

## Recommended primary path

Preferred primary path for this repo is now:

1. use Playwright Chromium as the test browser runtime
2. obtain a reusable login carrier by exporting `storageState({ indexedDB: true })` from a real manually logged-in browser
3. replay that state into Chromium + extension

This gives Playwright-native control plus extension loading, while avoiding fresh auth export into unrelated profiles as the default story.

### Primary sequence

1. launch a dedicated real browser/profile and log in manually once
2. export carrier state from that already-logged-in browser
3. replay it in Playwright Chromium

```bash
pnpm run browser:cdp-launch
# log in manually once in that browser
CHATGPT_CDP_ENDPOINT=http://127.0.0.1:9333 pnpm run auth:export
pnpm run test:storage-auth-smoke
```

## Fallback carrier

Fallback browser-auth carrier for this repo is:

1. launch a dedicated real Chrome/Chromium profile with remote debugging
2. log in to ChatGPT manually once
3. keep that profile on disk
4. attach Playwright with `chromium.connectOverCDP()`
5. prefer reusing already-open ChatGPT tabs
6. avoid unnecessary `goto`, reload, or homepage reset after attach

Recommended launch helper:

```bash
pnpm run browser:cdp-launch
```

Or manually:

```bash
google-chrome \
  --remote-debugging-port=9333 \
  --user-data-dir=/home/raystorm/.chatgpt-cdp-profile \
  --no-first-run \
  --no-default-browser-check \
  --load-extension=/absolute/path/to/dist/extension \
  --disable-extensions-except=/absolute/path/to/dist/extension \
  https://chatgpt.com
```

Then attach with:

```bash
CHATGPT_CDP_ENDPOINT=http://127.0.0.1:9333 pnpm run test:cdp-smoke
```

If you want to extract a reusable login carrier from that already-logged-in real browser, export it into Playwright-friendly files with:

```bash
CHATGPT_CDP_ENDPOINT=http://127.0.0.1:9333 pnpm run auth:export:cdp-storage
```

That produces:

- `playwright/.auth/chatgpt.cdp.storage.json`
- `playwright/.auth/chatgpt.cdp.session.json`

Preferred operator flow:

1. start the dedicated browser/profile once
2. log in manually in that browser
3. keep that browser running
4. run attach-based scripts from the repo

Do not treat script-exported auth as the main way to obtain login state.

Use direct attach as the fallback path when Chromium replay is unsuitable, not as the default first choice.

## Legacy compatibility

These scripts still exist for compatibility and investigation, but they are no longer the primary recommendation:

- `pnpm run auth:export:legacy`
- `pnpm run auth:verify`
- `pnpm run test:real-hop:auth`
- `pnpm run test:semi:auth`
- `pnpm run test:e2e:auth`

Their model is older compatibility around explicit auth file replay. Keep them for debugging, but do not treat them as the main carrier story for this repo anymore.
