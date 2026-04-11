export interface TriggerComposerSendInput {
  root: ParentNode | null | undefined;
  composer: Element | null | undefined;
  sendButton?: HTMLButtonElement | null;
}

export function normalizeText(value: unknown): string {
  return String(value || "").replace(/\r\n/g, "\n").replace(/\u00a0/g, " ").trim();
}

export function hashText(value: unknown): string {
  const text = normalizeText(value);
  let hash = 2166136261;

  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return `h${(hash >>> 0).toString(16)}`;
}

/**
 * Tightened composer_cleared detection - only if truly cleared, not just different.
 * Avoid false positives from minor normalization, line folding, or DOM reordering.
 */
export function isComposerTrulyCleared(currentText: string, expectedText: string): boolean {
  if (!currentText || currentText.trim() === "") {
    return true;
  }

  if (stillContainsExpectedPayload(currentText, expectedText)) {
    return false;
  }

  return true;
}

/**
 * Check if composer still contains significant parts of the expected payload.
 * Use normalized comparison to avoid false negatives from minor normalization.
 * Returns true if significant payload remains (NOT cleared).
 */
export function stillContainsExpectedPayload(currentText: string, expectedText: string): boolean {
  if (!expectedText || !currentText) {
    return false;
  }

  const normalizedCurrent = normalizeText(currentText);
  const normalizedExpected = normalizeText(expectedText);

  if (normalizedCurrent === normalizedExpected) {
    return true;
  }

  let matchCount = 0;
  const expectedWords = normalizedExpected.split(/\s+/).filter(w => w.length > 0);
  const currentWords = normalizedCurrent.split(/\s+/).filter(w => w.length > 0);

  for (const word of expectedWords) {
    if (currentWords.some(cw => cw.includes(word) || word.includes(cw))) {
      matchCount++;
    }
  }

  const similarity = expectedWords.length > 0 ? matchCount / expectedWords.length : 0;
  return similarity >= 0.5;
}

export function isGenerationInProgressFromDoc(): boolean {
  return hasGenerationControlButtonFromDoc();
}

export function isReplyGenerationInProgressFromDoc(latestAssistantText: unknown): boolean {
  if (hasTerminalBridgeDirective(latestAssistantText)) {
    return false;
  }

  return hasGenerationControlButtonFromDoc();
}

function hasGenerationControlButtonFromDoc(): boolean {
  if (
    document.querySelector('button[data-testid="stop-button"]') ||
    document.querySelector('button[data-testid="stop-generating-button"]')
  ) {
    return true;
  }

  return Boolean(
    document.querySelector('button[aria-label*="停止"]') ||
    document.querySelector('button[aria-label*="Stop"]') ||
    document.querySelector('button[aria-label*="Cancel"]')
  );
}

function hasTerminalBridgeDirective(value: unknown): boolean {
  const normalized = normalizeText(value);
  if (!normalized) {
    return false;
  }

  const lines = normalized
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (/^\[BRIDGE_STATE\]\s+(CONTINUE|FREEZE)$/i.test(lines[index] ?? "")) {
      return true;
    }
  }

  return false;
}

export function readComposerTextFromDoc(composer: Element | null | undefined): string {
  if (!composer) {
    return "";
  }

  if (isValueComposer(composer)) {
    return normalizeText(composer.value || "");
  }

  return normalizeText(composer.textContent || "");
}

export function findLatestUserMessageHash(): string | null {
  const selectors = [
    '[data-message-author-role="user"]',
    'article [data-message-author-role="user"]',
    '[data-testid*="conversation-turn"] [data-message-author-role="user"]',
    'main [data-message-author-role="user"]'
  ];

  for (const selector of selectors) {
    const candidates = Array.from(document.querySelectorAll(selector)).filter((element) =>
      normalizeText(element.textContent || "")
    );
    if (candidates.length > 0) {
      const latest = candidates[candidates.length - 1];
      const text = normalizeText(latest.textContent || "");
      return text ? hashText(text) : null;
    }
  }

  return null;
}

export type AckSignal = "user_message_added" | "generation_started";
export type AuxiliarySignal = "composer_cleared";
export type DispatchAcceptanceSignal = AckSignal | "trigger_consumed";

