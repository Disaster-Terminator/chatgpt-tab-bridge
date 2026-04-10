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
 * These are kept for explicit auth workflows only.
 */
export const DEFAULT_AUTH_PATHS = {
  storageState: "playwright/.auth/chatgpt.cdp.storage.json",
  sessionStorage: "playwright/.auth/chatgpt.cdp.session.json"
};

export const DEFAULT_CDP_ENDPOINT = "http://127.0.0.1:9333";
export const DEFAULT_CDP_CONNECT_TIMEOUT_MS = 60000;
export const DEFAULT_PLAYWRIGHT_PROFILE_DIR = path.resolve(
  process.env.HOME || process.cwd(),
  ".chatgpt-playwright-profile"
);

/**
 * Resolve browser connection strategy from CLI/env.
 * CDP attach is the new recommended path; persistent context launch remains
 * as a compatibility path.
 * @param {Object} options
 * @param {string|null} [options.cdpEndpointArg]
 * @param {boolean} [options.reuseOpenChatgptTab]
 * @param {boolean} [options.noNavOnAttach]
 * @returns {{
 *   mode: "persistent"|"cdp",
 *   cdpEndpoint: string|null,
 *   reuseOpenChatgptTab: boolean,
 *   noNavOnAttach: boolean,
 *   recommended: "cdp"|"persistent"
 * }}
 */
export function resolveBrowserStrategyFromCli(options = {}) {
  const cdpEndpoint =
    options.cdpEndpointArg || process.env.CHATGPT_CDP_ENDPOINT || null;

  return {
    mode: cdpEndpoint ? "cdp" : "persistent",
    cdpEndpoint,
    reuseOpenChatgptTab:
      options.reuseOpenChatgptTab !== undefined
        ? Boolean(options.reuseOpenChatgptTab)
        : true,
    noNavOnAttach:
      options.noNavOnAttach !== undefined
        ? Boolean(options.noNavOnAttach)
        : true,
    recommended: cdpEndpoint ? "cdp" : "persistent"
  };
}

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

  const useAuth = Boolean(authStateArg || sessionStateArg);

  let storageStatePath = null;
  if (authStateArg) {
    storageStatePath = path.isAbsolute(authStateArg)
      ? authStateArg
      : path.resolve(cwd, authStateArg);
  }

  let sessionStoragePath = null;
  if (sessionStateArg) {
    sessionStoragePath = path.isAbsolute(sessionStateArg)
      ? sessionStateArg
      : path.resolve(cwd, sessionStateArg);
  }

  return {
    storageStatePath,
    sessionStoragePath,
    useAuth
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
    valid: true,
    storageStateExists: false,
    sessionStorageExists: false,
    error: undefined
  };

  if (storageStatePath) {
    try {
      await access(storageStatePath);
      results.storageStateExists = true;
    } catch {
      results.valid = false;
      results.error = `Auth state file not found: ${storageStatePath}`;
      return results;
    }
  }

  if (sessionStoragePath) {
    try {
      await access(sessionStoragePath);
      results.sessionStorageExists = true;
    } catch {
      results.valid = false;
      results.error = `Session storage file not found: ${sessionStoragePath}`;
      return results;
    }
  }

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
  const usePlaywrightChromiumChannel = Boolean(storageStatePath && !browserExecutablePath);
  const persistentProfileDir = options.userDataDir || process.env.CHATGPT_PLAYWRIGHT_PROFILE_DIR || null;

  const userDataDir = persistentProfileDir || await mkdtemp(path.join(os.tmpdir(), "chatgpt-bridge-e2e-"));

  // Build launch options
  const launchOptions = {
    headless: false,
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
    ...(usePlaywrightChromiumChannel ? { channel: "chromium" } : {}),
    ...(browserExecutablePath ? { executablePath: browserExecutablePath } : {}),
    ...(storageStatePath ? { storageState: storageStatePath } : {}),
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--password-store=basic",
      "--disable-blink-features=AutomationControlled",
      "--enable-unsafe-extension-debugging"
    ]
  };

  const context = await chromium.launchPersistentContext(userDataDir, launchOptions);

  // Return sessionStorage data for later restoration if needed
  return { context, userDataDir, sessionStorageData };
}

