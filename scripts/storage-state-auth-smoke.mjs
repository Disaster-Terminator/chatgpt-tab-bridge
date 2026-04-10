import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import { chromium } from "playwright";

const CHATGPT_URL = "https://chatgpt.com";
const OUT_DIR = path.resolve(process.cwd(), "tmp", "storage-state-smoke");
const STORAGE_STATE_PATH = path.join(OUT_DIR, "chatgpt.storage-state.json");
const SESSION_STATE_PATH = path.join(OUT_DIR, "chatgpt.session-state.json");
const replayOnly = process.argv.includes("--replay-only");

function log(message) {
  console.log(`[storage-smoke] ${message}`);
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

async function restoreSessionStorage(page, sessionStorageData) {
  if (!sessionStorageData || Object.keys(sessionStorageData).length === 0) {
    return;
  }

  await page.evaluate((data) => {
    for (const [key, value] of Object.entries(data)) {
      try {
        sessionStorage.setItem(key, value);
      } catch {
        // ignore sessionStorage restore failures
      }
    }
  }, sessionStorageData);
}

async function checkAuthStatus(page) {
  const url = page.url();
  if (url.includes("auth.openai.com") || url.includes("/log-in") || url.includes("/login")) {
    return { authenticated: false, status: "redirected_to_login", url };
  }

  const result = await page.evaluate(() => {
    const hasAccountTrigger = Boolean(document.querySelector('button[data-testid="account-trigger"]'));
    const hasComposer = Boolean(document.querySelector('[contenteditable="true"][role="textbox"], textarea'));
    const hasSidebar = Boolean(document.querySelector('[data-testid*="sidebar-history"]'));
    const title = document.title;
    return { hasAccountTrigger, hasComposer, hasSidebar, title, url: window.location.href };
  }).catch(() => ({ hasAccountTrigger: false, hasComposer: false, hasSidebar: false, title: "", url }));

  return {
    authenticated: result.hasAccountTrigger || result.hasComposer || result.hasSidebar,
    status: result.hasAccountTrigger
      ? "authenticated_account_visible"
      : result.hasComposer
        ? "authenticated_composer_visible"
        : result.hasSidebar
          ? "authenticated_sidebar_visible"
          : "unknown_landing",
    url: result.url,
    title: result.title
  };
}

async function phaseOneCapture() {
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "chatgpt-storage-capture-"));
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: ["--no-first-run", "--no-default-browser-check"]
  });
  const page = context.pages()[0] || await context.newPage();

  try {
    await page.goto(CHATGPT_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(3000);

    let auth = await checkAuthStatus(page);
    if (!auth.authenticated) {
      log(`manual login required (${auth.status})`);
      log("Complete login in the Playwright Chromium window, then press Enter here.");
      await new Promise((resolve) => process.stdin.once("data", resolve));
      await page.waitForTimeout(2000);
      auth = await checkAuthStatus(page);
    }

    if (!auth.authenticated) {
      throw new Error(`phase_one_not_authenticated:${auth.status}:${auth.url}`);
    }

    await fs.mkdir(OUT_DIR, { recursive: true });
    const storageState = await context.storageState({ indexedDB: true });
    await fs.writeFile(STORAGE_STATE_PATH, JSON.stringify(storageState, null, 2), "utf8");

    const sessionStorageData = await extractSessionStorage(page);
    await fs.writeFile(SESSION_STATE_PATH, JSON.stringify(sessionStorageData, null, 2), "utf8");

    return {
      auth,
      userDataDir,
      sessionStorageCount: Object.keys(sessionStorageData).length
    };
  } finally {
    await context.close().catch(() => {});
    await fs.rm(userDataDir, { recursive: true, force: true, maxRetries: 5 }).catch(() => {});
  }
}

async function phaseTwoReplay() {
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "chatgpt-storage-replay-"));
  const sessionStateRaw = await fs.readFile(SESSION_STATE_PATH, "utf8").catch(() => "{}");
  const sessionState = JSON.parse(sessionStateRaw || "{}");
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    storageState: STORAGE_STATE_PATH,
    args: ["--no-first-run", "--no-default-browser-check"]
  });
  const page = context.pages()[0] || await context.newPage();

  try {
    await page.goto(CHATGPT_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
    await restoreSessionStorage(page, sessionState);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);

    const auth = await checkAuthStatus(page);
    return {
      auth,
      sessionStorageCount: Object.keys(sessionState).length
    };
  } finally {
    await context.close().catch(() => {});
    await fs.rm(userDataDir, { recursive: true, force: true, maxRetries: 5 }).catch(() => {});
  }
}

await fs.mkdir(OUT_DIR, { recursive: true });

const phaseOne = replayOnly
  ? {
      auth: { authenticated: true, status: "replay_only_existing_state" },
      userDataDir: null,
      sessionStorageCount: 0
    }
  : await phaseOneCapture();
const phaseTwo = await phaseTwoReplay();

const summary = {
  phaseOne,
  phaseTwo,
  files: {
    storageState: STORAGE_STATE_PATH,
    sessionStorage: SESSION_STATE_PATH
  },
  verdict: phaseTwo.auth.authenticated ? "PASS" : "FAIL"
};

await fs.writeFile(path.join(OUT_DIR, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
console.log(JSON.stringify(summary, null, 2));

if (!phaseTwo.auth.authenticated) {
  process.exitCode = 1;
}
