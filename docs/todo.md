# TODO

## Product Polish

- Reduce the ChatGPT page overlay footprint before redesigning it: shrink the full panel, lower visual weight, and make the collapsed state read more like a small status pill.
- Keep global ambient overlay optional and off by default; prefer extension action badge/status over intrusive cross-site floating UI.
- Keep manual ChatGPT testing as the acceptance path. OpenAI risk controls and Cloudflare challenges make full automation unreliable; use local debug logs for agent-side diagnosis.

## Open Issues / Next Work

### State and Refresh Decoupling

- Decouple extension runtime state from page refresh expectations. State changes should be observable from popup, action badge, and injected overlays without requiring the user to manually refresh ChatGPT pages.
- Broadcast runtime state to all relevant ChatGPT tabs after important transitions, not only to currently bound tabs and already-connected overlay ports.
- Preserve state visibility when the user navigates away from ChatGPT. The global ambient overlay is optional and off by default, so the extension action badge and popup must remain the low-intrusion source of truth.

### Debug Logs

- Add a popup export/download action for debug logs. The existing runtime event ring buffer is useful but only visible through the debug snapshot, and local JSONL logging requires `pnpm run debug:log-server`.
- Export should work without new extension permissions first, using a Blob download from popup.
- Include current runtime state, popup model summary, current tab, recent runtime events, last ack debug, and latest user preview when available.

### Overlay Interaction

- Fix the global ambient overlay drag behavior. The page overlay can be positioned, but the ambient/all-site overlay currently cannot be dragged.
- Decide whether ambient overlay should support persistent per-site/global position, or intentionally stay fixed while only the ChatGPT page overlay is draggable.
- Keep the ambient overlay non-intrusive by default: no controls unless enabled, compact status-only presentation, and no accidental page obstruction.

### Pause / Resume Controls

- Re-test the paused starter and resume flow manually after loading the latest build. The reducer now uses starter as a first-round fallback when override is missing, but real browser state sync should still be validated.
- Use the new state transition runtime events to diagnose any future mismatch between displayed starter, next-hop override, and actual activeHop.

## Relay Envelope

- Treat metadata as a plugin correlation mechanism, not as model-facing context. GPT Web does not need to reason about source/round/hop.
- Keep one compact machine-readable hop marker in the submitted user message so the extension can distinguish the current hop from stale messages, duplicate sends, and wrong-thread observations.
- Prefer placing bridge metadata after the bridged content and before the final instruction, never at the very beginning of the prompt.
- Minimize metadata content. Prefer `[BRIDGE_META hop=<id>]`; keep `source` and `round` only if a concrete verification path needs them.
- Localize natural-language bridge instructions to the user's UI/page language. Keep the final machine-readable directive stable as `[BRIDGE_STATE] CONTINUE` or `[BRIDGE_STATE] FREEZE`.
