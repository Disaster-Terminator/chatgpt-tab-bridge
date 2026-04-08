2026-04-08 Task 1: no blocking implementation issues encountered during the canonical hop-contract change.
2026-04-08 Task 1: existing popup-model fallback logic still exists outside this task scope; background observation now prefers `activeHop` when present without broadening popup semantics.
2026-04-08 Task 2: TypeScript initially rejected the fresh-hop helper as a type predicate because the false branch collapsed `RuntimeHopTruth` to `never`; switching the helper to a boolean guard preserved the intended control flow without widening scope.
2026-04-08 Task 5: background sample unwrapping initially returned the broader `ThreadActivityResponse` union on failure; narrowing it to an explicit `{ ok: false, error }` wrapper resolved the type mismatch without broadening the transport change.
