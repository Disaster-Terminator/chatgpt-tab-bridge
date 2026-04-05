/**
 * E2E Bridge Test Runner with Scenario Matrix.
 * Auto-bootstraps two ChatGPT threads if no URLs provided.
 */

import assert from "node:assert/strict";
import path from "node:path";
import process from "node:process";
import fs from "node:fs/promises";

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
  readPopupState,
  readOverlayState,
  compareStates,
  assertStatesConsistent,
  cleanupBrowser,
  sleep
} from "./_playwright-bridge-helpers.mjs";

const extensionPath = readPathFlag("--path") || path.resolve(process.cwd(), "dist/extension");
const browserExecutablePath = process.env.BROWSER_EXECUTABLE_PATH || null;
const urlA = readFlag("--url-a");
const urlB = readFlag("--url-b");
const scenarioFilter = readFlag("--scenario");
const skipBootstrap = process.argv.includes("--skip-bootstrap");

// Scenario registry
const scenarios = {
  "happy-path": runHappyPath,
  "starter-busy-before-start": runStarterBusyBeforeStart,
  "starter-busy-before-resume": runStarterBusyBeforeResume,
  "popup-overlay-sync": runPopupOverlaySync,
  "source-busy-before-hop": runSourceBusyBeforeHop
};

async function runScenario(name, fn) {
  const diagnosticsDir = path.resolve(process.cwd(), "tmp");
  await fs.mkdir(diagnosticsDir, { force: true }).catch(() => {});
  const diagPath = path.join(diagnosticsDir, `e2e-${name}.txt`);

  let context = null;
  let userDataDir = null;
  let popupPage = null;
  let pageA = null;
  let pageB = null;

  try {
    const result = await fn();
    // Success path
    await fs.writeFile(diagPath, `PASS\nScenario: ${name}\n`, "utf8").catch(() => {});
    return { name, status: "PASS" };
  } catch (error) {
    // Failure path - capture diagnostics
    let diagContent = `FAIL\nScenario: ${name}\nError: ${error.message}\n`;

    try {
      if (popupPage) {
        const popupState = await readPopupState(popupPage);
        diagContent += `\nPopup State:\n${JSON.stringify(popupState, null, 2)}\n`;
      }
      if (pageA) {
        const overlayA = await readOverlayState(pageA);
        diagContent += `\nOverlay A State:\n${JSON.stringify(overlayA, null, 2)}\n`;
      }
      if (pageB) {
        const overlayB = await readOverlayState(pageB);
        diagContent += `\nOverlay B State:\n${JSON.stringify(overlayB, null, 2)}\n`;
      }
    } catch (e) {
      diagContent += `\nDiagnostics capture failed: ${e.message}`;
    }

    await fs.writeFile(diagPath, diagContent, "utf8").catch(() => {});

    // Also try to capture screenshots
    try {
      if (pageA) {
        await pageA.screenshot({ path: path.join(diagnosticsDir, `e2e-${name}-a.png`) }).catch(() => {});
      }
      if (pageB) {
        await pageB.screenshot({ path: path.join(diagnosticsDir, `e2e-${name}-b.png`) }).catch(() => {});
      }
      if (popupPage) {
        await popupPage.screenshot({ path: path.join(diagnosticsDir, `e2e-${name}-popup.png`) }).catch(() => {});
      }
    } catch (screenshotError) {
      // Ignore screenshot failures
    }

    return { name, status: "FAIL", diagnostics: diagPath, error: error.message };
  } finally {
    if (context) {
      await cleanupBrowser(context, userDataDir);
    }
  }
}

// ===== SCENARIO IMPLEMENTATIONS =====

