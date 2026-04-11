/**
 * E2E Bridge Test Runner with Scenario Matrix.
 * Defaults to an anonymous/live-session baseline unless auth is explicitly provided.
 * Runner creates env once, scenarios receive env and return result.
 */

import assert from "node:assert/strict";
import path from "node:path";
import process from "node:process";
import fs from "node:fs/promises";

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
  buildBootstrapPrompt,
  findPageByOverlayTabId,
  getExtensionId,
  openPopup,
  readPopupState,
  readOverlayState,
  compareStates,
  sleep,
  assertSupportedThreadUrl,
  isSupportedThreadUrl,
  bindFromPage,
  getRuntimeState,
  isExpectedPendingBoundaryVisible,
  fetchRuntimeEventsFromPopup,
  ensureComposer,
  sendPrompt,
  collectThreadObservation,
  ensureAnonymousSourceSeedWithBlocker,
  ensureAuthBackedSourceSeedWithBlocker,
  validateCurrentPageAuthState,
  isHarnessBlocker
} from "./_playwright-bridge-helpers.mjs";

const extensionPath = readPathFlag("--path") || path.resolve(process.cwd(), "dist/extension");
const browserExecutablePath = process.env.BROWSER_EXECUTABLE_PATH || null;
const urlA = readFlag("--url-a");
const urlB = readFlag("--url-b");
const scenarioFilter = readFlag("--scenario");
const skipBootstrap = process.argv.includes("--skip-bootstrap");
const rootOnly = process.argv.includes("--root-only");
const cdpEndpointArg = readFlag("--cdp-endpoint");
const reuseOpenChatgptTab = !process.argv.includes("--no-reuse-open-chatgpt-tab");
const noNavOnAttach = !process.argv.includes("--nav-on-attach");
const TASK9_SCENARIOS = new Set([
  "resume-with-override-a",
  "resume-with-override-b",
  "resume-default",
  "continuation-without-focus-switch",
  "task9-suite"
]);

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
    console.error(`[e2e] ERROR: ${authValidation.error}`);
    console.error("[e2e] Auth is opt-in. Fix the provided auth paths or omit --auth-state/--session-state to use the anonymous baseline.");
    process.exit(1);
  }

  sessionStorageData = await loadSessionStorageData(authOptions.sessionStoragePath);
  console.log(`[e2e] Auth mode: enabled (${authOptions.storageStatePath || "session-only"})`);
  console.log(`[e2e] Session storage: ${authOptions.sessionStoragePath || "not provided"} (${sessionStorageData ? "loaded" : "not found"})`);
} else {
  console.log("[e2e] Auth mode: disabled by default; using anonymous/live-session baseline.");
}

// Scenario registry - each receives env and returns { success: true } or throws
const scenarios = {
  "happy-path": runHappyPath,
  "starter-busy-before-start": runStarterBusyBeforeStart,
  "starter-busy-before-resume": runStarterBusyBeforeResume,
  "popup-overlay-sync": runPopupOverlaySync,
  "source-busy-before-hop": runSourceBusyBeforeHop,
  "resume-with-override-a": runResumeWithOverrideA,
  "resume-with-override-b": runResumeWithOverrideB,
  "resume-default": runResumeDefault,
  "continuation-without-focus-switch": runContinuationWithoutFocusSwitch,
  "task9-suite": runTask9Suite
};

function normalizeText(value) {
  return String(value || "").replace(/\r\n/g, "\n").replace(/\u00a0/g, " ").trim();
}

function hasTerminalBridgeDirective(text) {
  return /(?:^|\n)\[BRIDGE_STATE\]\s+(CONTINUE|FREEZE)\s*$/i.test(normalizeText(text));
}

async function ensureChatGptPage(page) {
  const alreadyChatGpt = page.url().startsWith("https://chatgpt.com");
  if (browserStrategy.mode === "cdp" && browserStrategy.noNavOnAttach && alreadyChatGpt) {
    return;
  }

  await page.goto("https://chatgpt.com", { waitUntil: "domcontentloaded" });
}

