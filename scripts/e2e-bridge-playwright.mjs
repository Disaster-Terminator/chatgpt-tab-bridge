/**
 * E2E Bridge Test Runner with Scenario Matrix.
 * Auto-bootstraps two ChatGPT threads if no URLs provided.
 * Runner creates env once, scenarios receive env and return result.
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
  sleep,
  assertSupportedThreadUrl
} from "./_playwright-bridge-helpers.mjs";

const extensionPath = readPathFlag("--path") || path.resolve(process.cwd(), "dist/extension");
const browserExecutablePath = process.env.BROWSER_EXECUTABLE_PATH || null;
const urlA = readFlag("--url-a");
const urlB = readFlag("--url-b");
const scenarioFilter = readFlag("--scenario");
const skipBootstrap = process.argv.includes("--skip-bootstrap");

// Scenario registry - each receives env and returns { success: true } or throws
const scenarios = {
  "happy-path": runHappyPath,
  "starter-busy-before-start": runStarterBusyBeforeStart,
  "starter-busy-before-resume": runStarterBusyBeforeResume,
  "popup-overlay-sync": runPopupOverlaySync,
  "source-busy-before-hop": runSourceBusyBeforeHop
};

/**
 * Run a scenario with proper lifecycle:
 * - Runner creates env (browser, pages)
 * - Scenario receives env, runs test, returns result
 * - Runner handles diagnostics on failure
 * - Runner cleans up in finally
 */
async function runScenario(name, scenarioFn) {
  const diagnosticsDir = path.resolve(process.cwd(), "tmp");
  await fs.mkdir(diagnosticsDir, { force: true }).catch(() => {});
  const diagPath = path.join(diagnosticsDir, `e2e-${name}.txt`);

  let env = null;

  try {
    // Runner creates the environment
    env = await createEnv();
    
    // Run scenario with env - scenario does NOT create/cleanup browser
    await scenarioFn(env);
    
    // Success path
    await fs.writeFile(diagPath, `PASS\nScenario: ${name}\n`, "utf8").catch(() => {});
    return { name, status: "PASS" };
    
  } catch (error) {
    // Failure path - capture diagnostics using env
    let diagContent = `FAIL\nScenario: ${name}\nError: ${error.message}\n`;

    if (env) {
      try {
        const popupState = await readPopupState(env.popupPage);
        diagContent += `\nPopup State:\n${JSON.stringify(popupState, null, 2)}\n`;
      } catch (e) {
        diagContent += `\nPopup state capture failed: ${e.message}`;
      }

      try {
        const overlayAState = await readOverlayState(env.pageA);
        diagContent += `\nOverlay A State:\n${JSON.stringify(overlayAState, null, 2)}\n`;
      } catch (e) {
        diagContent += `\nOverlay A state capture failed: ${e.message}`;
      }

      try {
        const overlayBState = await readOverlayState(env.pageB);
        diagContent += `\nOverlay B State:\n${JSON.stringify(overlayBState, null, 2)}\n`;
      } catch (e) {
        diagContent += `\nOverlay B state capture failed: ${e.message}`;
      }

      // P0-5: Add target thread activity diagnostics
      try {
        const targetActivity = await env.pageB.evaluate(() => {
          const result = { generating: false, sendButtonReady: false, userMessages: 0, assistantMessages: 0 };
          
          // Check for stop button (generating)
          const stopButton = document.querySelector('button[data-testid="stop-button"]') || 
                            document.querySelector('button[data-testid="stop-generating-button"]');
          result.generating = !!stopButton;
          
          // Check send button
          const sendButton = document.querySelector('button[data-testid="send-button"]') ||
                           document.querySelector('button[type="submit"]');
          result.sendButtonReady = sendButton && !sendButton.disabled;
          
          // Count messages
          result.userMessages = document.querySelectorAll('[data-message-author-role="user"]').length;
          result.assistantMessages = document.querySelectorAll('[data-message-author-role="assistant"]').length;
          
          return result;
        });
        diagContent += `\nTarget Thread Activity:\n${JSON.stringify(targetActivity, null, 2)}\n`;
      } catch (e) {
        diagContent += `\nTarget thread activity capture failed: ${e.message}`;
      }

      // P0-4: Add real Ack Debug from content-script via GET_LAST_ACK_DEBUG
      try {
        const ackDebugResponse = await env.pageA.evaluate(() => {
          return new Promise((resolve) => {
            chrome.runtime.sendMessage({ type: "GET_LAST_ACK_DEBUG" }, (response) => {
              resolve(response);
            });
          });
        }).catch(() => null);
        
        if (ackDebugResponse) {
          diagContent += `\nAck Debug (GET_LAST_ACK_DEBUG):\n${JSON.stringify(ackDebugResponse, null, 2)}\n`;
        } else {
          diagContent += `\nAck Debug: unavailable\n`;
        }
      } catch (e) {
        diagContent += `\nAck Debug capture failed: ${e.message}`;
      }

      // Screenshots
      try {
        if (env.pageA) {
          await env.pageA.screenshot({ path: path.join(diagnosticsDir, `e2e-${name}-a.png`) }).catch(() => {});
        }
        if (env.pageB) {
          await env.pageB.screenshot({ path: path.join(diagnosticsDir, `e2e-${name}-b.png`) }).catch(() => {});
        }
        if (env.popupPage) {
          await env.popupPage.screenshot({ path: path.join(diagnosticsDir, `e2e-${name}-popup.png`) }).catch(() => {});
        }
      } catch (screenshotError) {
        // Ignore
      }
    }

    await fs.writeFile(diagPath, diagContent, "utf8").catch(() => {});
    return { name, status: "FAIL", diagnostics: diagPath, error: error.message };
    
  } finally {
    // Runner cleans up
    if (env) {
      await cleanupEnv(env);
    }
  }
}

