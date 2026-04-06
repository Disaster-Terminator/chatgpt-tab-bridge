/**
 * Real-hop verification test - validates actual message submission.
 * This is the PRIMARY acceptance path for bridge functionality.
 * 
 * Usage:
 *   pnpm run test:real-hop -- --url-a <thread-a> --url-b <thread-b>
 *   pnpm run test:real-hop -- --skip-bootstrap  # manual thread navigation
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
  getExtensionId,
  openPopup,
  assertSupportedThreadUrl,
  sleep
} from "./_playwright-bridge-helpers.mjs";

const extensionPath = readPathFlag("--path") || path.resolve(process.cwd(), "dist/extension");
const browserExecutablePath = process.env.BROWSER_EXECUTABLE_PATH || null;
const urlA = readFlag("--url-a");
const urlB = readFlag("--url-b");
const skipBootstrap = process.argv.includes("--skip-bootstrap");

const VERIFICATION_TIMEOUT_MS = 60000;
const EVENT_POLL_INTERVAL_MS = 2000;

async function fetchRuntimeEvents(page) {
  return await page.evaluate(async () => {
    try {
      const response = await chrome.runtime.sendMessage({
        type: "GET_RECENT_RUNTIME_EVENTS"
      });
      return response;
    } catch (error) {
      return { error: error.message };
    }
  });
}

async function waitForVerificationPass(events, timeoutMs = 30000) {
  const startedAt = Date.now();
  
  while (Date.now() - startedAt < timeoutMs) {
    const hasVerificationPassed = events.some(
      e => e.phaseStep === "verification_passed"
    );
    if (hasVerificationPassed) {
      return true;
    }
    await sleep(EVENT_POLL_INTERVAL_MS);
  }
  return false;
}

async function checkHopSequence(pageA, pageB, popupPage, timeoutMs = VERIFICATION_TIMEOUT_MS) {
  const startedAt = Date.now();
  
  while (Date.now() - startedAt < timeoutMs) {
    const events = await fetchRuntimeEvents(pageA);
    
    if (!Array.isArray(events) || events.length === 0) {
      await sleep(EVENT_POLL_INTERVAL_MS);
      continue;
    }
    
    const phaseSteps = events.map(e => e.phaseStep);
    console.log(`[checkHopSequence] Current phase steps: ${phaseSteps.join(", ")}`);
    
    const hasSending = phaseSteps.includes("sending") || phaseSteps.includes("pre_send_baseline") || phaseSteps.includes("send_failed");
    const hasVerification = phaseSteps.includes("verifying") || phaseSteps.includes("verification_passed");
    const hasWaitingReply = phaseSteps.includes("waiting_reply");
    
    if (hasWaitingReply && !phaseSteps.includes("verification_passed")) {
      return {
        success: false,
        reason: "entered_waiting_reply_without_verification_passed",
        events: events
      };
    }
    
    if (phaseSteps.includes("verification_passed") && hasWaitingReply) {
      return {
        success: true,
        reason: "verified_hop_completed",
        events: events
      };
    }
    
    if (phaseSteps.includes("send_failed")) {
      return {
        success: false,
        reason: "send_failed",
        events: events
      };
    }
    
    await sleep(EVENT_POLL_INTERVAL_MS);
  }
  
  return {
    success: false,
    reason: "timeout_waiting_for_hop",
    events: []
  };
}

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
    await assertSupportedThreadUrl(pageA, "pageA (--url-a)");
    await assertSupportedThreadUrl(pageB, "pageB (--url-b)");
  } else if (skipBootstrap) {
    console.log("Skip bootstrap mode - waiting for you to navigate to thread URLs...");
    console.log("Please navigate both pages to valid /c/ or /g/.../c/ URLs, then press Enter in this terminal.");
    await Promise.all([
      pageA.goto("https://chatgpt.com", { waitUntil: "domcontentloaded" }),
      pageB.goto("https://chatgpt.com", { waitUntil: "domcontentloaded" })
    ]);
    console.log("Ready? Press Enter to continue...");
    await new Promise(resolve => {
      process.stdin.once("data", () => resolve());
    });
    await assertSupportedThreadUrl(pageA, "pageA (manual)");
    await assertSupportedThreadUrl(pageB, "pageB (manual)");
  } else {
    throw new Error("This test requires real thread URLs. Use --url-a and --url-b, or --skip-bootstrap for manual navigation.");
  }

  await ensureOverlay(pageA);
  await ensureOverlay(pageB);

  await clickOverlayBind(pageA, "A");
  await clickOverlayBind(pageB, "B");

  const extensionId = await getExtensionId(pageA);
  const popupPage = await openPopup(context, extensionId);

  await expectBindingState(popupPage, "A");
  await expectBindingState(popupPage, "B");
  await expectPopupPhaseState(popupPage, "ready");

  console.log("Starting relay session...");
  await expectOverlayActionEnabled(pageA, "start");
  await clickOverlayAction(pageA, "start");
  await expectPopupPhaseState(popupPage, "running");

  console.log("Waiting for hop completion...");
  const result = await checkHopSequence(pageA, pageB, popupPage);

  if (!result.success) {
    console.error(`FAIL: ${result.reason}`);
    console.error("Events captured:");
    for (const event of result.events.slice(-10)) {
      console.error(`  - ${event.phaseStep}: ${event.verificationVerdict}`);
    }
    throw new Error(`Real-hop verification failed: ${result.reason}`);
  }

  console.log("Verifying event sequence...");
  const verificationPassedEvent = result.events.find(e => e.phaseStep === "verification_passed");
  const waitingReplyEvent = result.events.find(e => e.phaseStep === "waiting_reply");
  
  assert.ok(verificationPassedEvent, "Must have verification_passed event");
  assert.ok(waitingReplyEvent, "Must have waiting_reply event");
  
  const eventOrder = result.events.map(e => e.phaseStep);
  const verificationIdx = eventOrder.indexOf("verification_passed");
  const waitingIdx = eventOrder.indexOf("waiting_reply");
  
  assert.ok(verificationIdx < waitingIdx, "verification_passed must come before waiting_reply");
  
  console.log("Verification evidence:");
  console.log(`  - dispatchReadbackSummary: ${verificationPassedEvent.dispatchReadbackSummary}`);
  console.log(`  - sendTriggerMode: ${verificationPassedEvent.sendTriggerMode}`);
  console.log(`  - verificationBaseline: ${verificationPassedEvent.verificationBaseline.slice(0, 80)}...`);
  console.log(`  - verificationPollSample: ${verificationPassedEvent.verificationPollSample.slice(0, 80)}...`);
  console.log(`  - verificationVerdict: ${verificationPassedEvent.verificationVerdict}`);

  console.log("\nReal-hop test: PASS");
} catch (error) {
  runError = error;
} finally {
  const { cleanupBrowser } = await import("./_playwright-bridge-helpers.mjs");
  await cleanupBrowser(context, userDataDir);
}

if (runError) {
  throw runError;
}