function hasWaitingLikeStep(stepText) {
  return normalizeText(stepText).toLowerCase().startsWith("waiting ");
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
      (targetObservation.generating === false || hasTerminalBridgeDirective(targetObservation.latestAssistantText));
    const atExpectedPendingBoundary = isExpectedPendingBoundaryVisible({
      popupState,
      runtimeState,
      expectedSourceRole,
      expectedTargetRole
    });
    const progressedIntoExpectedHop = Boolean(
      runtimeState.activeHop &&
        runtimeState.activeHop.sourceRole === expectedSourceRole &&
        runtimeState.activeHop.targetRole === expectedTargetRole &&
        ["verifying", "waiting_reply"].includes(runtimeState.activeHop.stage)
    );

    if (pauseOnBoundary && targetReplyObserved && atExpectedPendingBoundary && !pauseRequested) {
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
        `Expected paused between-hop state to expose ${expectedSourceRole} -> ${expectedTargetRole}, got ${JSON.stringify(pausedState)}`
      );

      return collectThreadObservation(sourcePage);
    }

    if (!pauseOnBoundary && targetReplyObserved && (atExpectedPendingBoundary || progressedIntoExpectedHop)) {
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
          `Expected paused between-hop state to expose ${expectedSourceRole} -> ${expectedTargetRole}, got ${JSON.stringify(pausedState)}`
        );
        return collectThreadObservation(sourcePage);
      }

      throw new Error(
        `Pause settled before pending boundary ${expectedSourceRole} -> ${expectedTargetRole}: ${JSON.stringify(runtimeState)}`
      );
    }

    await sleep(500);
  }

  throw new Error(`Timed out waiting for ${targetRole} reply and pending hop ${expectedSourceRole} -> ${expectedTargetRole}`);
}

async function pauseOnExpectedPendingHop({
  pageA,
  popupPage,
  targetPage,
  expectedSourceRole,
  expectedTargetRole,
  timeoutMs = 90000
}) {
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
        `Expected paused between-hop state to expose ${expectedSourceRole} -> ${expectedTargetRole}, got ${JSON.stringify(pausedState)}`
      );

      return pausedState;
    }

    await sleep(800);
  }

  throw new Error(`Timed out waiting to pause on pending hop ${expectedHopText}`);
}

async function normalizeRuntimeToReady(popupPage) {
  let runtimeState = await getRuntimeState(popupPage);

  if (runtimeState.phase === "running" || runtimeState.phase === "paused") {
    await clickPopupAction(popupPage, "stop");
    const stopStartedAt = Date.now();
    while (Date.now() - stopStartedAt < 30000) {
      runtimeState = await getRuntimeState(popupPage);
      if (runtimeState.phase === "stopped") break;
      await sleep(250);
    }
  }

  if (runtimeState.phase === "stopped" || runtimeState.phase === "error") {
    await clickPopupAction(popupPage, "clear-terminal");
    const clearStartedAt = Date.now();
    while (Date.now() - clearStartedAt < 30000) {
      runtimeState = await getRuntimeState(popupPage);
      if (runtimeState.phase === "ready") break;
      await sleep(250);
    }
  }

  return runtimeState;
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
  });
  await popupPage.close().catch(() => {});
  await sleep(1500);
  return openPopup(context, extensionId);
}

async function buildTask9ReadyEnv(env) {
  if (env.task9Ready) {
    return env.task9Ready;
  }

  const { context, pageA, pageB } = env;
  let popupPage = env.popupPage;
  if (!popupPage) {
    const extensionId = await getExtensionId(pageA);
    popupPage = await openPopup(context, extensionId);
    popupPage = await reloadExtensionRuntime(context, popupPage, extensionId);
    await Promise.all([
      pageA.reload({ waitUntil: "domcontentloaded" }),
      pageB.reload({ waitUntil: "domcontentloaded" })
    ]);
    await ensureOverlay(pageA);
    await ensureOverlay(pageB);
    await ensureBoundRole(pageA, popupPage, "A");
    await ensureBoundRole(pageB, popupPage, "B");
    await sleep(3000);
    env.popupPage = popupPage;
  }

  let seedResult;
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
    seedResult = {
      ok: true,
      seeded: false,
      observation: existingSourceObservation,
      snapshot: {
        url: pageA.url(),
        hasAssistantSeed: true,
        assistantHash: existingSourceObservation.latestAssistantHash,
        assistantCount: existingSourceObservation.assistantMessageCount,
        userCount: existingSourceObservation.userMessageCount,
        generating: existingSourceObservation.generating,
        authStateA,
        authStateB,
        sourcePayloadStrategy: "reused_existing_assistant_reply"
      }
    };
  } else {
    seedResult = await (authOptions.useAuth
      ? ensureAuthBackedSourceSeedWithBlocker(pageA, {
          prompt: "Hello from A. Reply briefly with a short identifier for relay testing.",
          label: "source-seed"
        })
      : ensureAnonymousSourceSeedWithBlocker(pageA, {
          label: "source-seed"
        }));
  }
  await ensureComposer(pageB);

  const readyState = await normalizeRuntimeToReady(popupPage);
  assert.ok(readyState.bindings?.A, "Expected runtime binding for A");
  assert.ok(readyState.bindings?.B, "Expected runtime binding for B");
  assert.equal(readyState.phase, "ready", `Expected runtime phase ready before Task 9 seed flow, got ${JSON.stringify(readyState)}`);

  env.task9Ready = {
    pageA,
    pageB,
    popupPage,
    seedResult
  };
  return env.task9Ready;
}

