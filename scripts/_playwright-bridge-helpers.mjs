/**
 * Shared Playwright helpers for ChatGPT Tab Bridge E2E tests.
 * Extracted from semi-bridge-playwright.mjs - behavior unchanged.
 */

import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import { chromium } from "playwright";

/**
 * Launch Playwright browser with extension loaded.
 * @param {Object} options
 * @param {string} [options.extensionPath] - Path to extension dist
 * @param {string} [options.browserExecutablePath] - Custom browser path
 * @returns {Promise<{context: import("playwright").BrowserContext, userDataDir: string}>}
 */
export async function launchBrowserWithExtension(options = {}) {
  const extensionPath = options.extensionPath || path.resolve(process.cwd(), "dist/extension");
  const browserExecutablePath = options.browserExecutablePath || null;

  const userDataDir = await mkdtemp(path.join(os.tmpdir(), "chatgpt-bridge-e2e-"));

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    ...(browserExecutablePath ? { executablePath: browserExecutablePath } : {}),
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--enable-unsafe-extension-debugging"
    ]
  });

  return { context, userDataDir };
}

/**
 * Cleanup browser context and user data directory.
 * @param {import("playwright").BrowserContext} context
 * @param {string} userDataDir
 */
export async function cleanupBrowser(context, userDataDir) {
  if (context) {
    await context.close().catch(() => {});
  }

  await rm(userDataDir, {
    force: true,
    maxRetries: 5,
    recursive: true,
    retryDelay: 250
  }).catch(() => {});
}

/**
 * Get two pages from context (existing or new).
 * @param {import("playwright").BrowserContext} context
 * @returns {Promise<[import("playwright").Page, import("playwright").Page]>}
 */
export async function getTwoPages(context) {
  const existingPages = context.pages();
  const pageA = existingPages[0] ?? (await context.newPage());
  const pageB = existingPages[1] ?? (await context.newPage());

  for (const page of existingPages.slice(2)) {
    await page.close().catch(() => {});
  }

  return [pageA, pageB];
}

/**
 * Read command-line flag value.
 * @param {string} flagName
 * @returns {string|null}
 */
export function readFlag(flagName) {
  const index = process.argv.indexOf(flagName);
  if (index === -1) {
    return null;
  }

  return process.argv[index + 1] ?? null;
}

/**
 * Read path flag and resolve relative paths.
 * @param {string} flagName
 * @returns {string|null}
 */
export function readPathFlag(flagName) {
  const value = readFlag(flagName);
  if (!value) {
    return null;
  }

  // Resolve relative paths against cwd, preserve absolute paths
  return path.isAbsolute(value) ? value : path.resolve(process.cwd(), value);
}

/**
 * Ensure overlay is rendered on page.
 * @param {import("playwright").Page} page
 */
export async function ensureOverlay(page) {
  await page.waitForSelector(".chatgpt-bridge-overlay", { timeout: 30000 });
}

/**
 * Click overlay bind button for specified role.
 * @param {import("playwright").Page} page
 * @param {"A"|"B"} role
 */
export async function clickOverlayBind(page, role) {
  const selector = `[data-bind-role="${role}"]`;
  await page.waitForSelector(selector, { state: "visible", timeout: 30000 });
  await page.locator(selector).click();
}

/**
 * Click overlay action button (start/pause/resume/stop).
 * @param {import("playwright").Page} page
 * @param {"start"|"pause"|"resume"|"stop"} action
 */
export async function clickOverlayAction(page, action) {
  const selector = `[data-action="${action}"]`;
  await page.locator(selector).click();
}

/**
 * Wait until overlay action is enabled (visible and not disabled).
 * @param {import("playwright").Page} page
 * @param {"start"|"pause"|"resume"|"stop"} action
 */
export async function expectOverlayActionEnabled(page, action) {
  const selector = `[data-action="${action}"]`;
  await page.waitForFunction(
    (targetSelector) => {
      const node = document.querySelector(targetSelector);
      // Check if visible (not display:none) and not disabled
      if (!node) return false;
      const style = window.getComputedStyle(node);
      if (style.display === "none") return false;
      return node.disabled !== true;
    },
    selector,
    { timeout: 30000 }
  );
}