export interface CheckAckSignalsInput {
  baselineGenerating?: boolean;
  baselineUserHash: string | null;
  baselineSendButtonReady?: boolean;
  composer: Element;
  expectedHash: string;
  expectedText: string;
  postClickTimestamp?: number;
}

export type CheckAckSignalsResult = 
  | { ok: true; signal: AckSignal; evidence: "strong" | "strong_with_auxiliary" }
  | { ok: true; signal: AuxiliarySignal; evidence: "auxiliary_only" }
  | null;

export interface EvaluateDispatchAcceptanceInput {
  ack: CheckAckSignalsResult;
  baselineUserHash: string | null;
  currentUserHash: string | null;
  payloadReleased: boolean;
  textChanged: boolean;
  buttonStateChanged: boolean;
}

export function evaluateDispatchAcceptanceSignal(
  input: EvaluateDispatchAcceptanceInput
): DispatchAcceptanceSignal | null {
  const { ack, baselineUserHash, currentUserHash, payloadReleased, textChanged, buttonStateChanged } = input;
  const hasUserThreadChange = currentUserHash !== null && currentUserHash !== baselineUserHash;
  const triggerConsumed = payloadReleased || textChanged || buttonStateChanged;

  if (ack?.ok && ack.signal === "user_message_added" && hasUserThreadChange) {
    return "user_message_added";
  }

  if (ack?.ok && ack.signal === "generation_started" && triggerConsumed) {
    return "generation_started";
  }

  if (triggerConsumed) {
    return "trigger_consumed";
  }

  return null;
}

/**
 * Find the text content of the latest user message in the conversation.
 * Used for payload correlation verification instead of exact hash match.
 */
export function findLatestUserMessageText(): string | null {
  const selectors = [
    '[data-message-author-role="user"]',
    'article [data-message-author-role="user"]',
    '[data-testid*="conversation-turn"] [data-message-author-role="user"]',
    'main [data-message-author-role="user"]'
  ];

  for (const selector of selectors) {
    const candidates = Array.from(document.querySelectorAll(selector)).filter((element) =>
      normalizeText(element.textContent || "")
    );
    if (candidates.length > 0) {
      const latest = candidates[candidates.length - 1];
      const text = normalizeText(latest.textContent || "");
      return text || null;
    }
  }

  return null;
}

/**
 * Calculate the word overlap ratio between two texts.
 * Returns a value between 0 and 1.
 */
export function calculateTextOverlap(textA: string, textB: string): number {
  const normalizedA = normalizeText(textA);
  const normalizedB = normalizeText(textB);

  if (!normalizedA || !normalizedB) {
    return 0;
  }

  const wordsA = normalizedA.split(/\s+/).filter(w => w.length > 0);
  const wordsB = normalizedB.split(/\s+/).filter(w => w.length > 0);

  if (wordsA.length === 0 || wordsB.length === 0) {
    return 0;
  }

  let matchCount = 0;
  for (const word of wordsA) {
    if (wordsB.some(bw => bw.includes(word) || word.includes(bw))) {
      matchCount++;
    }
  }

  return matchCount / Math.max(wordsA.length, wordsB.length);
}

/**
 * Check if the latest user message contains the bridge envelope prefix.
 * This is a stable indicator that the message was relayed by our bridge.
 */
function containsBridgeEnvelopePrefix(text: string): boolean {
  return text.includes("[BRIDGE_CONTEXT]") || text.includes("[来自");
}

function extractHopMarker(text: string): string | null {
  const match = normalizeText(text).match(/(?:^|\n)hop:\s*([^\s\n]+)/i);
  return match?.[1] ?? null;
}

/**
 * Check if the latest user message shows payload adoption.
 * This checks if the expected text is present in any form in the latest user message.
 */
