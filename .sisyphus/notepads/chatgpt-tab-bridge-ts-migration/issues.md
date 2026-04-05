## 2026-04-04
- Initial TS conversion used `.js` runtime specifiers between source modules, which broke Node test imports because the harness executes source `.ts` files directly. Switched those internal imports to `.ts` for source runtime resolution while keeping type-only imports on `.js`.

## 2026-04-04 (F4)
- `lsp_diagnostics` for TypeScript could not run via language server because `typescript-language-server` is not installed in this environment; used directory diagnostics with `tsc` strategy as verification fallback (0 errors).

## 2026-04-04 (F2)
- File-level LSP diagnostics are still unavailable in this environment because `typescript-language-server` is not installed; verification relied on `pnpm run build` and `pnpm test` instead.

## 2026-04-04 (typecheck cleanup pass)
- `lsp_diagnostics` remains unavailable for TypeScript in this environment (`typescript-language-server` missing), so verification used `pnpm run typecheck` as the authoritative check.

## 2026-04-04 (send ack RCA)
- `waitForSubmissionAcknowledgement()` can miss real sends because `generation_started` currently requires both a generation indicator and composer text divergence; if ChatGPT starts generating while the composer still matches the submitted payload, no ack is emitted.
- For textarea/value composers, ChatGPT can clear `.value` without a DOM mutation that `MutationObserver` sees, so the `composer_cleared` path may never re-run even though the send succeeded.
- If all ack signals are missed in a background tab, the content script falls back to a 5s timer that can itself be throttled; background `sendRelayMessage()` then surfaces `send_message_timeout` from its 15s race even after a visually successful click.
