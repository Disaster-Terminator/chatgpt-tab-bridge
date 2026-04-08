/**
 * Shared Playwright helpers for ChatGPT Tab Bridge E2E tests.
 * Extracted from semi-bridge-playwright.mjs - behavior unchanged.
 */

import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, readFile, access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import { chromium } from "playwright";

import { parseChatGptThreadUrl } from "../src/extension/core/chatgpt-url.mjs";

// ===== AUTH STATE CONSTANTS =====

/**
 * Default auth state file paths.
 * These are relative to cwd and resolve to absolute paths.
 */
export const DEFAULT_AUTH_PATHS = {
  storageState: "playwright/.auth/chatgpt.json",
  sessionStorage: "playwright/.auth/chatgpt.session.json"
};

/**
 * Resolve auth options from CLI arguments.
 * @param {Object} options
 * @param {string} [options.authStateArg] - CLI flag value for --auth-state
 * @param {string} [options.sessionStateArg] - CLI flag value for --session-state
 * @returns {{ storageStatePath: string|null, sessionStoragePath: string|null, useAuth: boolean }}
 */
export function resolveAuthOptions(options = {}) {
  const { authStateArg, sessionStateArg } = options;
  
  const cwd = process.cwd();
  
  // Resolve storageState path
  let storageStatePath = null;
  if (authStateArg) {
    storageStatePath = path.isAbsolute(authStateArg) 
      ? authStateArg 
      : path.resolve(cwd, authStateArg);
  } else {
    // Use default path
    storageStatePath = path.resolve(cwd, DEFAULT_AUTH_PATHS.storageState);
  }
  
  // Resolve sessionStorage path
  let sessionStoragePath = null;
  if (sessionStateArg) {
    sessionStoragePath = path.isAbsolute(sessionStateArg)
      ? sessionStateArg
      : path.resolve(cwd, sessionStateArg);
  } else {
    // Use default path (derived from storageState path directory)
    sessionStoragePath = path.resolve(cwd, DEFAULT_AUTH_PATHS.sessionStorage);
  }
  
  return {
    storageStatePath,
    sessionStoragePath,
    useAuth: true // Always use auth if files exist and are valid
  };
}

/**
 * Validate that auth files exist and are readable.
 * @param {string} storageStatePath
 * @param {string} sessionStoragePath
 * @returns {{ valid: boolean, storageStateExists: boolean, sessionStorageExists: boolean, error?: string }}
 */
export async function validateAuthFiles(storageStatePath, sessionStoragePath) {
  const results = {
    valid: false,
    storageStateExists: false,
    sessionStorageExists: false,
    error: undefined
  };
  
  // Check storageState
  try {
    await access(storageStatePath);
    results.storageStateExists = true;
  } catch {
    results.error = `Auth state file not found: ${storageStatePath}`;
    return results;
  }
  
  // Check sessionStorage (optional - may not exist)
  try {
    await access(sessionStoragePath);
    results.sessionStorageExists = true;
  } catch {
    // sessionStorage is optional - this is OK
    results.sessionStorageExists = false;
  }
  
  results.valid = true;
  return results;
}

/**
 * Load sessionStorage data from file.
 * @param {string} sessionStoragePath
 * @returns {Promise<Object|null>} - Parsed sessionStorage object or null if file doesn't exist
 */