/**
 * Connect to browser either by launching a fresh persistent context or by
 * attaching to an already-running CDP browser.
 * @param {Object} options
 * @param {string} [options.extensionPath]
 * @param {string} [options.browserExecutablePath]
 * @param {string|null} [options.storageStatePath]
 * @param {Object|null} [options.sessionStorageData]
 * @param {{mode:"persistent"|"cdp", cdpEndpoint:string|null, reuseOpenChatgptTab:boolean, noNavOnAttach:boolean}} [options.strategy]
 * @returns {Promise<{
 *   browser: import("playwright").Browser | null,
 *   context: import("playwright").BrowserContext,
 *   userDataDir: string | null,
 *   sessionStorageData: Object | null,
 *   strategy: {mode:"persistent"|"cdp", cdpEndpoint:string|null, reuseOpenChatgptTab:boolean, noNavOnAttach:boolean},
 *   cleanupMode: "close-context"|"disconnect-browser"
 * }>} 
 */
export async function connectBrowserWithExtensionOrCdp(options = {}) {
  const strategy =
    options.strategy ||
    resolveBrowserStrategyFromCli({
      cdpEndpointArg: options.cdpEndpointArg || null,
      reuseOpenChatgptTab: options.reuseOpenChatgptTab,
      noNavOnAttach: options.noNavOnAttach
    });

  if (strategy.mode === "cdp") {
    const browser = await chromium.connectOverCDP(strategy.cdpEndpoint, {
      timeout: DEFAULT_CDP_CONNECT_TIMEOUT_MS
    });
    const contexts = browser.contexts();
    const context = contexts[0];

    if (!context) {
      await browser.close().catch(() => {});
      throw new Error(
        `CDP attach succeeded but no browser contexts were available at ${strategy.cdpEndpoint}.`
      );
    }

    return {
      browser,
      context,
      userDataDir: null,
      sessionStorageData: null,
      strategy,
      cleanupMode: "disconnect-browser"
    };
  }

  const launched = await launchBrowserWithExtension(options);
  return {
    browser: null,
    context: launched.context,
    userDataDir: launched.userDataDir,
    sessionStorageData: launched.sessionStorageData,
    strategy,
    cleanupMode: "close-context"
  };
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
 * Cleanup browser resources from either persistent launch or CDP attach.
 * @param {Object} connection
 * @param {import("playwright").BrowserContext} connection.context
 * @param {import("playwright").Browser|null} [connection.browser]
 * @param {string|null} [connection.userDataDir]
 * @param {"close-context"|"disconnect-browser"} [connection.cleanupMode]
 */
export async function cleanupBrowserConnection(connection) {
  if (!connection) {
    return;
  }

  if (connection.cleanupMode === "disconnect-browser") {
    // In CDP attach mode, close only the Playwright transport connection and
    // leave the user's real browser/profile running.
    try {
      connection.browser?._connection?.close?.();
    } catch {
      // Ignore detach errors in CDP mode.
    }
    return;
  }

  await cleanupBrowser(connection.context, connection.userDataDir);
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
 * For auth-backed replay flows, sessionStorage may need a reload cycle before
 * the page fully reflects the restored state.
 * @param {import("playwright").Page} page
 * @param {Object|null} sessionStorageData
 */
export async function reloadAfterSessionRestore(page, sessionStorageData) {
  if (!sessionStorageData || Object.keys(sessionStorageData).length === 0) {
    return;
  }

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
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
export async function getTwoPages(context, options = {}) {
  const {
    reuseOpenChatgptTab = false,
    preserveExistingPages = false,
    noNavOnAttach = false
  } = options;

  const existingPages = context.pages();
  const chatGptPages = existingPages.filter((page) =>
    page.url().startsWith("https://chatgpt.com")
  );

  const candidates = reuseOpenChatgptTab ? chatGptPages : existingPages;
  const pageA = candidates[0] ?? (await context.newPage());
  const pageB = candidates[1] ?? (await context.newPage());

  if (!preserveExistingPages) {
    const retained = new Set([pageA, pageB]);
    for (const page of existingPages) {
      if (!retained.has(page)) {
        await page.close().catch(() => {});
      }
    }
  }

  if (!noNavOnAttach) {
    return [pageA, pageB];
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
 * Validate that auth state is still valid by checking if we can access chatgpt.com.
 * Fails fast with clear message if cookies are expired and redirect to login occurs.
 * @param {import("playwright").Page} page - A page from the context
 * @returns {{ valid: boolean, error?: string }}
 */
export async function validateAuthState(page) {
  try {
    // Navigate to chatgpt.com
    await page.goto("https://chatgpt.com", { 
      waitUntil: "domcontentloaded",
      timeout: 15000 
    });
    
    // Check if we were redirected to an auth page
    const currentUrl = page.url();
    const isAuthPage = currentUrl.includes("auth.openai.com") || 
                       currentUrl.includes("/log-in") ||
                       currentUrl.includes("/login") ||
                       currentUrl.includes("/signin");
    
    if (isAuthPage) {
      return {
        valid: false,
        error: `Auth carrier redirected to ${currentUrl}. Refresh carrier state with 'pnpm run auth:export:cdp-storage' or use manual browser:cdp-launch flow.`
      };
    }
    
    // Also check page content for login forms
    const hasLoginForm = await page.evaluate(() => {
      return document.querySelector('input[type="email"]') !== null ||
             document.querySelector('[data-testid="login"]') !== null ||
             document.querySelector('button:contains("Log in")') !== null ||
             document.querySelector('button:contains("Sign up")') !== null;
    }).catch(() => false);
    
    if (hasLoginForm) {
      return {
        valid: false,
        error: `Auth carrier hit a login form on ${currentUrl}. Refresh carrier state with 'pnpm run auth:export:cdp-storage' or use manual browser:cdp-launch flow.`
      };
    }
    
    return { valid: true };
  } catch (error) {
    return {
      valid: false,
      error: `Auth validation failed: ${error.message}`
    };
  }
}

/**
 * Validate auth on the current page without forcing a navigation.
 * Useful when the page itself is the carrier under test.
 * @param {import("playwright").Page} page
 * @returns {Promise<{ valid: boolean, error?: string, url?: string, title?: string, composerVisible?: boolean, accountVisible?: boolean }>}
 */
export async function validateCurrentPageAuthState(page) {
  try {
    const currentUrl = page.url();
    const title = await page.title().catch(() => "");

    const isAuthPage =
      currentUrl.includes("auth.openai.com") ||
      currentUrl.includes("/log-in") ||
      currentUrl.includes("/login") ||
      currentUrl.includes("/signin") ||
      currentUrl.includes("/log-in-or-create-account");

    if (isAuthPage) {
      return {
        valid: false,
        error: `Current page redirected to login: ${currentUrl}`,
        url: currentUrl,
        title
      };
    }

    const markers = await page.evaluate(() => {
      const accountVisible = Boolean(document.querySelector('button[data-testid="account-trigger"]'));
      const composerVisible = Boolean(document.querySelector('[contenteditable="true"][role="textbox"], textarea'));
      const sidebarVisible = Boolean(document.querySelector('[data-testid*="sidebar-history"]'));
      return { accountVisible, composerVisible, sidebarVisible };
    }).catch(() => ({ accountVisible: false, composerVisible: false, sidebarVisible: false }));

    if (markers.accountVisible || markers.composerVisible || markers.sidebarVisible) {
      return {
        valid: true,
        url: currentUrl,
        title,
        composerVisible: markers.composerVisible,
        accountVisible: markers.accountVisible
      };
    }

    return {
      valid: false,
      error: `Current page lacks authenticated markers: ${currentUrl}`,
      url: currentUrl,
      title,
      composerVisible: markers.composerVisible,
      accountVisible: markers.accountVisible
    };
  } catch (error) {
    return {
      valid: false,
      error: `Current page auth validation failed: ${error.message}`,
      url: page.url()
    };
  }
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
  const startedAt = Date.now();
  const stabilityWindowMs = 3000;
  let lastText = "";
  let lastHash = null;
  let lastStableTime = 0;

  while (Date.now() - startedAt < 60000) {
    let observation;
    try {
      observation = await collectThreadObservation(page);
    } catch {
      await page.waitForTimeout(1000);
      continue;
    }

    if (!observation.latestAssistantHash) {
      await page.waitForTimeout(1000);
      continue;
    }

    if (observation.generating) {
      lastText = observation.latestAssistantText || "";
      lastHash = observation.latestAssistantHash;
      lastStableTime = 0;
      await page.waitForTimeout(1500);
      continue;
    }

    const currentText = String(observation.latestAssistantText || "").trim();
    const currentHash = observation.latestAssistantHash;

    if (currentText && currentText === lastText && currentHash === lastHash) {
      if (lastStableTime === 0) {
        lastStableTime = Date.now();
      } else if (Date.now() - lastStableTime >= stabilityWindowMs) {
        return currentText;
      }
    } else {
      lastText = currentText;
      lastHash = currentHash;
      lastStableTime = 0;
    }

    await page.waitForTimeout(1500);
  }

  await dumpBootstrapDiagnostics(page, seedLabel);
  throw new Error("Timed out waiting for settled assistant reply (generation stopped + text stable).");
}

/**
 * Collect page-fact-first thread observation from a ChatGPT page.
 * Mirrors the real-hop harness baseline so live-session pages can be
 * verified without depending on persistent thread URLs.
 * @param {import("playwright").Page} page
 */
export async function collectThreadObservation(page) {
  return await page.evaluate(() => {
    const normalize = (value) => String(value || "").replace(/\r\n/g, "\n").replace(/\u00a0/g, " ").trim();
    const hashText = (value) => {
      const text = normalize(value);
      let hash = 2166136261;

      for (let index = 0; index < text.length; index += 1) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
      }

      return text ? `h${(hash >>> 0).toString(16)}` : null;
    };

    const userSelectors = [
      '[data-message-author-role="user"]',
      'article [data-message-author-role="user"]',
      '[data-testid*="conversation-turn"] [data-message-author-role="user"]',
      'main [data-message-author-role="user"]'
    ];

    const assistantSelectors = [
      '[data-message-author-role="assistant"]',
      'article [data-message-author-role="assistant"]',
      '[data-testid*="conversation-turn"] [data-message-author-role="assistant"]',
      'main [data-message-author-role="assistant"]'
    ];

    const composerSelectors = [
      '[contenteditable="true"][role="textbox"]',
      '[contenteditable="true"][data-testid*="composer"]',
      'textarea',
      'input'
    ];

    const findLatestBySelectors = (selectors) => {
      for (const selector of selectors) {
        const candidates = Array.from(document.querySelectorAll(selector)).filter((element) =>
          normalize(element.textContent || "")
        );
        if (candidates.length > 0) {
          return {
            text: normalize(candidates[candidates.length - 1].textContent || ""),
            count: candidates.length
          };
        }
      }

      return { text: "", count: 0 };
    };

    const findComposerNode = () => {
      for (const selector of composerSelectors) {
        const node = document.querySelector(selector);
        if (node) {
          return node;
        }
      }

      return null;
    };

    const readComposerText = (composer) => {
      if (!composer) {
        return "";
      }

      const tag = String(composer.tagName || "").toLowerCase();
      if (tag === "textarea" || tag === "input") {
        return normalize(composer.value || "");
      }

      return normalize(composer.textContent || "");
    };

    const composer = findComposerNode();
    const sendButton =
      composer?.closest?.("form")?.querySelector?.('button[type="submit"]') ||
      document.querySelector('#composer-submit-button') ||
      document.querySelector('button[data-testid="send-button"]') ||
      document.querySelector('button[aria-label*="Send"]') ||
      document.querySelector('button[aria-label*="发送"]');

    const latestUser = findLatestBySelectors(userSelectors);
    const latestAssistant = findLatestBySelectors(assistantSelectors);

    const generating = Boolean(
      document.querySelector('button[data-testid="stop-button"]') ||
        document.querySelector('button[data-testid="stop-generating-button"]') ||
        document.querySelector('button[aria-label*="Stop"]') ||
        document.querySelector('button[aria-label*="停止"]') ||
        document.querySelector('button[aria-label*="Cancel"]')
    );

    return {
      timestamp: new Date().toISOString(),
      generating,
      latestUserText: latestUser.text || null,
      latestUserHash: hashText(latestUser.text),
      userMessageCount: latestUser.count,
      latestAssistantText: latestAssistant.text || null,
      latestAssistantHash: hashText(latestAssistant.text),
      assistantMessageCount: latestAssistant.count,
      composerText: readComposerText(composer),
      sendButtonReady: Boolean(sendButton) && sendButton.disabled !== true,
      sendButtonVisible: Boolean(sendButton)
    };
  });
}

/**
 * Ensure a source page has settled assistant content available for the next hop.
 * @param {import("playwright").Page} page
 * @param {string} [prompt]
 */
export async function ensureSourceAssistantSeed(
  page,
  prompt = "Hello, respond briefly."
) {
  const baseline = await collectThreadObservation(page);
  if (baseline.latestAssistantHash) {
    return baseline;
  }

  await ensureComposer(page);
  await sendPrompt(page, prompt);
  await page.waitForTimeout(3000);
  await waitForSettledAssistantReply(page, "source-seed");
  return collectThreadObservation(page);
}

export class HarnessBlockerError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "HarnessBlockerError";
    this.code = code;
    this.details = details;
  }
}

export function isHarnessBlocker(error) {
  return Boolean(
    error &&
      error.name === "HarnessBlockerError" &&
      typeof error.code === "string"
  );
}

function isAnonymousLoginDiversionUrl(url) {
  const currentUrl = String(url || "");
  return (
    currentUrl.includes("auth.openai.com") ||
    currentUrl.includes("/log-in") ||
    currentUrl.includes("/login") ||
    currentUrl.includes("/signin") ||
    currentUrl.includes("/log-in-or-create-account")
  );
}

async function collectAnonymousSeedSnapshot(page) {
  const url = page.url();
  const title = await page.title().catch(() => "");
  const observation = await collectThreadObservation(page).catch(() => null);

  return {
    url,
    title,
    loginDiverted: isAnonymousLoginDiversionUrl(url),
    supportedThreadUrl: parseChatGptThreadUrl(url).supported,
    hasAssistantSeed: Boolean(observation?.latestAssistantHash),
    assistantHash: observation?.latestAssistantHash || null,
    assistantCount: observation?.assistantMessageCount ?? null,
    userCount: observation?.userMessageCount ?? null,
    generating: observation?.generating ?? null,
    composerVisible: observation ? Boolean(observation.sendButtonVisible) : null
  };
}

export async function ensureAnonymousSourceSeedWithBlocker(page, options = {}) {
  const prompt = options.prompt || "Hello, respond briefly.";
  const label = options.label || "source-seed";

  await ensureAnonymousChatPage(page);

  const before = await collectAnonymousSeedSnapshot(page);
  if (before.loginDiverted) {
    throw new HarnessBlockerError(
      "anonymous_seed_blocked_by_login_diversion",
      `Anonymous source seed diverted to login before seeding (${before.url})`,
      before
    );
  }

  if (before.hasAssistantSeed) {
    return {
      ok: true,
      seeded: false,
      observation: await collectThreadObservation(page),
      snapshot: before
    };
  }

  try {
    await ensureComposer(page);
    await sendPrompt(page, prompt);
    await page.waitForTimeout(3000);
    await waitForSettledAssistantReply(page, label);

    const observation = await collectThreadObservation(page);
    return {
      ok: true,
      seeded: true,
      observation,
      snapshot: await collectAnonymousSeedSnapshot(page)
    };
  } catch (error) {
    const after = await collectAnonymousSeedSnapshot(page).catch(() => ({
      url: page.url(),
      title: "",
      loginDiverted: isAnonymousLoginDiversionUrl(page.url())
    }));

    if (after.loginDiverted) {
      throw new HarnessBlockerError(
        "anonymous_seed_blocked_by_login_diversion",
        `Anonymous source seed diverted to login during seeding (${after.url})`,
        {
          ...after,
          cause: error instanceof Error ? error.message : String(error)
        }
      );
    }

    throw new HarnessBlockerError(
      "anonymous_seed_environment_instability",
      `Anonymous source seed did not produce stable assistant evidence (${after.url || "unknown_url"})`,
      {
        ...after,
        cause: error instanceof Error ? error.message : String(error)
      }
    );
  }
}

export async function ensureAuthBackedSourceSeedWithBlocker(page, options = {}) {
  const prompt = options.prompt || "Hello, respond briefly.";
  const label = options.label || "source-seed";

  const beforeAuth = await validateCurrentPageAuthState(page);
  if (!beforeAuth.valid) {
    throw new HarnessBlockerError(
      "auth_carrier_lost_before_seed",
      `Auth-backed source page was not authenticated before seeding (${beforeAuth.url || page.url()})`,
      beforeAuth
    );
  }

  const baseline = await collectThreadObservation(page);
  if (baseline.latestAssistantHash) {
    return {
      ok: true,
      seeded: false,
      observation: baseline,
      snapshot: {
        url: page.url(),
        title: beforeAuth.title || "",
        hasAssistantSeed: true,
        assistantHash: baseline.latestAssistantHash,
        assistantCount: baseline.assistantMessageCount,
        userCount: baseline.userMessageCount,
        generating: baseline.generating,
        composerVisible: beforeAuth.composerVisible ?? baseline.sendButtonVisible,
        authMode: "carrier"
      }
    };
  }

  try {
    await ensureComposer(page);
    await sendPrompt(page, prompt);
    await page.waitForTimeout(3000);
    await waitForSettledAssistantReply(page, label);

    const observation = await collectThreadObservation(page);
    return {
      ok: true,
      seeded: true,
      observation,
      snapshot: {
        url: page.url(),
        title: await page.title().catch(() => ""),
        hasAssistantSeed: Boolean(observation.latestAssistantHash),
        assistantHash: observation.latestAssistantHash,
        assistantCount: observation.assistantMessageCount,
        userCount: observation.userMessageCount,
        generating: observation.generating,
        composerVisible: observation.sendButtonVisible,
        authMode: "carrier"
      }
    };
  } catch (error) {
    const afterAuth = await validateCurrentPageAuthState(page);
    if (!afterAuth.valid) {
      throw new HarnessBlockerError(
        "auth_carrier_lost_during_seed",
        `Auth-backed source page lost authenticated state during seeding (${afterAuth.url || page.url()})`,
        {
          ...afterAuth,
          cause: error instanceof Error ? error.message : String(error)
        }
      );
    }

    const afterObservation = await collectThreadObservation(page).catch(() => null);
    throw new HarnessBlockerError(
      "auth_seed_environment_instability",
      `Auth-backed source seed did not produce stable assistant evidence (${page.url()})`,
      {
        url: page.url(),
        title: await page.title().catch(() => ""),
        latestAssistantHash: afterObservation?.latestAssistantHash || null,
        assistantMessageCount: afterObservation?.assistantMessageCount ?? null,
        userMessageCount: afterObservation?.userMessageCount ?? null,
        generating: afterObservation?.generating ?? null,
        composerVisible: afterObservation?.sendButtonVisible ?? null,
        cause: error instanceof Error ? error.message : String(error)
      }
    );
  }
}

/**
 * Give live-session pages a short post-binding stabilization window before
 * source seeding. This mirrors the proven real-hop sequencing where binding
 * broadcasts settle before page-fact seeding begins.
 * @param {import("playwright").Page} page
 * @param {number} timeoutMs
 */
export async function stabilizeAfterBinding(page, timeoutMs = 3000) {
  await page.waitForTimeout(timeoutMs);
  await page.title().catch(() => "");
}

/**
 * Recover anonymous baseline pages that drifted onto auth.openai.com before
 * live-session seeding. Keeps the harness on the root ChatGPT page without
 * reintroducing auth requirements.
 * @param {import("playwright").Page} page
 */
export async function ensureAnonymousChatPage(page) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const currentUrl = page.url();
    const isAuthPage = isAnonymousLoginDiversionUrl(currentUrl);

    if (!isAuthPage && currentUrl.startsWith("https://chatgpt.com")) {
      return;
    }

    await page.goto("https://chatgpt.com", {
      waitUntil: "domcontentloaded",
      timeout: 30000
    });
    await page.waitForTimeout(2000);
  }
}

