/**
 * Real-hop acceptance runner (primary authenticity gate).
 *
 * Acceptance relies on independent page facts first:
 * - target latest user message changed from pre-send baseline
 * - changed user message correlates with this relay payload
 * - bridge only enters waiting-reply after independent acceptance evidence
 *
 * Runtime events are exported only as auxiliary evidence.
 *
 * Usage:
 *   pnpm run test:real-hop
 *   pnpm run test:real-hop -- --url-a <thread-a> --url-b <thread-b>
 *   pnpm run test:real-hop -- --skip-bootstrap
 */

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

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
  bootstrapAnonymousThread,
  buildBootstrapPrompt,
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

// Auth state options
const authStateArg = readFlag("--auth-state");
const sessionStateArg = readFlag("--session-state");

// Resolve auth options
const authOptions = resolveAuthOptions({
  authStateArg,
  sessionStateArg
});

// Validate auth files before doing anything
const authValidation = await validateAuthFiles(authOptions.storageStatePath, authOptions.sessionStoragePath);
if (!authValidation.valid) {
  console.error(`[real-hop] ERROR: ${authValidation.error}`);
  console.error("[real-hop] To skip auth, provide --url-a and --url-b for existing threads.");
  process.exit(1);
}

// Load sessionStorage data
const sessionStorageData = await loadSessionStorageData(authOptions.sessionStoragePath);
console.log(`[real-hop] Auth state: ${authOptions.storageStatePath}`);
console.log(`[real-hop] Session storage: ${authOptions.sessionStoragePath} (${sessionStorageData ? "loaded" : "not found"})`);

const ACCEPTANCE_TIMEOUT_MS = 90000;
const POLL_INTERVAL_MS = 1200;

const evidenceRunId = new Date().toISOString().replace(/[.:]/g, "-");
const evidenceDir = path.resolve(process.cwd(), "tmp", `real-hop-${evidenceRunId}`);

/** @type {string[]} */
const runLog = [];

function logLine(message) {
  const line = `[real-hop] ${message}`;
  const stamped = `${new Date().toISOString()} ${line}`;
  runLog.push(stamped);
  console.log(line);
}

function normalizeText(value) {
  return String(value || "").replace(/\r\n/g, "\n").replace(/\u00a0/g, " ").trim();
}

function calculateTextOverlap(textA, textB) {
  const normalizedA = normalizeText(textA);
  const normalizedB = normalizeText(textB);

  if (!normalizedA || !normalizedB) {
    return 0;
  }

  const wordsA = normalizedA
    .toLowerCase()
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length > 1);
  const wordsB = normalizedB
    .toLowerCase()
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length > 1);

  if (wordsA.length === 0 || wordsB.length === 0) {
    return 0;
  }

  let matched = 0;
  for (const word of wordsA) {
    if (wordsB.some((candidate) => candidate.includes(word) || word.includes(candidate))) {
      matched += 1;
    }
  }

  return matched / Math.max(wordsA.length, wordsB.length);
}

function buildPayloadFingerprint(sourceObservation) {
  const assistantText = normalizeText(sourceObservation.latestAssistantText || "");
  return {
    assistantSnippet: assistantText.slice(0, 220),
    hasAssistantSnippet: assistantText.length > 0
  };
}

function isPayloadCorrelated(latestUserText, payloadFingerprint) {
  const normalized = normalizeText(latestUserText);
  if (!normalized) {
    return false;
  }

  const hasBridgeContext = normalized.includes("[BRIDGE_CONTEXT]");
  const hasBridgeInstruction = normalized.includes("[BRIDGE_INSTRUCTION]");
  if (hasBridgeContext && hasBridgeInstruction) {
    return true;
  }

  if (!hasBridgeContext) {
    return false;
  }

  if (normalized.includes("source: A") || normalized.includes("source: B")) {
    return true;
  }

  if (!payloadFingerprint.hasAssistantSnippet) {
    return false;
  }

  return calculateTextOverlap(normalized, payloadFingerprint.assistantSnippet) >= 0.35;
}

function formatShort(text) {
  return normalizeText(text).slice(0, 140);
}

async function writeJson(fileName, payload) {
  const filePath = path.join(evidenceDir, fileName);
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return filePath;
}