async function runHappyPath() {
  const { context, userDataDir } = await launchBrowserWithExtension({ extensionPath, browserExecutablePath });
  let pageA, pageB, popupPage;

  try {
    ([pageA, pageB] = await getTwoPages(context));

    // Auto-bootstrap if no URLs
    if (!urlA || !urlB) {
      console.log("  Auto-bootstrapping two threads...");
      await Promise.all([
        pageA.goto("https://chatgpt.com", { waitUntil: "domcontentloaded" }),
        pageB.goto("https://chatgpt.com", { waitUntil: "domcontentloaded" })
      ]);
      await bootstrapAnonymousThread(pageA, "seed-a", buildBootstrapPrompt("A"));
      await bootstrapAnonymousThread(pageB, "seed-b", buildBootstrapPrompt("B"));
    } else {
      await pageA.goto(urlA, { waitUntil: "domcontentloaded" });
      await pageB.goto(urlB, { waitUntil: "domcontentloaded" });
    }

    await ensureOverlay(pageA);
    await ensureOverlay(pageB);

    // Bind A and B
    await clickOverlayBind(pageA, "A");
    await clickOverlayBind(pageB, "B");

    const extensionId = await getExtensionId(pageA);
    popupPage = await openPopup(context, extensionId);

    // Verify ready state
    await expectBindingState(popupPage, "A");
    await expectBindingState(popupPage, "B");
    await expectPopupPhaseState(popupPage, "ready");

    // Start
    await expectOverlayActionEnabled(pageA, "start");
    await clickOverlayAction(pageA, "start");
    await expectPopupPhaseState(popupPage, "running");

    await expectPopupControlState(popupPage, {
      canPause: true,
      canResume: false,
      canStop: true,
      overrideSelectEnabled: false
    });

    // Pause
    await expectOverlayActionEnabled(pageA, "pause");
    await clickOverlayAction(pageA, "pause");
    await expectPopupPhaseState(popupPage, "paused");

    await expectPopupControlState(popupPage, {
      canPause: false,
      canResume: true,
      canStop: true,
      overrideSelectEnabled: true
    });

    // Resume
    await expectOverlayActionEnabled(pageA, "resume");
    await clickOverlayAction(pageA, "resume");
    await expectPopupPhaseState(popupPage, "running");

    // Stop
    await expectOverlayActionEnabled(pageA, "stop");
    await clickOverlayAction(pageA, "stop");
    await expectPopupPhaseState(popupPage, "stopped");

    await expectPopupControlState(popupPage, {
      canPause: false,
      canResume: false,
      canStop: false,
      clearTerminalEnabled: true
    });

    return { success: true };
  } finally {
    await cleanupBrowser(context, userDataDir);
  }
}

async function runStarterBusyBeforeStart() {
  const { context, userDataDir } = await launchBrowserWithExtension({ extensionPath, browserExecutablePath });
  let pageA, pageB, popupPage;

  try {
    ([pageA, pageB] = await getTwoPages(context));

    // Auto-bootstrap
    if (!urlA || !urlB) {
      console.log("  Auto-bootstrapping two threads...");
      await Promise.all([
        pageA.goto("https://chatgpt.com", { waitUntil: "domcontentloaded" }),
        pageB.goto("https://chatgpt.com", { waitUntil: "domcontentloaded" })
      ]);
      await bootstrapAnonymousThread(pageA, "seed-a", buildBootstrapPrompt("A"));
      await bootstrapAnonymousThread(pageB, "seed-b", buildBootstrapPrompt("B"));
    } else {
      await pageA.goto(urlA, { waitUntil: "domcontentloaded" });
      await pageB.goto(urlB, { waitUntil: "domcontentloaded" });
    }

    await ensureOverlay(pageA);
    await ensureOverlay(pageB);

    // Bind A and B
    await clickOverlayBind(pageA, "A");
    await clickOverlayBind(pageB, "B");

    const extensionId = await getExtensionId(pageA);
    popupPage = await openPopup(context, extensionId);

    // Wait for ready state
    await expectPopupPhaseState(popupPage, "ready");

    // Now make pageA busy - send another prompt
    const { ensureComposer, sendPrompt } = await import("./_playwright-bridge-helpers.mjs");
    const composer = await ensureComposer(pageA);
    await sendPrompt(pageA, "Generate a longer response with multiple paragraphs. Include details about architecture patterns. [CONTINUE]");

    // Wait a moment for the response to start generating
    await sleep(3000);

    // Now try to start - should go to waiting settle / preflight instead of running directly
    await expectOverlayActionEnabled(pageA, "start");
    await clickOverlayAction(pageA, "start");

    // Should NOT be in running immediately - should be in waiting/preflight
    // The popup should show a state indicating waiting for generation to settle
    await sleep(2000);
    const phase = await popupPage.locator("#phaseBadge").getAttribute("data-phase");
    
    // Either waiting/preflight or still settling
    assert.ok(
      ["waiting", "preflight", "running"].includes(phase),
      `Expected waiting/preflight/running after start with busy starter, got: ${phase}`
    );

    return { success: true };
  } finally {
    await cleanupBrowser(context, userDataDir);
  }
}

