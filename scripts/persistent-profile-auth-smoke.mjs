import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import {
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
      const infrastructure = await collectInfrastructureEvidence(secondLaunch.context, reopened.page);
      await reopened.page.screenshot({ path: SCREENSHOT_PATH, fullPage: true }).catch(() => {});

      const extensionEvidence = classifyExtensionLoadedEvidence({
        serviceWorkerOk: infrastructure.serviceWorker.ok,
        overlayOk: infrastructure.overlay.ok,
        popupOk: infrastructure.popup.ok,
        runtimePingOk: infrastructure.popup.runtimePing.ok
      });
      const loggedIn = reopened.auth.authenticated;
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
            ok: reopened.auth.authenticated,
            status: reopened.auth.status,
            evidence: reopened.auth.evidence,
            url: reopened.auth.url,
            title: reopened.auth.title,
            markers: reopened.auth.markers
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