function showsPayloadAdoption(latestText: string, expectedText: string): boolean {
  const hopMarker = extractHopMarker(expectedText);
  if (hopMarker) {
    const latestLower = normalizeText(latestText).toLowerCase();
    return latestLower.includes(`[bridge_context]`) && latestLower.includes(`hop: ${hopMarker}`.toLowerCase());
  }

  // Check for bridge envelope prefix
  if (containsBridgeEnvelopePrefix(latestText)) {
    return true;
  }

  // Check for significant text overlap (>= 50%)
  const overlap = calculateTextOverlap(latestText, expectedText);
  if (overlap >= 0.5) {
    return true;
  }

  return false;
}

/**
 * Check acknowledgment signals after message submission.
 * 
 * Strong evidence (can succeed alone):
 * - user_message_added: latest user message changed with payload adoption
 * - generation_started: generation actually started (not stopped)
 * 
 * Auxiliary evidence (must combine with strong evidence):
 * - composer_cleared: composer content changed - weak signal, needs strong evidence
 */
export function checkAckSignals(input: CheckAckSignalsInput): CheckAckSignalsResult {
  const { baselineGenerating, baselineUserHash, composer, expectedHash, expectedText } = input;

  const composerText = readComposerTextFromDoc(composer);
  const latestUserHash = findLatestUserMessageHash();
  const latestUserText = findLatestUserMessageText();
  const currentGenerating = isGenerationInProgressFromDoc();
  const composerCleared = isComposerTrulyCleared(composerText, expectedText);

  // STRONG EVIDENCE: user_message_added with payload adoption
  if (latestUserHash && latestUserHash !== baselineUserHash) {
    if (latestUserText && showsPayloadAdoption(latestUserText, expectedText)) {
      if (composerCleared) {
        return { ok: true, signal: "user_message_added", evidence: "strong_with_auxiliary" };
      }
      return { ok: true, signal: "user_message_added", evidence: "strong" };
    }
    if (latestUserHash === expectedHash) {
      if (composerCleared) {
        return { ok: true, signal: "user_message_added", evidence: "strong_with_auxiliary" };
      }
      return { ok: true, signal: "user_message_added", evidence: "strong" };
    }
  }

  // STRONG EVIDENCE: generation_started (truly started, not stopped)
  if (!baselineGenerating && currentGenerating) {
    if (composerCleared) {
      return { ok: true, signal: "generation_started", evidence: "strong_with_auxiliary" };
    }
    return { ok: true, signal: "generation_started", evidence: "strong" };
  }

  // AUXILIARY ONLY: composer_cleared cannot succeed alone
  if (composerCleared) {
    return { ok: true, signal: "composer_cleared", evidence: "auxiliary_only" };
  }

  return null;
}

export function findBestComposer(root: ParentNode | null | undefined): Element | null {
  const selectors = [
    '[contenteditable="true"][role="textbox"]',
    '[contenteditable="true"][data-testid*="composer"]',
    "textarea",
    "input"
  ];

  const visibleCandidates: Element[] = [];
  const fallbackCandidates: Element[] = [];

  for (const selector of selectors) {
    const elements = Array.from(root?.querySelectorAll?.(selector) ?? []);
    for (const element of elements) {
      if (isElementVisible(element)) {
        visibleCandidates.push(element);
      } else {
        fallbackCandidates.push(element);
      }
    }
  }

  return visibleCandidates[0] ?? fallbackCandidates[0] ?? null;
}

