/**
 * Semi-automated bridge test using Playwright.
 * Uses shared helpers from _playwright-bridge-helpers.mjs
 */

import assert from "node:assert/strict";
import path from "node:path";
import process from "node:process";

import {
  launchBrowserWithExtension,
  getTwoPages,
  readFlag,
  readPathFlag,
  ensureOverlay,
  clickOverlayBind,
  clickOverlayAction,
  expectOverlayActionEnabled,
  expectPopupPhaseState,
  expectBindingState,
  expectPopupControlState,
  expectValueChanged,
  bootstrapAnonymousThread,
  buildBootstrapPrompt,
  getExtensionId,
  openPopup,
  assertSupportedThreadUrl
} from "./_playwright-bridge-helpers.mjs";

const extensionPath = readPathFlag("--path") || path.resolve(process.cwd(), "dist/extension");
const browserExecutablePath = process.env.BROWSER_EXECUTABLE_PATH || null;
const urlA = readFlag("--url-a");
const urlB = readFlag("--url-b");
const skipBootstrap = process.argv.includes("--skip-bootstrap");

const { context, userDataDir } = await launchBrowserWithExtension({
  extensionPath,
  browserExecutablePath
});

let runError = null;

try {
  const [pageA, pageB] = await getTwoPages(context);

  if (urlA && urlB) {
    console.log("Using provided thread URLs.");
    await pageA.goto(urlA, { waitUntil: "domcontentloaded" });
    await pageB.goto(urlB, { waitUntil: "domcontentloaded" });
    // Validate URLs are supported thread URLs before binding
    await assertSupportedThreadUrl(pageA, "pageA (--url-a)");
    await assertSupportedThreadUrl(pageB, "pageB (--url-b)");
  } else if (skipBootstrap) {
    console.log("Skip bootstrap mode - waiting for you to navigate to thread URLs...");
    console.log("Please navigate both pages to valid /c/ or /g/.../c/ URLs, then press Enter in this terminal.");
    await Promise.all([
      pageA.goto("https://chatgpt.com", { waitUntil: "domcontentloaded" }),
      pageB.goto("https://chatgpt.com", { waitUntil: "domcontentloaded" })
    ]);
    // Wait for user to signal ready
    console.log("Ready? Press Enter to continue...");
    await new Promise(resolve => {
      process.stdin.once("data", () => resolve());
    });
    // Validate URLs after user navigation
    await assertSupportedThreadUrl(pageA, "pageA (manual)");
    await assertSupportedThreadUrl(pageB, "pageB (manual)");
  } else {
    console.log("No thread URLs supplied. Attempting anonymous bootstrap...");
    console.log("NOTE: Anonymous bootstrap may fail if ChatGPT requires authentication.");
    console.log("      If bootstrap fails, provide existing thread URLs via --url-a and --url-b.");
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

  const extensionId = await getExtensionId(pageA);

  // P1: Open popup for read-only verification only
  const popupPage = await openPopup(context, extensionId);

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
  const { cleanupBrowser } = await import("./_playwright-bridge-helpers.mjs");
  await cleanupBrowser(context, userDataDir);
}

if (runError) {
  throw runError;
}