async function startLiveRelayFromA(env) {
  const { pageA, pageB, popupPage } = await buildTask9ReadyEnv(env);

  await (authOptions.useAuth
    ? ensureAuthBackedSourceSeedWithBlocker(pageA, {
        prompt: "Hello from A. Reply briefly with a short identifier for relay testing.",
        label: "source-seed-refresh"
      })
    : ensureAnonymousSourceSeedWithBlocker(pageA, {
        label: "source-seed-refresh"
      }));

  const initialRound = Number(await popupPage.locator("#roundValue").innerText());
  const baselineTarget = await collectThreadObservation(pageB);

  await clickPopupAction(popupPage, "start");
  await expectPopupPhaseState(popupPage, "running");

  const firstHop = await waitForAcceptedHop({
    popupPage,
    targetPage: pageB,
    baselineTarget,
    expectedRound: initialRound + 1,
    targetRole: "B"
  });

  if (!firstHop.ok) {
    throw new Error(`Initial live-session hop A -> B failed: ${firstHop.reason} ${JSON.stringify(firstHop.context || {})}`);
  }

  return {
    initialRound,
    firstHop,
    firstTargetObservation: await collectThreadObservation(pageB)
  };
}

async function waitForPendingHopBoundary({ popupPage, timeoutMs = 90000 }) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const [popupState, runtimeState] = await Promise.all([
      readPopupState(popupPage),
      getRuntimeState(popupPage)
    ]);

    const activeHop = runtimeState.activeHop;
    const atBoundary = Boolean(activeHop && activeHop.stage === "pending" && !activeHop.hopId);

    if (atBoundary) {
      return {
        sourceRole: activeHop.sourceRole,
        targetRole: activeHop.targetRole,
        popupState,
        runtimeState
      };
    }

    const normalizedNextHop = normalizeText(popupState.nextHop).toUpperCase();
    const readyBoundaryMatch = normalizedNextHop.match(/\b(A|B)\s*->\s*(A|B)\b/);
    const readyBoundaryVisible = Boolean(
      runtimeState.phase === "ready" &&
      readyBoundaryMatch &&
      Number(popupState.round || "0") >= 1
    );

    if (readyBoundaryVisible) {
      return {
        sourceRole: readyBoundaryMatch[1],
        targetRole: readyBoundaryMatch[2],
        popupState,
        runtimeState
      };
    }

    await sleep(800);
  }

  throw new Error("Timed out waiting for between-hop boundary");
}

async function pauseAtCurrentPendingBoundary(env) {
  const { pageA, popupPage } = await buildTask9ReadyEnv(env);
  const boundary = await waitForPendingHopBoundary({ popupPage });

  if (boundary.runtimeState.phase === "ready") {
    return {
      ...boundary,
      pausedState: boundary.popupState
    };
  }

  const pausedState = await pauseOnExpectedPendingHop({
    pageA,
    popupPage,
    expectedSourceRole: boundary.sourceRole,
    expectedTargetRole: boundary.targetRole
  });

  return {
    ...boundary,
    pausedState
  };
}

async function runTask9ResumeBranchAtCurrentBoundary(env, mode) {
  const boundary = await pauseAtCurrentPendingBoundary(env);
  const { pageA, pageB, popupPage } = env;

  let overrideRole = null;
  let expectedSourceRole = boundary.sourceRole;
  let expectedTargetRole = boundary.targetRole;

  if (mode === "override-a") {
    overrideRole = "A";
    expectedSourceRole = "A";
    expectedTargetRole = "B";
  } else if (mode === "override-b") {
    overrideRole = "B";
    expectedSourceRole = "B";
    expectedTargetRole = "A";
  }

  const baselineTargetObservation = await collectThreadObservation(
    expectedTargetRole === "A" ? pageA : pageB
  );

  if (mode === "override-a") {
    await popupPage.locator("#overrideSelect").selectOption("A");
    await popupPage.waitForTimeout(500);
    await clickPopupAction(popupPage, "resume");

    const startedAt = Date.now();
    let runtimeState = await getRuntimeState(popupPage);
    while (Date.now() - startedAt < 90000) {
      runtimeState = await getRuntimeState(popupPage);
      if (runtimeState.phase === "stopped") {
        break;
      }
      await sleep(500);
    }

    if (runtimeState.phase !== "stopped") {
      throw new Error(`Override A expected terminal stop, got ${JSON.stringify(runtimeState)}`);
    }

    return {
      boundary,
      result: {
        ok: true,
        evidence: `terminal:${runtimeState.lastStopReason || "unknown"}`
      },
      expectedSourceRole,
      expectedTargetRole,
      overrideRole
    };
  }

  const result = await resumeAndVerifyHop({
    env,
    overrideRole,
    expectedSourceRole,
    expectedTargetRole,
    baselineTargetObservation
  });

  return {
    boundary,
    result,
    expectedSourceRole,
    expectedTargetRole,
    overrideRole
  };
}

