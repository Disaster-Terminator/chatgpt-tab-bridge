/**
 * Semi-automated bridge test using Playwright.
 * Uses shared helpers from _playwright-bridge-helpers.mjs
 */

import assert from "node:assert/strict";
import path from "node:path";
import process from "node:process";

import {
  connectBrowserWithExtensionOrCdp,
  cleanupBrowserConnection,
  getTwoPages,
  readFlag,
  readPathFlag,
  resolveAuthOptions,
  resolveBrowserStrategyFromCli,
  validateAuthFiles,
  validateAuthState,
  loadSessionStorageData,
  addSessionStorageInitScript,
  restoreSessionStorage,
  reloadAfterSessionRestore,
  ensureOverlay,
  clickOverlayAction,
  clickPopupAction,
  expectOverlayActionEnabled,
  expectPopupActionEnabled,
  expectPopupPhaseState,
  expectPopupControlState,
  findPageByOverlayTabId,
  getExtensionId,
  openPopup,
  assertSupportedThreadUrl,
  isSupportedThreadUrl,
  ensureComposer,
  bindFromPage,
  getRuntimeState,
  readPopupState,
  isExpectedPendingBoundaryVisible,
  collectThreadObservation,
  ensureAnonymousSourceSeedWithBlocker,
  ensureAuthBackedSourceSeedWithBlocker,
  validateCurrentPageAuthState,
  isHarnessBlocker,
  sleep
} from "./_playwright-bridge-helpers.mjs";

const extensionPath = readPathFlag("--path") || path.resolve(process.cwd(), "dist/extension");
const browserExecutablePath = process.env.BROWSER_EXECUTABLE_PATH || null;
const urlA = readFlag("--url-a");
const urlB = readFlag("--url-b");
const skipBootstrap = process.argv.includes("--skip-bootstrap");
const cdpEndpointArg = readFlag("--cdp-endpoint");
const reuseOpenChatgptTab = !process.argv.includes("--no-reuse-open-chatgpt-tab");
const noNavOnAttach = !process.argv.includes("--nav-on-attach");

// Auth state options
const authStateArg = readFlag("--auth-state");
const sessionStateArg = readFlag("--session-state");

// Resolve auth options
const authOptions = resolveAuthOptions({
  authStateArg,
  sessionStateArg
});

const browserStrategy = resolveBrowserStrategyFromCli({
  cdpEndpointArg,
  reuseOpenChatgptTab,
  noNavOnAttach
});

async function ensureChatGptPage(page) {
  const alreadyChatGpt = page.url().startsWith("https://chatgpt.com");
  if (browserStrategy.mode === "cdp" && browserStrategy.noNavOnAttach && alreadyChatGpt) {
    return;
  }

  await page.goto("https://chatgpt.com", { waitUntil: "domcontentloaded" });
}

let sessionStorageData = null;
if (authOptions.useAuth) {
  const authValidation = await validateAuthFiles(authOptions.storageStatePath, authOptions.sessionStoragePath);
  if (!authValidation.valid) {
    console.error(`[semi] ERROR: ${authValidation.error}`);
    console.error("[semi] Auth is opt-in. Fix the provided auth paths or omit --auth-state/--session-state to use the anonymous baseline.");
    process.exit(1);
  }

  sessionStorageData = await loadSessionStorageData(authOptions.sessionStoragePath);
  console.log(`[semi] Auth mode: enabled (${authOptions.storageStatePath || "session-only"})`);
  console.log(`[semi] Session storage: ${authOptions.sessionStoragePath || "not provided"} (${sessionStorageData ? "loaded" : "not found"})`);
} else {
  console.log("[semi] Auth mode: disabled by default; using anonymous/live-session baseline.");
}

// Connect browser with shared strategy layer
const browserConnection = await connectBrowserWithExtensionOrCdp({
  extensionPath,
  browserExecutablePath,
  storageStatePath: authOptions.storageStatePath,
  sessionStorageData,
  strategy: browserStrategy
});
const { context } = browserConnection;

