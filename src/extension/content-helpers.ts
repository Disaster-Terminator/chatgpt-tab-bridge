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

function defaultInputEvent(type: string, init: InputEventInit): InputEvent | (InputEventInit & { type: string }) {
  if (typeof InputEvent === "function") {
    return new InputEvent(type, init);
  }

  return { type, ...init };
}
