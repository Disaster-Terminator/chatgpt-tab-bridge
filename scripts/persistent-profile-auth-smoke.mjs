import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import {
  attemptRecoverableAuthRecovery,
  classifyExtensionLoadedEvidence,
  DEFAULT_PLAYWRIGHT_PROFILE_DIR,
  cleanupBrowser,
  collectOverlayEvidence,
  collectPopupEvidence,
  deriveExtensionIdFromServiceWorkers,
  ensureOverlay,
  getExtensionId,
  launchBrowserWithExtension,
  probeChatGptAuthState,
  readFlag,
  readPathFlag,
  waitForExtensionServiceWorkers
} from "./_playwright-bridge-helpers.mjs";

const OUT_DIR = path.resolve(process.cwd(), "tmp", "persistent-profile-smoke");
const SUMMARY_PATH = path.join(OUT_DIR, "summary.json");
const SCREENSHOT_PATH = path.join(OUT_DIR, "chatgpt-page.png");
const TARGET_URL = readFlag("--url") || "https://chatgpt.com";
const EXTENSION_PATH = readPathFlag("--path") || path.resolve(process.cwd(), "dist/extension");
const PROFILE_DIR =
  readPathFlag("--profile-dir") ||
  process.env.CHATGPT_PLAYWRIGHT_PROFILE_DIR ||
  DEFAULT_PLAYWRIGHT_PROFILE_DIR;
const BROWSER_EXECUTABLE_PATH = process.env.BROWSER_EXECUTABLE_PATH || null;
const INTERACTIVE = process.argv.includes("--interactive");

function log(message) {
  console.log(`[persistent-smoke] ${message}`);
}

async function waitForManualLogin() {
  log("Playwright Chromium persistent profile is open. Log into ChatGPT in that window, then press Enter here.");
  await new Promise((resolve) => process.stdin.once("data", resolve));
}

async function launchPersistentProfile() {
  return await launchBrowserWithExtension({
    extensionPath: EXTENSION_PATH,
    browserExecutablePath: BROWSER_EXECUTABLE_PATH,
    userDataDir: PROFILE_DIR
  });
}