// Add sessionStorage init script
if (sessionStorageData) {
  addSessionStorageInitScript(context, sessionStorageData);
}

if (authOptions.useAuth) {
  const validationPage = await context.newPage();
  const authStateCheck = await validateAuthState(validationPage);
  console.log(`[semi] Auth state check: ${authStateCheck.valid ? 'valid' : 'invalid'}`);
  if (authStateCheck.valid) {
    const validatedUrl = validationPage.url();
    console.log(`[semi] Auth validation landed on: ${validatedUrl}`);
    if (validatedUrl.includes("auth.openai.com")) {
      authStateCheck.valid = false;
      authStateCheck.error = `Auth validation redirected to login page: ${validatedUrl}`;
    }
  }
  await validationPage.close().catch(() => {});
  if (!authStateCheck.valid) {
    console.error(`[semi] ERROR: ${authStateCheck.error}`);
    process.exit(1);
  }
}

function normalizeText(value) {
  return String(value || "").replace(/\r\n/g, "\n").replace(/\u00a0/g, " ").trim();
}

function parseNextHopText(nextHopText) {
  const normalized = normalizeText(nextHopText).toUpperCase();
  const match = normalized.match(/\b(A|B)\s*->\s*(A|B)\b/);
  if (!match) {
    throw new Error(`Unable to parse next hop text: ${JSON.stringify(nextHopText)}`);
  }

  return {
    sourceRole: match[1],
    targetRole: match[2]
  };
}

async function ensureBoundRole(page, popupPage, role) {
  let lastError = "bind_not_attempted";

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const bindResult = await bindFromPage(page, popupPage, role);
    if (!bindResult.ok) {
      lastError = bindResult.error || "bind_failed";
    }

    await page.waitForTimeout(1000);
    const runtimeState = await getRuntimeState(popupPage);
    if (runtimeState.bindings?.[role]) {
      return runtimeState;
    }

    lastError = runtimeState.error || lastError;
  }

  throw new Error(`Failed to bind role ${role}: ${lastError}`);
}

async function waitForPopupNextHop(popupPage, expectedSourceRole, expectedTargetRole, timeoutMs = 90000) {
  const expectedText = `${expectedSourceRole} -> ${expectedTargetRole}`;
  await popupPage.waitForFunction(
    (targetText) => {
      const node = document.querySelector("#nextHopValue");
      return (node?.textContent || "").trim().toUpperCase() === targetText;
    },
    expectedText,
    { timeout: timeoutMs }
  );
}

async function waitForAcceptedHop({ popupPage, targetPage, baselineTarget, expectedRound, targetRole, timeoutMs = 90000 }) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const [popupState, targetObservation] = await Promise.all([
      readPopupState(popupPage),
      collectThreadObservation(targetPage)
    ]);

    const normalizedLatestUserText = normalizeText(targetObservation.latestUserText);
    const latestUserTextChanged =
      Boolean(normalizedLatestUserText) &&
      normalizedLatestUserText !== normalizeText(baselineTarget.latestUserText);
    const userHashChanged =
      targetObservation.latestUserHash !== null &&
      targetObservation.latestUserHash !== baselineTarget.latestUserHash;
    const userCountIncreased = targetObservation.userMessageCount > baselineTarget.userMessageCount;
    const pageAccepted =
      latestUserTextChanged &&
      normalizedLatestUserText.includes("[BRIDGE_CONTEXT]") &&
      /(?:^|\n)hop:\s*[^\s\n]+/i.test(normalizedLatestUserText) &&
      (userHashChanged || userCountIncreased);

    if (pageAccepted) {
      return {
        round: expectedRound,
        targetRole,
        popupPhase: popupState.phase,
        popupStep: popupState.currentStep,
        latestUserHash: targetObservation.latestUserHash,
        latestUserPreview: normalizedLatestUserText.slice(0, 160)
      };
    }

    if (popupState.phase === "error") {
      throw new Error(`Hop ${expectedRound} -> ${targetRole} entered error phase: ${JSON.stringify(popupState)}`);
    }

    await popupPage.waitForTimeout(1200);
  }

  throw new Error(`Timed out waiting for accepted hop round=${expectedRound} target=${targetRole}`);
}

