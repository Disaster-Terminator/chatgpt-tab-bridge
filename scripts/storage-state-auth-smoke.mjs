import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import {
  DEFAULT_AUTH_PATHS,
  ensureOverlay,
  getExtensionId,
  getRuntimeState,
  loadSessionStorageData,
  openPopup,
  probeChatGptAuthState,
  readFlag,
  readPathFlag,
  reloadAfterSessionRestore,
  resolveAuthOptions,
  restoreSessionStorage,
  validateAuthFiles,
  launchBrowserWithExtension
} from "./_playwright-bridge-helpers.mjs";

const OUT_DIR = path.resolve(process.cwd(), "tmp", "storage-state-smoke");
const SUMMARY_PATH = path.join(OUT_DIR, "summary.json");
const SCREENSHOT_PATH = path.join(OUT_DIR, "chatgpt-page.png");
const CHATGPT_URL = readFlag("--url") || "https://chatgpt.com";
const EXTENSION_PATH = readPathFlag("--path") || path.resolve(process.cwd(), "dist/extension");
const BROWSER_EXECUTABLE_PATH = process.env.BROWSER_EXECUTABLE_PATH || null;

function log(message) {
  console.log(`[storage-smoke:diagnostic] ${message}`);
}

async function waitForServiceWorkers(context, timeoutMs = 10000) {
  let workers = context.serviceWorkers();
  if (workers.length > 0) {
    return workers;
  }

  await context.waitForEvent("serviceworker", { timeout: timeoutMs }).catch(() => null);
  workers = context.serviceWorkers();
  return workers;
}

async function collectOverlayEvidence(page) {
  const overlayCount = await page.locator(".chatgpt-bridge-overlay").count();
  const dataset = await page
    .locator(".chatgpt-bridge-overlay")
    .first()
    .evaluate((node) => ({
      extensionId: node.dataset.extensionId || "",
      tabId: node.dataset.tabId || "",
      phase: node.querySelector("[data-slot='phase-badge']")?.getAttribute("data-phase") || ""
    }))
    .catch(() => ({ extensionId: "", tabId: "", phase: "" }));

  return {
    ok: overlayCount > 0,
    count: overlayCount,
    dataset
  };
}

async function collectPopupEvidence(context, extensionId) {
  const popupPage = await openPopup(context, extensionId);

  try {
    await popupPage.waitForSelector(".popup", { timeout: 15000 });
    await popupPage.waitForSelector("#bindAButton", { state: "attached", timeout: 15000 });
    await popupPage.waitForSelector("#startButton", { state: "attached", timeout: 15000 });

    const runtimeState = await getRuntimeState(popupPage);
    const runtimeOk = !runtimeState.error;

    return {
      ok: true,
      url: popupPage.url(),
      runtimePing: {
        ok: runtimeOk,
        phase: runtimeState.phase ?? null,
        error: runtimeState.error ?? null
      }
    };
  } finally {
    await popupPage.close().catch(() => {});
  }
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });

  const explicitSessionStatePath = readPathFlag("--session-state");
  const defaultSessionStatePath = path.resolve(process.cwd(), DEFAULT_AUTH_PATHS.sessionStorage);
  let inferredSessionStatePath = explicitSessionStatePath;
  if (!inferredSessionStatePath) {
    inferredSessionStatePath = await fs.access(defaultSessionStatePath)
      .then(() => defaultSessionStatePath)
      .catch(() => null);
  }

  const authStateArg = readPathFlag("--auth-state") || DEFAULT_AUTH_PATHS.storageState;
  const sessionStateArg = inferredSessionStatePath || undefined;
  const authOptions = resolveAuthOptions({
    authStateArg,
    sessionStateArg
  });

  const authFiles = await validateAuthFiles(
    authOptions.storageStatePath,
    authOptions.sessionStoragePath
  );

  if (!authFiles.valid) {
    throw new Error(authFiles.error || "auth_files_invalid");
  }

  const sessionStorageData = authOptions.sessionStoragePath
    ? await loadSessionStorageData(authOptions.sessionStoragePath)
    : null;

  let context = null;
  let userDataDir = null;
  /** @type {Record<string, unknown>} */
  let summary = {};

  try {
    const launched = await launchBrowserWithExtension({
      extensionPath: EXTENSION_PATH,
      browserExecutablePath: BROWSER_EXECUTABLE_PATH,
      storageStatePath: authOptions.storageStatePath,
      sessionStorageData,
      userDataDir: null
    });

    context = launched.context;
    userDataDir = launched.userDataDir;

    const page = context.pages()[0] || (await context.newPage());
    await page.goto(CHATGPT_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
    await restoreSessionStorage(page, sessionStorageData);
    await reloadAfterSessionRestore(page, sessionStorageData);
    await page.waitForTimeout(3000);

    const auth = await probeChatGptAuthState(page);
    await ensureOverlay(page);
    const overlay = await collectOverlayEvidence(page);
    const extensionId = overlay.dataset.extensionId || (await getExtensionId(page));

    const serviceWorkers = await waitForServiceWorkers(context);
    const popup = await collectPopupEvidence(context, extensionId);

    await page.screenshot({ path: SCREENSHOT_PATH, fullPage: true }).catch(() => {});

    const serviceWorkerEvidence = {
      ok: serviceWorkers.length > 0,
      count: serviceWorkers.length,
      urls: serviceWorkers.map((worker) => worker.url())
    };

    const verdict =
      auth.authenticated &&
      serviceWorkerEvidence.ok &&
      overlay.ok &&
      popup.ok &&
      popup.runtimePing.ok
        ? "PASS"
        : "FAIL";

    summary = {
      timestamp: new Date().toISOString(),
      verdict,
      browser: {
        ok: true,
        mode: "playwright-storage-replay-diagnostic",
        authStatePath: authOptions.storageStatePath,
        sessionStatePath: authOptions.sessionStoragePath,
        extensionPath: EXTENSION_PATH,
        targetUrl: CHATGPT_URL
      },
      auth: {
        ok: auth.authenticated,
        status: auth.status,
        evidence: auth.evidence,
        url: auth.url,
        title: auth.title,
        markers: auth.markers
      },
      serviceWorker: serviceWorkerEvidence,
      overlay,
      popup,
      artifacts: {
        summary: SUMMARY_PATH,
        screenshot: SCREENSHOT_PATH
      }
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    summary = {
      timestamp: new Date().toISOString(),
      verdict: "FAIL",
      browser: {
        ok: false,
        mode: "playwright-storage-replay-diagnostic",
        authStatePath: authOptions.storageStatePath,
        sessionStatePath: authOptions.sessionStoragePath,
        extensionPath: EXTENSION_PATH,
        targetUrl: CHATGPT_URL
      },
      error: message,
      artifacts: {
        summary: SUMMARY_PATH,
        screenshot: SCREENSHOT_PATH
      }
    };
  } finally {
    await fs.writeFile(SUMMARY_PATH, `${JSON.stringify(summary, null, 2)}\n`, "utf8");

    if (context) {
      await context.close().catch(() => {});
    }

    if (userDataDir) {
      await fs.rm(userDataDir, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 250
      }).catch(() => {});
    }
  }

  log(`verdict: ${summary.verdict}`);
  console.log(JSON.stringify(summary, null, 2));

  if (summary.verdict !== "PASS") {
    process.exitCode = 1;
  }
}

await main();
