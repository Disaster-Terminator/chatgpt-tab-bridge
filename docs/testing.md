# Testing Lanes

## Browser carrier smoke

Use this first when validating the CDP attach model:

```bash
CHATGPT_CDP_ENDPOINT=http://127.0.0.1:9333 pnpm run test:cdp-smoke
```

It only proves:

1. Playwright can attach over CDP
2. at least one browser context exists
3. pages are visible to the attached context
4. an already-open ChatGPT tab can be detected
5. basic page facts can be read without navigation

## Primary login-carrier experiment

Use this to validate the preferred testing baseline:

```bash
pnpm run browser:cdp-launch
# log in manually once in that browser
CHATGPT_CDP_ENDPOINT=http://127.0.0.1:9333 pnpm run auth:export
pnpm run test:storage-auth-smoke
```

Interpretation:

- If replay succeeds, Playwright Chromium + extension becomes a viable primary test baseline
- Real browser + CDP attach remains the fallback carrier when replay is unsuitable
- sessionStorage remains a compatibility concern, but in current local evidence it may not be required for basic ChatGPT entry

## Authenticity sentinel

`real-hop` remains the stronger page-fact-first authenticity lane.

- `PASS`: first-hop proof succeeded by page facts
- `BLOCKED`: environment/login diversion prevented a valid proof attempt
- `FAIL`: proof was attempted and page facts contradicted expectations

## Browser control-flow coverage

`e2e` / `semi` remain browser-control-flow layers, not the authenticity truth source.

Under anonymous root-page conditions they may legitimately surface `BLOCKED` when the site diverts source seeding to login. That should not be conflated with a product regression.
