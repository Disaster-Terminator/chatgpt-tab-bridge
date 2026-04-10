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
  connectBrowserWithExtensionOrCdp,
  cleanupBrowserConnection,
  getTwoPages,
  readFlag,
  readPathFlag,
  resolveAuthOptions,
  resolveBrowserStrategyFromCli,
  validateAuthFiles,
  loadSessionStorageData,
  addSessionStorageInitScript,
  restoreSessionStorage,
  reloadAfterSessionRestore,
  bootstrapAnonymousThread,
  buildBootstrapPrompt,
  ensureOverlay,
  bindFromPage,
  getRuntimeState,
  clickOverlayAction,
  expectOverlayActionEnabled,
  expectPopupPhaseState,
  expectBindingState,
  getExtensionId,
  openPopup,
  assertSupportedThreadUrl,
  hasSessionEvidence,
  isSupportedThreadUrl,
  ensureComposer,
  fetchRuntimeEventsFromPopup,
  sleep,
  ensureAnonymousSourceSeedWithBlocker,
  ensureAuthBackedSourceSeedWithBlocker,
  validateCurrentPageAuthState,
  HarnessBlockerError,
  isHarnessBlocker
} from "./_playwright-bridge-helpers.mjs";

const extensionPath = readPathFlag("--path") || path.resolve(process.cwd(), "dist/extension");
const browserExecutablePath = process.env.BROWSER_EXECUTABLE_PATH || null;
const urlA = readFlag("--url-a");
const urlB = readFlag("--url-b");
const skipBootstrap = process.argv.includes("--skip-bootstrap");
const rootOnly = process.argv.includes("--root-only");
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
    console.error(`[real-hop] ERROR: ${authValidation.error}`);
    console.error("[real-hop] Auth is opt-in. Fix the provided auth paths or omit --auth-state/--session-state to use the anonymous baseline.");
    process.exit(1);
  }

  sessionStorageData = await loadSessionStorageData(authOptions.sessionStoragePath);
  console.log(`[real-hop] Auth mode: enabled (${authOptions.storageStatePath || "session-only"})`);
  console.log(`[real-hop] Session storage: ${authOptions.sessionStoragePath || "not provided"} (${sessionStorageData ? "loaded" : "not found"})`);
} else {
  console.log("[real-hop] Auth mode: disabled by default; using anonymous/live-session baseline.");
}

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

function isReplyWaitingStep(stepText) {
  if (!stepText) return false;
  const text = normalizeText(stepText).toLowerCase();
  return text.includes("waiting") && (text.includes("reply") || text.includes("回复"));
}