async function openAndProbe(context) {
  const page = context.pages().find((candidate) => candidate.url().startsWith("https://chatgpt.com")) || (await context.newPage());
  await page.goto(TARGET_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(3000);
  const auth = await probeChatGptAuthState(page);
  return { page, auth };
}

/**
 * Probe auth state with recovery for recoverable gates.
 * Attempts generic recovery if the initial state is a recoverable gate,
 * then re-probes to get the final auth state.
 * @param {import("playwright").Page} page
 * @returns {Promise<{ initialAuth: import("./_playwright-bridge-helpers.mjs").ReturnType<typeof probeChatGptAuthState>, auth: import("./_playwright-bridge-helpers.mjs").ReturnType<typeof probeChatGptAuthState>, recovered: boolean, recoveryStatus: string, isRecoverableGate: boolean }>}
 */
async function probeAndRecoverAuth(page) {
  const initialAuth = await probeChatGptAuthState(page);

  // Check if this is a recoverable gate
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

  // Attempt safe generic recovery
  const recovery = await attemptRecoverableAuthRecovery(page);

  if (recovery.recovered) {
    // Re-probe after successful recovery
    const finalAuth = await probeChatGptAuthState(page);
    return {
      initialAuth,
      auth: finalAuth,
      recovered: true,
      recoveryStatus: recovery.status,
      isRecoverableGate: true
    };
  }

  // Recovery failed - return initial auth with recovery status for explicit blocker
  return {
    initialAuth,
    auth: initialAuth,
    recovered: false,
    recoveryStatus: recovery.status,
    isRecoverableGate: true
  };
}

async function collectInfrastructureEvidence(context, page) {
  await ensureOverlay(page);
  const overlay = await collectOverlayEvidence(page);
  const serviceWorkers = await waitForExtensionServiceWorkers(context);
  const serviceWorker = {
    ok: serviceWorkers.length > 0,
    count: serviceWorkers.length,
    urls: serviceWorkers.map((worker) => worker.url())
  };
  const extensionId =
    overlay.dataset.extensionId ||
    deriveExtensionIdFromServiceWorkers(serviceWorkers) ||
    (await getExtensionId(page));
  const popup = await collectPopupEvidence(context, extensionId);

  return {
    serviceWorker,
    overlay,
    popup,
    extensionId,
    extensionLoaded: serviceWorker.ok && overlay.ok && popup.ok && popup.runtimePing.ok
  };
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });

  /** @type {Record<string, unknown>} */
  let summary = {};
  let firstLaunch = null;
  let bootstrapPerformed = false;

  try {
    firstLaunch = await launchPersistentProfile();
    let { page, auth } = await openAndProbe(firstLaunch.context);

    if (!auth.authenticated && INTERACTIVE) {
      bootstrapPerformed = true;
      await waitForManualLogin();
      await page.waitForTimeout(3000);
      auth = await probeChatGptAuthState(page);
    }

    const firstAuth = auth;
    await cleanupBrowser(firstLaunch.context, firstLaunch.userDataDir, { removeUserDataDir: false });
    firstLaunch = null;

    const secondLaunch = await launchPersistentProfile();
    try {
      const reopened = await openAndProbe(secondLaunch.context);

      // Probe with recovery for recoverable gates BEFORE making final verdict
      const {
        initialAuth,
        auth: finalAuth,
        recovered,
        recoveryStatus,
        isRecoverableGate
      } = await probeAndRecoverAuth(reopened.page);

      const infrastructure = await collectInfrastructureEvidence(
        secondLaunch.context,
        reopened.page
      );
      await reopened.page.screenshot({ path: SCREENSHOT_PATH, fullPage: true }).catch(() => {});

      const extensionEvidence = classifyExtensionLoadedEvidence({
        serviceWorkerOk: infrastructure.serviceWorker.ok,
        overlayOk: infrastructure.overlay.ok,
        popupOk: infrastructure.popup.ok,
        runtimePingOk: infrastructure.popup.runtimePing.ok
      });

      // LoggedIn verdict: must be fully authenticated (not recoverable gate)
      const loggedIn =
        finalAuth.authenticated &&
        finalAuth.status !== "recoverable_account_selection_gate" &&
        finalAuth.status !== "recoverable_auth_cta_with_shell";

      const pageTestable = loggedIn && extensionEvidence.ok;
      const verdict = pageTestable ? "PASS" : "FAIL";

      summary = {
        timestamp: new Date().toISOString(),
        verdict,
        carrier: {
          primary: "playwright-persistent-profile",
          profileDir: PROFILE_DIR,
          extensionPath: EXTENSION_PATH,
          targetUrl: TARGET_URL,
          bootstrapPerformed
        },
        firstLaunch: {
          auth: {
            ok: firstAuth.authenticated,
            status: firstAuth.status,
            evidence: firstAuth.evidence,
            url: firstAuth.url,
            markers: firstAuth.markers
          }
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
          extensionLoaded: extensionEvidence.ok,
          extensionEvidenceMode: extensionEvidence.mode,
          pageTestable,
          serviceWorker: infrastructure.serviceWorker,
          overlay: infrastructure.overlay,
          popup: infrastructure.popup,
          extensionId: infrastructure.extensionId
        },
        artifacts: {
          summary: SUMMARY_PATH,
          screenshot: SCREENSHOT_PATH
        }
      };
    } finally {
      await cleanupBrowser(secondLaunch.context, secondLaunch.userDataDir, { removeUserDataDir: false });
    }
  } catch (error) {
    summary = {
      timestamp: new Date().toISOString(),
      verdict: "FAIL",
      carrier: {
        primary: "playwright-persistent-profile",
        profileDir: PROFILE_DIR,
        extensionPath: EXTENSION_PATH,
        targetUrl: TARGET_URL,
        bootstrapPerformed
      },
      error: error instanceof Error ? error.message : String(error),
      artifacts: {
        summary: SUMMARY_PATH,
        screenshot: SCREENSHOT_PATH
      }
    };
  } finally {
    if (firstLaunch) {
      await cleanupBrowser(firstLaunch.context, firstLaunch.userDataDir, { removeUserDataDir: false });
    }
    await fs.writeFile(SUMMARY_PATH, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  }

  log(`verdict: ${summary.verdict}`);
  console.log(JSON.stringify(summary, null, 2));

  if (summary.verdict !== "PASS") {
    process.exitCode = 1;
  }
}

await main();