async function waitForTargetReplyAndPendingHop({
  pageA,
  popupPage,
  sourcePage,
  sourceRole,
  targetPage,
  targetRole,
  pauseOnBoundary = false,
  timeoutMs = 90000
}) {
  const baselineTarget = await collectThreadObservation(targetPage);
  const expectedSourceRole = sourceRole;
  const expectedTargetRole = sourceRole === "A" ? "B" : "A";
  const startedAt = Date.now();
  let pauseRequested = false;

  while (Date.now() - startedAt < timeoutMs) {
    const [popupState, runtimeState, targetObservation] = await Promise.all([
      readPopupState(popupPage),
      getRuntimeState(popupPage),
      collectThreadObservation(targetPage)
    ]);

    const targetReplyObserved =
      targetObservation.latestAssistantHash !== null &&
      targetObservation.latestAssistantHash !== baselineTarget.latestAssistantHash &&
      targetObservation.generating === false;
    const atExpectedPendingBoundary = isExpectedPendingBoundaryVisible({
      popupState,
      runtimeState,
      expectedSourceRole,
      expectedTargetRole
    });

    if (pauseOnBoundary && targetReplyObserved && atExpectedPendingBoundary && !pauseRequested) {
      await expectPopupActionEnabled(popupPage, "pause");
      await sendPopupRuntimeAction(popupPage, "PAUSE_SESSION");
      pauseRequested = true;
    }

    if (pauseOnBoundary && pauseRequested && runtimeState.phase === "paused" && atExpectedPendingBoundary) {
      await expectPopupPhaseState(popupPage, "paused");
      await expectPopupControlState(popupPage, {
        canPause: false,
        canResume: true,
        canStop: true,
        overrideSelectEnabled: true
      });

      const pausedState = await readPopupState(popupPage);
      assert.deepEqual(
        parseNextHopText(pausedState.nextHop),
        { sourceRole: expectedSourceRole, targetRole: expectedTargetRole },
        `Expected paused next hop ${expectedSourceRole} -> ${expectedTargetRole}, got ${JSON.stringify(pausedState)}`
      );

      return collectThreadObservation(sourcePage);
    }

    if (!pauseOnBoundary && targetReplyObserved && atExpectedPendingBoundary) {
      return collectThreadObservation(sourcePage);
    }

    if (pauseOnBoundary && targetReplyObserved && pauseRequested && runtimeState.phase === "paused") {
      const pausedState = await readPopupState(popupPage);
      const activeHop = runtimeState.activeHop;
      const pausedAtExpectedBoundary = Boolean(
        activeHop &&
        activeHop.stage === "pending" &&
        activeHop.sourceRole === expectedSourceRole &&
        activeHop.targetRole === expectedTargetRole
      );

      if (pausedAtExpectedBoundary) {
        assert.deepEqual(
          parseNextHopText(pausedState.nextHop),
          { sourceRole: expectedSourceRole, targetRole: expectedTargetRole },
          `Expected paused next hop ${expectedSourceRole} -> ${expectedTargetRole}, got ${JSON.stringify(pausedState)}`
        );
        return collectThreadObservation(sourcePage);
      }

      throw new Error(
        `Pause settled before pending boundary ${expectedSourceRole} -> ${expectedTargetRole}: ${JSON.stringify(runtimeState)}`
      );
    }

    await popupPage.waitForTimeout(500);
  }

  throw new Error(`Timed out waiting for ${targetRole} reply and pending hop ${expectedSourceRole} -> ${expectedTargetRole}`);
}

