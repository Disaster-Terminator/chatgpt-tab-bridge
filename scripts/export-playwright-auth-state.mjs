import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { chromium } from "playwright";

import {
  DEFAULT_AUTH_PATHS,
  launchBrowserWithExtension,
  probeChatGptAuthState,
  readPathFlag
} from "./_playwright-bridge-helpers.mjs";

const AUTH_DIR = path.resolve(process.cwd(), "playwright/.auth");
const STORAGE_STATE_PATH = path.resolve(process.cwd(), DEFAULT_AUTH_PATHS.storageState);
const SESSION_STATE_PATH = path.resolve(process.cwd(), DEFAULT_AUTH_PATHS.sessionStorage);
const EXTENSION_PATH = readPathFlag("--path") || path.resolve(process.cwd(), "dist/extension");
const SUMMARY_PATH = path.resolve(process.cwd(), "tmp", "auth-export-summary.json");

function log(message) {
  console.log(`[auth-export:diagnostic] ${message}`);
}

async function extractSessionStorage(page) {
  return await page.evaluate(() => {
    const data = {};
    for (let i = 0; i < sessionStorage.length; i += 1) {
      const key = sessionStorage.key(i);
      if (key) {
        data[key] = sessionStorage.getItem(key);
      }
    }
    return data;
  });
}

async function waitForManualLogin(page) {
  log("Diagnostic export is open in Playwright Chromium with the extension. Log into ChatGPT in that window, then press Enter here.");
  await new Promise((resolve) => process.stdin.once("data", resolve));
  await page.waitForTimeout(2000);
}

async function verifyRoundTripReplay() {
  const browser = await chromium.launch({ channel: "chromium", headless: false });
  const context = await browser.newContext({ storageState: STORAGE_STATE_PATH });
  const page = await context.newPage();

  try {
    await page.goto("https://chatgpt.com", { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(3000);
    return await probeChatGptAuthState(page);
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

async function main() {
  await fs.mkdir(AUTH_DIR, { recursive: true });
  await fs.mkdir(path.dirname(SUMMARY_PATH), { recursive: true });

  const launched = await launchBrowserWithExtension({
    extensionPath: EXTENSION_PATH
  });

  const { context, userDataDir } = launched;
  const page = context.pages()[0] || (await context.newPage());

  try {
    await page.goto("https://chatgpt.com", { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(3000);

    let auth = await probeChatGptAuthState(page);
    if (!auth.authenticated) {
      log(`Current state is not authenticated (${auth.status}).`);
      await waitForManualLogin(page);
      auth = await probeChatGptAuthState(page);
    }

    if (!auth.authenticated) {
      throw new Error(`playwright_export_not_authenticated:${auth.status}:${auth.evidence}`);
    }

    const storageState = await context.storageState({ indexedDB: true });
    await fs.writeFile(STORAGE_STATE_PATH, `${JSON.stringify(storageState, null, 2)}\n`, "utf8");

    const sessionStorageData = await extractSessionStorage(page);
    await fs.writeFile(SESSION_STATE_PATH, `${JSON.stringify(sessionStorageData, null, 2)}\n`, "utf8");

    const replayAuth = await verifyRoundTripReplay();

    const summary = {
      verdict: replayAuth.authenticated ? "PASS" : "FAIL",
      role: "diagnostic-storage-export",
      exportAuth: {
        status: auth.status,
        evidence: auth.evidence,
        url: auth.url,
        markers: auth.markers
      },
      replayAuth: {
        authenticated: replayAuth.authenticated,
        status: replayAuth.status,
        evidence: replayAuth.evidence,
        url: replayAuth.url,
        markers: replayAuth.markers
      },
      files: {
        storageState: STORAGE_STATE_PATH,
        sessionState: SESSION_STATE_PATH,
        summary: SUMMARY_PATH
      },
      cookies: storageState.cookies?.length || 0,
      origins: storageState.origins?.length || 0,
      sessionStorageKeys: Object.keys(sessionStorageData).length
    };

    await fs.writeFile(SUMMARY_PATH, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
    console.log(JSON.stringify(summary, null, 2));

    if (!replayAuth.authenticated) {
      process.exitCode = 1;
    }
  } finally {
    await context.close().catch(() => {});
    await fs.rm(userDataDir, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 250
    }).catch(() => {});
  }
}

await main();
