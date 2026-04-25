# TODO

## Product Polish

- Reduce the ChatGPT page overlay footprint before redesigning it: shrink the full panel, lower visual weight, and make the collapsed state read more like a small status pill.
- Keep global ambient overlay optional and off by default; prefer extension action badge/status over intrusive cross-site floating UI.
- Keep manual ChatGPT testing as the acceptance path. OpenAI risk controls and Cloudflare challenges make full automation unreliable; use local debug logs for agent-side diagnosis.

## Relay Envelope

- Treat metadata as a plugin correlation mechanism, not as model-facing context. GPT Web does not need to reason about source/round/hop.
- Keep one compact machine-readable hop marker in the submitted user message so the extension can distinguish the current hop from stale messages, duplicate sends, and wrong-thread observations.
- Prefer placing bridge metadata after the bridged content and before the final instruction, never at the very beginning of the prompt.
- Minimize metadata content. Prefer `[BRIDGE_META hop=<id>]`; keep `source` and `round` only if a concrete verification path needs them.
- Localize natural-language bridge instructions to the user's UI/page language. Keep the final machine-readable directive stable as `[BRIDGE_STATE] CONTINUE` or `[BRIDGE_STATE] FREEZE`.
