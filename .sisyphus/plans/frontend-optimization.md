# Frontend Optimization Implementation Plan

## Bottom line

The safest path is to add one small shared localization layer and one small UI-preference layer, then refit the overlay and popup around the existing render seams: `createOverlay()` / `renderOverlay()` in `content-script.ts` and `render()` in `popup.ts`. The current code already centralizes most UI updates there, so this can be done without touching `core/*`, `background.ts`, manifest structure, or message protocols.

## Effort estimate

**Medium (1-2d)**

## Assumptions

- Phase 5 means adding the third `bilingual` locale after the shared `zh-CN` / `en` localization plumbing exists.
- `help` in the popup fallback block is static helper text, not a new command button, to stay within the "no new action buttons" constraint.
- The overlay's `starter` becomes a toggle button (click to switch A↔B), not a `<select>`. The popup retains `#starterSelect` for full control.

---

## New files to create

### `src/extension/copy/bridge-copy.ts`
Purpose: single shared copy dictionary for overlay + popup.

Planned exports:
- `type UiLocale = "zh-CN" | "en" | "bilingual"`
- `const DEFAULT_UI_LOCALE = "zh-CN"`
- `applyStaticCopy(root, locale)` for `[data-copy]` text nodes
- formatter helpers for dynamic UI text:
  - `formatPhase(locale, phase)`
  - `formatRoleStatus(locale, assignedRole)`
  - `formatBindingSummary(locale, binding)`
  - `formatCurrentTabStatus(locale, currentTab)`
  - `formatStarter(locale, role)`
  - `formatIssueLine(locale, issue)`
  - `formatStepLine(locale, step)`
  - `formatDebugSnapshot(locale, model)`

Notes:
- Keep freeform runtime values like `currentStep`, `transport`, `selector`, `lastIssue` raw; localize the labels around them.
- Implement bilingual with `"中文 English"` joining, never parentheses.

### `src/extension/ui/preferences.ts`
Purpose: UI-only storage for locale, without changing runtime state or background semantics.

Planned exports:
- `const UI_LOCALE_STORAGE_KEY = "chatgptBridgeUiLocale"`
- `readUiLocale()`
- `writeUiLocale(locale)`
- `observeUiLocale(callback)` or equivalent storage-change subscription helper

Notes:
- Use `chrome.storage.local`.
- Do not move locale into `core/*` or runtime state.

---

## Phase 1 — Integrate shared copy dictionary

### Goal
Replace hardcoded UI strings with shared copy helpers, defaulting to `zh-CN`, without changing layout yet.

### Files to modify

#### `src/extension/popup.html`
- Add `[data-copy]` attributes to static text nodes:
  - header eyebrow/title
  - section headings
  - labels for `#starterSelect` and `#overrideSelect`
- Keep all existing control IDs unchanged.

#### `src/extension/popup.ts`
- Add locale bootstrap at startup:
  - `let currentLocale: UiLocale = DEFAULT_UI_LOCALE`
  - load locale before first render if possible
- Split rendering into:
  - static copy pass for `[data-copy]`
  - dynamic value render in `render(model)`
- Replace hardcoded strings in:
  - `render()`
  - `copyDebugSnapshot()`
  - `buildDebugSnapshot()`
  - `summarizeBinding()`
  - current-tab status text
- Set `document.documentElement.lang` from the active locale.

#### `src/extension/content-script.ts`
- Add `let overlayLocale: UiLocale = DEFAULT_UI_LOCALE`
- Read locale on startup and subscribe to storage changes.
- Replace hardcoded overlay strings in:
  - `createOverlay()`
  - `renderOverlay()`
- Keep current DOM structure for now; only swap text sourcing.

### Dependency
- This is the foundation step; all later phases depend on it.

### Verification checkpoint
```bash
pnpm run build && pnpm run typecheck && pnpm test
```
Manual:
- Overlay still injects on supported ChatGPT thread pages.
- Popup opens.
- Default language is full Chinese.
- No `undefined`, empty, or stale English labels remain in popup/overlay.