/**
 * Verify popup phase via data-phase attribute (no copy dependency).
 * @param {import("playwright").Page} page
 * @param {string} expectedPhase
 */
export async function expectPopupPhaseState(page, expectedPhase) {
  await page.waitForFunction(
    ({ targetSelector, targetPhase }) => {
      const node = document.querySelector(targetSelector);
      return Boolean(node) && node.dataset.phase === targetPhase;
    },
    { targetSelector: "#phaseBadge", targetPhase: expectedPhase },
    { timeout: 30000 }
  );
}

/**
 * Verify binding is in non-default state (not unbound).
 * @param {import("playwright").Page} page
 * @param {"A"|"B"} role
 */
export async function expectBindingState(page, role) {
  const selector = role === "A" ? "#bindingA" : "#bindingB";
  await page.waitForFunction(
    (targetSelector) => {
      const node = document.querySelector(targetSelector);
      if (!node) return false;
      const text = node.textContent?.trim() || "";
      // Check non-default: not "未绑定" (zh-CN) or "Unbound" (en)
      return text.length > 0 && !text.includes("未绑定") && text.toLowerCase() !== "unbound";
    },
    selector,
    { timeout: 30000 }
  );
}

/**
 * Verify popup control states via enabled/disabled attributes.
 * @param {import("playwright").Page} page
 * @param {Object} expectedStates
 */
export async function expectPopupControlState(page, expectedStates) {
  if (expectedStates.canPause !== undefined) {
    await page.waitForFunction(
      ({ selector, expectedEnabled }) => {
        const node = document.querySelector(selector);
        if (!node) return false;
        const isEnabled = node.disabled !== true;
        return isEnabled === expectedEnabled;
      },
      { selector: "#pauseButton", expectedEnabled: expectedStates.canPause },
      { timeout: 30000 }
    );
  }
  if (expectedStates.canResume !== undefined) {
    await page.waitForFunction(
      ({ selector, expectedEnabled }) => {
        const node = document.querySelector(selector);
        if (!node) return false;
        const isEnabled = node.disabled !== true;
        return isEnabled === expectedEnabled;
      },
      { selector: "#resumeButton", expectedEnabled: expectedStates.canResume },
      { timeout: 30000 }
    );
  }
  if (expectedStates.canStop !== undefined) {
    await page.waitForFunction(
      ({ selector, expectedEnabled }) => {
        const node = document.querySelector(selector);
        if (!node) return false;
        const isEnabled = node.disabled !== true;
        return isEnabled === expectedEnabled;
      },
      { selector: "#stopButton", expectedEnabled: expectedStates.canStop },
      { timeout: 30000 }
    );
  }
  if (expectedStates.overrideSelectEnabled !== undefined) {
    await page.waitForFunction(
      ({ selector, expectedEnabled }) => {
        const node = document.querySelector(selector);
        if (!node) return false;
        const isEnabled = node.disabled !== true;
        return isEnabled === expectedEnabled;
      },
      { selector: "#overrideSelect", expectedEnabled: expectedStates.overrideSelectEnabled },
      { timeout: 30000 }
    );
  }
  if (expectedStates.clearTerminalEnabled !== undefined) {
    await page.waitForFunction(
      ({ selector, expectedEnabled }) => {
        const node = document.querySelector(selector);
        if (!node) return false;
        const isEnabled = node.disabled !== true;
        return isEnabled === expectedEnabled;
      },
      { selector: "#clearTerminalButton", expectedEnabled: expectedStates.clearTerminalEnabled },
      { timeout: 30000 }
    );
  }
}

/**
 * Wait for value to change from initial value.
 * @param {import("playwright").Page} page
 * @param {string} selector
 * @param {Function} predicate - async function receiving current value
 */
