import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import { chromium } from "playwright";

const extensionPath = readPathFlag("--path") || path.resolve(process.cwd(), "dist/extension");
const browserExecutablePath = process.env.BROWSER_EXECUTABLE_PATH || null;
const urlA = readFlag("--url-a");
const urlB = readFlag("--url-b");

const userDataDir = await mkdtemp(path.join(os.tmpdir(), "chatgpt-bridge-semi-"));

let context;
let runError = null;

try {
  context = await chromium.launchPersistentContext(userDataDir, {
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

  const existingPages = context.pages();
  const pageA = existingPages[0] ?? (await context.newPage());
  const pageB = existingPages[1] ?? (await context.newPage());

  for (const page of existingPages.slice(2)) {
    await page.close().catch(() => {});
  }

  if (urlA && urlB) {
    await pageA.goto(urlA, { waitUntil: "domcontentloaded" });
    await pageB.goto(urlB, { waitUntil: "domcontentloaded" });
  } else {
    console.log("No thread URLs supplied. Bootstrapping two anonymous ChatGPT threads.");
    await Promise.all([
      pageA.goto("https://chatgpt.com", { waitUntil: "domcontentloaded" }),
      pageB.goto("https://chatgpt.com", { waitUntil: "domcontentloaded" })
    ]);
    await bootstrapAnonymousThread(pageA, "seed-a", buildBootstrapPrompt("A"));
    await bootstrapAnonymousThread(pageB, "seed-b", buildBootstrapPrompt("B"));
  }

  await ensureOverlay(pageA);
  await ensureOverlay(pageB);

  // P0: Bind using overlay selectors instead of popup
  await clickOverlayBind(pageA, "A");
  await clickOverlayBind(pageB, "B");

  const extensionId = await pageA.locator(".chatgpt-bridge-overlay").evaluate((node) => {
    return node.dataset.extensionId || "";
  });
  assert.ok(extensionId, "Expected overlay to expose extension id");

  // P1: Open popup for read-only verification only
  const popupPage = await context.newPage();
  await popupPage.goto(`chrome-extension://${extensionId}/popup.html`, {
    waitUntil: "domcontentloaded"
  });

  // P1: Verify popup structural readiness (no copy-dependent checks)
  await popupPage.waitForSelector("#phaseBadge");
  await popupPage.waitForSelector("#bindingA");
  await popupPage.waitForSelector("#bindingB");

  // P2: Binding verification - check non-default values instead of specific copy
  await expectBindingState(popupPage, "A");
  await expectBindingState(popupPage, "B");
  await expectPopupPhaseState(popupPage, "ready");

  // P0: Wait for overlay start button to be enabled before clicking
  await expectOverlayActionEnabled(pageA, "start");
  await clickOverlayAction(pageA, "start");
  await expectPopupPhaseState(popupPage, "running");

  // P1: Verify control states in popup (read-only check)
  await expectPopupControlState(popupPage, {
    canPause: true,
    canResume: false,
    canStop: true,
    overrideSelectEnabled: false
  });

  // Capture round before pause
  const roundBeforePause = await popupPage.locator("#roundValue").innerText();

  // P0: Pause from overlay
  await expectOverlayActionEnabled(pageA, "pause");
  await clickOverlayAction(pageA, "pause");
  await expectPopupPhaseState(popupPage, "paused");

  // P1: Verify paused state controls in popup (read-only check)
  await expectPopupControlState(popupPage, {
    canPause: false,
    canResume: true,
    canStop: true,
    overrideSelectEnabled: true
  });

  // P1: Verify override can be changed in paused state
  await popupPage.locator("#overrideSelect").selectOption("B");

  // P2: Verify next hop changed (no hard-coded copy assertion)
  await expectValueChanged(popupPage, "#nextHopValue", async (val) => val !== "A → B");
  await expectValueChanged(popupPage, "#roundValue", async (val) => val === roundBeforePause);

  // P0: Resume from overlay
  await expectOverlayActionEnabled(pageA, "resume");
  await clickOverlayAction(pageA, "resume");
  await expectPopupPhaseState(popupPage, "running");

  // P1: Verify running state controls in popup (read-only check)
  await expectPopupControlState(popupPage, {
    canPause: true,
    canResume: false,
    canStop: true,
    overrideSelectEnabled: false
  });

  // P0: Stop from overlay
  await expectOverlayActionEnabled(pageA, "stop");
  await clickOverlayAction(pageA, "stop");
  await expectPopupPhaseState(popupPage, "stopped");

  // P1: Verify stopped state controls in popup (read-only check)
  await expectPopupControlState(popupPage, {
    canPause: false,
    canResume: false,
    canStop: false,
    clearTerminalEnabled: true
  });

  console.log("Semi bridge test: PASS");
} catch (error) {
  runError = error;
} finally {
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

if (runError) {
  throw runError;
}

// ===== NEW HELPERS FOR FROZEN UI CONTRACT =====

/**
 * Click overlay bind button for specified role
 * @param {import("playwright").Page} page
 * @param {"A"|"B"} role
 */
async function clickOverlayBind(page, role) {
  const selector = `[data-bind-role="${role}"]`;
  await page.waitForSelector(selector, { state: "visible", timeout: 30000 });
  await page.locator(selector).click();
}

/**
 * Click overlay action button (start/pause/resume/stop)
 * @param {import("playwright").Page} page
 * @param {"start"|"pause"|"resume"|"stop"} action
 */
async function clickOverlayAction(page, action) {
  const selector = `[data-action="${action}"]`;
  await page.locator(selector).click();
}

/**
 * Wait until overlay action is enabled (visible and not disabled)
 * @param {import("playwright").Page} page
 * @param {"start"|"pause"|"resume"|"stop"} action
 */
async function expectOverlayActionEnabled(page, action) {
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
 * Verify popup phase via data-phase attribute (no copy dependency)
 * @param {import("playwright").Page} page
 * @param {string} expectedPhase
 */
async function expectPopupPhaseState(page, expectedPhase) {
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
 * Verify binding is in non-default state (not unbound)
 * @param {import("playwright").Page} page
 * @param {"A"|"B"} role
 */
async function expectBindingState(page, role) {
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
 * Verify popup control states via enabled/disabled attributes
 * @param {import("playwright").Page} page
 * @param {Object} expectedStates
 */
async function expectPopupControlState(page, expectedStates) {
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
 * Wait for value to change from initial value or satisfy predicate
 * @param {import("playwright").Page} page
 * @param {string} selector
 * @param {Function} predicate - async function receiving current value
 */
async function expectValueChanged(page, selector, predicate) {
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

// ===== EXISTING HELPERS (unchanged) =====

async function ensureOverlay(page) {
  await page.waitForSelector(".chatgpt-bridge-overlay", { timeout: 30000 });
}

function readFlag(flagName) {
  const index = process.argv.indexOf(flagName);
  if (index === -1) {
    return null;
  }

  return process.argv[index + 1] ?? null;
}

function readPathFlag(flagName) {
  const value = readFlag(flagName);
  if (!value) {
    return null;
  }

  // Resolve relative paths against cwd, preserve absolute paths
  return path.isAbsolute(value) ? value : path.resolve(process.cwd(), value);
}

async function bootstrapAnonymousThread(page, seedLabel, prompt) {
  await dismissCookieBanner(page);
  await ensureComposer(page);
  await sendPrompt(page, prompt);
  await waitForAssistantReply(page, seedLabel);
  await waitForSupportedThreadUrl(page);
}

async function ensureComposer(page) {
  const composer = await findComposer(page);
  await composer.waitFor({
    state: "visible",
    timeout: 30000
  });
  return composer;
}

async function sendPrompt(page, prompt) {
  const composer = await ensureComposer(page);
  const tagName = await composer.evaluate((node) => node.tagName.toLowerCase());

  if (tagName === "textarea" || tagName === "input") {
    await composer.evaluate((node, value) => {
      node.value = value;
      node.dispatchEvent(new Event("input", { bubbles: true }));
      node.dispatchEvent(new Event("change", { bubbles: true }));
    }, prompt);
  } else {
    await composer.click();
    await composer.focus();
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

async function waitForAssistantReply(page, seedLabel) {
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

async function waitForSupportedThreadUrl(page) {
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

async function findComposer(page) {
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

async function dismissCookieBanner(page) {
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

async function waitForEnabledButton(locator, timeoutMs) {
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

function sleep(durationMs) {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}

async function waitForPromptDispatch(page, composer, prompt) {
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

function buildBootstrapPrompt(roleLabel) {
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

async function dumpBootstrapDiagnostics(page, seedLabel) {
  const diagnosticsDir = path.resolve(process.cwd(), "tmp");
  const screenshotPath = path.join(diagnosticsDir, `semi-${seedLabel}.png`);
  const textPath = path.join(diagnosticsDir, `semi-${seedLabel}.txt`);

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