function classifyFirstBrokenBeat({
  dispatchRejectedEvent,
  verificationFailedEvent,
  waitingReplyEvent,
  popupSnapshot,
  userMessageDelivered,
  assistantNeverResponded
}) {
  // If user message was delivered but assistant never started generating (automation detection)
  if (userMessageDelivered && assistantNeverResponded) {
    return "beat_4_model_no_response_under_automation";
  }

  if (dispatchRejectedEvent) {
    return `beat_3_trigger_not_consumed:${dispatchRejectedEvent.verificationVerdict || "unknown"}`;
  }

  if (waitingReplyEvent || isReplyWaitingStep(popupSnapshot?.currentStep)) {
    return "beat_4_waiting_before_page_evidence";
  }

  if (verificationFailedEvent) {
    return `beat_4_page_evidence_not_observed:${verificationFailedEvent.verificationVerdict || "unknown"}`;
  }

  return "beat_4_page_evidence_not_observed:timeout";
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
      fetchRuntimeEventsFromPopup(popupPage),
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

    if (independentAcceptance && (waitingReplyEvent || hasWaitingStep(popupSnapshot.currentStep))) {
      return {
        success: true,
        reason: "independent_acceptance_before_waiting_reply",
        observationLog,
        acceptance: independentAcceptance
      };
    }

    if (dispatchRejectedEvent || verificationFailedEvent) {
      const userDelivered = latestUserTextChanged || userHashChanged || userCountIncreased;
      return {
        success: false,
        reason: classifyFirstBrokenBeat({
          dispatchRejectedEvent,
          verificationFailedEvent,
          waitingReplyEvent,
          popupSnapshot,
          userMessageDelivered: userDelivered,
          assistantNeverResponded: !targetObservation.generating && userDelivered
        }),
        observationLog,
        acceptance: independentAcceptance
      };
    }

    if (waitingReplyEvent && !independentAcceptance && !independentAcceptedNow) {
      return {
        success: false,
        reason: "waiting_reply_observed_before_independent_acceptance",
        observationLog,
        acceptance: independentAcceptance
      };
    }

    if (isReplyWaitingStep(popupSnapshot.currentStep) && !independentAcceptance && !independentAcceptedNow) {
      return {
        success: false,
        reason: "popup_waiting_observed_before_independent_acceptance",
        observationLog,
        acceptance: independentAcceptance
      };
    }

    await sleep(POLL_INTERVAL_MS);
  }

  // Timeout - check if user message was delivered but assistant never responded
  const finalTargetCheck = await collectThreadObservation(pageB);
  const userDeliveredFinal =
    finalTargetCheck.latestUserHash !== baselineTarget.latestUserHash ||
    finalTargetCheck.userMessageCount > baselineTarget.userMessageCount;

  return {
    success: false,
    reason: classifyFirstBrokenBeat({
      dispatchRejectedEvent: null,
      verificationFailedEvent: null,
      waitingReplyEvent: null,
      popupSnapshot: null,
      userMessageDelivered: userDeliveredFinal,
      assistantNeverResponded: userDeliveredFinal && !finalTargetCheck.generating
    }),
    observationLog,
    acceptance: independentAcceptance
  };
}

await fs.mkdir(evidenceDir, { recursive: true });
logLine(`证据目录: ${evidenceDir}`);

// Connect browser via shared strategy layer
const browserConnection = await connectBrowserWithExtensionOrCdp({
  extensionPath,
  browserExecutablePath,
  storageStatePath: authOptions.storageStatePath,
  sessionStorageData,
  strategy: browserStrategy
});
const { context } = browserConnection;

// Add sessionStorage init script for automatic restoration on page navigation
if (sessionStorageData) {
  addSessionStorageInitScript(context, sessionStorageData);
}

