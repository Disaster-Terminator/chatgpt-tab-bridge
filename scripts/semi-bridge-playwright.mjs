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
  expectOverlayActionEnabled,
  expectPopupPhaseState,
  expectPopupControlState,
  getExtensionId,
  openPopup,
  assertSupportedThreadUrl,
  ensureComposer,
  bindFromPage,
  getRuntimeState,
  readPopupState,
  collectThreadObservation,
  waitForAssistantReplyAfter,
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

async function waitForTargetReplyAndPendingHop({ popupPage, sourcePage, sourceRole, targetPage, targetRole, timeoutMs = 90000 }) {
  const baselineTarget = await collectThreadObservation(targetPage);
  await waitForAssistantReplyAfter(targetPage, baselineTarget.latestAssistantHash, `semi-reply-${targetRole}`, timeoutMs);
  return collectThreadObservation(sourcePage);
}

async function pauseAtPendingHop({ pageA, popupPage, expectedSourceRole, expectedTargetRole }) {
  await expectOverlayActionEnabled(pageA, "pause");
  await clickOverlayAction(pageA, "pause");
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

async function pauseOnExpectedPendingHop({ pageA, popupPage, expectedSourceRole, expectedTargetRole, timeoutMs = 90000 }) {
  const expectedHopText = `${expectedSourceRole} -> ${expectedTargetRole}`;
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const [popupState, runtimeState] = await Promise.all([
      readPopupState(popupPage),
      getRuntimeState(popupPage)
    ]);

    const nextHopMatches = normalizeText(popupState.nextHop).toUpperCase() === expectedHopText;
    const activeHop = runtimeState.activeHop;
    const atBetweenHopBoundary = Boolean(
      activeHop &&
      activeHop.stage === "pending" &&
      !activeHop.hopId &&
      activeHop.sourceRole === expectedSourceRole &&
      activeHop.targetRole === expectedTargetRole
    );

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
  await expectOverlayActionEnabled(pageA, "resume");
  await clickOverlayAction(pageA, "resume");
  await expectPopupPhaseState(popupPage, "running");

  return await waitForAcceptedHop({
    popupPage,
    targetPage: expectedTargetRole === "A" ? pageA : pageB,
    baselineTarget: baselineTargetObservation,
    expectedRound: roundBeforeResume + 1,
    targetRole: expectedTargetRole
  });
}

let runError = null;

try {
  const [pageA, pageB] = await getTwoPages(context, {
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
    if (!(browserStrategy.mode === "cdp" && browserStrategy.noNavOnAttach)) {
      await Promise.all([
        pageA.goto("https://chatgpt.com", { waitUntil: "domcontentloaded" }),
        pageB.goto("https://chatgpt.com", { waitUntil: "domcontentloaded" })
      ]);
    }
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
    if (!(browserStrategy.mode === "cdp" && browserStrategy.noNavOnAttach)) {
      await Promise.all([
        pageA.goto("https://chatgpt.com", { waitUntil: "domcontentloaded" }),
        pageB.goto("https://chatgpt.com", { waitUntil: "domcontentloaded" })
      ]);
    }
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
  const popupPage = await openPopup(context, extensionId);

  await ensureBoundRole(pageA, popupPage, "A");
  await ensureBoundRole(pageB, popupPage, "B");
  await sleep(3000);
  const runtimeState = await getRuntimeState(popupPage);
  assert.ok(runtimeState.bindings?.A, "Expected runtime binding for A");
  assert.ok(runtimeState.bindings?.B, "Expected runtime binding for B");
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

  const readyState = await getRuntimeState(popupPage);
  assert.ok(readyState.bindings?.A, "Expected runtime binding for A after seeding");
  assert.ok(readyState.bindings?.B, "Expected runtime binding for B after seeding");
  assert.equal(readyState.phase, "ready", `Expected runtime phase ready after seeding, got ${JSON.stringify(readyState)}`);
  console.log("[semi] Live-session bindings verified");

  const roundBeforeStart = Number(await popupPage.locator("#roundValue").innerText());
  const baselineBStart = await collectThreadObservation(pageB);
  await expectOverlayActionEnabled(pageA, "start");
  await clickOverlayAction(pageA, "start");
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
  console.log("[semi] First live-session hop accepted:", JSON.stringify(firstHop));

  // ===== RESUME SCENARIO 1: Override A =====
  await waitForTargetReplyAndPendingHop({
    popupPage,
    sourcePage: pageB,
    sourceRole: "B",
    targetPage: pageB,
    targetRole: "B"
  });
  await pauseOnExpectedPendingHop({ pageA, popupPage, expectedSourceRole: "B", expectedTargetRole: "A" });
  const baselineBOverrideA = await collectThreadObservation(pageB);
  const overrideAHop = await resumeBranch({
    pageA,
    pageB,
    popupPage,
    overrideRole: "A",
    expectedSourceRole: "A",
    expectedTargetRole: "B",
    baselineTargetObservation: baselineBOverrideA
  });
  console.log("[semi] Override A resume accepted:", JSON.stringify(overrideAHop));

  // ===== RESUME SCENARIO 2: Override B =====
  await waitForTargetReplyAndPendingHop({
    popupPage,
    sourcePage: pageB,
    sourceRole: "B",
    targetPage: pageB,
    targetRole: "B"
  });
  await pauseOnExpectedPendingHop({ pageA, popupPage, expectedSourceRole: "B", expectedTargetRole: "A" });
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
  await waitForTargetReplyAndPendingHop({
    popupPage,
    sourcePage: pageA,
    sourceRole: "A",
    targetPage: pageA,
    targetRole: "A"
  });
  await pauseOnExpectedPendingHop({ pageA, popupPage, expectedSourceRole: "A", expectedTargetRole: "B" });
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
  await clickOverlayAction(pageA, "stop");
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