async function pauseAtPendingHop({ pageA, popupPage, expectedSourceRole, expectedTargetRole }) {
  await expectPopupActionEnabled(popupPage, "pause");
  await clickPopupAction(popupPage, "pause");
  await expectPopupPhaseState(popupPage, "paused");
  await expectPopupControlState(popupPage, {
    canPause: false,
    canResume: true,
    canStop: true,
    overrideSelectEnabled: true
  });

  const pausedState = await readPopupState(popupPage);
  assert.deepEqual(
    parseNextHopText(pausedState.nextHop),
    { sourceRole: expectedSourceRole, targetRole: expectedTargetRole },
    `Expected paused next hop ${expectedSourceRole} -> ${expectedTargetRole}, got ${JSON.stringify(pausedState)}`
  );
}

async function sendPopupRuntimeAction(popupPage, type) {
  return popupPage.evaluate(async (messageType) => {
    return await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: messageType }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        resolve(response);
      });
    });
  }, type);
}

async function reloadExtensionRuntime(context, popupPage, extensionId) {
  await popupPage.evaluate(() => {
    chrome.runtime.reload();
  }).catch(() => {});
  await popupPage.close().catch(() => {});
  await sleep(1500);
  return openPopup(context, extensionId);
}

async function normalizeRuntimeToReady(popupPage) {
  let runtimeState = await getRuntimeState(popupPage);

  if (runtimeState.phase === "running" || runtimeState.phase === "paused") {
    await expectPopupActionEnabled(popupPage, "stop");
    await clickPopupAction(popupPage, "stop");
    await expectPopupPhaseState(popupPage, "stopped");
    runtimeState = await getRuntimeState(popupPage);
  }

  if (runtimeState.phase === "stopped" || runtimeState.phase === "error") {
    await expectPopupActionEnabled(popupPage, "clear-terminal");
    await clickPopupAction(popupPage, "clear-terminal");
    await expectPopupPhaseState(popupPage, "ready");
    runtimeState = await getRuntimeState(popupPage);
  }

  return runtimeState;
}

async function pauseOnExpectedPendingHop({ pageA, popupPage, expectedSourceRole, expectedTargetRole, timeoutMs = 90000 }) {
  const expectedHopText = `${expectedSourceRole} -> ${expectedTargetRole}`;
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const [popupState, runtimeState] = await Promise.all([
      readPopupState(popupPage),
      getRuntimeState(popupPage)
    ]);

    const nextHopMatches = normalizeText(popupState.nextHop).toUpperCase() === expectedHopText;
    const atBetweenHopBoundary = isExpectedPendingBoundaryVisible({
      popupState,
      runtimeState,
      expectedSourceRole,
      expectedTargetRole
    });

    if (nextHopMatches && atBetweenHopBoundary) {
      await pauseAtPendingHop({ pageA, popupPage, expectedSourceRole, expectedTargetRole });
      return;
    }

    await popupPage.waitForTimeout(800);
  }

  throw new Error(`Timed out waiting to pause on pending hop ${expectedHopText}`);
}

async function resumeBranch({ pageA, pageB, popupPage, overrideRole = null, expectedSourceRole, expectedTargetRole, baselineTargetObservation }) {
  if (overrideRole) {
    await popupPage.locator("#overrideSelect").selectOption(overrideRole);
    await popupPage.waitForTimeout(500);
  }

  const popupBeforeResume = await readPopupState(popupPage);
  assert.equal(
    normalizeText(popupBeforeResume.nextHop).toUpperCase(),
    `${expectedSourceRole} -> ${expectedTargetRole}`,
    `Expected popup next hop ${expectedSourceRole} -> ${expectedTargetRole} before resume, got ${JSON.stringify(popupBeforeResume)}`
  );

  const roundBeforeResume = Number(await popupPage.locator("#roundValue").innerText());
  await expectPopupActionEnabled(popupPage, "resume");
  await clickPopupAction(popupPage, "resume");
  await expectPopupPhaseState(popupPage, "running");

  return await waitForAcceptedHop({
    popupPage,
    targetPage: expectedTargetRole === "A" ? pageA : pageB,
    baselineTarget: baselineTargetObservation,
    expectedRound: roundBeforeResume + 1,
    targetRole: expectedTargetRole
  });
}