export function applyComposerText(
  composer: Element | null | undefined,
  text: string,
  createInputEvent: typeof defaultInputEvent = defaultInputEvent
): "value" | "contenteditable" {
  const normalized = normalizeText(text);
  composer?.focus?.();

  if (isValueComposer(composer)) {
    const prototype =
      String(composer.tagName || "").toLowerCase() === "textarea"
        ? globalThis.HTMLTextAreaElement?.prototype
        : globalThis.HTMLInputElement?.prototype;
    const valueSetter = prototype ? Object.getOwnPropertyDescriptor(prototype, "value")?.set : null;

    if (typeof valueSetter === "function") {
      valueSetter.call(composer, normalized);
    } else {
      composer.value = normalized;
    }
    composer.dispatchEvent?.(createInputEvent("input", { bubbles: true, data: normalized }));
    composer.dispatchEvent?.(createInputEvent("change", { bubbles: true, data: normalized }));
    return "value";
  }

  const ownerDocument = composer?.ownerDocument || globalThis.document;
  const selection = ownerDocument?.getSelection?.();

  if (selection && ownerDocument?.createRange) {
    const range = ownerDocument.createRange();
    range.selectNodeContents(composer as Node);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  if (typeof ownerDocument?.execCommand === "function") {
    const inserted = ownerDocument.execCommand("insertText", false, normalized);
    if (!inserted && composer) {
      composer.textContent = normalized;
    }
  } else if (composer) {
    composer.textContent = normalized;
  }

  composer?.dispatchEvent?.(
    createInputEvent("beforeinput", {
      bubbles: true,
      cancelable: true,
      data: normalized,
      inputType: "insertText"
    })
  );
  composer?.dispatchEvent?.(
    createInputEvent("input", {
      bubbles: true,
      data: normalized,
      inputType: "insertText"
    })
  );
  return "contenteditable";
}

export function readComposerText(composer: Element | null | undefined): string {
  if (!composer) {
    return "";
  }

  if (isValueComposer(composer)) {
    return normalizeText(composer.value || "");
  }

  return normalizeText(composer.textContent || "");
}

export function findSendButton(
  root: ParentNode | null | undefined,
  composer: Element | null | undefined
): HTMLButtonElement | null {
  const candidates = [
    composer?.closest?.("form")?.querySelector?.('button[type="submit"]'),
    root?.getElementById?.("composer-submit-button"),
    root?.querySelector?.("#composer-submit-button"),
    root?.querySelector?.('button[data-testid="send-button"]'),
    root?.querySelector?.('button[aria-label*="Send"]'),
    root?.querySelector?.('button[aria-label*="发送"]')
  ].filter(Boolean) as HTMLButtonElement[];

  return candidates[0] ?? null;
}

export function triggerComposerSend({
  root,
  composer,
  sendButton = findSendButton(root, composer)
}: TriggerComposerSendInput): {
  ok: boolean;
  mode: "button_missing" | "button" | "form_submit" | "button_disabled";
  error?: string;
} {
  if (!sendButton) {
    return {
      ok: false,
      mode: "button_missing",
      error: "send_button_missing"
    };
  }

  if (!isDisabledButton(sendButton)) {
    sendButton.click?.();
    return {
      ok: true,
      mode: "button"
    };
  }

  const form = composer?.closest?.("form") as HTMLFormElement | null;
  if (form) {
    if (typeof form.requestSubmit === "function") {
      form.requestSubmit();
      return {
        ok: true,
        mode: "form_submit"
      };
    }

    const submitAccepted = form.dispatchEvent?.(
      new Event("submit", {
        bubbles: true,
        cancelable: true
      })
    );

    if (submitAccepted) {
      return {
        ok: true,
        mode: "form_submit"
      };
    }
  }

  return {
    ok: false,
    mode: "button_disabled",
    error: "send_button_disabled"
  };
}

export function isValueComposer(composer: Element | null | undefined): composer is HTMLTextAreaElement | HTMLInputElement {
  if (!composer) {
    return false;
  }

  const tagName = String(composer.tagName || "").toLowerCase();
  return tagName === "textarea" || tagName === "input";
}

function isDisabledButton(button: HTMLButtonElement | null | undefined): boolean {
  if (!button) {
    return false;
  }

  return button.disabled === true || button.getAttribute?.("aria-disabled") === "true";
}

export function isElementVisible(element: Element | null | undefined): boolean {
  if (!element) {
    return false;
  }

  if ((element as HTMLElement).hidden || element.getAttribute?.("aria-hidden") === "true") {
    return false;
  }

  const style = globalThis.getComputedStyle?.(element);
  if (style && (style.display === "none" || style.visibility === "hidden")) {
    return false;
  }

  const rects = element.getClientRects?.();
  return Boolean(rects && rects.length > 0);
}

function defaultInputEvent(type: string, init: InputEventInit): Event {
  if (typeof InputEvent === "function") {
    return new InputEvent(type, init);
  }

  return new Event(type, {
    bubbles: init.bubbles,
    cancelable: init.cancelable,
    composed: init.composed
  });
}
