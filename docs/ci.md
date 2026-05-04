# CI Boundary for Web Codex Development

This document defines which checks are appropriate for GitHub Actions CI and which checks are local/manual only.

The goal is to keep PR CI deterministic and reliable, while still allowing live browser validation when needed during development.

## Lane 1: CI-safe deterministic checks

These checks are safe to run in GitHub Actions and should remain the baseline PR gate:

- `pnpm run typecheck`
- `pnpm run build`
- `pnpm test`

Why these are CI-safe:

- They are deterministic project checks.
- They do not require ChatGPT login.
- They do not require an existing local browser profile.
- They do not require CDP attachment.
- They do not require secrets.

## Lane 2: Local semi/live browser checks

These checks are for local validation and manual evidence:

- `pnpm run test:smoke`
- `pnpm run test:cdp-smoke`
- `pnpm run test:storage-auth-smoke`
- `pnpm run test:semi`
- `pnpm run test:real-hop`
- `pnpm run test:e2e`

Why these are local-only:

- They depend on a real browser runtime and/or live ChatGPT behavior.
- They may depend on authenticated state.
- They may require CDP-connected browser sessions.
- They are inherently less deterministic in shared CI infrastructure.

These checks can be documented in PRs as manual/local evidence, but they must not be required to pass in GitHub Actions unless a proper mocked/fake browser harness is introduced later.

## Lane 3: Auth/profile setup checks

These scripts are setup/verification helpers for local authenticated workflows:

- `pnpm run auth:bootstrap-profile`
- `pnpm run auth:export`
- `pnpm run auth:verify`

These are not CI gates because they rely on local auth/profile state and interactive or environment-specific browser conditions.

## CI policy for this repository

GitHub Actions CI must not require:

- ChatGPT login
- Browser profile state
- CDP attachment
- Secrets for live ChatGPT access

## For Codex Web tasks

When preparing PRs for Web Codex work:

- Preserve CI-safe checks (`pnpm run typecheck`, `pnpm run build`, `pnpm test`).
- Do not reference non-existent `check:*` scripts.
- Do not weaken tests only to make CI green.
- Do not commit auth files or local browser profiles.

If live browser coverage is needed in a PR, report it as local/manual verification evidence rather than turning it into a required CI blocker.