export async function expectValueChanged(page, selector, predicate) {
  const initialValue = await page.locator(selector).innerText();
  await page.waitForFunction(
    async ({ targetSelector, initialVal }) => {
      const node = document.querySelector(targetSelector);
      if (!node) return false;
      const currentValue = node.textContent?.trim() || "";
      // Simple check: value changed from initial
      return currentValue !== initialVal;
    },
    { targetSelector: selector, initialVal: initialValue },
    { timeout: 30000 }
  );
}

/**
 * Wait for user to manually navigate to supported thread URLs.
 * @param {import("playwright").Page} page
 * @param {string} label - Label for diagnostics
 */
export async function waitForManualThreadUrl(page, label) {
  try {
    await page.waitForFunction(() => {
      return /^https:\/\/chatgpt\.com\/(c\/|g\/[^/]+\/c\/)/.test(window.location.href);
    }, {
      timeout: 0 // No timeout - wait indefinitely
    });
  } catch (error) {
    // timeout of 0 means we wait forever until user navigates
    // This should not throw
  }
}

/**
 * Bootstrap an anonymous ChatGPT thread with a prompt.
 * Tries anonymous bootstrap first, only fails on actual error.
 * @param {import("playwright").Page} page
 * @param {string} seedLabel
 * @param {string} prompt
 */
export async function bootstrapAnonymousThread(page, seedLabel, prompt) {
  await dismissCookieBanner(page);
  
  // Try anonymous bootstrap - send prompt and wait for response
  try {
    // Find and use composer
    const composer = await findComposer(page);
    await composer.waitFor({ state: "visible", timeout: 30000 });
    
    // Send the prompt
    const tagName = await composer.evaluate((node) => node.tagName.toLowerCase());
    if (tagName === "textarea" || tagName === "input") {
      await composer.evaluate((node, value) => {
        node.value = value;
        node.dispatchEvent(new Event("input", { bubbles: true }));
        node.dispatchEvent(new Event("change", { bubbles: true }));
      }, prompt);
    } else {
      await composer.click({ force: true });
      await composer.focus({ force: true });
      await page.keyboard.insertText(prompt);
    }
    
    // Click send or press Enter
    const sendButton = page
      .locator('button[data-testid="send-button"], button[aria-label*="Send"], button[aria-label*="发送"], form button[type="submit"]')
      .first();

    if (await sendButton.count()) {
      const clickable = await waitForEnabledButton(sendButton, 5000);
      if (clickable) {
        await sendButton.click();
      } else {
        await page.keyboard.press("Enter");
      }
    } else {
      await page.keyboard.press("Enter");
    }

    // Wait for assistant reply
    const locator = page.locator('[data-message-author-role="assistant"]').last();
    await locator.waitFor({ state: "visible", timeout: 60000 });
    
    // Wait for stable reply
    const startedAt = Date.now();
    while (Date.now() - startedAt < 60000) {
      const text = (await locator.innerText()).trim();
      if (text) break;
      await page.waitForTimeout(1500);
    }

    // Wait for supported URL
    await page.waitForFunction(() => {
      return /^https:\/\/chatgpt\.com\/(c\/|g\/[^/]+\/c\/)/.test(window.location.href);
    }, { timeout: 20000 });
    
    return; // Success!
    
  } catch (bootstrapError) {
    // Check if we actually got a response despite the error
    const hasConversation = await page.evaluate(() => {
      return !!document.querySelector('[data-message-author-role="assistant"]');
    }).catch(() => false);
    
    const hasSupportedUrl = await page.evaluate(() => {
      return /^https:\/\/chatgpt\.com\/(c\/|g\/[^/]+\/c\/)/.test(window.location.href);
    }).catch(() => false);
    
    // If we got both a response AND a supported URL, consider it a success
    if (hasConversation && hasSupportedUrl) {
      return; // Success despite error message
    }
    
    // Real failure - couldn't create thread
    throw new Error(
      `Anonymous bootstrap failed for ${seedLabel}: ${bootstrapError.message}. ` +
      `Provide --url-a and --url-b with existing thread URLs instead.`
    );
  }
}

/**
 * Ensure composer is visible on page.
 * @param {import("playwright").Page} page
 * @returns {Promise<import("playwright").Locator>}
 */
