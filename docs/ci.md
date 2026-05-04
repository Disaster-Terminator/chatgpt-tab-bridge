# CI boundary for Web Codex development

This project intentionally separates deterministic CI checks from local/live browser checks.

## 1) CI-safe deterministic checks

These checks are stable, scriptable, and safe for GitHub Actions:

- `pnpm run typecheck`
- `pnpm run build`
- `pnpm test`

These are the baseline checks PR CI should run and enforce.

## 2) Local semi/live browser checks (manual evidence)

These checks exercise browser-driven and/or live ChatGPT flows and are **not CI-safe by default**:

- `pnpm run test:smoke`
- `pnpm run test:cdp-smoke`
- `pnpm run test:storage-auth-smoke`
- `pnpm run test:semi`
- `pnpm run test:real-hop`
- `pnpm run test:e2e`

Treat these as local validation and manual evidence for development tasks. They should not block PR CI unless a proper mocked/fake browser harness is added later.

## 3) Auth/profile setup checks (local only)

These commands prepare and verify authenticated local browser state:

- `pnpm run auth:bootstrap-profile`
- `pnpm run auth:export`
- `pnpm run auth:verify`

These are local setup utilities and should not run in GitHub Actions.

## CI requirements and non-requirements

GitHub Actions CI must **not** require any of the following:

- ChatGPT login
- persisted browser profile state
- CDP attachment to an existing browser session
- secrets for live ChatGPT access

CI should stay deterministic and independent from personal/local browser state.

## For Codex Web tasks

- Every PR should preserve the CI-safe checks:
  - `pnpm run typecheck`
  - `pnpm run build`
  - `pnpm test`
- Do not reference non-existent `check:*` scripts.
- Do not weaken tests just to make CI green.
- Do not commit auth files or local browser profiles.
- Do not claim live ChatGPT E2E is automated in CI.
