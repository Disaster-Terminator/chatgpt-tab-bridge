# Meta

This project is an OMX-managed workspace for a popup-first Microsoft Edge extension that relays between two already-open ChatGPT web threads.

## Goal

Build a narrow v1 bridge that:

- reuses two ChatGPT tabs the user already opened in Edge
- requires A and B to be two distinct threads
- lets the user bind one tab as `A` and another as `B`
- starts from an explicit side chosen in the popup
- relays the latest stable assistant reply from one side to the other
- stops on stop marker, timeout, repeated output, or max rounds

## Product Shape

The primary control surface is the extension popup.

The in-page floating overlay is intentionally smaller and only exists for convenience:

- bind current page as `A`
- bind current page as `B`
- unbind current page
- show compact runtime status

The bridge-controlled tabs are not the user's working pages. The runtime may mutate them, but it should avoid stealing foreground focus.

## Supported Thread URLs

- Regular thread:
  - `https://chatgpt.com/c/<conversation-id>`
- Project-scoped thread:
  - `https://chatgpt.com/g/<project-id>/c/<conversation-id>`

## State Model

V1 uses a narrow six-state model:

- `idle`
- `ready`
- `running`
- `paused`
- `stopped`
- `error`

Important constraints:

- `round` is cumulative across `pause` and `resume`
- `nextHopOverride` is writable only while `paused`
- `clearTerminal -> ready -> start` is the only fresh-session gate
- recovery features that would widen the state machine stay in backlog

## Relay Protocol

- Continue marker: `[CONTINUE]`
- Stop marker: `[FREEZE]`
- Each relayed payload includes:
  - source side
  - round number
  - wrapped assistant output

## Current Files

- Extension runtime:
  - [`manifest.json`](/home/raystorm/projects/meta/src/extension/manifest.json)
  - [`background.mjs`](/home/raystorm/projects/meta/src/extension/background.mjs)
  - [`content-script.js`](/home/raystorm/projects/meta/src/extension/content-script.js)
  - [`popup.html`](/home/raystorm/projects/meta/src/extension/popup.html)
  - [`popup.mjs`](/home/raystorm/projects/meta/src/extension/popup.mjs)
- Shared core logic:
  - [`state-machine.mjs`](/home/raystorm/projects/meta/src/extension/core/state-machine.mjs)
  - [`chatgpt-url.mjs`](/home/raystorm/projects/meta/src/extension/core/chatgpt-url.mjs)
  - [`relay-core.mjs`](/home/raystorm/projects/meta/src/extension/core/relay-core.mjs)
- Verification:
  - [`tests/state-machine.test.mjs`](/home/raystorm/projects/meta/tests/state-machine.test.mjs)
  - [`tests/chatgpt-url.test.mjs`](/home/raystorm/projects/meta/tests/chatgpt-url.test.mjs)
  - [`tests/relay-core.test.mjs`](/home/raystorm/projects/meta/tests/relay-core.test.mjs)

## Local Commands

```bash
pnpm run build
pnpm test
pnpm run test:smoke
```

`pnpm run build` performs a local extension validation pass:

- manifest parses
- referenced files exist
- extension JavaScript files pass syntax checks

`pnpm run test:smoke` launches Playwright's Chromium with the unpacked extension and verifies:

- overlay injection on `https://chatgpt.com`
- popup loading through the discovered extension id

## Load In Edge

1. Open `edge://extensions`
2. Enable Developer mode
3. Choose `Load unpacked`
4. Select [`src/extension`](/home/raystorm/projects/meta/src/extension)

## OMX Workflow

Recommended OMX path for this project:

1. `$deep-interview` to lock product boundaries
2. `$ralplan` to freeze PRD, state machine, UI slices, and test spec
3. `$ralph` to implement against the approved narrow scope
4. `verifier` and architect review before claiming completion