/**
 * Wait for a new assistant reply to appear and settle compared to a baseline hash.
 * @param {import("playwright").Page} page
 * @param {string|null} previousAssistantHash
 * @param {string} seedLabel
 * @param {number} timeoutMs
 */
export async function waitForAssistantReplyAfter(page, previousAssistantHash, seedLabel, timeoutMs = 90000) {
  const startedAt = Date.now();
  const stabilityWindowMs = 3000;
  let lastSeenHash = null;
  let lastStableAt = 0;

  while (Date.now() - startedAt < timeoutMs) {
    const observation = await collectThreadObservation(page);
    const currentHash = observation.latestAssistantHash;

    if (currentHash && currentHash !== previousAssistantHash) {
      if (observation.generating) {
        lastSeenHash = currentHash;
        lastStableAt = 0;
      } else if (lastSeenHash === currentHash) {
        if (lastStableAt === 0) {
          lastStableAt = Date.now();
        } else if (Date.now() - lastStableAt >= stabilityWindowMs) {
          return observation;
        }
      } else {
        lastSeenHash = currentHash;
        lastStableAt = Date.now();
      }
    }

    await page.waitForTimeout(1000);
  }

  await dumpBootstrapDiagnostics(page, seedLabel);
  throw new Error(
    `Timed out waiting for a new settled assistant reply after ${previousAssistantHash || "no-baseline"}.`
  );
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
      `Persistent thread URL evidence was not observed. ` +
      `Live-session root-page binding may still be valid when overlay/session evidence exists.`
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
      `Supported thread URL required for ${label}. ` +
      `Current URL: ${url} (${parsed.reason}). ` +
      `This assertion is only for persistent-URL flows; live-session root-page binding can still be valid ` +
      `when overlay/session evidence exists.`
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
    `Persistent thread URL evidence was not observed. ` +
    `Live-session root-page binding may still be valid when overlay/session evidence exists.`
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
 * @returns {Promise<{phase: string, bindings: {A: unknown, B: unknown}, activeHop?: unknown, nextHopSource?: unknown, nextHopOverride?: unknown, round?: unknown, error?: string}>}
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
          },
          activeHop: state?.activeHop || null,
          nextHopSource: state?.nextHopSource ?? null,
          nextHopOverride: state?.nextHopOverride ?? null,
          round: state?.round ?? null
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
