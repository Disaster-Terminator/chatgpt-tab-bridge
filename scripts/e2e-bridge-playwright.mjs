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
  resolveAuthOptions,
  validateAuthFiles,
  loadSessionStorageData,
  addSessionStorageInitScript,
  restoreSessionStorage,
  ensureOverlay,
  clickOverlayAction,
  expectOverlayActionEnabled,
  expectPopupPhaseState,
  expectPopupControlState,
  bootstrapAnonymousThread,
  buildBootstrapPrompt,
  getExtensionId,
  openPopup,
  readPopupState,
  readOverlayState,
  compareStates,
  cleanupBrowser,
  sleep,
  assertSupportedThreadUrl,
  isSupportedThreadUrl,
  bindFromPage,
  getRuntimeState,
  fetchRuntimeEventsFromPopup,
  ensureComposer,
  sendPrompt,
  waitForSettledAssistantReply
} from "./_playwright-bridge-helpers.mjs";

const extensionPath = readPathFlag("--path") || path.resolve(process.cwd(), "dist/extension");
const browserExecutablePath = process.env.BROWSER_EXECUTABLE_PATH || null;
const urlA = readFlag("--url-a");
const urlB = readFlag("--url-b");
const scenarioFilter = readFlag("--scenario");
const skipBootstrap = process.argv.includes("--skip-bootstrap");
const rootOnly = process.argv.includes("--root-only");

// Auth state options
const authStateArg = readFlag("--auth-state");
const sessionStateArg = readFlag("--session-state");

// Resolve auth options
const authOptions = resolveAuthOptions({
  authStateArg,
  sessionStateArg
});

// Validate auth files before starting
const authValidation = await validateAuthFiles(authOptions.storageStatePath, authOptions.sessionStoragePath);
if (!authValidation.valid) {
  console.error(`[e2e] ERROR: ${authValidation.error}`);
  console.error("[e2e] To skip auth, provide --url-a and --url-b for existing threads.");
  process.exit(1);
}

// Load sessionStorage data
const sessionStorageData = await loadSessionStorageData(authOptions.sessionStoragePath);
console.log(`[e2e] Auth state: ${authOptions.storageStatePath}`);
console.log(`[e2e] Session storage: ${authOptions.sessionStoragePath} (${sessionStorageData ? "loaded" : "not found"})`);

// Scenario registry - each receives env and returns { success: true } or throws
const scenarios = {
  "happy-path": runHappyPath,
  "starter-busy-before-start": runStarterBusyBeforeStart,
  "starter-busy-before-resume": runStarterBusyBeforeResume,
  "popup-overlay-sync": runPopupOverlaySync,
  "source-busy-before-hop": runSourceBusyBeforeHop
};

function normalizeText(value) {
  return String(value || "").replace(/\r\n/g, "\n").replace(/\u00a0/g, " ").trim();
}

function hasWaitingLikeStep(stepText) {
  return normalizeText(stepText).toLowerCase().startsWith("waiting ");
}

async function collectThreadObservation(page) {
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

    const latestByRole = (role) => {
      const nodes = Array.from(document.querySelectorAll(`[data-message-author-role="${role}"]`));
      const latest = nodes.at(-1) || null;
      const text = normalize(latest?.textContent || "");
      return {
        count: nodes.length,
        text: text || null,
        hash: hashText(text)
      };
    };

    const latestUser = latestByRole("user");
    const latestAssistant = latestByRole("assistant");

    return {
      latestUserText: latestUser.text,
      latestUserHash: latestUser.hash,
      userMessageCount: latestUser.count,
      latestAssistantText: latestAssistant.text,
      latestAssistantHash: latestAssistant.hash,
      assistantMessageCount: latestAssistant.count,
      bridgeContext: normalize(latestUser.text || "").includes("[BRIDGE_CONTEXT]"),
      hopMarker: /(?:^|\n)hop:\s*[^\s\n]+/i.test(normalize(latestUser.text || ""))
    };
  });
}

async function ensureBoundRole(page, popupPage, role) {
  let lastError = "bind_not_attempted";

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const bindResult = await bindFromPage(page, popupPage, role);
    if (!bindResult.ok) {
      lastError = bindResult.error || "bind_failed";
    }

    await sleep(1000);
    const runtimeState = await getRuntimeState(popupPage);
    if (runtimeState.bindings?.[role]) {
      return runtimeState;
    }

    lastError = runtimeState.error || lastError;
  }

  throw new Error(`Failed to bind role ${role}: ${lastError}`);
}