export async function ensureComposer(page) {
  const composer = await findComposer(page);
  await composer.waitFor({
    state: "visible",
    timeout: 30000
  });
  return composer;
}

/**
 * Send a prompt via composer.
 * @param {import("playwright").Page} page
 * @param {string} prompt
 */
export async function sendPrompt(page, prompt) {
  const composer = await ensureComposer(page);
  const tagName = await composer.evaluate((node) => node.tagName.toLowerCase());

  if (tagName === "textarea" || tagName === "input") {
    await composer.evaluate((node, value) => {
      node.value = value;
      node.dispatchEvent(new Event("input", { bubbles: true }));
      node.dispatchEvent(new Event("change", { bubbles: true }));
    }, prompt);
  } else {
    // Use force:true to bypass overlay intercepting clicks
    await composer.click({ force: true });
    await composer.focus({ force: true });
    await page.keyboard.insertText(prompt);
  }

  const sendButton = page
    .locator('button[data-testid="send-button"], button[aria-label*="Send"], button[aria-label*="发送"], form button[type="submit"]')
    .first();

  if (await sendButton.count()) {
    const clickable = await waitForEnabledButton(sendButton, 5000);
    if (clickable) {
      await sendButton.click();
      await waitForPromptDispatch(page, composer, prompt);
      return;
    }
  }

  await page.keyboard.press("Enter");
  await waitForPromptDispatch(page, composer, prompt);
}

/**
 * Wait for assistant reply to appear.
 * @param {import("playwright").Page} page
 * @param {string} seedLabel
 * @returns {Promise<string>}
 */
export async function waitForAssistantReply(page, seedLabel) {
  const locator = page.locator('[data-message-author-role="assistant"]').last();
  try {
    await locator.waitFor({
      state: "visible",
      timeout: 60000
    });
  } catch (error) {
    await dumpBootstrapDiagnostics(page, seedLabel);
    throw error;
  }

  const startedAt = Date.now();

  while (Date.now() - startedAt < 60000) {
    const text = (await locator.innerText()).trim();
    if (text) {
      return text;
    }

    await page.waitForTimeout(1500);
  }

  await dumpBootstrapDiagnostics(page, seedLabel);
  throw new Error("Timed out waiting for a stable assistant reply.");
}

/**
 * Wait for URL to become a supported thread URL.
 * @param {import("playwright").Page} page
 */
export async function waitForSupportedThreadUrl(page) {
  try {
    await page.waitForFunction(() => {
      return /^https:\/\/chatgpt\.com\/(c\/|g\/[^/]+\/c\/)/.test(window.location.href);
    }, {
      timeout: 20000
    });
  } catch (error) {
    await dumpBootstrapDiagnostics(page, "thread-url");
    throw new Error(
      "Anonymous ChatGPT chat did not transition to a supported thread URL. Semi-automated binding tests need real /c/ or /g/.../c/ thread URLs."
    );
  }
}

/**
 * Find the ChatGPT composer element.
 * @param {import("playwright").Page} page
 * @returns {Promise<import("playwright").Locator>}
 */
export async function findComposer(page) {
  const candidates = [
    page.locator('[contenteditable="true"][role="textbox"]').first(),
    page.locator('[contenteditable="true"][data-testid*="composer"]').first(),
    page.locator("textarea").first()
  ];

  for (const locator of candidates) {
    if ((await locator.count()) && (await locator.isVisible().catch(() => false))) {
      return locator;
    }
  }

  throw new Error("Could not find a ChatGPT composer on the page.");
}

/**
 * Dismiss cookie banner if present.
 * @param {import("playwright").Page} page
 */
export async function dismissCookieBanner(page) {
  const selectors = [
    'button:has-text("拒绝非必需")',
    'button:has-text("全部接受")',
    'button:has-text("Reject non-essential")',
    'button:has-text("Accept all")',
    'button:has-text("Manage Cookie")'
  ];

  for (const selector of selectors) {
    const button = page.locator(selector).first();
    if (await button.count()) {
      try {
        await button.click({ force: true, timeout: 2000 });
        await page.waitForTimeout(500);
        return;
      } catch {
        // Try the next known banner action.
      }
    }
  }
}