/**
 * Create test environment - browser, pages, popup.
 */
async function createEnv() {
  const { context, userDataDir } = await launchBrowserWithExtension({ 
    extensionPath, 
    browserExecutablePath 
  });
  
  const [pageA, pageB] = await getTwoPages(context);
  
  // Navigate based on mode
  if (urlA && urlB) {
    console.log("  Using provided thread URLs...");
    await pageA.goto(urlA, { waitUntil: "domcontentloaded" });
    await pageB.goto(urlB, { waitUntil: "domcontentloaded" });
    // Validate URLs are supported thread URLs before binding
    await assertSupportedThreadUrl(pageA, "pageA (--url-a)");
    await assertSupportedThreadUrl(pageB, "pageB (--url-b)");
  } else if (skipBootstrap) {
    console.log("  Skip bootstrap mode - waiting for user navigation...");
    await Promise.all([
      pageA.goto("https://chatgpt.com", { waitUntil: "domcontentloaded" }),
      pageB.goto("https://chatgpt.com", { waitUntil: "domcontentloaded" })
    ]);
    // Wait for user to signal ready
    console.log("  Please navigate both pages to valid thread URLs (/c/ or /g/.../c/), then press Enter...");
    await new Promise(resolve => {
      process.stdin.once("data", () => resolve());
    });
    // Validate URLs after user navigation
    await assertSupportedThreadUrl(pageA, "pageA (manual)");
    await assertSupportedThreadUrl(pageB, "pageB (manual)");
  } else {
    console.log("  Auto-bootstrapping two threads...");
    await Promise.all([
      pageA.goto("https://chatgpt.com", { waitUntil: "domcontentloaded" }),
      pageB.goto("https://chatgpt.com", { waitUntil: "domcontentloaded" })
    ]);
    await bootstrapAnonymousThread(pageA, "seed-a", buildBootstrapPrompt("A"));
    await bootstrapAnonymousThread(pageB, "seed-b", buildBootstrapPrompt("B"));
  }
  
  // Wait for overlay
  await ensureOverlay(pageA);
  await ensureOverlay(pageB);
  
  // Bind A and B
  await clickOverlayBind(pageA, "A");
  await clickOverlayBind(pageB, "B");
  
  // Open popup
  const extensionId = await getExtensionId(pageA);
  const popupPage = await openPopup(context, extensionId);
  
  // Wait for ready
  await expectPopupPhaseState(popupPage, "ready");
  
  return {
    context,
    userDataDir,
    pageA,
    pageB,
    popupPage
  };
}

/**
 * Cleanup test environment.
 */
async function cleanupEnv(env) {
  if (env.context) {
    await cleanupBrowser(env.context, env.userDataDir);
  }
}

// ===== SCENARIO IMPLEMENTATIONS =====
// Each receives env: { pageA, pageB, popupPage }
// Each returns { success: true } or throws