async function ensureSourceAssistantSeed(page) {
  const baseline = await collectThreadObservation(page);
  if (baseline.latestAssistantHash) {
    return baseline;
  }

  await ensureComposer(page);
  await sendPrompt(page, "Hello, respond briefly and end with [BRIDGE_STATE] CONTINUE.");
  await waitForSettledAssistantReply(page, "e2e-source-seed");
  return collectThreadObservation(page);
}

function classifyHopFailure({
  expectedRound,
  dispatchRejectedEvent,
  verificationFailedEvent,
  waitingReplyEvent,
  replyTimeoutEvent,
  pageAccepted
}) {
  if (replyTimeoutEvent) {
    return `round_${replyTimeoutEvent.round}_beat_5_reply_timeout:${replyTimeoutEvent.verificationVerdict || "reply_timeout"}`;
  }

  if (dispatchRejectedEvent) {
    return `round_${expectedRound}_beat_3_dispatch_rejected:${dispatchRejectedEvent.verificationVerdict || "dispatch_rejected"}`;
  }

  if (verificationFailedEvent) {
    return `round_${expectedRound}_beat_4_page_acceptance_failed:${verificationFailedEvent.verificationVerdict || "verification_failed"}`;
  }

  if (waitingReplyEvent && !pageAccepted) {
    return `round_${expectedRound}_beat_4_waiting_before_page_acceptance`;
  }

  return `round_${expectedRound}_beat_4_acceptance_timeout`;
}