---

## Phase 2 — Refine overlay copy and styles

### Goal
Match the frozen overlay hierarchy while keeping existing actions and message semantics intact.

### Files to modify

#### `src/extension/content-script.ts`
Update `createOverlay()` markup:
- Keep the root `aside.chatgpt-bridge-overlay`.
- Keep `data-action` / `data-bind-role` / `data-slot` patterns.
- Rework the inner HTML to this shape:
  - header row: title + phase badge + collapse button
  - role row
  - two stat cards: round / next hop
  - single info band for step
  - issue row wrapper, hidden when empty
  - single-line starter row
  - binding action row: A / B / Unbind
  - session action row: Start / Pause / Resume / Stop
  - aux row: Clear / Popup
- Remove the overlay-side `starter` `<select>` and replace it with a display slot such as `[data-slot="starter"]`.
- Add a wrapper like `[data-slot="issue-row"]` so `renderOverlay()` can toggle `hidden`.

Update `renderOverlay()`:
- Use `formatRoleStatus()`, `formatPhase()`, `formatStepLine()`, `formatIssueLine()`, `formatStarter()`.
- Hide the issue row when `display.lastIssue` is empty or `"None"`.
- Set `data-phase` on the phase badge for semantic CSS styling.
- Preserve button enabled/disabled logic exactly as today.

Update `bindOverlayEvents()`:
- Remove the overlay `starter` change listener.
- Keep all existing button handlers unchanged.

#### `src/extension/overlay.css`
Refine styles around the new structure:
- Keep dark theme and fixed bottom-right positioning.
- Add lower-brightness semantic phase badge styles via `[data-phase]`.
- Make Start the strongest CTA.
- Reduce collapse button visual weight.
- Give disabled buttons explicit subdued colors instead of relying mostly on `opacity`.
- Style the step band as a distinct single-row info block.
- Style the issue row as conditional warning text.
- Keep drag affordance on the header.
- Keep collapsed behavior on `.chatgpt-bridge-overlay--collapsed`.

### Dependency
- Requires Phase 1 copy helpers.

### Verification checkpoint
```bash
pnpm run build && pnpm run typecheck && pnpm test
```
Manual:
- Overlay injects and renders the new hierarchy.
- Drag and collapse still work.
- Issue row disappears when empty.
- Start is visually primary; disabled buttons stay readable.
- Phase badge colors change by phase without overpowering Start.

---

## Phase 3 — Refine popup into the final single-column layout

### Goal
Move the popup into the frozen 4-block structure while preserving existing control IDs and behavior.

### Files to modify

#### `src/extension/popup.html`
Restructure into four card sections:

1. **Global status**: phaseBadge, roundValue, nextHopValue, bindingA, bindingB, currentTabStatus, starterSelect, binding buttons, session buttons
2. **Settings**: new `#localeSelect`, `#overlayEnabledCheckbox`, new `#defaultExpandedCheckbox`, `#resetOverlayPositionButton`
3. **Fallback**: `#overrideSelect`, `#clearTerminalButton`, static help text
4. **Debug**: existing runtime debug value IDs (currentStepValue, issueValue, transportValue, selectorValue, copyDebugButton)

Important:
- Preserve all existing IDs already used by `popup.ts`.
- Only add new IDs where necessary: `#localeSelect`, `#defaultExpandedCheckbox`.

#### `src/extension/popup.css`
Rework layout for narrow single-column cards:
- Keep light theme and CSS variable pattern.
- Add semantic phase badge styles via `[data-phase]`.
- Replace multi-column action grids with clearer stacked/paired rows.
- Style Start as primary CTA.
- Keep card-style sections with consistent spacing.
- Improve disabled button readability with explicit disabled tokens.

#### `src/extension/popup.ts`
Add new elements to `PopupElements`:
- `localeSelect`
- `defaultExpandedCheckbox`

Wire new events:
- `#localeSelect` → `writeUiLocale(locale)` then rerender current UI
- `#defaultExpandedCheckbox` → send `SET_OVERLAY_COLLAPSED` with `collapsed: !checked`