/**
 * Wait for button to become enabled.
 * @param {import("playwright").Locator} locator
 * @param {number} timeoutMs
 * @returns {Promise<boolean>}
 */
export async function waitForEnabledButton(locator, timeoutMs) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const enabled = await locator.evaluate((node) => {
      return node.disabled !== true && node.getAttribute("aria-disabled") !== "true";
    }).catch(() => false);

    if (enabled) {
      return true;
    }

    await sleep(250);
  }

  return false;
}

/**
 * Sleep for specified duration.
 * @param {number} durationMs
 * @returns {Promise<void>}
 */
export function sleep(durationMs) {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}

/**
 * Wait for prompt to be dispatched (appear in conversation).
 * @param {import("playwright").Page} page
 * @param {import("playwright").Locator} composer
 * @param {string} prompt
 */
export async function waitForPromptDispatch(page, composer, prompt) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < 10000) {
    const currentValue = await composer.evaluate((node) => {
      if ("value" in node) {
        return node.value || "";
      }

      return node.textContent || "";
    });

    if (!String(currentValue).includes(prompt)) {
      return;
    }

    if (/^https:\/\/chatgpt\.com\/(c\/|g\/[^/]+\/c\/)/.test(page.url())) {
      return;
    }

    await sleep(250);
  }
}

/**
 * Build bootstrap prompt for thread initialization.
 * @param {string} roleLabel
 * @returns {string}
 */
export function buildBootstrapPrompt(roleLabel) {
  const peerLabel = roleLabel === "A" ? "B" : "A";

  return [
    `You are reviewer ${roleLabel} in a two-model bridge rehearsal.`,
    "We are iterating on a browser-extension state machine.",
    "State machine: idle -> ready -> running -> paused -> stopped / error.",
    `Start from the ${roleLabel} perspective, mention one interaction with ${peerLabel}, and suggest one improvement to the state machine.`,
    "Keep it concise.",
    "End with [CONTINUE]."
  ].join(" ");
}

/**
 * Dump diagnostics for bootstrap failures.
 * @param {import("playwright").Page} page
 * @param {string} seedLabel
 */
export async function dumpBootstrapDiagnostics(page, seedLabel) {
  const diagnosticsDir = path.resolve(process.cwd(), "tmp");
  const screenshotPath = path.join(diagnosticsDir, `e2e-${seedLabel}.png`);
  const textPath = path.join(diagnosticsDir, `e2e-${seedLabel}.txt`);

  await page.screenshot({
    fullPage: true,
    path: screenshotPath
  }).catch(() => {});

  const snapshot = await page.evaluate(() => {
    const buttonSummary = Array.from(document.querySelectorAll("button"))
      .slice(0, 40)
      .map((button) => {
        return {
          text: button.textContent?.trim() ?? "",
          ariaLabel: button.getAttribute("aria-label") ?? "",
          disabled:
            button.disabled === true || button.getAttribute("aria-disabled") === "true"
        };
      });

    return {
      buttons: buttonSummary,
      title: document.title,
      url: window.location.href,
      text: document.body?.innerText?.slice(0, 4000) ?? ""
    };
  }).catch(() => ({
    title: "",
    url: page.url(),
    text: ""
  }));

  const payload = [
    `label: ${seedLabel}`,
    `title: ${snapshot.title}`,
    `url: ${snapshot.url}`,
    "",
    "buttons:",
    JSON.stringify(snapshot.buttons, null, 2),
    "",
    snapshot.text
  ].join("\n");

  await writeFile(textPath, payload, "utf8").catch(() => {});
  console.error(`Bootstrap diagnostics written: ${screenshotPath}`);
  console.error(`Bootstrap diagnostics written: ${textPath}`);
}

/**
 * Get extension ID from overlay element.
 * @param {import("playwright").Page} page
 * @returns {Promise<string>}
 */