export async function loadSessionStorageData(sessionStoragePath) {
  try {
    const content = await readFile(sessionStoragePath, "utf8");
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * Launch Playwright browser with extension loaded.
 * @param {Object} options
 * @param {string} [options.extensionPath] - Path to extension dist
 * @param {string} [options.browserExecutablePath] - Custom browser path
 * @param {string} [options.storageStatePath] - Path to Playwright storageState JSON file
 * @param {Object} [options.sessionStorageData] - sessionStorage data to restore
 * @returns {Promise<{context: import("playwright").BrowserContext, userDataDir: string, sessionStorageData: Object|null}>}
 */
export async function launchBrowserWithExtension(options = {}) {
  const extensionPath = options.extensionPath || path.resolve(process.cwd(), "dist/extension");
  const browserExecutablePath = options.browserExecutablePath || null;
  const storageStatePath = options.storageStatePath || null;
  const sessionStorageData = options.sessionStorageData || null;

  const userDataDir = await mkdtemp(path.join(os.tmpdir(), "chatgpt-bridge-e2e-"));

  // Build launch options
  const launchOptions = {
    headless: false,
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
    ...(browserExecutablePath ? { executablePath: browserExecutablePath } : {}),
    ...(storageStatePath ? { storageState: storageStatePath } : {}),
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-blink-features=AutomationControlled",
      "--enable-unsafe-extension-debugging"
    ]
  };

  const context = await chromium.launchPersistentContext(userDataDir, launchOptions);

  // Return sessionStorage data for later restoration if needed
  return { context, userDataDir, sessionStorageData };
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
 * Restore sessionStorage data on a page after navigation.
 * Call this after page.goto() for ChatGPT pages to restore session state.
 * @param {import("playwright").Page} page
 * @param {Object} sessionStorageData - Key-value pairs to set in sessionStorage
 */
export async function restoreSessionStorage(page, sessionStorageData) {
  if (!sessionStorageData || Object.keys(sessionStorageData).length === 0) {
    return;
  }

  await page.evaluate((data) => {
    for (const [key, value] of Object.entries(data)) {
      try {
        sessionStorage.setItem(key, value);
      } catch {
        // Ignore sessionStorage errors (e.g., quota exceeded)
      }
    }
  }, sessionStorageData);
}

/**
 * Add sessionStorage restoration as an init script to a context.
 * This will automatically restore sessionStorage when pages navigate.
 * @param {import("playwright").BrowserContext} context
 * @param {Object} sessionStorageData - Key-value pairs to restore
 */
export function addSessionStorageInitScript(context, sessionStorageData) {
  if (!sessionStorageData || Object.keys(sessionStorageData).length === 0) {
    return;
  }

  const script = `
    () => {
      const sessionData = ${JSON.stringify(sessionStorageData)};
      try {
        for (const [key, value] of Object.entries(sessionData)) {
          sessionStorage.setItem(key, value);
        }
      } catch {
        // Ignore - sessionStorage may be blocked
      }
    }
  `;

  context.addInitScript(script);
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
 * Waits for button to be enabled, clicks with fallback, then confirms
 * bind success via the button's data-active attribute (locale-agnostic).
 * @param {import("playwright").Page} page
 * @param {"A"|"B"} role
 */
export async function clickOverlayBind(page, role) {
  const selector = `.chatgpt-bridge-overlay:not([hidden]) [data-bind-role="${role}"]`;
  const bindButton = page.locator(selector).first();

  // Wait for currentTabId to be ready before attempting bind
  await page.waitForFunction(
    () => {
      const el = document.querySelector(".chatgpt-bridge-overlay");
      return el?.dataset?.tabId !== "";
    },
    { timeout: 10000 }
  );

  const isAlreadyActive = await page
    .evaluate((targetRole) => {
      const btn = document.querySelector(`.chatgpt-bridge-overlay:not([hidden]) [data-bind-role="${targetRole}"]`);
      return btn?.getAttribute("data-active") === "true";
    }, role)
    .catch(() => false);

  if (isAlreadyActive) {
    return;
  }

  await bindButton.waitFor({ state: "visible", timeout: 30000 });
  const enabled = await waitForEnabledButton(bindButton, 15000);
  if (!enabled) {
    throw new Error(
      `Overlay bind button for role ${role} never became enabled within 15s. ` +
      `Bind handshake cannot proceed.`
    );
  }

  try {
    await bindButton.click({ force: true, timeout: 5000 });
  } catch {
    await bindButton.evaluate((node) => node.click()).catch(() => {});
  }

  // Post-click confirmation: check data-active attribute (locale-agnostic)
  await page
    .waitForFunction(
      ({ targetRole }) => {
        const btn = document.querySelector(`.chatgpt-bridge-overlay:not([hidden]) [data-bind-role="${targetRole}"]`);
        return btn?.getAttribute("data-active") === "true";
      },
      { targetRole: role },
      { timeout: 15000 }
    )
    .catch(async () => {
      const debug = await page.evaluate(() => {
        const roleText = document.querySelector('.chatgpt-bridge-overlay:not([hidden]) [data-slot="role"]')?.textContent?.trim() || "missing";
        const issue = document.querySelector('[data-slot="issue"]')?.textContent?.trim() || "";
        const a = document.querySelector('[data-bind-role="A"]')?.getAttribute('data-active') || "missing";
        const b = document.querySelector('[data-bind-role="B"]')?.getAttribute('data-active') || "missing";
        return { roleText, issue, a, b };
      });
      throw new Error(
        `Overlay bind for role ${role} did not become active within 15s. ` +
          `Bind handshake failed. roleText='${debug.roleText}', issue='${debug.issue}', activeA='${debug.a}', activeB='${debug.b}'`
      );
    });
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
 * Bootstrap an anonymous ChatGPT thread with a prompt.
 * Supports two success modes:
 * 1. Persistent URL: URL transitions to /c/<id> or /g/.../c/<id>
 * 2. Live session: Page shows seed acceptance evidence without URL transition
 * @param {import("playwright").Page} page
 * @param {string} seedLabel
 * @param {string} prompt
 */
export async function bootstrapAnonymousThread(page, seedLabel, prompt) {
  await dismissCookieBanner(page);

  try {
    const composer = await findComposer(page);
    await composer.waitFor({ state: "visible", timeout: 30000 });

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

    await dismissCookieBanner(page);

    const sendButton = page
      .locator('button[data-testid="send-button"], button[aria-label*="Send"], button[aria-label*="发送"], form button[type="submit"]')
      .first();

    let dispatched = false;
    if (await sendButton.count()) {
      const clickable = await waitForEnabledButton(sendButton, 5000);
      if (clickable) {
        try {
          await sendButton.click({ force: true, timeout: 5000 });
        } catch {
        }

        dispatched = await waitForPromptDispatch(page, composer, prompt);
        if (!dispatched) {
          await sendButton.evaluate((node) => node.click()).catch(() => {});
          dispatched = await waitForPromptDispatch(page, composer, prompt);
        }

        if (!dispatched) {
          await page.keyboard.press("Enter");
          dispatched = await waitForPromptDispatch(page, composer, prompt);
        }
      } else {
        await page.keyboard.press("Enter");
        dispatched = await waitForPromptDispatch(page, composer, prompt);
      }
    } else {
      await page.keyboard.press("Enter");
      dispatched = await waitForPromptDispatch(page, composer, prompt);
    }

    if (!dispatched) {
      throw new Error("seed_prompt_not_dispatched");
    }

    const baselineUserCount = await getUserMessageCount(page);

    const [hasSupportedUrl, hasAcceptanceEvidence] = await Promise.all([
      waitForSupportedThreadUrlWithTimeout(page, 30000),
      waitForAcceptanceEvidenceWithTimeout(page, baselineUserCount, 30000)
    ]);

    if (hasSupportedUrl) {
      const locator = page.locator('[data-message-author-role="assistant"]').last();
      try {
        await locator.waitFor({ state: "visible", timeout: 15000 });
      } catch {
      }
      return { mode: "persistent_url", url: page.url() };
    }

    if (hasAcceptanceEvidence) {
      return { mode: "live_session", url: page.url() };
    }

    throw new Error("bootstrap_timeout_no_evidence");

  } catch (bootstrapError) {
    const url = page.url();
    const parsed = parseChatGptThreadUrl(url);
    const hasSupportedUrl = parsed.supported;

    if (hasSupportedUrl) {
      return { mode: "persistent_url", url };
    }

    throw new Error(
      `Anonymous bootstrap failed for ${seedLabel}: ${bootstrapError.message}. ` +
      `Root page cannot be bound directly. Bootstrap two threads first or provide existing thread URLs via --url-a and --url-b.`
    );
  }
}

async function getUserMessageCount(page) {
  return await page.evaluate(() => {
    const candidates = document.querySelectorAll('[data-message-author-role="user"]');
    return candidates.length;
  });
}

async function waitForAcceptanceEvidenceWithTimeout(page, baselineUserCount, timeoutMs) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const currentUserCount = await getUserMessageCount(page);
    if (currentUserCount > baselineUserCount) {
      return true;
    }

    const generating = await page.evaluate(() => {
      return Boolean(
        document.querySelector('button[data-testid="stop-button"]') ||
        document.querySelector('button[data-testid="stop-generating-button"]')
      );
    });
    if (generating) {
      return true;
    }

    await sleep(500);
  }

  return false;
}

async function waitForSupportedThreadUrlWithTimeout(page, timeoutMs) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const url = page.url();
    const parsed = parseChatGptThreadUrl(url);

    if (parsed.supported) {
      return true;
    }

    await sleep(500);
  }

  return false;
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

  await dismissCookieBanner(page);

  const sendButton = page
    .locator('button[data-testid="send-button"], button[aria-label*="Send"], button[aria-label*="发送"], form button[type="submit"]')
    .first();

  let dispatched = false;
  if (await sendButton.count()) {
    const clickable = await waitForEnabledButton(sendButton, 5000);
    if (clickable) {
      try {
        await sendButton.click({ force: true, timeout: 5000 });
      } catch {
        // Fall through to alternative submit paths.
      }

      dispatched = await waitForPromptDispatch(page, composer, prompt);
      if (!dispatched) {
        await sendButton.evaluate((node) => node.click()).catch(() => {});
        dispatched = await waitForPromptDispatch(page, composer, prompt);
      }

      if (!dispatched) {
        await page.keyboard.press("Enter");
        dispatched = await waitForPromptDispatch(page, composer, prompt);
      }
    }
  }

  if (!dispatched) {
    await page.keyboard.press("Enter");
    dispatched = await waitForPromptDispatch(page, composer, prompt);
  }

  if (!dispatched) {
    throw new Error("prompt_not_dispatched");
  }
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
 * Wait for assistant reply to be settled (generation stopped + text stable).
 * Used before collecting baseline to ensure source payload is ready for relay.
 * @param {import("playwright").Page} page
 * @param {string} seedLabel
 * @returns {Promise<string>} The settled assistant reply text
 */
export async function waitForSettledAssistantReply(page, seedLabel) {
  const locator = page.locator('[data-message-author-role="assistant"]').last();

  await locator.waitFor({ state: "visible", timeout: 60000 });

  const startedAt = Date.now();
  const stabilityWindowMs = 3000;
  let lastText = "";
  let lastStableTime = 0;

  while (Date.now() - startedAt < 60000) {
    const isGenerating = await page.evaluate(() => {
      const stopBtn = document.querySelector('button[data-testid="stop-generating-button"]') ||
                      document.querySelector('button[data-testid="stop-button"]');
      return Boolean(stopBtn);
    });

    if (isGenerating) {
      await page.waitForTimeout(1500);
      continue;
    }

    const currentText = (await locator.innerText()).trim();

    if (currentText && currentText === lastText) {
      if (lastStableTime === 0) {
        lastStableTime = Date.now();
      } else if (Date.now() - lastStableTime >= stabilityWindowMs) {
        return currentText;
      }
    } else {
      lastText = currentText;
      lastStableTime = 0;
    }

    await page.waitForTimeout(1500);
  }

  await dumpBootstrapDiagnostics(page, seedLabel);
  throw new Error("Timed out waiting for settled assistant reply (generation stopped + text stable).");
}

/**
 * Wait for URL to become a supported thread URL.
 * Uses canonical parser for consistent semantics.
 * Note: Diagnostics already dumped in waitUntilSupportedThreadUrl on timeout.
 * @param {import("playwright").Page} page
 */
export async function waitForSupportedThreadUrl(page) {
  try {
    // Use polling helper to wait for URL transition
    // Diagnostics are dumped inside waitUntilSupportedThreadUrl on timeout
    await waitUntilSupportedThreadUrl(page, 20000);
  } catch (error) {
    // Don't dump again - already done in waitUntilSupportedThreadUrl
    const url = page.url();
    const parsed = parseChatGptThreadUrl(url);
    throw new Error(
      `Anonymous bootstrap did not transition to a supported thread URL. ` +
      `Current URL: ${url} (${parsed.reason}). ` +
      `Root page cannot be bound directly. Provide existing thread URLs via --url-a and --url-b.`
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

  let dismissedAny = false;
  for (const selector of selectors) {
    const button = page.locator(selector).first();
    if (await button.count()) {
      try {
        await button.click({ force: true, timeout: 2000 });
      } catch {
        await button.evaluate((node) => node.click()).catch(() => {});
      }

      dismissedAny = true;
      await page.waitForTimeout(300);
    }
  }

  if (!dismissedAny) {
    return;
  }

  await page
    .evaluate(() => {
      const targets = [
        "拒绝非必需",
        "全部接受",
        "Reject non-essential",
        "Accept all",
        "Manage Cookie"
      ];

      for (const button of Array.from(document.querySelectorAll("button"))) {
        const text = button.textContent?.trim() || "";
        if (targets.includes(text)) {
          button.click();
        }
      }
    })
    .catch(() => {});

  await page.waitForTimeout(300);
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
 * Check if current URL is a supported thread URL using canonical parser.
 * @param {import("playwright").Page} page
 * @returns {Promise<boolean>}
 */
export async function isSupportedThreadUrl(page) {
  const url = page.url();
  const parsed = parseChatGptThreadUrl(url);
  return parsed.supported;
}

/**
 * Assert that current URL is a supported thread URL, fail if not.
 * Uses canonical parser for consistent semantics.
 * @param {import("playwright").Page} page
 * @param {string} label - Label for error message (e.g., "pageA", "pageB")
 */
export async function assertSupportedThreadUrl(page, label) {
  const url = page.url();
  const parsed = parseChatGptThreadUrl(url);
  
  if (!parsed.supported) {
    throw new Error(
      `Root page cannot be bound directly for ${label}. ` +
      `Current URL: ${url} (${parsed.reason}). ` +
      `Bootstrap two threads first (send prompts and wait for /c/ or /g/.../c/ URLs) ` +
      `or provide existing thread URLs via --url-a and --url-b.`
    );
  }
}

/**
 * Check if page has at least some session evidence (user message or generation).
 * Returns true if the page has been used for a conversation.
 * @param {import("playwright").Page} page
 * @returns {Promise<boolean>}
 */
export async function hasSessionEvidence(page) {
  return await page.evaluate(() => {
    const userMessages = document.querySelectorAll('[data-message-author-role="user"]');
    if (userMessages.length > 0) {
      return true;
    }

    const generating = document.querySelector('button[data-testid="stop-button"]') ||
      document.querySelector('button[data-testid="stop-generating-button"]');
    return Boolean(generating);
  });
}

/**
 * Wait until URL becomes a supported thread URL using canonical parser polling.
 * @param {import("playwright").Page} page
 * @param {number} timeoutMs - Timeout in milliseconds
 * @returns {Promise<void>}
 */
export async function waitUntilSupportedThreadUrl(page, timeoutMs = 20000) {
  const startedAt = Date.now();
  
  while (Date.now() - startedAt < timeoutMs) {
    const url = page.url();
    const parsed = parseChatGptThreadUrl(url);
    
    if (parsed.supported) {
      return; // Success
    }
    
    await sleep(500); // Poll every 500ms
  }
  
  // Timeout - final check and throw
  await dumpBootstrapDiagnostics(page, "thread-url");
  const url = page.url();
  const parsed = parseChatGptThreadUrl(url);
  throw new Error(
    `URL did not transition to supported thread URL within ${timeoutMs}ms. ` +
    `Current URL: ${url} (${parsed.reason}). ` +
    `Root page cannot be bound directly. Provide existing thread URLs via --url-a and --url-b.`
  );
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
      return true;
    }

    // Use canonical parser to check if URL is a supported thread
    const parsed = parseChatGptThreadUrl(page.url());
    if (parsed.supported) {
      return true;
    }

    await sleep(250);
  }

  return false;
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

/**
 * Read current tab id from the overlay DOM in page context.
 * @param {import("playwright").Page} page - Page with overlay injected
 * @returns {Promise<{tabId: number, error?: string}>}
 */
export async function getTabIdFromPage(page) {
  try {
    const result = await page.evaluate(async () => {
      const overlay = document.querySelector(`.chatgpt-bridge-overlay`);
      if (!overlay) {
        return { error: "Overlay not found" };
      }
      const tabIdAttr = overlay.dataset.tabId;
      if (!tabIdAttr) {
        return { error: "No tabId in overlay dataset" };
      }
      const tabId = parseInt(tabIdAttr, 10);
      if (isNaN(tabId)) {
        return { error: "Invalid tabId: " + tabIdAttr };
      }
      return { tabId };
    });
    return result;
  } catch (error) {
    return { error: error.message };
  }
}

/**
 * Send SET_BINDING from popup page runtime context.
 * @param {import("playwright").Page} popupPage - The extension popup page
 * @param {"A"|"B"} role - Role to bind
 * @param {number} tabId - Tab id to bind
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
export async function bindFromPopup(popupPage, role, tabId) {
  try {
    const result = await popupPage.evaluate(async ({ role: targetRole, tabId: targetTabId }) => {
      try {
        const response = await chrome.runtime.sendMessage({
          type: "SET_BINDING",
          role: targetRole,
          tabId: targetTabId
        });
        return { ok: response.ok, error: response.error };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    }, { role, tabId });
    return result;
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

/**
 * Bind a page role by reading tab id from page DOM then sending SET_BINDING from popup.
 * @param {import("playwright").Page} page - Page with overlay injected
 * @param {import("playwright").Page} popupPage - The extension popup page
 * @param {"A"|"B"} role - Role to bind
 * @returns {Promise<{ok: boolean, tabId?: number, error?: string}>}
 */
export async function bindFromPage(page, popupPage, role) {
  // Step 1: Read tabId from page DOM
  const tabIdResult = await getTabIdFromPage(page);
  if (tabIdResult.error) {
    return { ok: false, error: "getTabIdFromPage: " + tabIdResult.error };
  }

  const tabId = tabIdResult.tabId;

  // Step 2: Send SET_BINDING from popup context
  const bindResult = await bindFromPopup(popupPage, role, tabId);

  return {
    ok: bindResult.ok,
    error: bindResult.error,
    tabId: tabId,
    role: role
  };
}

/**
 * Get real runtime state from the popup page context.
 * The popup is an extension page with full chrome.runtime access,
 * unlike chatgpt.com pages which Playwright isolates.
 * @param {import("playwright").Page} popupPage - The extension popup page
 * @returns {Promise<{phase: string, bindings: {A: unknown, B: unknown}, error?: string}>}
 */
export async function getRuntimeState(popupPage) {
  try {
    const result = await popupPage.evaluate(async () => {
      try {
        const response = await chrome.runtime.sendMessage({
          type: "GET_RUNTIME_STATE"
        });
        if (!response.ok) {
          return { error: response.error };
        }
        const state = response.result;
        return {
          phase: state?.phase || "unknown",
          bindings: {
            A: state?.bindings?.A,
            B: state?.bindings?.B
          }
        };
      } catch (error) {
        return { error: error.message };
      }
    });

    return result;
  } catch (error) {
    return { phase: "error", error: error.message };
  }
}

/**
 * Check if bindings are established by querying popup model via the popup page.
 * @param {import("playwright").Page} popupPage - The extension popup page
 * @returns {Promise<{bindingA: boolean, bindingB: boolean, phase: string}>}
 */
export async function checkBindingsViaPopupPage(popupPage) {
  try {
    const result = await popupPage.evaluate(async () => {
      try {
        const response = await chrome.runtime.sendMessage({
          type: "GET_POPUP_MODEL"
        });
        if (!response.ok) {
          return { error: response.error };
        }
        const model = response.result;
        return {
          bindingA: model?.state?.bindings?.A !== null && model?.state?.bindings?.A !== undefined,
          bindingB: model?.state?.bindings?.B !== null && model?.state?.bindings?.B !== undefined,
          phase: model?.state?.phase || "unknown"
        };
      } catch (error) {
        return { error: error.message };
      }
    });

    return result;
  } catch (error) {
    return { bindingA: false, bindingB: false, phase: "error", error: error.message };
  }
}

/**
 * Fetch runtime events from popup page context (has proper chrome.runtime access).
 * @param {import("playwright").Page} popupPage - The extension popup page
 * @returns {Promise<{ok: boolean, events: unknown[], error?: string}>}
 */
export async function fetchRuntimeEventsFromPopup(popupPage) {
  try {
    const result = await popupPage.evaluate(async () => {
      try {
        const response = await chrome.runtime.sendMessage({
          type: "GET_RECENT_RUNTIME_EVENTS"
        });
        if (response && response.ok === true && Array.isArray(response.result)) {
          return { ok: true, events: response.result };
        }
        return { ok: false, events: [], error: response?.error || "invalid_response" };
      } catch (error) {
        return { ok: false, events: [], error: error instanceof Error ? error.message : String(error) };
      }
    });
    return result;
  } catch (error) {
    return { ok: false, events: [], error: error.message };
  }
}