async function waitForAcceptedHop({ popupPage, targetPage, baselineTarget, expectedRound, targetRole }) {
  const startedAt = Date.now();
  let sawPageAcceptance = false;

  while (Date.now() - startedAt < 90000) {
    const [popupState, runtimeResult, targetObservation] = await Promise.all([
      readPopupState(popupPage).catch(() => ({})),
      fetchRuntimeEventsFromPopup(popupPage),
      collectThreadObservation(targetPage)
    ]);

    const runtimeEvents = runtimeResult.ok ? runtimeResult.events : [];
    const roundEvents = runtimeEvents.filter((event) => event.round === expectedRound && event.targetRole === targetRole);
    const dispatchRejectedEvent = roundEvents.find((event) => event.phaseStep === "dispatch_rejected") || null;
    const verificationFailedEvent = roundEvents.find((event) => event.phaseStep === "verification_failed") || null;
    const verificationPassedEvent = roundEvents.find((event) => event.phaseStep === "verification_passed") || null;
    const waitingReplyEvent = roundEvents.find((event) => event.phaseStep === "waiting_reply") || null;
    const replyTimeoutEvent = runtimeEvents.find((event) => {
      if (event.phaseStep !== "reply_timeout") {
        return false;
      }

      return expectedRound === 1 ? event.round === 1 : event.round === expectedRound - 1;
    }) || null;

    const userHashChanged =
      targetObservation.latestUserHash !== null &&
      targetObservation.latestUserHash !== baselineTarget.latestUserHash;
    const userCountIncreased = targetObservation.userMessageCount > baselineTarget.userMessageCount;
    const latestUserTextChanged =
      Boolean(targetObservation.latestUserText) &&
      normalizeText(targetObservation.latestUserText) !== normalizeText(baselineTarget.latestUserText);
    const pageAccepted =
      latestUserTextChanged &&
      targetObservation.bridgeContext &&
      targetObservation.hopMarker &&
      (userHashChanged || userCountIncreased);

    sawPageAcceptance ||= pageAccepted;

    if (pageAccepted && (verificationPassedEvent || waitingReplyEvent)) {
      return {
        ok: true,
        evidence: {
          round: expectedRound,
          targetRole,
          popupPhase: popupState.phase || null,
          popupStep: popupState.currentStep || null,
          gateReason:
            verificationPassedEvent?.verificationVerdict ||
            waitingReplyEvent?.verificationVerdict ||
            null,
          latestUserHash: targetObservation.latestUserHash,
          latestUserPreview: normalizeText(targetObservation.latestUserText).slice(0, 160)
        }
      };
    }

    if (dispatchRejectedEvent || verificationFailedEvent || replyTimeoutEvent || (waitingReplyEvent && !pageAccepted)) {
      return {
        ok: false,
        reason: classifyHopFailure({
          expectedRound,
          dispatchRejectedEvent,
          verificationFailedEvent,
          waitingReplyEvent,
          replyTimeoutEvent,
          pageAccepted
        }),
        context: {
          popupPhase: popupState.phase || null,
          popupStep: popupState.currentStep || null,
          sawPageAcceptance,
          latestUserHash: targetObservation.latestUserHash,
          latestUserPreview: normalizeText(targetObservation.latestUserText).slice(0, 160)
        }
      };
    }

    await sleep(1200);
  }

  return {
    ok: false,
    reason: classifyHopFailure({
      expectedRound,
      dispatchRejectedEvent: null,
      verificationFailedEvent: null,
      waitingReplyEvent: null,
      replyTimeoutEvent: null,
      pageAccepted: sawPageAcceptance
    }),
    context: {
      sawPageAcceptance
    }
  };
}

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
  // Launch with auth state
  const { context, userDataDir } = await launchBrowserWithExtension({ 
    extensionPath, 
    browserExecutablePath,
    storageStatePath: authOptions.storageStatePath,
    sessionStorageData
  });
  
  // Add sessionStorage init script
  if (sessionStorageData) {
    addSessionStorageInitScript(context, sessionStorageData);
  }
  
  const [pageA, pageB] = await getTwoPages(context);
  
  // Navigate based on mode
  if (urlA && urlB) {
    console.log("  Using provided thread URLs...");
    await pageA.goto(urlA, { waitUntil: "domcontentloaded" });
    await pageB.goto(urlB, { waitUntil: "domcontentloaded" });
    // Restore sessionStorage after navigation (backup to init script)
    if (sessionStorageData) {
      await restoreSessionStorage(pageA, sessionStorageData);
      await restoreSessionStorage(pageB, sessionStorageData);
    }
    // Validate URLs are supported thread URLs before binding
    await assertSupportedThreadUrl(pageA, "pageA (--url-a)");
    await assertSupportedThreadUrl(pageB, "pageB (--url-b)");
  } else if (skipBootstrap) {
    console.log("  Skip bootstrap mode - waiting for user navigation...");
    await Promise.all([
      pageA.goto("https://chatgpt.com", { waitUntil: "domcontentloaded" }),
      pageB.goto("https://chatgpt.com", { waitUntil: "domcontentloaded" })
    ]);
    // Restore sessionStorage after navigation
    if (sessionStorageData) {
      await restoreSessionStorage(pageA, sessionStorageData);
      await restoreSessionStorage(pageB, sessionStorageData);
    }
    // Wait for user to signal ready
    console.log("  Please navigate both pages to valid thread URLs (/c/ or /g/.../c/), then press Enter...");
    await new Promise(resolve => {
      process.stdin.once("data", () => resolve());
    });
    if (!rootOnly) {
      await assertSupportedThreadUrl(pageA, "pageA (manual)");
      await assertSupportedThreadUrl(pageB, "pageB (manual)");
    }
  } else {
    // Default: Use auth state for authenticated bootstrap
    console.log("  Using exported auth state for authenticated bootstrap...");
    await Promise.all([
      pageA.goto("https://chatgpt.com", { waitUntil: "domcontentloaded" }),
      pageB.goto("https://chatgpt.com", { waitUntil: "domcontentloaded" })
    ]);
    
    // Restore sessionStorage after navigation (backup to init script)
    if (sessionStorageData) {
      await restoreSessionStorage(pageA, sessionStorageData);
      await restoreSessionStorage(pageB, sessionStorageData);
    }
    
    // Give page time to stabilize
    await sleep(2000);

    if (!rootOnly) {
      await bootstrapAnonymousThread(pageA, "seed-a", buildBootstrapPrompt("A"));
      await bootstrapAnonymousThread(pageB, "seed-b", buildBootstrapPrompt("B"));
    } else {
      const [pageAHasUrl, pageBHasUrl] = await Promise.all([
        isSupportedThreadUrl(pageA),
        isSupportedThreadUrl(pageB)
      ]);
      console.log(
        `  Root-only mode: skipping thread bootstrap (A URL supported: ${pageAHasUrl}, B URL supported: ${pageBHasUrl})`
      );
    }
  }
  
  // Wait for overlay
  await ensureOverlay(pageA);
  await ensureOverlay(pageB);

  // Open popup
  const extensionId = await getExtensionId(pageA);
  const popupPage = await openPopup(context, extensionId);

  await ensureBoundRole(pageA, popupPage, "A");
  await ensureBoundRole(pageB, popupPage, "B");

  const runtimeState = await getRuntimeState(popupPage);
  assert.ok(runtimeState.bindings?.A, "Expected runtime binding for A");
  assert.ok(runtimeState.bindings?.B, "Expected runtime binding for B");

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

  await ensureSourceAssistantSeed(pageA);

  const initialRound = Number(await popupPage.locator("#roundValue").innerText());
  const [baselineTargetB, baselineTargetA] = await Promise.all([
    collectThreadObservation(pageB),
    collectThreadObservation(pageA)
  ]);

  await expectOverlayActionEnabled(pageA, "start");
  await clickOverlayAction(pageA, "start");
  await expectPopupPhaseState(popupPage, "running");

  await expectPopupControlState(popupPage, {
    canPause: true,
    canResume: false,
    canStop: true,
    overrideSelectEnabled: false
  });

  const roundOne = await waitForAcceptedHop({
    popupPage,
    targetPage: pageB,
    baselineTarget: baselineTargetB,
    expectedRound: initialRound + 1,
    targetRole: "B"
  });
  if (!roundOne.ok) {
    throw new Error(`Round 1 acceptance failed: ${roundOne.reason} ${JSON.stringify(roundOne.context || {})}`);
  }

  const roundTwo = await waitForAcceptedHop({
    popupPage,
    targetPage: pageA,
    baselineTarget: baselineTargetA,
    expectedRound: initialRound + 2,
    targetRole: "A"
  });
  if (!roundTwo.ok) {
    throw new Error(`Round 2 acceptance failed: ${roundTwo.reason} ${JSON.stringify(roundTwo.context || {})}`);
  }

  const runtimeEvents = await fetchRuntimeEventsFromPopup(popupPage);
  const verificationPassRounds = runtimeEvents.ok
    ? runtimeEvents.events
        .filter((event) => event.phaseStep === "verification_passed")
        .map((event) => event.round)
    : [];
  assert.ok(
    verificationPassRounds.includes(initialRound + 1),
    `Expected verification_passed for round ${initialRound + 1}, got ${JSON.stringify(verificationPassRounds)}`
  );
  assert.ok(
    verificationPassRounds.includes(initialRound + 2),
    `Expected verification_passed for round ${initialRound + 2}, got ${JSON.stringify(verificationPassRounds)}`
  );

  const finalPopupState = await readPopupState(popupPage);
  assert.equal(finalPopupState.phase, "running");
  assert.ok(
    String(finalPopupState.currentStep || "").toLowerCase().includes("waiting"),
    `Expected multi-round run to remain in a waiting step after round 2 acceptance, got ${JSON.stringify(finalPopupState)}`
  );

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

  // STEP 1: runtime phase stays `running`; waiting/preflight is expressed via currentStep.
  await sleep(1000);
  const popupStateDuringStarterSettle = await readPopupState(popupPage);

  assert.equal(
    popupStateDuringStarterSettle.phase,
    "running",
    `Expected phase to remain running while starter settle is expressed via currentStep, got: ${JSON.stringify(popupStateDuringStarterSettle)}`
  );
  assert.ok(
    hasWaitingLikeStep(popupStateDuringStarterSettle.currentStep),
    `Expected currentStep to carry the waiting/preflight signal when starting with busy starter, got: ${JSON.stringify(popupStateDuringStarterSettle)}`
  );

  // STEP 2: Then should eventually go to a stable allowed phase after settle completes.
  await sleep(5000);
  let phase = await popupPage.locator("#phaseBadge").getAttribute("data-phase");
  
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

  // STEP 1: runtime phase stays `running`; waiting/preflight is expressed via currentStep.
  await sleep(1000);
  const popupStateDuringResumeSettle = await readPopupState(popupPage);

  assert.equal(
    popupStateDuringResumeSettle.phase,
    "running",
    `Expected phase to remain running while resume settle is expressed via currentStep, got: ${JSON.stringify(popupStateDuringResumeSettle)}`
  );
  assert.ok(
    hasWaitingLikeStep(popupStateDuringResumeSettle.currentStep),
    `Expected currentStep to carry the waiting/preflight signal when resuming with busy starter, got: ${JSON.stringify(popupStateDuringResumeSettle)}`
  );

  // STEP 2: Then should eventually go to a stable allowed phase after settle completes.
  await sleep(5000);
  let phase = await popupPage.locator("#phaseBadge").getAttribute("data-phase");
  
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

  // STEP 1: runtime phase stays `running`; waiting/preflight is expressed via currentStep.
  const popupStateDuringBusySource = await readPopupState(popupPage);

  assert.equal(
    popupStateDuringBusySource.phase,
    "running",
    `Expected phase to remain running while source-busy handling is expressed via currentStep, got: ${JSON.stringify(popupStateDuringBusySource)}`
  );
  assert.ok(
    hasWaitingLikeStep(popupStateDuringBusySource.currentStep),
    `Expected currentStep to carry the waiting/preflight signal when source is busy during hop, got: ${JSON.stringify(popupStateDuringBusySource)}`
  );

  // STEP 2: Wait longer to see final state after waiting/settle completes.
  await sleep(5000);
  let phase = await popupPage.locator("#phaseBadge").getAttribute("data-phase");
  
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
  : rootOnly
    ? ["happy-path"]
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