Update `render(model)`:
- localize `#phaseBadge`
- set `elements.phaseBadge.dataset.phase = state.phase`
- keep all current control disabled logic unchanged

### Dependency
- Requires Phase 1 copy helpers.
- Can be done independently of Phase 2, but is cleaner after overlay copy is already settled.

### Verification checkpoint
```bash
pnpm run build && pnpm run typecheck && pnpm test
```
Manual:
- Popup is single-column and readable at extension width.
- All buttons still fire correctly.
- `default expanded` toggles the existing overlay collapsed state in the correct direction.
- Locale selector works for available locales without breaking control meaning.

---

## Phase 4 — Add debug collapse

### Goal
Make Debug collapsed by default without changing debug data or copy behavior.

### Files to modify

#### `src/extension/popup.html`
- Wrap the Debug block in native `<details>` / `<summary>`.
- Keep all existing debug value IDs inside the details content.

#### `src/extension/popup.css`
- Style the collapsed summary row to look like a card header.
- Add open/closed affordance styling.

### Dependency
- Depends on Phase 3 popup markup refactor.

### Verification checkpoint
```bash
pnpm run build && pnpm run typecheck && pnpm test
```
Manual:
- Popup opens with Debug collapsed.
- Expanding Debug reveals step / issue / transport / selector / copy snapshot.
- `Copy debug snapshot` still works when Debug is opened.

---

## Phase 5 — Add bilingual support

### Goal
Add the third locale mode with `"中文 English"` formatting.

### Files to modify

#### `src/extension/copy/bridge-copy.ts`
- `UiLocale` becomes `"zh-CN" | "en" | "bilingual"`
- Add a `toBilingual(zh, en)` helper that returns `"${zh} ${en}"`
- Apply bilingual formatting to all labels

#### `src/extension/ui/preferences.ts`
- Accept and persist `bilingual`.

#### `src/extension/popup.html`
- Add `<option value="bilingual">` to `#localeSelect`.

#### `src/extension/popup.ts` + `src/extension/content-script.ts`
- Ensure locale switch rerenders static + dynamic copy immediately.

### Dependency
- Requires Phase 1 copy architecture.
- Uses the settings UI introduced in Phase 3.

### Verification checkpoint
```bash
pnpm run build && pnpm run typecheck && pnpm test
```
Manual:
- Switching locale updates popup and currently open overlays.
- Bilingual strings use a single space, not parentheses.
- Examples: `就绪 Ready`, `未绑定 Unbound`.

---

## Dependency map

1. `bridge-copy.ts` and `preferences.ts` must exist before any reliable overlay/popup localization work.
2. Overlay refinement depends on localized formatter helpers, but not on popup layout.
3. Popup layout depends on the copy layer and existing IDs staying stable.
4. Debug collapse should be done after the popup structure is finalized.
5. Bilingual support is the last pass because it builds on the shared dictionary and the popup locale selector.

---

## Risk flags

1. **DOM/ID churn risk** — `popup.ts` uses `requireElement()` for every bound node. If any existing ID is renamed or removed during layout refactor, the popup will fail hard on load. Mitigation: preserve current IDs; add wrappers/classes around them instead of replacing them.

2. **Locale sync risk** — Popup and content script do not share in-memory state. If locale is only read at startup, existing overlays will drift out of sync. Mitigation: use `chrome.storage.local` plus `chrome.storage.onChanged` in `content-script.ts`.

3. **Control-state regression risk** — The most likely behavioral regressions are: `default expanded` checkbox inversion, hidden issue row never returning, moved buttons losing correct disabled states. Mitigation: keep all enable/disable logic in existing `render()` / `renderOverlay()` branches.

---

## Verification summary by phase

After **every** phase:
```bash
pnpm run build && pnpm run typecheck && pnpm test
```

Manual minimum after **every** phase:
- overlay injectable
- popup openable
- phase badge and button disabled states correct
- locale switch does not change button meaning
