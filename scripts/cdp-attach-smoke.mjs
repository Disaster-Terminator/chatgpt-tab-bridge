import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import {
  attemptRecoverableAuthRecovery,
  classifyExtensionLoadedEvidence,
  cleanupBrowserConnection,
  collectOverlayEvidence,
  collectPopupEvidence,
  connectBrowserWithExtensionOrCdp,
  deriveExtensionIdFromServiceWorkers,
  ensureOverlay,
  getExtensionId,
  probeChatGptAuthState,
  readFlag,
  resolveBrowserStrategyFromCli,
  waitForExtensionServiceWorkers
} from "./_playwright-bridge-helpers.mjs";

/**
 * Probe auth state with recovery for CDP smoke workflow.
 * @param {import("playwright").Page} page
 * @returns {Promise<{ initialAuth: ReturnType<typeof probeChatGptAuthState>, auth: ReturnType<typeof probeChatGptAuthState>, recovered: boolean, recoveryStatus: string, isRecoverableGate: boolean }>}
 */
async function probeAndRecoverAuthWithResult(page) {
  const initialAuth = await probeChatGptAuthState(page);

  const isRecoverableGate =
    initialAuth.status === "recoverable_account_selection_gate" ||
    initialAuth.status === "recoverable_auth_cta_with_shell";

  if (!isRecoverableGate) {
    return {
      initialAuth,
      auth: initialAuth,
      recovered: false,
      recoveryStatus: initialAuth.status,
      isRecoverableGate: false
    };
  }

  const recovery = await attemptRecoverableAuthRecovery(page);

  if (recovery.recovered) {
    const finalAuth = await probeChatGptAuthState(page);
    return {
      initialAuth,
      auth: finalAuth,
      recovered: true,
      recoveryStatus: recovery.status,
      isRecoverableGate: true
    };
  }

  return {
    initialAuth,
    auth: initialAuth,
    recovered: false,
    recoveryStatus: recovery.status,
    isRecoverableGate: true
  };
}

const OUT_DIR = path.resolve(process.cwd(), "tmp", "cdp-smoke");
const SUMMARY_PATH = path.join(OUT_DIR, "summary.json");
const SCREENSHOT_PATH = path.join(OUT_DIR, "chatgpt-page.png");
const TARGET_URL = readFlag("--url") || "https://chatgpt.com";
const extensionPath = path.resolve(process.cwd(), "dist/extension");
const browserExecutablePath = process.env.BROWSER_EXECUTABLE_PATH || null;
const cdpEndpointArg = readFlag("--cdp-endpoint");
const reuseOpenChatgptTab = !process.argv.includes("--no-reuse-open-chatgpt-tab");
const noNavOnAttach = !process.argv.includes("--nav-on-attach");

const strategy = resolveBrowserStrategyFromCli({
  cdpEndpointArg,
  reuseOpenChatgptTab,
  noNavOnAttach
});

if (strategy.mode !== "cdp") {
  console.error("[cdp-smoke] CDP attach requires --cdp-endpoint or CHATGPT_CDP_ENDPOINT.");
  process.exit(1);
}

let connection = null;

try {
  await fs.mkdir(OUT_DIR, { recursive: true });

  connection = await connectBrowserWithExtensionOrCdp({
    extensionPath,
    browserExecutablePath,
    strategy
  });

  const pages = connection.context.pages();
  const targetPage =
    pages.find((page) => page.url().startsWith("https://chatgpt.com")) ||
    (await connection.context.newPage());

  if (!strategy.noNavOnAttach || !targetPage.url().startsWith("https://chatgpt.com")) {
    await targetPage.goto(TARGET_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
  }
  await targetPage.waitForTimeout(3000);

  const serviceWorkers = await waitForExtensionServiceWorkers(connection.context);
  const serviceWorker = {
    ok: serviceWorkers.length > 0,
    count: serviceWorkers.length,
    urls: serviceWorkers.map((worker) => worker.url())
  };

  // Probe auth state with recovery for recoverable gates
  const {
    initialAuth,
    auth: finalAuth,
    recovered,
    recoveryStatus,
    isRecoverableGate
  } = await probeAndRecoverAuthWithResult(targetPage);

  let overlay = {
    ok: false,
    count: 0,
    dataset: { extensionId: "", tabId: "", phase: "" }
  };
  let overlayError = null;
  try {
    await ensureOverlay(targetPage);
    overlay = await collectOverlayEvidence(targetPage);
  } catch (error) {
    overlayError = error instanceof Error ? error.message : String(error);
  }

  const extensionId =
    overlay.dataset.extensionId ||
    deriveExtensionIdFromServiceWorkers(serviceWorkers) ||
    (overlay.ok ? await getExtensionId(targetPage) : "");
  let popup = {
    ok: false,
    url: "",
    runtimePing: {
      ok: false,
      phase: null,
      error: extensionId ? "popup_not_checked" : "extension_id_unavailable"
    }
  };
  if (extensionId) {
    popup = await collectPopupEvidence(connection.context, extensionId);
  }
  const extensionEvidence = classifyExtensionLoadedEvidence({
    serviceWorkerOk: serviceWorker.ok,
    overlayOk: overlay.ok,
    popupOk: popup.ok,
    runtimePingOk: popup.runtimePing.ok
  });
  const extensionLoaded = extensionEvidence.ok;

  // LoggedIn verdict: must be fully authenticated (not recoverable gate)
  const loggedIn =
    finalAuth.authenticated &&
    finalAuth.status !== "recoverable_account_selection_gate" &&
    finalAuth.status !== "recoverable_auth_cta_with_shell";

  const pageTestable = loggedIn && extensionLoaded;
  const verdict = pageTestable ? "PASS" : "FAIL";

  await targetPage.screenshot({ path: SCREENSHOT_PATH, fullPage: true }).catch(() => {});

  const summary = {
    timestamp: new Date().toISOString(),
    verdict,
    carrier: {
      mode: "real-browser-cdp-attach",
      cdpEndpoint: strategy.cdpEndpoint,
      targetUrl: targetPage.url() || TARGET_URL
    },
    finalLaunch: {
      loggedIn,
      auth: {
        ok: finalAuth.authenticated,
        status: finalAuth.status,
        evidence: finalAuth.evidence,
        url: finalAuth.url,
        title: finalAuth.title,
        markers: finalAuth.markers
      },
      recovery: {
        attempted: isRecoverableGate,
        recovered,
        status: recoveryStatus
      },
      extensionLoaded,
      extensionEvidenceMode: extensionEvidence.mode,
      pageTestable,
      serviceWorker,
      overlay,
      overlayError,
      popup,
      extensionId
    },
    artifacts: {
      summary: SUMMARY_PATH,
      screenshot: SCREENSHOT_PATH
    }
  };

  await fs.writeFile(SUMMARY_PATH, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(summary, null, 2));

  if (summary.verdict !== "PASS") {
    process.exitCode = 1;
  }
} finally {
  await cleanupBrowserConnection(connection);
}