async function reachPendingBtoABoundary({ pageA, pageB, popupPage }) {
  const readyState = await normalizeRuntimeToReady(popupPage);
  assert.ok(readyState.bindings?.A, "Expected runtime binding for A before branch start");
  assert.ok(readyState.bindings?.B, "Expected runtime binding for B before branch start");
  assert.equal(readyState.phase, "ready", `Expected runtime ready before branch start, got ${JSON.stringify(readyState)}`);

  const roundBeforeStart = Number(await popupPage.locator("#roundValue").innerText());
  const baselineBStart = await collectThreadObservation(pageB);
  await expectPopupActionEnabled(popupPage, "start");
  await clickPopupAction(popupPage, "start");
  await expectPopupPhaseState(popupPage, "running");
  await expectPopupControlState(popupPage, {
    canPause: true,
    canResume: false,
    canStop: true,
    overrideSelectEnabled: false
  });

  const firstHop = await waitForAcceptedHop({
    popupPage,
    targetPage: pageB,
    baselineTarget: baselineBStart,
    expectedRound: roundBeforeStart + 1,
    targetRole: "B"
  });

  await waitForTargetReplyAndPendingHop({
    pageA,
    popupPage,
    sourcePage: pageB,
    sourceRole: "B",
    targetPage: pageB,
    targetRole: "B",
    pauseOnBoundary: true
  });

  return { firstHop };
}

let runError = null;