async function runHappyPath(env) {
  const { pageA, pageB, popupPage } = env;
  
  // P0-5: Capture comprehensive initial state for proof of real submission
  const initialRound = await popupPage.locator("#roundValue").innerText();
  
  const initialTargetState = await pageB.evaluate(() => {
    const result = { userText: null, userHash: null, assistantHash: null, bridgeContext: false };
    
    // Get latest user message
    const userMessages = Array.from(document.querySelectorAll('[data-message-author-role="user"]'));
    if (userMessages.length > 0) {
      const latestUser = userMessages[userMessages.length - 1];
      result.userText = latestUser.textContent?.trim() || "";
      if (result.userText) {
        let hash = 2166136261;
        for (let i = 0; i < result.userText.length; i++) {
          hash ^= result.userText.charCodeAt(i);
          hash = Math.imul(hash, 16777619);
        }
        result.userHash = "h" + (hash >>> 0).toString(16);
        result.bridgeContext = result.userText.includes("[BRIDGE_CONTEXT]") || result.userText.includes("[来自");
      }
    }
    
    // Get latest assistant message for activity evidence
    const assistantMessages = Array.from(document.querySelectorAll('[data-message-author-role="assistant"]'));
    if (assistantMessages.length > 0) {
      const latestAssistant = assistantMessages[assistantMessages.length - 1];
      const assistantText = latestAssistant.textContent?.trim() || "";
      if (assistantText) {
        let hash = 2166136261;
        for (let i = 0; i < assistantText.length; i++) {
          hash ^= assistantText.charCodeAt(i);
          hash = Math.imul(hash, 16777619);
        }
        result.assistantHash = "h" + (hash >>> 0).toString(16);
      }
    }
    
    return result;
  });

  await expectOverlayActionEnabled(pageA, "start");
  await clickOverlayAction(pageA, "start");
  await expectPopupPhaseState(popupPage, "running");

  await expectPopupControlState(popupPage, {
    canPause: true,
    canResume: false,
    canStop: true,
    overrideSelectEnabled: false
  });

  // P0-5: Wait for real first-hop submission proof
  // Not just round change - need compound evidence
  await sleep(10000);

  const newRound = await popupPage.locator("#roundValue").innerText();
  
  const newTargetState = await pageB.evaluate(() => {
    const result = { userText: null, userHash: null, assistantHash: null, bridgeContext: false };
    
    const userMessages = Array.from(document.querySelectorAll('[data-message-author-role="user"]'));
    if (userMessages.length > 0) {
      const latestUser = userMessages[userMessages.length - 1];
      result.userText = latestUser.textContent?.trim() || "";
      if (result.userText) {
        let hash = 2166136261;
        for (let i = 0; i < result.userText.length; i++) {
          hash ^= result.userText.charCodeAt(i);
          hash = Math.imul(hash, 16777619);
        }
        result.userHash = "h" + (hash >>> 0).toString(16);
        result.bridgeContext = result.userText.includes("[BRIDGE_CONTEXT]") || result.userText.includes("[来自");
      }
    }
    
    const assistantMessages = Array.from(document.querySelectorAll('[data-message-author-role="assistant"]'));
    if (assistantMessages.length > 0) {
      const latestAssistant = assistantMessages[assistantMessages.length - 1];
      const assistantText = latestAssistant.textContent?.trim() || "";
      if (assistantText) {
        let hash = 2166136261;
        for (let i = 0; i < assistantText.length; i++) {
          hash ^= assistantText.charCodeAt(i);
          hash = Math.imul(hash, 16777619);
        }
        result.assistantHash = "h" + (hash >>> 0).toString(16);
      }
    }
    
    return result;
  });

  // P0-5: Compound success criteria - not just round OR message, but both for real proof
  const roundChanged = newRound !== initialRound && parseInt(newRound, 10) > parseInt(initialRound, 10);
  const userMessageChanged = newTargetState.userHash !== null && newTargetState.userHash !== initialTargetState.userHash;
  const payloadAdoption = newTargetState.bridgeContext || (
    newTargetState.userText && initialTargetState.userText &&
    calculateOverlap(newTargetState.userText, initialTargetState.userText) >= 0.3
  );
  const assistantActivity = newTargetState.assistantHash !== null && newTargetState.assistantHash !== initialTargetState.assistantHash;

  // P0-5: Strong proof requires either:
  // 1. bridge context (unambiguous relay marker)
  // 2. OR (user message changed AND (round changed OR assistant activity))
  const realSubmission = newTargetState.bridgeContext || 
    (userMessageChanged && (roundChanged || assistantActivity));

  if (!realSubmission) {
    const popupState = await readPopupState(popupPage).catch(() => ({}));
    throw new Error(
      `First hop did not prove real submission.\n` +
      `Initial: round=${initialRound}, userHash=${initialTargetState.userHash}, assistantHash=${initialTargetState.assistantHash}, bridgeCtx=${initialTargetState.bridgeContext}\n` +
      `After: round=${newRound}, userHash=${newTargetState.userHash}, assistantHash=${newTargetState.assistantHash}, bridgeCtx=${newTargetState.bridgeContext}\n` +
      `Round changed: ${roundChanged}, User changed: ${userMessageChanged}, Payload adopted: ${payloadAdoption}, Assistant active: ${assistantActivity}\n` +
      `Popup state: ${JSON.stringify(popupState)}`
    );
  }

  await expectPopupControlState(popupPage, {
    canPause: true,
    canResume: false,
    canStop: true,
    overrideSelectEnabled: false
  });

  await expectOverlayActionEnabled(pageA, "pause");
  await clickOverlayAction(pageA, "pause");
  await expectPopupPhaseState(popupPage, "paused");

  await expectPopupControlState(popupPage, {
    canPause: false,
    canResume: true,
    canStop: true,
    overrideSelectEnabled: true
  });

  await expectOverlayActionEnabled(pageA, "resume");
  await clickOverlayAction(pageA, "resume");
  await expectPopupPhaseState(popupPage, "running");

  await expectPopupControlState(popupPage, {
    canPause: true,
    canResume: false,
    canStop: true,
    overrideSelectEnabled: false
  });

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
}