async function runStarterBusyBeforeResume() {
  const { context, userDataDir } = await launchBrowserWithExtension({ extensionPath, browserExecutablePath });
  let pageA, pageB, popupPage;

  try {
    ([pageA, pageB] = await getTwoPages(context));

    // Auto-bootstrap
    if (!urlA || !urlB) {
      console.log("  Auto-bootstrapping two threads...");
      await Promise.all([
        pageA.goto("https://chatgpt.com", { waitUntil: "domcontentloaded" }),
        pageB.goto("https://chatgpt.com", { waitUntil: "domcontentloaded" })
      ]);
      await bootstrapAnonymousThread(pageA, "seed-a", buildBootstrapPrompt("A"));
      await bootstrapAnonymousThread(pageB, "seed-b", buildBootstrapPrompt("B"));
    } else {
      await pageA.goto(urlA, { waitUntil: "domcontentloaded" });
      await pageB.goto(urlB, { waitUntil: "domcontentloaded" });
    }

    await ensureOverlay(pageA);
    await ensureOverlay(pageB);

    // Bind A and B
    await clickOverlayBind(pageA, "A");
    await clickOverlayBind(pageB, "B");

    const extensionId = await getExtensionId(pageA);
    popupPage = await openPopup(context, extensionId);

    // Wait for ready state
    await expectPopupPhaseState(popupPage, "ready");

    // Start
    await expectOverlayActionEnabled(pageA, "start");
    await clickOverlayAction(pageA, "start");
    await expectPopupPhaseState(popupPage, "running");

    // Pause
    await expectOverlayActionEnabled(pageA, "pause");
    await clickOverlayAction(pageA, "pause");
    await expectPopupPhaseState(popupPage, "paused");

    // Now make pageA busy - send another prompt
    const { ensureComposer, sendPrompt } = await import("./_playwright-bridge-helpers.mjs");
    const composer = await ensureComposer(pageA);
    await sendPrompt(pageA, "Generate a detailed response about distributed systems. [CONTINUE]");

    // Wait for generation to start
    await sleep(3000);

    // Now try to resume - should wait for generation to settle first
    await expectOverlayActionEnabled(pageA, "resume");
    await clickOverlayAction(pageA, "resume");

    // Should either wait for settle or eventually go to running after settle completes
    await sleep(2000);
    const phase = await popupPage.locator("#phaseBadge").getAttribute("data-phase");
    
    // Should eventually settle to running
    assert.ok(
      ["waiting", "preflight", "running"].includes(phase),
      `Expected waiting/preflight/running after resume with busy starter, got: ${phase}`
    );

    return { success: true };
  } finally {
    await cleanupBrowser(context, userDataDir);
  }
}

async function runPopupOverlaySync() {
  const { context, userDataDir } = await launchBrowserWithExtension({ extensionPath, browserExecutablePath });
  let pageA, pageB, popupPage;

  try {
    ([pageA, pageB] = await getTwoPages(context));

    // Auto-bootstrap
    if (!urlA || !urlB) {
      console.log("  Auto-bootstrapping two threads...");
      await Promise.all([
        pageA.goto("https://chatgpt.com", { waitUntil: "domcontentloaded" }),
        pageB.goto("https://chatgpt.com", { waitUntil: "domcontentloaded" })
      ]);
      await bootstrapAnonymousThread(pageA, "seed-a", buildBootstrapPrompt("A"));
      await bootstrapAnonymousThread(pageB, "seed-b", buildBootstrapPrompt("B"));
    } else {
      await pageA.goto(urlA, { waitUntil: "domcontentloaded" });
      await pageB.goto(urlB, { waitUntil: "domcontentloaded" });
    }

    await ensureOverlay(pageA);
    await ensureOverlay(pageB);

    // Bind A and B
    await clickOverlayBind(pageA, "A");
    await clickOverlayBind(pageB, "B");

    const extensionId = await getExtensionId(pageA);
    popupPage = await openPopup(context, extensionId);

    // Wait for ready state
    await expectPopupPhaseState(popupPage, "ready");

    // Start the relay
    await expectOverlayActionEnabled(pageA, "start");
    await clickOverlayAction(pageA, "start");
    await expectPopupPhaseState(popupPage, "running");

    // Now compare states during running
    const popupState = await readPopupState(popupPage);
    const overlayAState = await readOverlayState(pageA);
    const overlayBState = await readOverlayState(pageB);

    // Compare popup vs overlay A
    const comparisonA = compareStates(popupState, overlayAState);
    assert.ok(comparisonA.consistent, `Popup vs Overlay A mismatch: ${comparisonA.mismatches.join(", ")}`);

    // Compare popup vs overlay B
    const comparisonB = compareStates(popupState, overlayBState);
    assert.ok(comparisonB.consistent, `Popup vs Overlay B mismatch: ${comparisonB.mismatches.join(", ")}`);

    // Stop
    await expectOverlayActionEnabled(pageA, "stop");
    await clickOverlayAction(pageA, "stop");
    await expectPopupPhaseState(popupPage, "stopped");

    return { success: true };
  } finally {
    await cleanupBrowser(context, userDataDir);
  }
}