let runError = null;
let runStatus = "PASS";
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
  [pageA, pageB] = await getTwoPages(context, {
    reuseOpenChatgptTab: browserStrategy.mode === "cdp" && browserStrategy.reuseOpenChatgptTab,
    preserveExistingPages: browserStrategy.mode === "cdp",
    noNavOnAttach: browserStrategy.mode === "cdp" && browserStrategy.noNavOnAttach
  });

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
    logLine("--skip-bootstrap 模式：请手动导航到两个 ChatGPT 页面。\n");
    if (!(browserStrategy.mode === "cdp" && browserStrategy.noNavOnAttach)) {
      await Promise.all([
        pageA.goto("https://chatgpt.com", { waitUntil: "domcontentloaded" }),
        pageB.goto("https://chatgpt.com", { waitUntil: "domcontentloaded" })
      ]);
    }
    logLine("导航完成后请在终端按 Enter 继续。");
    await new Promise((resolve) => {
      process.stdin.once("data", () => resolve());
    });

    const [hasEvidenceA, hasEvidenceB] = await Promise.all([
      hasSessionEvidence(pageA),
      hasSessionEvidence(pageB)
    ]);

    if (!hasEvidenceA) {
      throw new Error("pageA has no session evidence - send a prompt first");
    }
    if (!hasEvidenceB) {
      throw new Error("pageB has no session evidence - send a prompt first");
    }

    const [urlAValid, urlBValid] = await Promise.all([
      isSupportedThreadUrl(pageA),
      isSupportedThreadUrl(pageB)
    ]);

    if (urlAValid) {
      await assertSupportedThreadUrl(pageA, "pageA (manual)");
    }
    if (urlBValid) {
      await assertSupportedThreadUrl(pageB, "pageB (manual)");
    }

    resolvedUrlA = pageA.url();
    resolvedUrlB = pageB.url();
    logLine(`Manual skip bootstrap: A=${resolvedUrlA} (URL: ${urlAValid}, evidence: ${hasEvidenceA})`);
    logLine(`Manual skip bootstrap: B=${resolvedUrlB} (URL: ${urlBValid}, evidence: ${hasEvidenceB})`);
  } else {
    bootstrapMode = "live_session_bootstrap";
    logLine("Live session bootstrap: send prompts and verify acceptance without URL.\n");
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

    await sleep(2000);

    // In root-only mode, skip seed bootstrap - just navigate to root and proceed
    if (!rootOnly) {
      await bootstrapThreadWithRetry(pageA, "seed-a", "A");
      await bootstrapThreadWithRetry(pageB, "seed-b", "B");
    } else {
      logLine("Root-only mode: skipping seed bootstrap, proceeding to session-first bind/start\n");
    }

    const [urlAValid, urlBValid] = await Promise.all([
      isSupportedThreadUrl(pageA),
      isSupportedThreadUrl(pageB)
    ]);

    if (urlAValid) {
      await assertSupportedThreadUrl(pageA, "pageA (live-session-bootstrap)");
    }
    if (urlBValid) {
      await assertSupportedThreadUrl(pageB, "pageB (live-session-bootstrap)");
    }

    resolvedUrlA = pageA.url();
    resolvedUrlB = pageB.url();
    logLine(`Live session bootstrap: A=${resolvedUrlA} (URL valid: ${urlAValid})`);
    logLine(`Live session bootstrap: B=${resolvedUrlB} (URL valid: ${urlBValid})`);
  }

  await ensureOverlay(pageA);
  await ensureOverlay(pageB);

  // Use direct binding from page contexts (the proven pattern like fetchRuntimeEvents)
  logLine("Attempting direct binding from page contexts...");

  // Open popup first - we need it for reliable runtime state checks
  const extensionId = await getExtensionId(pageA);
  popupPage = await openPopup(context, extensionId);

  try {
    const resultA = await bindFromPage(pageA, popupPage, "A");
    logLine(`Direct bind A result: ${JSON.stringify(resultA)}`);
  } catch (error) {
    logLine(`Direct bind A failed: ${error.message}`);
  }

  try {
    const resultB = await bindFromPage(pageB, popupPage, "B");
    logLine(`Direct bind B result: ${JSON.stringify(resultB)}`);
  } catch (error) {
    logLine(`Direct bind B failed: ${error.message}`);
  }

  // Delay for binding to broadcast
  await sleep(3000);

  // Verify bindings via popup (the only reliable runtime state source in Playwright)
  logLine("Verifying bindings via popup runtime state...");
  const runtimeFromPopup = await getRuntimeState(popupPage);
  logLine(`Runtime state from popup: ${JSON.stringify(runtimeFromPopup)}`);

  // Retry B if needed
    if (!runtimeFromPopup.bindings?.B) {
    logLine("B not showing, retrying B binding...");
    try {
      await bindFromPage(pageB, popupPage, "B");
      await sleep(2000);
    } catch {}
  }

  // Final check via popup
  const finalCheck = await getRuntimeState(popupPage);
  logLine(`Final runtime state: ${JSON.stringify(finalCheck)}`);

  // Proceed even with partial binding
  const bindingEstablished = Boolean(finalCheck.bindings?.A || finalCheck.bindings?.B);
  logLine(`Proceeding with binding: ${bindingEstablished}`);

  // Source payload establishment: on auth-backed root-only runs, prefer an already-existing
  // assistant reply on page A rather than creating a fresh seed on the fragile root page.
  let sourceSeedResult;
  if (authOptions.useAuth && rootOnly) {
    const sourceAuthState = await validateCurrentPageAuthState(pageA);
    if (!sourceAuthState.valid) {
      throw new HarnessBlockerError(
        "auth_carrier_lost_before_seed",
        `Auth-backed source page was not authenticated before reusable payload check (${sourceAuthState.url || pageA.url()})`,
        sourceAuthState
      );
    }

    const existingSourceObservation = await collectThreadObservation(pageA);
    if (!existingSourceObservation.latestAssistantHash) {
      throw new HarnessBlockerError(
        "auth_root_source_payload_missing",
        `Auth-backed root page had no reusable assistant payload for first hop (${pageA.url()})`,
        {
          url: pageA.url(),
          title: sourceAuthState.title || "",
          authMode: "carrier",
          rootOnly: true,
          sourcePayloadStrategy: "existing_assistant_reply_required",
          latestAssistantHash: null,
          assistantMessageCount: existingSourceObservation.assistantMessageCount,
          userMessageCount: existingSourceObservation.userMessageCount,
          generating: existingSourceObservation.generating,
          composerVisible:
            sourceAuthState.composerVisible ?? existingSourceObservation.sendButtonVisible,
          detail:
            "Harness did not auto-seed because authenticated root-only first hop must reuse an already-present assistant reply whenever possible."
        }
      );
    }

    sourceSeedResult = {
      ok: true,
      seeded: false,
      observation: existingSourceObservation,
      snapshot: {
        url: pageA.url(),
        title: sourceAuthState.title || "",
        hasAssistantSeed: true,
        assistantHash: existingSourceObservation.latestAssistantHash,
        assistantCount: existingSourceObservation.assistantMessageCount,
        userCount: existingSourceObservation.userMessageCount,
        generating: existingSourceObservation.generating,
        composerVisible:
          sourceAuthState.composerVisible ?? existingSourceObservation.sendButtonVisible,
        authMode: "carrier",
        rootOnly: true,
        sourcePayloadStrategy: "reused_existing_assistant_reply"
      }
    };
    logLine(
      `Root-only auth mode: reusing existing source assistant reply for first-hop payload (assistantHash=${existingSourceObservation.latestAssistantHash || "null"})`
    );
  } else {
    logLine("Source-seed-only: sending minimal prompt to source A to generate first-hop payload...");
    sourceSeedResult = await (authOptions.useAuth
      ? ensureAuthBackedSourceSeedWithBlocker(pageA, {
          prompt: "Hello, respond briefly.",
          label: "source-seed"
        })
      : ensureAnonymousSourceSeedWithBlocker(pageA, {
          prompt: "Hello, respond briefly.",
          label: "source-seed"
        }));
  }
  logLine(
    `Source A seed ready for relay payload (seeded=${sourceSeedResult.seeded}, assistantHash=${sourceSeedResult.observation.latestAssistantHash || "null"})`
  );

  // Target B: ensure composer is available (for receiving later), but do NOT require prior conversation
  logLine("Target B: ensuring composer is ready for receiving...");
  try {
    await ensureComposer(pageB);
    logLine("Target B composer ready for receive");
  } catch (error) {
    logLine(`Target composer check failed: ${error.message}`);
  }

  // Collect page-level observations - these are the authoritative source of truth
  const pageObservationBeforeStart = await collectThreadObservation(pageB);
  logLine(
    `Page facts (pre-start): targetUserHash=${pageObservationBeforeStart.latestUserHash || "null"}, targetUserCount=${pageObservationBeforeStart.userMessageCount}, targetGenerating=${pageObservationBeforeStart.generating}`
  );

  // Make popup assertions non-blocking - use page facts as the source of truth
  try {
    await expectBindingState(popupPage, "A");
  } catch {
    logLine("Popup binding A check skipped - page facts primary");
  }
  try {
    await expectBindingState(popupPage, "B");
  } catch {
    logLine("Popup binding B check skipped - page facts primary");
  }
  try {
    await expectPopupPhaseState(popupPage, "ready");
  } catch {
    logLine("Popup phase 'ready' check skipped - page facts primary");
  }

  baselineSource = await collectThreadObservation(pageA);
  baselineTarget = await collectThreadObservation(pageB);

  if (!baselineSource.latestAssistantHash) {
    throw new HarnessBlockerError(
      "anonymous_seed_environment_instability",
      "Source assistant seed was not present when real-hop baseline was captured.",
      {
        sourceUrl: pageA.url(),
        baselineSource
      }
    );
  }

  const payloadFingerprint = buildPayloadFingerprint(baselineSource);

  logLine(
    `基线: targetUserHash=${baselineTarget.latestUserHash || "null"}, targetUserCount=${baselineTarget.userMessageCount}, targetGenerating=${baselineTarget.generating}`
  );
  logLine(`基线: sourceAssistantHash=${baselineSource.latestAssistantHash || "null"}`);

  await saveScreenshots(pageA, pageB, popupPage, "baseline");

  // Try to start relay; if UI checks timeout, just try clicking the start button anyway
  let startClicked = false;
  try {
    await expectOverlayActionEnabled(pageA, "start");
    await clickOverlayAction(pageA, "start");
    startClicked = true;
  } catch {
    logLine("Start action verification timed out - attempting direct click");
    try {
      const startBtn = pageA.locator('.chatgpt-bridge-overlay:not([hidden]) [data-action="start"]');
      await startBtn.click({ force: true, timeout: 5000 });
      startClicked = true;
    } catch {
      logLine("Direct click also failed - continuing anyway");
    }
  }

  if (!startClicked) {
    // Check if we already have user message activity on target page
    const activityCheck = await collectThreadObservation(pageB);
    if (activityCheck.latestUserHash && activityCheck.latestUserHash !== baselineTarget.latestUserHash) {
      logLine("User message already delivered - continuing to verify");
    }
  }

  try {
    await expectPopupPhaseState(popupPage, "running");
  } catch {
    logLine("Popup 'running' phase check skipped - continuing with page facts");
  }

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
  runStatus = isHarnessBlocker(error) ? "BLOCKED" : "FAIL";
  if (isHarnessBlocker(error)) {
    logLine(`执行阻塞: ${error.code}`);
    logLine(`阻塞详情: ${JSON.stringify(error.details || {})}`);
  } else {
    logLine(`执行失败: ${error instanceof Error ? error.message : String(error)}`);
  }
  await savePartialFailureScreenshots(pageA, pageB, popupPage);
} finally {
  if (popupPage) {
    const runtimeResult = await fetchRuntimeEventsFromPopup(popupPage);
    finalRuntimeEvents = runtimeResult.events;
  }

  if (popupPage) {
    popupSnapshot = await collectPopupSnapshot(popupPage).catch(() => null);
  }

  const summary = {
    status: runStatus,
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
      strategy:
        browserStrategy.mode === "cdp"
          ? "playwright-cdp-attach"
          : "playwright-persistent-chromium-with-extension",
      executablePath: browserExecutablePath || "playwright-default"
    },
    input: {
      urlA: urlA || null,
      urlB: urlB || null,
      skipBootstrap
    },
    browserStrategy,
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
    blocker: isHarnessBlocker(runError)
      ? {
          code: runError.code,
          details: runError.details || {}
        }
      : null,
    runtimeEventCount: finalRuntimeEvents.length,
    runtimePhaseSteps: finalRuntimeEvents.map((event) => event.phaseStep),
    lastRuntimeEvents: finalRuntimeEvents.slice(-12)
  };

  const acceptanceVerdict = {
    status: runStatus,
    acceptanceReason: verificationResult?.reason || null,
    independentAcceptance: verificationResult?.acceptance || null,
    blocker: isHarnessBlocker(runError)
      ? {
          code: runError.code,
          details: runError.details || {}
        }
      : null,
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

  await cleanupBrowserConnection(browserConnection);
}

if (runError) {
  if (isHarnessBlocker(runError)) {
    console.error(`[real-hop] BLOCKED: ${runError.code}`);
    console.error(`[real-hop] Blocker details: ${JSON.stringify(runError.details || {}, null, 2)}`);
    process.exit(1);
  }
  throw runError;
}

assert.ok(verificationResult?.success, "Real-hop verification must pass with independent evidence.");