// Helper for text overlap calculation
function calculateOverlap(textA, textB) {
  if (!textA || !textB) return 0;
  const wordsA = textA.toLowerCase().split(/\s+/).filter(w => w.length > 0);
  const wordsB = textB.toLowerCase().split(/\s+/).filter(w => w.length > 0);
  if (wordsA.length === 0 || wordsB.length === 0) return 0;
  let matches = 0;
  for (const w of wordsA) {
    if (wordsB.some(bw => bw.includes(w) || w.includes(bw))) matches++;
  }
  return matches / Math.max(wordsA.length, wordsB.length);
}

async function runStarterBusyBeforeStart(env) {
  const { pageA, popupPage } = env;
  
  // Send a prompt to make pageA busy (generating)
  const { ensureComposer, sendPrompt } = await import("./_playwright-bridge-helpers.mjs");
  await ensureComposer(pageA);
  await sendPrompt(pageA, "Generate a longer response with multiple paragraphs. Include details about architecture patterns. [CONTINUE]");

  // Wait for generation to start
  await sleep(3000);

  // Try to start - should NOT go directly to running
  await expectOverlayActionEnabled(pageA, "start");
  await clickOverlayAction(pageA, "start");

  // PHASE 1: Must enter waiting/settle/preflight FIRST
  // Wait a short time and check if we're in a waiting state
  await sleep(1000);
  let phase = await popupPage.locator("#phaseBadge").getAttribute("data-phase");
  
  // Must be in waiting/preflight first, NOT directly running
  assert.ok(
    ["waiting", "preflight", "settling"].includes(phase),
    `Expected waiting/preflight/settling first when starting with busy starter, got: ${phase}`
  );

  // PHASE 2: Then should eventually go to running after settle completes
  // Wait longer for settle to complete
  await sleep(5000);
  phase = await popupPage.locator("#phaseBadge").getAttribute("data-phase");
  
  // Should eventually be running
  assert.ok(
    ["running", "paused", "stopped", "error"].includes(phase),
    `Expected running/paused/stopped/error after settle, got: ${phase}`
  );

  // Cleanup - stop if still running
  if (phase === "running") {
    await expectOverlayActionEnabled(pageA, "stop");
    await clickOverlayAction(pageA, "stop");
    await expectPopupPhaseState(popupPage, "stopped");
  }

  return { success: true };
}

