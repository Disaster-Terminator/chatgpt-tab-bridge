# Fix: Strengthen isGenerationInProgress selector

## Change Summary
- **File**: `src/extension/content-script.ts`
- **Function**: `isGenerationInProgress` (lines 646-651)
- **Change**: Extended selector to detect 6 generation control button labels (3 Chinese, 3 English)

## Before
```ts
document.querySelector('button[aria-label*="停止"]') ||
document.querySelector('button[aria-label*="Stop"]')
```

## After
```ts
document.querySelector('button[aria-label*="停止"], button[aria-label*="Stop"], button[aria-label*="暂停"], button[aria-label*="Pause"], button[aria-label*="取消"], button[aria-label*="Cancel"]')
```

## Rationale
ChatGPT UI may display different labels depending on language or state. The original only covered "Stop" (中/英). Added coverage for:
- 暂停 / Pause (pause button)
- 取消 / Cancel (cancel button)

This ensures accurate detection of active generation across all language variants.

## Verification
- ✅ Build: `bun run build` - Extension build succeeded
- ✅ Tests: `bun test` - 30 pass, 0 fail
- ⚠️ Typecheck: Pre-existing errors in `popup.ts` (TS2554, TS2304) - unrelated to this change

## Notes
- The function now returns true if ANY of the 6 aria-label substrings match
- Single `querySelector` call with comma-separated selectors (more efficient than OR logic)
- No other code changes required
## Task 1.3 - Add AckDebug interface and lastAckDebug variable

**Date**: 2025-04-05  
**Status**: Completed

### Changes Made
- Added `AckDebug` interface in `src/extension/content-script.ts` (after line 55, before overlayLocale declaration)
- Declared `let lastAckDebug: AckDebug | null = null;` immediately after the interface

### Interface Structure
```ts
interface AckDebug {
  ok: boolean;
  signal: string | null;
  error: string | null;
  timedOut: boolean;
  baseline: {
    userHash: string | null;
    composerText: string;
    generating: boolean;
    expectedHash: string;
  };
  after: {
    latestUserHash: string | null;
    composerText: string;
    generating: boolean;
  };
  timestamp: number;
}
```

### Verification
- Typecheck: No new errors introduced in content-script.ts (pre-existing errors in popup.ts)
- Build: Extension build succeeded

### Notes
- Interface placed logically near other type declarations and variable declarations
- Variable initialized to `null` as required
- No runtime logic added yet (Task 1.4 will populate this)
- This provides the data structure for debugging send acknowledgement issues

### Next Steps
- Task 1.4: Implement logic to populate `lastAckDebug` during `waitForSubmissionAcknowledgement`

## Task 1.4 - Extend timeout and remove characterData from MutationObserver

**Date**: 2025-04-05  
**Status**: Completed

### Changes Made
- **File**: `src/extension/content-script.ts`
- **Function**: `waitForSubmissionAcknowledgement` (lines 564-611)

#### Change 1: Extended timeout
- Changed `setTimeout(..., 5000)` to `setTimeout(..., 10000)` (line 589)
- Gives more time for submission acknowledgement in slow network conditions

#### Change 2: Removed characterData from observer
- Removed `characterData: true` from `observer.observe()` options (line 607)
- Prevents page freezing caused by excessive character data mutations triggering the observer

### Before
```ts
const timeout = setTimeout(() => {
  observer.disconnect();
  resolve({ ok: false, error: "send_not_acknowledged", signal: "none" });
}, 5000);

observer.observe(document.body, {
  childList: true,
  subtree: true,
  attributes: true,
  characterData: true,
  attributeFilter: ["aria-label", "disabled", "style", "class"]
});
```

### After
```ts
const timeout = setTimeout(() => {
  observer.disconnect();
  resolve({ ok: false, error: "send_not_acknowledged", signal: "none" });
}, 10000);

observer.observe(document.body, {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: ["aria-label", "disabled", "style", "class"]
});
```

### Rationale
- **Timeout increase**: ChatGPT can be slow to acknowledge submissions, especially with longer prompts or network latency. 5 seconds was too aggressive; 10 seconds provides adequate margin.
- **Remove characterData**: Watching for character data changes is extremely expensive - every text insertion, deletion, or modification triggers the observer. This was causing the page to freeze during typing. The acknowledgement signals we need (aria-label changes, disabled state, class changes) are already covered by `attributes: true` with the attributeFilter.