async function writeText(fileName, content) {
  const filePath = path.join(evidenceDir, fileName);
  await fs.writeFile(filePath, content, "utf8");
  return filePath;
}

async function fetchRuntimeEvents(page) {
  const response = await page.evaluate(async () => {
    try {
      return await chrome.runtime.sendMessage({
        type: "GET_RECENT_RUNTIME_EVENTS"
      });
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  });

  if (response && response.ok === true && Array.isArray(response.result)) {
    return {
      ok: true,
      events: response.result,
      error: null
    };
  }

  return {
    ok: false,
    events: [],
    error: response?.error || "runtime_events_response_invalid"
  };
}

async function collectThreadObservation(page) {
  return await page.evaluate(() => {
    const hashText = (value) => {
      const text = String(value || "").replace(/\r\n/g, "\n").replace(/\u00a0/g, " ").trim();
      let hash = 2166136261;

      for (let index = 0; index < text.length; index += 1) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
      }

      return text ? `h${(hash >>> 0).toString(16)}` : null;
    };

    const normalize = (value) => String(value || "").replace(/\r\n/g, "\n").replace(/\u00a0/g, " ").trim();

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

    const findComposer = () => {
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

    const composer = findComposer();
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

async function collectPopupSnapshot(popupPage) {
  return await popupPage.evaluate(() => {
    const text = (selector) => {
      const node = document.querySelector(selector);
      return node ? node.textContent?.trim() || "" : "";
    };

    const attr = (selector, name) => {
      const node = document.querySelector(selector);
      return node ? node.getAttribute(name) : null;
    };

    return {
      phase: attr("#phaseBadge", "data-phase"),
      round: text("#roundValue"),
      nextHop: text("#nextHopValue"),
      currentStep: text("#currentStepValue"),
      lastIssue: text("#lastIssueValue")
    };
  });
}

function hasWaitingStep(stepText) {
  const text = normalizeText(stepText).toLowerCase();
  return text.includes("waiting") || text.includes("等待");
}

async function saveScreenshots(pageA, pageB, popupPage, prefix) {
  await Promise.all([
    pageA.screenshot({ path: path.join(evidenceDir, `${prefix}-page-a.png`), fullPage: true }).catch(() => {}),
    pageB.screenshot({ path: path.join(evidenceDir, `${prefix}-page-b.png`), fullPage: true }).catch(() => {}),
    popupPage.screenshot({ path: path.join(evidenceDir, `${prefix}-popup.png`) }).catch(() => {})
  ]);
}

async function savePartialFailureScreenshots(pageA, pageB, popupPage) {
  const captures = [];

  if (pageA) {
    captures.push(
      pageA
        .screenshot({ path: path.join(evidenceDir, "failure-page-a.png"), fullPage: true })
        .catch(() => {})
    );
  }

  if (pageB) {
    captures.push(
      pageB
        .screenshot({ path: path.join(evidenceDir, "failure-page-b.png"), fullPage: true })
        .catch(() => {})
    );
  }

  if (popupPage) {
    captures.push(
      popupPage
        .screenshot({ path: path.join(evidenceDir, "failure-popup.png") })
        .catch(() => {})
    );
  }

  await Promise.all(captures);
}

async function bootstrapThreadWithRetry(page, seedLabel, roleLabel, maxAttempts = 2) {
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await bootstrapAnonymousThread(page, seedLabel, buildBootstrapPrompt(roleLabel));
      return;
    } catch (error) {
      lastError = error;
      logLine(
        `bootstrap ${seedLabel} 第 ${attempt}/${maxAttempts} 次失败: ${
          error instanceof Error ? error.message : String(error)
        }`
      );

      if (attempt < maxAttempts) {
        await page.goto("https://chatgpt.com", { waitUntil: "domcontentloaded" });
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error(`bootstrap_failed:${seedLabel}`);
}

async function verifyRealHop({ pageA, pageB, popupPage, baselineTarget, payloadFingerprint }) {
  /** @type {Array<Record<string, unknown>>} */
  const observationLog = [];

  let independentAcceptance = null;
  const startedAt = Date.now();

  while (Date.now() - startedAt < ACCEPTANCE_TIMEOUT_MS) {
    const [targetObservation, runtimeEventResult, popupSnapshot] = await Promise.all([
      collectThreadObservation(pageB),
      fetchRuntimeEvents(pageA),
      collectPopupSnapshot(popupPage)
    ]);

    const runtimeEvents = runtimeEventResult.events;
    const waitingReplyEvent = runtimeEvents.find((event) => event.phaseStep === "waiting_reply") || null;
    const verificationPassedEvent =
      runtimeEvents.find((event) => event.phaseStep === "verification_passed") || null;
    const dispatchRejectedEvent =
      runtimeEvents.find((event) => event.phaseStep === "dispatch_rejected") || null;
    const verificationFailedEvent =
      runtimeEvents.find((event) => event.phaseStep === "verification_failed") || null;

    const baselineUserText = normalizeText(baselineTarget.latestUserText || "");
    const currentUserText = normalizeText(targetObservation.latestUserText || "");
    const latestUserTextChanged = Boolean(currentUserText) && currentUserText !== baselineUserText;

    const userHashChanged =
      targetObservation.latestUserHash !== null &&
      targetObservation.latestUserHash !== baselineTarget.latestUserHash;
    const userCountIncreased = targetObservation.userMessageCount > baselineTarget.userMessageCount;
    const payloadCorrelated = isPayloadCorrelated(targetObservation.latestUserText, payloadFingerprint);

    const independentAcceptedNow =
      latestUserTextChanged && payloadCorrelated && (userHashChanged || userCountIncreased);

    observationLog.push({
      timestamp: new Date().toISOString(),
      popupPhase: popupSnapshot.phase,
      popupStep: popupSnapshot.currentStep,
      popupWaitingHint: hasWaitingStep(popupSnapshot.currentStep),
      runtimeWaitingReply: Boolean(waitingReplyEvent),
      runtimeVerificationPassed: Boolean(verificationPassedEvent),
      runtimeDispatchRejected: Boolean(dispatchRejectedEvent),
      runtimeVerificationFailed: Boolean(verificationFailedEvent),
      baselineUserHash: baselineTarget.latestUserHash,
      currentUserHash: targetObservation.latestUserHash,
      baselineUserCount: baselineTarget.userMessageCount,
      currentUserCount: targetObservation.userMessageCount,
      latestUserTextChanged,
      payloadCorrelated,
      userHashChanged,
      userCountIncreased,
      independentAcceptedNow,
      targetGenerating: targetObservation.generating,
      targetSendButtonReady: targetObservation.sendButtonReady,
      targetComposerPreview: formatShort(targetObservation.composerText),
      targetLatestUserPreview: formatShort(targetObservation.latestUserText)
    });

    if (dispatchRejectedEvent) {
      return {
        success: false,
        reason: `runtime_dispatch_rejected:${dispatchRejectedEvent.verificationVerdict || "unknown"}`,
        observationLog,
        acceptance: independentAcceptance
      };
    }

    if (verificationFailedEvent) {
      return {
        success: false,
        reason: `runtime_verification_failed:${verificationFailedEvent.verificationVerdict || "unknown"}`,
        observationLog,
        acceptance: independentAcceptance
      };
    }

    if (!independentAcceptance && independentAcceptedNow) {
      independentAcceptance = {
        timestamp: new Date().toISOString(),
        userHash: targetObservation.latestUserHash,
        userCount: targetObservation.userMessageCount,
        preview: formatShort(targetObservation.latestUserText),
        generation: targetObservation.generating
      };

      logLine(`独立证据已成立：target user hash=${targetObservation.latestUserHash || "null"}, count=${targetObservation.userMessageCount}`);
      await saveScreenshots(pageA, pageB, popupPage, "acceptance");
    }

    if (waitingReplyEvent && !independentAcceptance && !independentAcceptedNow) {
      return {
        success: false,
        reason: "waiting_reply_observed_before_independent_acceptance",
        observationLog,
        acceptance: independentAcceptance
      };
    }

    if (hasWaitingStep(popupSnapshot.currentStep) && !independentAcceptance && !independentAcceptedNow) {
      return {
        success: false,
        reason: "popup_waiting_observed_before_independent_acceptance",
        observationLog,
        acceptance: independentAcceptance
      };
    }

    if (independentAcceptance && (waitingReplyEvent || hasWaitingStep(popupSnapshot.currentStep))) {
      return {
        success: true,
        reason: "independent_acceptance_before_waiting_reply",
        observationLog,
        acceptance: independentAcceptance
      };
    }

    await sleep(POLL_INTERVAL_MS);
  }

  return {
    success: false,
    reason: "timeout_waiting_independent_acceptance_or_waiting_reply",
    observationLog,
    acceptance: independentAcceptance
  };
}

await fs.mkdir(evidenceDir, { recursive: true });
logLine(`证据目录: ${evidenceDir}`);

// Launch browser with auth state
const { context, userDataDir } = await launchBrowserWithExtension({
  extensionPath,
  browserExecutablePath,
  storageStatePath: authOptions.storageStatePath,
  sessionStorageData
});

// Add sessionStorage init script for automatic restoration on page navigation
if (sessionStorageData) {
  addSessionStorageInitScript(context, sessionStorageData);
}

let runError = null;
let finalRuntimeEvents = [];
let verificationResult = null;
let popupSnapshot = null;
let baselineSource = null;
let baselineTarget = null;
let bootstrapMode = "provided_urls";
let resolvedUrlA = null;
let resolvedUrlB = null;

let pageA = null;
let pageB = null;
let popupPage = null;

try {
  [pageA, pageB] = await getTwoPages(context);

  if (urlA && urlB) {
    bootstrapMode = "provided_urls";
    logLine("使用 --url-a / --url-b 真实线程。\n");
    await pageA.goto(urlA, { waitUntil: "domcontentloaded" });
    await pageB.goto(urlB, { waitUntil: "domcontentloaded" });
    await assertSupportedThreadUrl(pageA, "pageA (--url-a)");
    await assertSupportedThreadUrl(pageB, "pageB (--url-b)");
    resolvedUrlA = pageA.url();
    resolvedUrlB = pageB.url();
  } else if (skipBootstrap) {
    bootstrapMode = "manual_skip_bootstrap";
    logLine("--skip-bootstrap 模式：请手动导航到两个真实线程 URL。\n");
    await Promise.all([
      pageA.goto("https://chatgpt.com", { waitUntil: "domcontentloaded" }),
      pageB.goto("https://chatgpt.com", { waitUntil: "domcontentloaded" })
    ]);
    logLine("导航完成后请在终端按 Enter 继续。");
    await new Promise((resolve) => {
      process.stdin.once("data", () => resolve());
    });
    await assertSupportedThreadUrl(pageA, "pageA (manual)");
    await assertSupportedThreadUrl(pageB, "pageB (manual)");
    resolvedUrlA = pageA.url();
    resolvedUrlB = pageB.url();
  } else {
    // Default: Use auth state to open authenticated pages, then auto-bootstrap threads
    bootstrapMode = "authenticated_bootstrap";
    logLine("使用已导出的认证状态，自动 bootstrap 两个线程。\n");
    await Promise.all([
      pageA.goto("https://chatgpt.com", { waitUntil: "domcontentloaded" }),
      pageB.goto("https://chatgpt.com", { waitUntil: "domcontentloaded" })
    ]);

    // Restore sessionStorage after navigation (as backup to init script)
    if (sessionStorageData) {
      await restoreSessionStorage(pageA, sessionStorageData);
      await restoreSessionStorage(pageB, sessionStorageData);
    }

    // Give page time to stabilize after auth restoration
    await sleep(2000);

    await bootstrapThreadWithRetry(pageA, "seed-a", "A");
    await bootstrapThreadWithRetry(pageB, "seed-b", "B");
    await assertSupportedThreadUrl(pageA, "pageA (authenticated-bootstrap)");
    await assertSupportedThreadUrl(pageB, "pageB (authenticated-bootstrap)");

    resolvedUrlA = pageA.url();
    resolvedUrlB = pageB.url();
    logLine(`认证 bootstrap 成功: A=${resolvedUrlA}`);
    logLine(`认证 bootstrap 成功: B=${resolvedUrlB}`);
  }

  await ensureOverlay(pageA);
  await ensureOverlay(pageB);

  await clickOverlayBind(pageA, "A");
  await clickOverlayBind(pageB, "B");

  const extensionId = await getExtensionId(pageA);
  popupPage = await openPopup(context, extensionId);

  await expectBindingState(popupPage, "A");
  await expectBindingState(popupPage, "B");
  await expectPopupPhaseState(popupPage, "ready");

  baselineSource = await collectThreadObservation(pageA);
  baselineTarget = await collectThreadObservation(pageB);
  const payloadFingerprint = buildPayloadFingerprint(baselineSource);

  logLine(
    `基线: targetUserHash=${baselineTarget.latestUserHash || "null"}, targetUserCount=${baselineTarget.userMessageCount}, targetGenerating=${baselineTarget.generating}`
  );
  logLine(`基线: sourceAssistantHash=${baselineSource.latestAssistantHash || "null"}`);

  await saveScreenshots(pageA, pageB, popupPage, "baseline");

  await expectOverlayActionEnabled(pageA, "start");
  await clickOverlayAction(pageA, "start");
  await expectPopupPhaseState(popupPage, "running");

  logLine("已启动 relay，开始独立观察 first hop。\n");
  verificationResult = await verifyRealHop({
    pageA,
    pageB,
    popupPage,
    baselineTarget,
    payloadFingerprint
  });

  if (!verificationResult.success) {
    throw new Error(`Real-hop 验收失败: ${verificationResult.reason}`);
  }

  logLine("real-hop 主验收通过：独立证据已在 waiting reply 之前成立。");
  await saveScreenshots(pageA, pageB, popupPage, "success");

  // Clean stop to avoid leaving running session in manual verification.
  try {
    await expectOverlayActionEnabled(pageA, "stop");
    await clickOverlayAction(pageA, "stop");
  } catch {
    // Ignore stop failures in teardown.
  }
} catch (error) {
  runError = error;
  logLine(`执行失败: ${error instanceof Error ? error.message : String(error)}`);
  await savePartialFailureScreenshots(pageA, pageB, popupPage);
} finally {
  if (pageA) {
    const runtimeResult = await fetchRuntimeEvents(pageA);
    finalRuntimeEvents = runtimeResult.events;
  }

  if (popupPage) {
    popupSnapshot = await collectPopupSnapshot(popupPage).catch(() => null);
  }

  const summary = {
    status: runError ? "FAIL" : "PASS",
    reason: runError
      ? runError instanceof Error
        ? runError.message
        : String(runError)
      : verificationResult?.reason || "independent_acceptance_before_waiting_reply",
    evidenceDir,
    auth: {
      storageState: authOptions.storageStatePath,
      sessionStorageLoaded: !!sessionStorageData
    },
    browser: {
      strategy: "playwright-persistent-chromium-with-extension",
      executablePath: browserExecutablePath || "playwright-default"
    },
    input: {
      urlA: urlA || null,
      urlB: urlB || null,
      skipBootstrap
    },
    bootstrapMode,
    resolvedUrls: {
      urlA: resolvedUrlA,
      urlB: resolvedUrlB
    },
    baseline: {
      source: baselineSource,
      target: baselineTarget
    },
    popupSnapshot,
    verification: verificationResult,
    runtimeEventCount: finalRuntimeEvents.length,
    runtimePhaseSteps: finalRuntimeEvents.map((event) => event.phaseStep),
    lastRuntimeEvents: finalRuntimeEvents.slice(-12)
  };

  const acceptanceVerdict = {
    status: runError ? "FAIL" : "PASS",
    acceptanceReason: verificationResult?.reason || null,
    independentAcceptance: verificationResult?.acceptance || null,
    runtimeAuxiliary: {
      eventCount: finalRuntimeEvents.length,
      phaseSteps: finalRuntimeEvents.map((event) => event.phaseStep)
    }
  };

  await writeJson("summary.json", summary);
  await writeJson("acceptance-verdict.json", acceptanceVerdict);
  await writeJson("runtime-events.json", finalRuntimeEvents);
  await writeJson("observation-log.json", verificationResult?.observationLog || []);
  await writeText("run.log", `${runLog.join("\n")}\n`);

  logLine(`证据已导出: ${evidenceDir}`);

  const { cleanupBrowser } = await import("./_playwright-bridge-helpers.mjs");
  await cleanupBrowser(context, userDataDir);
}

if (runError) {
  throw runError;
}

assert.ok(verificationResult?.success, "Real-hop verification must pass with independent evidence.");