async function runStarterBusyBeforeResume(env) {
  const { pageA, popupPage } = env;
  
  // Start the relay first
  await expectOverlayActionEnabled(pageA, "start");
  await clickOverlayAction(pageA, "start");
  await expectPopupPhaseState(popupPage, "running");
  
  // Let it run briefly
  await sleep(2000);
  
  // Pause
  await expectOverlayActionEnabled(pageA, "pause");
  await clickOverlayAction(pageA, "pause");
  await expectPopupPhaseState(popupPage, "paused");

  // Now make pageA busy (generating)
  const { ensureComposer, sendPrompt } = await import("./_playwright-bridge-helpers.mjs");
  await ensureComposer(pageA);
  await sendPrompt(pageA, "Generate a detailed response about distributed systems. [CONTINUE]");

  // Wait for generation to start
  await sleep(3000);

  // Try to resume - should wait for generation to settle first
  await expectOverlayActionEnabled(pageA, "resume");
  await clickOverlayAction(pageA, "resume");

  // PHASE 1: Must enter waiting/settle/preflight FIRST
  await sleep(1000);
  let phase = await popupPage.locator("#phaseBadge").getAttribute("data-phase");
  
  assert.ok(
    ["waiting", "preflight", "settling"].includes(phase),
    `Expected waiting/preflight/settling first when resuming with busy starter, got: ${phase}`
  );

  // PHASE 2: Then should eventually go to running after settle completes
  await sleep(5000);
  phase = await popupPage.locator("#phaseBadge").getAttribute("data-phase");
  
  assert.ok(
    ["running", "paused", "stopped", "error"].includes(phase),
    `Expected running/paused/stopped/error after settle, got: ${phase}`
  );

  // Cleanup
  if (phase === "running") {
    await expectOverlayActionEnabled(pageA, "stop");
    await clickOverlayAction(pageA, "stop");
    await expectPopupPhaseState(popupPage, "stopped");
  }

  return { success: true };
}

async function runPopupOverlaySync(env) {
  const { pageA, pageB, popupPage } = env;
  
  // Start the relay
  await expectOverlayActionEnabled(pageA, "start");
  await clickOverlayAction(pageA, "start");
  await expectPopupPhaseState(popupPage, "running");

  // Let it run briefly
  await sleep(3000);

  // Compare popup vs overlay A
  const popupState = await readPopupState(popupPage);
  const overlayAState = await readOverlayState(pageA);
  
  const comparisonA = compareStates(popupState, overlayAState);
  assert.ok(comparisonA.consistent, `Popup vs Overlay A mismatch: ${comparisonA.mismatches.join(", ")}`);

  // Compare popup vs overlay B
  const overlayBState = await readOverlayState(pageB);
  const comparisonB = compareStates(popupState, overlayBState);
  assert.ok(comparisonB.consistent, `Popup vs Overlay B mismatch: ${comparisonB.mismatches.join(", ")}`);

  // Stop
  await expectOverlayActionEnabled(pageA, "stop");
  await clickOverlayAction(pageA, "stop");
  await expectPopupPhaseState(popupPage, "stopped");

  return { success: true };
}

async function runSourceBusyBeforeHop(env) {
  const { pageA, pageB, popupPage } = env;
  
  // Start
  await expectOverlayActionEnabled(pageA, "start");
  await clickOverlayAction(pageA, "start");
  await expectPopupPhaseState(popupPage, "running");

  // Wait for first hop to potentially start
  await sleep(5000);

  // Make pageB (potential source) busy during hop
  const { ensureComposer, sendPrompt } = await import("./_playwright-bridge-helpers.mjs");
  await ensureComposer(pageB);
  await sendPrompt(pageB, "Generate content while the bridge is running. [CONTINUE]");

  await sleep(3000);

  // PHASE 1: Must enter waiting/settle/preflight FIRST
  // This is the core assertion: if source is busy during hop, we MUST see waiting phase
  let phase = await popupPage.locator("#phaseBadge").getAttribute("data-phase");
  
  // MUST see waiting/preflight/settling - NOT allowed to go directly to running/paused/stopped
  // The scenario name "source-busy-before-hop" implies hop was attempted and source was busy
  // If we don't see waiting phase, the test fails - this is a strict requirement
  assert.ok(
    ["waiting", "preflight", "settling"].includes(phase),
    `Expected waiting/preflight/settling in phase 1 when source is busy during hop, got: ${phase}. ` +
    `This scenario expects the hop to enter waiting phase due to busy source.`
  );

  // PHASE 2: Wait longer to see final state after waiting/settle completes
  await sleep(5000);
  phase = await popupPage.locator("#phaseBadge").getAttribute("data-phase");
  
  // Should eventually be running or a terminal state (after waiting settles)
  assert.ok(
    ["running", "paused", "stopped", "error"].includes(phase),
    `Expected running/paused/stopped/error after waiting phase settled, got: ${phase}`
  );

  // Stop
  await expectOverlayActionEnabled(pageA, "stop");
  await clickOverlayAction(pageA, "stop");
  await expectPopupPhaseState(popupPage, "stopped");

  return { success: true };
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