# 2026-04-04 send-ack-analysis

## Scope
- RCA only for first-hop `send_message_timeout` after a visually successful ChatGPT send click.
- Audited `src/extension/content-script.ts`, `src/extension/content-helpers.ts`, `src/extension/background.ts`, `src/extension/core/relay-core.ts`, and existing tests.
- Cross-checked current external ChatGPT automation patterns from active OSS projects (2025-2026).

## Key code path
- Background `sendRelayMessage()` races the content-script response against `sleep(15000)` and surfaces `send_message_timeout` if the content script never answers within 15s (`src/extension/background.ts:586-597`).
- Content script answers only after `waitForSubmissionAcknowledgement()` resolves (`src/extension/content-script.ts:457-470`, `564-611`).
- Ack detection accepts exactly three signals in `checkAckSignals()` (`src/extension/content-script.ts:613-634`):
  - latest user message hash changed and equals expected hash
  - generation in progress **and** composer text no longer equals expected hash
  - composer text empty or changed from expected hash

## Likely root cause chain
1. The click succeeds, but `checkAckSignals()` misses all three signals.
2. The content script then depends on its 5s timeout fallback (`setTimeout(..., 5000)`) to resolve failure.
3. In a background tab, that timer can be delayed by throttling, so the background-side 15s race wins first.
4. User sees `send_message_timeout` even though the page actually sent the message.

## Why the ack signals are brittle

### 1) `generation_started` is incorrectly coupled to composer mutation
- Current logic: `isGenerationInProgress() && composerText !== expectedHash`.
- If ChatGPT starts generating but keeps the composer content momentarily unchanged, this path does **not** acknowledge success.
- Generation start should be an independent success signal once we know the click was accepted.

### 2) `composer_cleared` can be invisible to MutationObserver for textarea/value composers
- `readComposerText()` reads `.value` for textarea/input composers (`content-helpers.ts:110-120`).
- But `waitForSubmissionAcknowledgement()` observes DOM mutations/attributes/characterData, not JS property changes like `textarea.value`.
- If ChatGPT clears the composer by setting `.value = ""` without matching DOM mutations, the observer never re-checks and `composer_cleared` is missed.

### 3) `isGenerationInProgress()` is too narrow
- Current selectors only check `button[aria-label*="停止"]` and `button[aria-label*="Stop"]` (`content-script.ts:646-650`).
- Active external implementations prefer `button[data-testid="stop-button"]` first, then aria-label fallbacks.
- Current code misses cases where the stop state is exposed by `data-testid`, different locale text, or UI variants.

### 4) User-message hash matching is strict and can miss legitimate sends
- `user_message_added` requires the latest user message hash to exactly equal `hashText(expectedText)` and differ from baseline.
- This can fail if ChatGPT normalizes or decorates the displayed message differently than the inserted composer payload.
- First hop is especially sensitive because the bridged envelope is multi-line and machine-formatted.

### 5) Observer attribute filter omits likely ack transitions
- Observer filter only watches `aria-label`, `disabled`, `style`, `class`.
- Real-world ChatGPT automation commonly relies on `data-testid` transitions (`send-button`, `stop-button`, copy-action buttons).
- If the UI swaps state mainly through `data-testid` or button replacement patterns not captured by the current filter, the observer may not re-check soon enough.

## ChatGPT DOM patterns from external research
- Stable message selectors still commonly use `data-message-author-role="user|assistant"`.
- Active projects increasingly use multi-selector composer detection: `#prompt-textarea`, `.ProseMirror[contenteditable="true"]`, and contenteditable prompt fallbacks.
- `button[data-testid="stop-button"]` is the most common generation indicator in modern ChatGPT automation.
- Copy-action buttons are widely used as a reliable completion signal after assistant generation finishes.
- Robust OSS implementations use multiple fallbacks and debounce MutationObserver callbacks because ChatGPT emits many transient DOM changes.

## Guard / timeout interaction notes
- `evaluatePreSendGuard()` / `evaluatePostHopGuard()` are not the source of this first-hop failure; they operate before send and after reply settle respectively (`relay-core.ts:97-160`).
- Existing tests cover relay guards only, not the content-script ack path (`tests/relay-core.test.mjs`).
- There is no current automated test coverage for `waitForSubmissionAcknowledgement()`, background-tab timer throttling, or modern ChatGPT stop-button selectors.

## Proposed fix direction (not implemented)
1. Decouple ack from a single DOM pattern:
   - treat **any** confirmed generation-start indicator as success
   - separately treat composer-clear and user-message insertion as alternative success signals
2. Broaden generation detection:
   - prefer `button[data-testid="stop-button"]`
   - keep aria-label fallbacks including localized variants
   - consider send-button disappearance/disable-state transitions as secondary hints
3. Stop depending on DOM-only mutations for composer `.value` changes:
   - add short bounded polling after click, or
   - explicitly re-check state on an interval while observer is active
4. Make timeout layering background-safe:
   - do not rely solely on background-tab `setTimeout(5000)` inside the content script to resolve failure
   - use an absolute timestamp loop / bounded poll cadence so background 15s cannot mask a missed local ack
5. Add a fallback success heuristic:
   - assistant reply preview / new assistant turn creation
   - or network-aware signal if extension permissions and architecture allow it

## Verification plan for the eventual fix
- Add unit coverage for `checkAckSignals()` variants:
  - generation started while composer text is unchanged
  - textarea `.value` cleared without observable DOM mutation
  - user message inserted with message-role selectors
- Add content-script-level tests for `isGenerationInProgress()` covering `data-testid="stop-button"` plus locale fallbacks.
- Add an integration/semi-manual verification pass with one tab backgrounded to confirm:
  - first-hop send returns promptly
  - ack is detected before 15s
  - no false positives when send is blocked/aborted.