async function pauseAtPendingBtoA(env) {
  const { pageA, pageB, popupPage } = env;
  const startState = await startLiveRelayFromA(env);
  await waitForTargetReplyAndPendingHop({
    pageA,
    popupPage,
    sourcePage: pageB,
    sourceRole: "B",
    targetPage: pageB,
    targetRole: "B",
    pauseOnBoundary: true
  });
  const pausedState = await readPopupState(popupPage);

  return {
    ...startState,
    pausedState
  };
}

async function resumeAndVerifyHop({ env, overrideRole = null, expectedSourceRole, expectedTargetRole, baselineTargetObservation }) {
  const { pageA, pageB, popupPage } = env;

  if (overrideRole) {
    await popupPage.locator("#overrideSelect").selectOption(overrideRole);
    await popupPage.waitForTimeout(500);
  }

  const popupBeforeResume = await readPopupState(popupPage);
  assert.equal(
    normalizeText(popupBeforeResume.nextHop).toUpperCase(),
    `${expectedSourceRole} -> ${expectedTargetRole}`,
    `Expected popup next hop to show ${expectedSourceRole} -> ${expectedTargetRole} before resume, got ${JSON.stringify(popupBeforeResume)}`
  );

  const roundBeforeResume = Number(await popupPage.locator("#roundValue").innerText());
  await expectOverlayActionEnabled(pageA, "resume");
  await clickPopupAction(popupPage, "resume");
  await expectPopupPhaseState(popupPage, "running");

  const targetPage = expectedTargetRole === "A" ? pageA : pageB;
  const result = await waitForAcceptedHop({
    popupPage,
    targetPage,
    baselineTarget: baselineTargetObservation,
    expectedRound: roundBeforeResume + 1,
    targetRole: expectedTargetRole
  });

  if (!result.ok) {
    throw new Error(`Resume hop ${expectedSourceRole} -> ${expectedTargetRole} failed: ${result.reason} ${JSON.stringify(result.context || {})}`);
  }

  return result;
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

function resolvePageForRole(env, role) {
  if (role === "A") {
    return env.pageA;
  }

  if (role === "B") {
    return env.pageB;
  }

  return env.pageB || env.pageA || null;
}

async function resolveCanonicalTargetDiagnostics(env) {
  let runtimeState = null;
  let runtimeEvents = [];

  try {
    runtimeState = await getRuntimeState(env.popupPage);
  } catch {
    runtimeState = null;
  }

  try {
    const runtimeResult = await fetchRuntimeEventsFromPopup(env.popupPage);
    if (runtimeResult.ok) {
      runtimeEvents = runtimeResult.events;
    }
  } catch {
    runtimeEvents = [];
  }

  const preferredTargetEvent = [...runtimeEvents].reverse().find((event) => {
    return (
      ["reply_timeout", "reply_observation_failed", "waiting_reply"].includes(event.phaseStep) &&
      (event.targetRole === "A" || event.targetRole === "B")
    );
  });

  const fallbackTargetEvent = [...runtimeEvents].reverse().find((event) => {
    return event.targetRole === "A" || event.targetRole === "B";
  });

  const targetRole =
    preferredTargetEvent?.targetRole ??
    runtimeState?.activeHop?.targetRole ??
    fallbackTargetEvent?.targetRole ??
    "B";

  return {
    targetRole,
    targetPage: resolvePageForRole(env, targetRole)
  };
}

async function waitForAcceptedHop({ popupPage, targetPage, baselineTarget, expectedRound, targetRole }) {
  const startedAt = Date.now();
  const initialRuntimeResult = await fetchRuntimeEventsFromPopup(popupPage);
  const initialEventCount = initialRuntimeResult.ok ? initialRuntimeResult.events.length : 0;
  let sawPageAcceptance = false;
  let confirmedAcceptancePolls = 0;

  while (Date.now() - startedAt < 90000) {
    const [popupState, runtimeResult, targetObservation] = await Promise.all([
      readPopupState(popupPage).catch(() => ({})),
      fetchRuntimeEventsFromPopup(popupPage),
      collectThreadObservation(targetPage)
    ]);

    const runtimeEvents = runtimeResult.ok ? runtimeResult.events.slice(initialEventCount) : [];
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
    const normalizedLatestUserText = normalizeText(targetObservation.latestUserText);
    const pageAccepted =
      latestUserTextChanged &&
      normalizedLatestUserText.includes("[BRIDGE_CONTEXT]") &&
      /(?:^|\n)hop:\s*[^\s\n]+/i.test(normalizedLatestUserText) &&
      (userHashChanged || userCountIncreased);

    sawPageAcceptance ||= pageAccepted;
    confirmedAcceptancePolls = pageAccepted ? confirmedAcceptancePolls + 1 : 0;

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

    if (confirmedAcceptancePolls >= 2) {
      return {
        ok: true,
        evidence: {
          round: expectedRound,
          targetRole,
          popupPhase: popupState.phase || null,
          popupStep: popupState.currentStep || null,
          gateReason: "page_facts_confirmed",
          latestUserHash: targetObservation.latestUserHash,
          latestUserPreview: normalizeText(targetObservation.latestUserText).slice(0, 160)
        }
      };
    }

    if (dispatchRejectedEvent || verificationFailedEvent || (replyTimeoutEvent && !sawPageAcceptance)) {
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
    env = await createEnv(name);
    
    // Run scenario with env - scenario does NOT create/cleanup browser
    await scenarioFn(env);
    
    // Success path
     await fs.writeFile(diagPath, `PASS\nScenario: ${name}\n`, "utf8").catch(() => {});
     return { name, status: "PASS" };
     
  } catch (error) {
    // Failure path - capture diagnostics using env
    const blocked = isHarnessBlocker(error);
    const status = blocked ? "BLOCKED" : "FAIL";
    let diagContent = `${status}\nScenario: ${name}\nError: ${error.message}\n`;
    if (blocked) {
      diagContent += `Blocker: ${error.code}\nDetails: ${JSON.stringify(error.details || {}, null, 2)}\n`;
    }

    if (env) {
      const canonicalTarget = await resolveCanonicalTargetDiagnostics(env);

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
        const targetActivity = await canonicalTarget.targetPage.evaluate(() => {
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
        diagContent += `\nTarget Thread Activity (${canonicalTarget.targetRole}):\n${JSON.stringify(targetActivity, null, 2)}\n`;
      } catch (e) {
        diagContent += `\nTarget thread activity capture failed: ${e.message}`;
      }

      // P0-4: Add real Ack Debug from content-script via GET_LAST_ACK_DEBUG
      try {
        const ackDebugResponse = await canonicalTarget.targetPage.evaluate(() => {
          return new Promise((resolve) => {
            chrome.runtime.sendMessage({ type: "GET_LAST_ACK_DEBUG" }, (response) => {
              resolve(response);
            });
          });
        }).catch(() => null);
        
        if (ackDebugResponse) {
          diagContent += `\nAck Debug (${canonicalTarget.targetRole}, GET_LAST_ACK_DEBUG):\n${JSON.stringify(ackDebugResponse, null, 2)}\n`;
        } else {
          diagContent += `\nAck Debug (${canonicalTarget.targetRole}): unavailable\n`;
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
    return {
      name,
      status,
      diagnostics: diagPath,
      error: error.message,
      blocker: blocked ? error.code : null
    };
     
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
async function createEnv(scenarioName) {
  // Launch with optional auth state
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
    const authCheck = await validateAuthState(validationPage);
    await validationPage.close().catch(() => {});
    if (!authCheck.valid) {
      await cleanupBrowserConnection(browserConnection);
      console.error(`[e2e] ERROR: ${authCheck.error}`);
      process.exit(1);
    }
    console.log("  [e2e] Auth validation passed");
  }
  
  let [pageA, pageB] = await getTwoPages(context, {
    reuseOpenChatgptTab: browserStrategy.mode === "cdp" && browserStrategy.reuseOpenChatgptTab,
    preserveExistingPages: browserStrategy.mode === "cdp",
    noNavOnAttach: browserStrategy.mode === "cdp" && browserStrategy.noNavOnAttach
  });
  
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
    await Promise.all([ensureChatGptPage(pageA), ensureChatGptPage(pageB)]);
    // Restore sessionStorage after navigation
    if (sessionStorageData) {
      await restoreSessionStorage(pageA, sessionStorageData);
      await restoreSessionStorage(pageB, sessionStorageData);
      await Promise.all([
        reloadAfterSessionRestore(pageA, sessionStorageData),
        reloadAfterSessionRestore(pageB, sessionStorageData)
      ]);
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
    console.log(`  Using ${authOptions.useAuth ? "auth-backed" : "anonymous"} ChatGPT root baseline...`);
    await Promise.all([ensureChatGptPage(pageA), ensureChatGptPage(pageB)]);
    
    // Restore sessionStorage after navigation (backup to init script)
    if (sessionStorageData) {
      await restoreSessionStorage(pageA, sessionStorageData);
      await restoreSessionStorage(pageB, sessionStorageData);
      await Promise.all([
        reloadAfterSessionRestore(pageA, sessionStorageData),
        reloadAfterSessionRestore(pageB, sessionStorageData)
      ]);
    }
    
    // Give page time to stabilize
    await sleep(2000);
    
    if (authOptions.useAuth) {
      const postNavCheckA = await validateAuthState(pageA);
      if (!postNavCheckA.valid) {
        await cleanupBrowserConnection(browserConnection);
        console.error(`[e2e] ERROR: Auth expired after navigation: ${postNavCheckA.error}`);
        process.exit(1);
      }
      console.log("  [e2e] Post-navigation auth verified");
    }

    const useLiveSessionRootBaseline = rootOnly || TASK9_SCENARIOS.has(scenarioName);

    if (!useLiveSessionRootBaseline) {
      await bootstrapAnonymousThread(pageA, "seed-a", buildBootstrapPrompt("A"));
      await bootstrapAnonymousThread(pageB, "seed-b", buildBootstrapPrompt("B"));
    } else {
      const [pageAHasUrl, pageBHasUrl] = await Promise.all([
        isSupportedThreadUrl(pageA),
        isSupportedThreadUrl(pageB)
      ]);
      console.log(
        `  Live-session root baseline: skipping persistent thread bootstrap (scenario=${scenarioName}, A URL supported: ${pageAHasUrl}, B URL supported: ${pageBHasUrl})`
      );
    }
  }

  await Promise.all([pageA.title(), pageB.title()]);
  
  // Wait for overlay
  await ensureOverlay(pageA);
  await ensureOverlay(pageB);

  let popupPage = null;
  if (!TASK9_SCENARIOS.has(scenarioName)) {
    const extensionId = await getExtensionId(pageA);
    popupPage = await openPopup(context, extensionId);
    await popupPage.waitForSelector("#phaseBadge");
    await popupPage.waitForSelector("#bindingA");
    await popupPage.waitForSelector("#bindingB");

    await ensureBoundRole(pageA, popupPage, "A");
    await ensureBoundRole(pageB, popupPage, "B");
    const runtimeState = await getRuntimeState(popupPage);
    assert.ok(runtimeState.bindings?.A, "Expected runtime binding for A");
    assert.ok(runtimeState.bindings?.B, "Expected runtime binding for B");

    if (runtimeState.bindings?.A?.tabId) {
      const reboundA = await findPageByOverlayTabId(context, runtimeState.bindings.A.tabId);
      if (reboundA) pageA = reboundA;
    }
    if (runtimeState.bindings?.B?.tabId) {
      const reboundB = await findPageByOverlayTabId(context, runtimeState.bindings.B.tabId);
      if (reboundB) pageB = reboundB;
    }
  } else {
    const extensionId = await getExtensionId(pageA);
    popupPage = await openPopup(context, extensionId);
    await ensureBoundRole(pageA, popupPage, "A");
    await ensureBoundRole(pageB, popupPage, "B");
    await sleep(3000);

    const runtimeState = await getRuntimeState(popupPage);
    if (runtimeState.bindings?.A?.tabId) {
      const reboundA = await findPageByOverlayTabId(context, runtimeState.bindings.A.tabId);
      if (reboundA) pageA = reboundA;
    }
    if (runtimeState.bindings?.B?.tabId) {
      const reboundB = await findPageByOverlayTabId(context, runtimeState.bindings.B.tabId);
      if (reboundB) pageB = reboundB;
    }

    // Normalize runtime to ready state at harness entry - before any scenario runs
    // This ensures we don't inherit stale running/stopped state from previous sessions
    const normalizedRuntimeState = await normalizeRuntimeToReady(popupPage);
    console.log(`  [e2e] Initial runtime state after normalization: ${normalizedRuntimeState.phase}`);
  }

  return {
    context,
    browserConnection,
    browserStrategy,
    pageA,
    pageB,
    popupPage
  };
}

/**
 * Cleanup test environment.
 */
async function cleanupEnv(env) {
  if (env.browserConnection) {
    await cleanupBrowserConnection(env.browserConnection);
  }
}

// ===== SCENARIO IMPLEMENTATIONS =====
// Each receives env: { pageA, pageB, popupPage }
// Each returns { success: true } or throws

async function runHappyPath(env) {
  const { pageA, pageB, popupPage } = env;

  await buildTask9ReadyEnv(env);

  const runtimeState = await getRuntimeState(popupPage);
  assert.ok(runtimeState.bindings?.A, "Expected runtime binding for A");
  assert.ok(runtimeState.bindings?.B, "Expected runtime binding for B");
  assert.equal(runtimeState.phase, "ready", `Expected runtime phase ready before happy-path start, got ${JSON.stringify(runtimeState)}`);

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

  await clickPopupAction(popupPage, "stop");
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
  await clickPopupAction(popupPage, "stop");
  const stopStartedAt = Date.now();
  let finalRuntimeState = await getRuntimeState(popupPage);
  while (Date.now() - stopStartedAt < 30000) {
    finalRuntimeState = await getRuntimeState(popupPage);
    if (finalRuntimeState.phase === "stopped") break;
    await sleep(250);
  }
  if (finalRuntimeState.phase !== "stopped") {
    throw new Error(`Task 9 suite stop did not settle: ${JSON.stringify(finalRuntimeState)}`);
  }

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

/**
 * Resume with override A scenario.
 * Verifies a real between-hop override changes the fresh next hop to A -> B.
 */
async function runResumeWithOverrideA(env) {
  const { pageB } = env;
  await pauseAtPendingBtoA(env);
  const baselineB = await collectThreadObservation(pageB);
  await resumeAndVerifyHop({
    env,
    overrideRole: "A",
    expectedSourceRole: "A",
    expectedTargetRole: "B",
    baselineTargetObservation: baselineB
  });
  return { success: true };
}

async function runResumeWithOverrideB(env) {
  const { pageA } = env;
  await pauseAtPendingBtoA(env);
  const baselineA = await collectThreadObservation(pageA);
  await resumeAndVerifyHop({
    env,
    overrideRole: "B",
    expectedSourceRole: "B",
    expectedTargetRole: "A",
    baselineTargetObservation: baselineA
  });
  return { success: true };
}

async function runResumeDefault(env) {
  const { pageA, popupPage } = env;
  await pauseAtPendingBtoA(env);
  const expectedHop = parseNextHopText(await popupPage.locator("#nextHopValue").innerText());
  const baselineTargetObservation = await collectThreadObservation(
    expectedHop.targetRole === "A" ? pageA : env.pageB
  );

  await resumeAndVerifyHop({
    env,
    expectedSourceRole: expectedHop.sourceRole,
    expectedTargetRole: expectedHop.targetRole,
    baselineTargetObservation
  });
  return { success: true };
}

async function runContinuationWithoutFocusSwitch(env) {
  const { pageA, pageB, popupPage } = env;
  const startState = await startLiveRelayFromA(env);
  const baselineA = await waitForTargetReplyAndPendingHop({
    popupPage,
    sourcePage: pageB,
    sourceRole: "B",
    targetPage: env.pageB,
    targetRole: "B"
  });

  const continuationHop = await waitForAcceptedHop({
    popupPage,
    targetPage: pageA,
    baselineTarget: baselineA,
    expectedRound: startState.initialRound + 2,
    targetRole: "A"
  });

  if (!continuationHop.ok) {
    throw new Error(`Continuation without focus switch failed: ${continuationHop.reason} ${JSON.stringify(continuationHop.context || {})}`);
  }

  const popupState = await readPopupState(popupPage);
  assert.equal(popupState.phase, "running");
  assert.ok(
    hasWaitingLikeStep(popupState.currentStep),
    `Expected relay to keep running without manual focus switching, got ${JSON.stringify(popupState)}`
  );
  return { success: true };
}

async function runTask9Suite(env) {
  const { pageA, pageB, popupPage } = await buildTask9ReadyEnv(env);
  const branchResults = [];

  const startState = await startLiveRelayFromA(env);
  branchResults.push({
    branch: "shared-live-start",
    status: "PASS",
    detail: startState.firstHop.evidence
  });

  const baselineA = await waitForTargetReplyAndPendingHop({
    popupPage,
    sourcePage: pageB,
    sourceRole: "B",
    targetPage: pageB,
    targetRole: "B"
  });

  const continuationHop = await waitForAcceptedHop({
    popupPage,
    targetPage: pageA,
    baselineTarget: baselineA,
    expectedRound: startState.initialRound + 2,
    targetRole: "A"
  });

  if (!continuationHop.ok) {
    throw new Error(`Task 9 suite continuation failed: ${continuationHop.reason} ${JSON.stringify(continuationHop.context || {})}`);
  }

  branchResults.push({
    branch: "continuation-without-focus-switch",
    status: "PASS",
    detail: continuationHop.evidence
  });

  await normalizeRuntimeToReady(popupPage);
  await pauseAtPendingBtoA(env);
  const baselineAOverrideB = await collectThreadObservation(pageA);
  const overrideBResult = await resumeAndVerifyHop({
    env,
    overrideRole: "B",
    expectedSourceRole: "B",
    expectedTargetRole: "A",
    baselineTargetObservation: baselineAOverrideB
  });
  branchResults.push({
    branch: "resume-with-override-b",
    status: "PASS",
    detail: overrideBResult.evidence,
    boundary: {
      sourceRole: "B",
      targetRole: "A"
    }
  });

  await normalizeRuntimeToReady(popupPage);
  await pauseAtPendingBtoA(env);
  const popupBeforeDefault = await readPopupState(popupPage);
  const defaultHop = parseNextHopText(popupBeforeDefault.nextHop);
  const baselineDefaultTarget = await collectThreadObservation(defaultHop.targetRole === "A" ? pageA : pageB);
  const resumeDefaultResult = await resumeAndVerifyHop({
    env,
    expectedSourceRole: defaultHop.sourceRole,
    expectedTargetRole: defaultHop.targetRole,
    baselineTargetObservation: baselineDefaultTarget
  });
  branchResults.push({
    branch: "resume-default",
    status: "PASS",
    detail: resumeDefaultResult.evidence,
    boundary: {
      sourceRole: defaultHop.sourceRole,
      targetRole: defaultHop.targetRole
    }
  });

  await normalizeRuntimeToReady(popupPage);
  await pauseAtPendingBtoA(env);

  // Step 1: Select override A
  await popupPage.locator("#overrideSelect").selectOption("A");
  await popupPage.waitForTimeout(500);

  // Step 2: Verify A -> B pending next-hop AFTER override selection
  // The override-A selection should change the pending next-hop from B->A to A->B
  // before we accept the terminal stop as valid proof
  const popupAfterOverrideSelect = await readPopupState(popupPage);
  assert.equal(
    normalizeText(popupAfterOverrideSelect.nextHop).toUpperCase(),
    "A -> B",
    `Expected override-A to show A -> B pending after selection, got ${JSON.stringify(popupAfterOverrideSelect)}`
  );

  // Step 3: Click resume and wait briefly for hop activity to start
  await clickPopupAction(popupPage, "resume");
  const hopActivityStartedAt = Date.now();
  let observedHopActivity = false;
  while (Date.now() - hopActivityStartedAt < 10000) {
    const runtimeState = await getRuntimeState(popupPage);
    if (runtimeState.phase === "running" && runtimeState.activeHop) {
      observedHopActivity = true;
      break;
    }
    await sleep(300);
  }

  // Gate: fail if no hop activity was observed before terminal stop
  if (!observedHopActivity) {
    throw new Error(`Override A failed to initiate hop activity within 10s - expected terminal stop but proof is invalid`);
  }

  // Step 4: Wait for terminal stop
  const overrideAStartedAt = Date.now();
  let overrideARuntimeState = await getRuntimeState(popupPage);
  while (Date.now() - overrideAStartedAt < 90000) {
    overrideARuntimeState = await getRuntimeState(popupPage);
    if (overrideARuntimeState.phase === "stopped") {
      break;
    }
    await sleep(500);
  }

  if (overrideARuntimeState.phase !== "stopped") {
    throw new Error(`Override A expected terminal stop, got ${JSON.stringify(overrideARuntimeState)}`);
  }

  branchResults.push({
    branch: "resume-with-override-a",
    status: "PASS",
    detail: `terminal:${overrideARuntimeState.lastStopReason || "unknown"}`,
    boundary: {
      sourceRole: "A",
      targetRole: "B"
    }
  });

  const finalRuntimeState = await getRuntimeState(popupPage);
  assert.equal(
    finalRuntimeState.phase,
    "stopped",
    `Task 9 suite expected override-A branch to leave runtime stopped, got ${JSON.stringify(finalRuntimeState)}`
  );

  console.log("[e2e] Task 9 suite reused one seeded live session across continuation/default/override branches");
  console.log(`[e2e] Task 9 suite branch results: ${JSON.stringify(branchResults)}`);
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
    } else if (result.status === "BLOCKED") {
      console.log(`  E2E scenario ${result.name}: BLOCKED [${result.blocker}] (see ${result.diagnostics})`);
    } else {
      console.log(`  E2E scenario ${result.name}: PASS`);
    }
  }

  const failedCount = results.filter(r => r.status !== "PASS").length;
  if (failedCount > 0) {
    console.log(`\n${failedCount} scenario(s) did not pass.`);
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