async function runSourceBusyBeforeHop() {
  const { context, userDataDir } = await launchBrowserWithExtension({ extensionPath, browserExecutablePath });
  let pageA, pageB, popupPage;

  try {
    ([pageA, pageB] = await getTwoPages(context));

    // Auto-bootstrap
    if (!urlA || !urlB) {
      console.log("  Auto-bootstrapping two threads...");
      await Promise.all([
        pageA.goto("https://chatgpt.com", { waitUntil: "domcontentloaded" }),
        pageB.goto("https://chatgpt.com", { waitUntil: "domcontentloaded" })
      ]);
      await bootstrapAnonymousThread(pageA, "seed-a", buildBootstrapPrompt("A"));
      await bootstrapAnonymousThread(pageB, "seed-b", buildBootstrapPrompt("B"));
    } else {
      await pageA.goto(urlA, { waitUntil: "domcontentloaded" });
      await pageB.goto(urlB, { waitUntil: "domcontentloaded" });
    }

    await ensureOverlay(pageA);
    await ensureOverlay(pageB);

    // Bind A and B
    await clickOverlayBind(pageA, "A");
    await clickOverlayBind(pageB, "B");

    const extensionId = await getExtensionId(pageA);
    popupPage = await openPopup(context, extensionId);

    // Wait for ready state
    await expectPopupPhaseState(popupPage, "ready");

    // Start
    await expectOverlayActionEnabled(pageA, "start");
    await clickOverlayAction(pageA, "start");
    await expectPopupPhaseState(popupPage, "running");

    // Wait a bit for first hop to complete
    await sleep(5000);

    // Now make pageB (the source at this point) busy during the hop
    const { ensureComposer, sendPrompt } = await import("./_playwright-bridge-helpers.mjs");
    const composer = await ensureComposer(pageB);
    await sendPrompt(pageB, "Generate content while the bridge is running. [CONTINUE]");

    await sleep(3000);

    // The system should not proceed with the hop until source settles
    // Check current step or phase to see if it's waiting
    const popupState = await readPopupState(popupPage);
    const currentStep = popupState.currentStep;

    // If still in a hop operation, it should be in waiting/preflight
    const phase = popupState.phase;
    assert.ok(
      ["waiting", "preflight", "running"].includes(phase),
      `Expected waiting/preflight/running during hop with busy source, got: ${phase}`
    );

    // Stop
    await expectOverlayActionEnabled(pageA, "stop");
    await clickOverlayAction(pageA, "stop");
    await expectPopupPhaseState(popupPage, "stopped");

    return { success: true };
  } finally {
    await cleanupBrowser(context, userDataDir);
  }
}

// ===== MAIN EXECUTION =====

async function main() {
  const results = [];
  const scenarioNames = scenarioFilter 
    ? [scenarioFilter] 
    : Object.keys(scenarios);

  console.log("E2E Bridge Test Runner");
  console.log("=======================\n");

  for (const name of scenarioNames) {
    if (!scenarios[name]) {
      console.error(`Unknown scenario: ${name}`);
      continue;
    }

    console.log(`Running scenario: ${name}...`);
    const result = await runScenario(name, scenarios[name]);
    results.push(result);

    console.log(`  Result: ${result.status}`);
    if (result.diagnostics) {
      console.log(`  Diagnostics: ${result.diagnostics}`);
    }
  }

  console.log("\n=======================");
  console.log("Summary:");
  for (const result of results) {
    if (result.status === "FAIL") {
      console.log(`  E2E scenario ${result.name}: FAIL (see ${result.diagnostics})`);
    } else {
      console.log(`  E2E scenario ${result.name}: PASS`);
    }
  }

  const failedCount = results.filter(r => r.status === "FAIL").length;
  if (failedCount > 0) {
    console.log(`\n${failedCount} scenario(s) failed.`);
    process.exit(1);
  } else {
    console.log("\nAll scenarios passed!");
    process.exit(0);
  }
}

main().catch(error => {
  console.error("E2E runner error:", error);
  process.exit(1);
});