export async function getExtensionId(page) {
  const extensionId = await page.locator(".chatgpt-bridge-overlay").evaluate((node) => {
    return node.dataset.extensionId || "";
  });
  assert.ok(extensionId, "Expected overlay to expose extension id");
  return extensionId;
}

/**
 * Open popup page for the extension.
 * @param {import("playwright").BrowserContext} context
 * @param {string} extensionId
 * @returns {Promise<import("playwright").Page>}
 */
export async function openPopup(context, extensionId) {
  const popupPage = await context.newPage();
  await popupPage.goto(`chrome-extension://${extensionId}/popup.html`, {
    waitUntil: "domcontentloaded"
  });
  return popupPage;
}

/**
 * Read all critical state from popup.
 * @param {import("playwright").Page} popupPage
 * @returns {Promise<Object>}
 */
export async function readPopupState(popupPage) {
  return await popupPage.evaluate(() => {
    const getText = (selector) => {
      const el = document.querySelector(selector);
      return el ? el.textContent?.trim() : null;
    };

    const getAttr = (selector, attr) => {
      const el = document.querySelector(selector);
      return el ? el.getAttribute(attr) : null;
    };

    return {
      phase: getAttr("#phaseBadge", "data-phase"),
      bindingA: getText("#bindingA"),
      bindingB: getText("#bindingB"),
      round: getText("#roundValue"),
      nextHop: getText("#nextHopValue"),
      currentStep: getText("#currentStepValue"),
      lastIssue: getText("#lastIssueValue"),
      pauseDisabled: getAttr("#pauseButton", "disabled"),
      resumeDisabled: getAttr("#resumeButton", "disabled"),
      stopDisabled: getAttr("#stopButton", "disabled"),
      overrideDisabled: getAttr("#overrideSelect", "disabled")
    };
  });
}

/**
 * Read all critical state from overlay.
 * @param {import("playwright").Page} page
 * @returns {Promise<Object>}
 */
export async function readOverlayState(page) {
  return await page.evaluate(() => {
    const overlay = document.querySelector(".chatgpt-bridge-overlay");
    if (!overlay) return null;

    const getText = (selector) => {
      const el = overlay.querySelector(selector);
      return el ? el.textContent?.trim() : null;
    };

    const getAttr = (selector, attr) => {
      const el = overlay.querySelector(selector);
      return el ? el.getAttribute(attr) : null;
    };

    return {
      phase: getAttr("[data-phase]", "data-phase"),
      binding: getText("[data-binding]"),
      round: getText("[data-round]"),
      nextHop: getText("[data-next-hop]"),
      currentStep: getText("[data-step]"),
      lastIssue: getText("[data-issue]"),
      startDisabled: getAttr("[data-action='start']", "disabled"),
      pauseDisabled: getAttr("[data-action='pause']", "disabled"),
      resumeDisabled: getAttr("[data-action='resume']", "disabled"),
      stopDisabled: getAttr("[data-action='stop']", "disabled")
    };
  });
}

/**
 * Compare popup and overlay state for consistency.
 * @param {Object} popupState
 * @param {Object} overlayState
 * @returns {Object} - { consistent: boolean, mismatches: string[] }
 */
export function compareStates(popupState, overlayState) {
  const mismatches = [];
  const fields = ["phase", "round", "nextHop", "currentStep", "lastIssue"];

  for (const field of fields) {
    const popupVal = popupState[field];
    const overlayVal = overlayState[field];
    if (popupVal !== overlayVal) {
      mismatches.push(`${field}: popup="${popupVal}" vs overlay="${overlayVal}"`);
    }
  }

  return {
    consistent: mismatches.length === 0,
    mismatches
  };
}

/**
 * Assert state consistency with helpful error.
 * @param {Object} popupState
 * @param {Object} overlayState
 */
export function assertStatesConsistent(popupState, overlayState) {
  const result = compareStates(popupState, overlayState);
  if (!result.consistent) {
    assert.fail(`State mismatch: ${result.mismatches.join(", ")}`);
  }
}