## 2026-04-04
- Initial TS conversion used `.js` runtime specifiers between source modules, which broke Node test imports because the harness executes source `.ts` files directly. Switched those internal imports to `.ts` for source runtime resolution while keeping type-only imports on `.js`.

## 2026-04-04 (F4)
- `lsp_diagnostics` for TypeScript could not run via language server because `typescript-language-server` is not installed in this environment; used directory diagnostics with `tsc` strategy as verification fallback (0 errors).

## 2026-04-04 (F2)
- File-level LSP diagnostics are still unavailable in this environment because `typescript-language-server` is not installed; verification relied on `pnpm run build` and `pnpm test` instead.

## 2026-04-04 (typecheck cleanup pass)
- `lsp_diagnostics` remains unavailable for TypeScript in this environment (`typescript-language-server` missing), so verification used `pnpm run typecheck` as the authoritative check.