try {
  let [pageA, pageB] = await getTwoPages(context, {
    reuseOpenChatgptTab: browserStrategy.mode === "cdp" && browserStrategy.reuseOpenChatgptTab,
    preserveExistingPages: browserStrategy.mode === "cdp",
    noNavOnAttach: browserStrategy.mode === "cdp" && browserStrategy.noNavOnAttach
  });

  console.log(`[semi] Pages acquired, navigating with ${authOptions.useAuth ? "auth-backed" : "anonymous"} live-session baseline...`);
  console.log("[semi] Task 9 control-flow harness: reuse one seeded live session across resume branches; blockers are classified separately from control-flow failures.");

  if (urlA && urlB) {
    console.log("[semi] Using provided thread URLs.");
    await pageA.goto(urlA, { waitUntil: "domcontentloaded" });
    await pageB.goto(urlB, { waitUntil: "domcontentloaded" });
    await assertSupportedThreadUrl(pageA, "pageA (--url-a)");
    await assertSupportedThreadUrl(pageB, "pageB (--url-b)");
  } else if (skipBootstrap) {
    console.log("[semi] Skip bootstrap mode - waiting for manual live-session pages...");
    await Promise.all([ensureChatGptPage(pageA), ensureChatGptPage(pageB)]);
    if (sessionStorageData) {
      await restoreSessionStorage(pageA, sessionStorageData);
      await restoreSessionStorage(pageB, sessionStorageData);
      await Promise.all([
        reloadAfterSessionRestore(pageA, sessionStorageData),
        reloadAfterSessionRestore(pageB, sessionStorageData)
      ]);
    }
    console.log("[semi] Navigate both pages to ChatGPT live sessions, then press Enter...");
    await new Promise((resolve) => {
      process.stdin.once("data", () => resolve());
    });
  } else {
    await Promise.all([ensureChatGptPage(pageA), ensureChatGptPage(pageB)]);
    if (sessionStorageData) {
      await restoreSessionStorage(pageA, sessionStorageData);
      await restoreSessionStorage(pageB, sessionStorageData);
      await Promise.all([
        reloadAfterSessionRestore(pageA, sessionStorageData),
        reloadAfterSessionRestore(pageB, sessionStorageData)
      ]);
    }
    await pageA.waitForTimeout(2000);
  }

  await Promise.all([pageA.title(), pageB.title()]);
  console.log("[semi] Pages are healthy");

  await ensureOverlay(pageA);
  await ensureOverlay(pageB);
  console.log("[semi] Overlays ready");

  const extensionId = await getExtensionId(pageA);
  let popupPage = await openPopup(context, extensionId);
  popupPage = await reloadExtensionRuntime(context, popupPage, extensionId);

  // Normalize runtime to ready state at harness entry - before any seeding/assertions
  // This ensures we don't inherit stale running/stopped state from previous sessions
  const initialRuntimeState = await normalizeRuntimeToReady(popupPage);
  console.log(`[semi] Initial runtime state after normalization: ${initialRuntimeState.phase}`);

  await Promise.all([
    pageA.reload({ waitUntil: "domcontentloaded" }),
    pageB.reload({ waitUntil: "domcontentloaded" })
  ]);
  await ensureOverlay(pageA);
  await ensureOverlay(pageB);

  await ensureBoundRole(pageA, popupPage, "A");
  await ensureBoundRole(pageB, popupPage, "B");
  await sleep(3000);
  const runtimeState = await getRuntimeState(popupPage);
  assert.ok(runtimeState.bindings?.A, "Expected runtime binding for A");
  assert.ok(runtimeState.bindings?.B, "Expected runtime binding for B");

  if (runtimeState.bindings?.A?.tabId) {
    const reboundA = await findPageByOverlayTabId(context, runtimeState.bindings.A.tabId);
    if (reboundA) {
      pageA = reboundA;
    }
  }

  if (runtimeState.bindings?.B?.tabId) {
    const reboundB = await findPageByOverlayTabId(context, runtimeState.bindings.B.tabId);
    if (reboundB) {
      pageB = reboundB;
    }
  }

  console.log("[semi] Runtime bindings verified");

  if (authOptions.useAuth && urlA && urlB) {
    const [authStateA, authStateB] = await Promise.all([
      validateCurrentPageAuthState(pageA),
      validateCurrentPageAuthState(pageB)
    ]);

    if (!authStateA.valid || !authStateB.valid) {
      throw new Error(
        `auth_carrier_lost_after_binding: ${JSON.stringify({ authStateA, authStateB })}`
      );
    }

    const [pageAStillThread, pageBStillThread] = await Promise.all([
      isSupportedThreadUrl(pageA),
      isSupportedThreadUrl(pageB)
    ]);

    if (!pageAStillThread || !pageBStillThread) {
      throw new Error(
        `auth_provided_thread_lost_after_binding: ${JSON.stringify({
          pageAUrl: pageA.url(),
          pageBUrl: pageB.url(),
          pageAStillThread,
          pageBStillThread,
          authStateA,
          authStateB
        })}`
      );
    }

    let existingSourceObservation = await collectThreadObservation(pageA);
    const hydrateStartedAt = Date.now();
    while (!existingSourceObservation.latestAssistantHash && Date.now() - hydrateStartedAt < 10000) {
      await sleep(1000);
      existingSourceObservation = await collectThreadObservation(pageA);
    }

    if (!existingSourceObservation.latestAssistantHash) {
      throw new Error(
        `auth_provided_thread_requires_existing_assistant_reply: provided source thread has no reusable assistant payload (${pageA.url()})`
      );
    }
  } else {
    await (authOptions.useAuth
      ? ensureAuthBackedSourceSeedWithBlocker(pageA, {
          prompt: "Hello from A. Reply briefly with a short identifier for relay testing.",
          label: "source-seed"
        })
      : ensureAnonymousSourceSeedWithBlocker(pageA, {
          label: "source-seed"
        }));
  }
  await ensureComposer(pageB);
  console.log("[semi] Source A seeded; target B composer ready");

  const readyState = await normalizeRuntimeToReady(popupPage);
  assert.ok(readyState.bindings?.A, "Expected runtime binding for A after seeding");
  assert.ok(readyState.bindings?.B, "Expected runtime binding for B after seeding");
  assert.equal(readyState.phase, "ready", `Expected runtime phase ready after seeding, got ${JSON.stringify(readyState)}`);
  console.log("[semi] Live-session bindings verified");

  // ===== RESUME SCENARIO 1: Override A =====
  const firstHop = await reachPendingBtoABoundary({ pageA, pageB, popupPage });
  console.log("[semi] First live-session hop accepted:", JSON.stringify(firstHop.firstHop));
  await popupPage.locator("#overrideSelect").selectOption("A");
  await popupPage.waitForTimeout(500);
  await expectPopupActionEnabled(popupPage, "resume");
  await clickPopupAction(popupPage, "resume");
  const duplicateStart = Date.now();
  while (Date.now() - duplicateStart < 90000) {
    const runtimeState = await getRuntimeState(popupPage);
    if (runtimeState.phase === "stopped" && runtimeState.lastStopReason === "duplicate_output") {
      break;
    }
    await popupPage.waitForTimeout(500);
  }
  let duplicateState = await getRuntimeState(popupPage);
  if (duplicateState.phase !== "stopped" || duplicateState.lastStopReason !== "duplicate_output") {
    await popupPage.close().catch(() => {});
    popupPage = await openPopup(context, extensionId);
    const refreshStartedAt = Date.now();
    while (Date.now() - refreshStartedAt < 10000) {
      duplicateState = await getRuntimeState(popupPage);
      if (duplicateState.phase === "stopped" && duplicateState.lastStopReason === "duplicate_output") {
        break;
      }
      await popupPage.waitForTimeout(250);
    }
  }
  assert.equal(duplicateState.phase, "stopped");
  if (duplicateState.lastStopReason) {
    assert.equal(duplicateState.lastStopReason, "duplicate_output");
  }
  console.log("[semi] Override A resume stopped with expected duplicate_output");

  await popupPage.close().catch(() => {});
  popupPage = await openPopup(context, extensionId);

  // ===== RESUME SCENARIO 2: Override B =====
  await reachPendingBtoABoundary({ pageA, pageB, popupPage });
  const baselineAOverrideB = await collectThreadObservation(pageA);
  const overrideBHop = await resumeBranch({
    pageA,
    pageB,
    popupPage,
    overrideRole: "B",
    expectedSourceRole: "B",
    expectedTargetRole: "A",
    baselineTargetObservation: baselineAOverrideB
  });
  console.log("[semi] Override B resume accepted:", JSON.stringify(overrideBHop));

  // ===== RESUME SCENARIO 3: Default resume =====
  await reachPendingBtoABoundary({ pageA, pageB, popupPage });
  const popupBeforeDefault = await readPopupState(popupPage);
  const defaultHop = parseNextHopText(popupBeforeDefault.nextHop);
  const baselineDefaultTarget = await collectThreadObservation(defaultHop.targetRole === "A" ? pageA : pageB);
  const defaultResumeHop = await resumeBranch({
    pageA,
    pageB,
    popupPage,
    expectedSourceRole: defaultHop.sourceRole,
    expectedTargetRole: defaultHop.targetRole,
    baselineTargetObservation: baselineDefaultTarget
  });
  console.log("[semi] Default resume accepted:", JSON.stringify(defaultResumeHop));

  await expectOverlayActionEnabled(pageA, "stop");
  await clickPopupAction(popupPage, "stop");
  await expectPopupPhaseState(popupPage, "stopped");
  console.log("Semi bridge test: PASS");
} catch (error) {
  if (isHarnessBlocker(error)) {
    console.error(`[semi] BLOCKED: ${error.code}`);
    console.error(`[semi] Blocker details: ${JSON.stringify(error.details || {}, null, 2)}`);
  }
  runError = error;
} finally {
  await cleanupBrowserConnection(browserConnection);
}

if (runError) {
  throw runError;
}