### Verification
- ✅ Build: `bun run build` - Extension build succeeded
- ✅ Tests: `bun test` - 30 pass, 0 fail
- ⚠️ Typecheck: Pre-existing errors in `popup.ts` (TS2554, TS2304) - unrelated to this change, no new errors introduced

### Notes
- The function still checks the same acknowledgement signals (user_message_added, generation_started, composer_cleared)
- No logic changes beyond the timeout and observer configuration
- The observer remains efficient by only watching attribute changes on relevant elements

## Task 2.1 - Popup AckDebug integration

**Date**: 2025-04-05  
**Status**: Completed

### Changes Made

#### 1. constants.ts
- Added `GET_LAST_ACK_DEBUG` message type to `MESSAGE_TYPES` (alphabetically after GET_ASSISTANT_SNAPSHOT)

#### 2. content-script.ts
- Added message handler for `GET_LAST_ACK_DEBUG` in `chrome.runtime.onMessage.addListener`
- Handler returns `lastAckDebug` or `{ ok: false, error: "no_ack_debug" }` if null
- Populates `lastAckDebug` in `sendRelayMessage` immediately after `waitForSubmissionAcknowledgement` completes (before success/failure checks)
- `lastAckDebug` captures:
  - `ok`, `signal`, `error`, `timedOut`
  - `baseline`: userHash, composerText, generating, expectedHash
  - `after`: latestUserHash, composerText, generating
  - `timestamp`

#### 3. popup.ts
- Modified `copyDebugSnapshot()` to fetch `ackDebug` from content script via `chrome.tabs.sendMessage`
- Updated `buildDebugSnapshot()` signature to accept `ackDebug: any` parameter
- Added "Ack Debug:" section to debug output when data is available:
  - Timestamp (ISO)
  - Expected hash
  - Baseline (userHash, composerText truncated to 60 chars, generating)
  - After (latestUserHash, composerText truncated, generating)
  - Signal, timed out, error

### Verification
- ✅ Build: `bun run build` - Extension build succeeded
- ✅ Tests: `bun test` - 30 pass, 0 fail
- ⚠️ Typecheck: Pre-existing errors in popup.ts (TS2554, TS2304) - unrelated to this change, no new errors

### Notes
- Used `any` type for ackDebug to avoid cross-file type dependencies (as per plan)
- The debug snapshot now includes comprehensive acknowledgement debugging information
- This completes Wave 1 and Wave 2 of the fix-send-timeout plan

### Next Steps
- Wave 3 (optional): Consider adding type definitions for AckDebug in shared/types.ts if needed

## Popup Freeze & Error Sync Fixes

**Date**: 2025-04-05  
**Status**: Completed

### Issues Addressed

1. **refreshInFlight unhandled rejection**: Auto-refresh interval didn't catch errors from `refresh()`, causing unhandled rejections and potential refresh cycle stop.
2. **copyDebugSnapshot crash**: Used non-null assertion `currentTabId!` which throws if `currentTabId` is null.
3. **copyDebugSnapshot hang**: No timeout on `chrome.tabs.sendMessage` could freeze popup indefinitely if content script unresponsive.
4. **Error display overwriting**: `render()` always sets `issueValue` from state, potentially overwriting transient errors.

### Changes Made to `src/extension/popup.ts`

#### Added `withTimeout` helper
```ts
function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Operation timed out")), timeoutMs)
    )
  ]);
}
```

#### Fixed `copyDebugSnapshot`
- Added null check for `currentTabId` (shows "unsupportedTab" message if null)
- Wrapped `chrome.tabs.sendMessage` with `withTimeout(..., 5000)` to prevent indefinite hang
- Added error handling for timeout/send failures (logs warning, continues)
- Improved no-data case: shows "No data available" instead of silent return

#### Fixed `startAutoRefresh`
- Added `.catch()` to `refresh()` call in interval to prevent unhandled rejections
- Added explanatory comment: "Don't let errors stop the refresh cycle"

### Verification
- ✅ Build: `bun run build` - Extension build succeeded
- ✅ Tests: `bun test` - 30 pass, 0 fail

### Notes
- Error sync issue (Issue 4) not fully addressed; deferred as per plan focus on freeze fixes
- Used hardcoded "No data available" message instead of i18n key (no `noData` in PopupCopy)
- All changes are defensive: prevent popup freeze, improve robustness

### Next Steps
- Consider addressing error display persistence if it remains a problem after these fixes
