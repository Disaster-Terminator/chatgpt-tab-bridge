# TODO

## Product Polish

- Initial footprint pass is done: popup and ChatGPT page overlay widths are reduced, panel padding is tighter, visual weight is lower, and selects opt into dark color-scheme.
- Continue visual polish only after manual browser pass: check popup density, overlay readability, and whether the collapsed pill needs a stronger completion/status signal.
- Keep global ambient overlay optional and off by default; prefer extension action badge/status over intrusive cross-site floating UI.
- Keep manual ChatGPT testing as the acceptance path. OpenAI risk controls and Cloudflare challenges make full automation unreliable; use local debug logs for agent-side diagnosis.

## Open Issues / Next Work

### State and Refresh Decoupling

- Runtime state is no longer dependent on page refresh alone: injected overlays refresh from port pushes, periodic polling, focus/visibility, and `chrome.storage.onChanged` for runtime/settings changes.
- Broadcast runtime state to all relevant ChatGPT tabs after important transitions, not only to currently bound tabs and already-connected overlay ports.
- Preserve state visibility when the user navigates away from ChatGPT. The global ambient overlay is optional and off by default, so the extension action badge and popup must remain the low-intrusion source of truth.

### Debug Logs

- Popup export/download is available from Debug. It reuses the debug snapshot collector and uses a Blob download without new extension permissions.
- Keep local JSONL logging via `pnpm run debug:log-server` as the preferred continuous log sink when the user can run the server.
- Include current runtime state, popup model summary, current tab, recent runtime events, last ack debug, and latest user preview when available.
- Keep copied debug snapshots readable enough for bug reports: real timestamps, state-transition summaries, and enough before/after state to trace starter, override, nextHop, and activeHop.

### Relay Runtime Bugs

- Investigate false stop / stuck verification reports where the ChatGPT thread is still active but the plugin treats the flow as stopped or remains stuck at `verifying <target> submission`.
- Use the latest debug snapshot fields to distinguish these cases:
  - dispatch accepted and target generation started, but verification polling sampled `generating:false` too early or from stale DOM.
  - verification passed but the relay loop did not advance into `waiting <target> reply`.
  - target page kept generating after plugin moved to stopped due to timeout, stale target, or max-round guard.
- Preserve the latest concrete repro:
  - start side `B`, round `0 / 8`, next hop `B -> A`.
  - current step `verifying A submission`.
  - ack target `A (#1463761706, active-hop)`.
  - ack accepted via `user_message_added`, evidence `currentGenerating:true`.
  - runtime events show `dispatch_accepted B->A r1` followed by `verification_passed B->A r1`.
  - user observation: the thread had not stopped, but plugin behavior/status did not continue as expected.
- Add targeted instrumentation before changing relay semantics again. The next snapshot should prove whether the loop is stuck before `set_execution_hop(waiting_reply)`, inside reply waiting, or after a stop condition.

### Overlay Interaction

- Global ambient overlay drag is supported and uses the same persisted overlay position as the ChatGPT page overlay.
- Keep the ambient overlay non-intrusive by default: no controls unless enabled, compact status-only presentation, and no accidental page obstruction.

### Pause / Resume Controls

- Re-test the paused starter and resume flow manually after loading the latest build. The reducer now uses starter as a first-round fallback when override is missing, but real browser state sync should still be validated.
- Use the new state transition runtime events to diagnose any future mismatch between displayed starter, next-hop override, and actual activeHop.
- Current manual result: lock/unlock and starter selection are fixed; remaining problem is relay progress after accepted submission, not the pause control itself.

## Relay Envelope

- Treat metadata as a plugin correlation mechanism, not as model-facing context. GPT Web does not need to reason about source/round/hop.
- Keep one compact machine-readable hop marker in the submitted user message so the extension can distinguish the current hop from stale messages, duplicate sends, and wrong-thread observations.
- Prefer placing bridge metadata after the bridged content and before the final instruction, never at the very beginning of the prompt.
- Minimize metadata content. Prefer `[BRIDGE_META hop=<id>]`; keep `source` and `round` only if a concrete verification path needs them.
- Localize natural-language bridge instructions to the user's UI/page language. Keep the final machine-readable directive stable as `[BRIDGE_STATE] CONTINUE` or `[BRIDGE_STATE] FREEZE`.
