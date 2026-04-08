2026-04-08 Task 1: introduced minimal `activeHop` contract on `RuntimeState` with `sourceRole`, `targetRole`, `targetTabId`, `round`, `hopId`, and `stage`.
2026-04-08 Task 1: kept `nextHopSource` and `nextHopOverride` intact for existing control/UI semantics, but moved execution truth for running hops into the persisted reducer-owned contract.
2026-04-08 Task 1: start/resume/hop_completed rebuild pending `activeHop`; background promotes it to `verifying` and `waiting_reply` by writing the hop id back into persisted state.
2026-04-08 Task 2: `reduceResume()` now distinguishes a fresh unclaimed pending hop (`stage: pending`, `hopId: null`, `round === state.round + 1`) from an already claimed hop before applying override intent.
2026-04-08 Task 2: `resumeSession()` now starts the relay loop from the just-resumed snapshot so the preserved `activeHop` chosen by the reducer is the one background consumes first.
2026-04-08 Task 5: introduced a fact-only `TargetObservationSample` contract and embedded it in the existing target activity transport so baseline capture and verification polling can read one coherent observation window without moving acceptance logic into content-script.
2026-04-08 Task 5: kept settle polling on `GET_ASSISTANT_SNAPSHOT` and preserved `relay-core` verification / acceptance semantics; this slice only swapped baseline + verification transport.
