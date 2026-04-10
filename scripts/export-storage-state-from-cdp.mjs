import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { chromium } from "playwright";

import { DEFAULT_CDP_CONNECT_TIMEOUT_MS } from "./_playwright-bridge-helpers.mjs";

const endpoint = process.env.CHATGPT_CDP_ENDPOINT || "http://127.0.0.1:9333";
const outDir = path.resolve(process.cwd(), "playwright/.auth");
const storageStatePath = path.join(outDir, "chatgpt.cdp.storage.json");
const sessionStatePath = path.join(outDir, "chatgpt.cdp.session.json");

const browser = await chromium.connectOverCDP(endpoint, {
  timeout: DEFAULT_CDP_CONNECT_TIMEOUT_MS
});

try {
  const context = browser.contexts()[0];
  if (!context) {
    throw new Error(`No browser context available from CDP endpoint ${endpoint}`);
  }

  const page = context.pages().find((candidate) =>
    candidate.url().startsWith("https://chatgpt.com")
  );

  if (!page) {
    throw new Error("No open ChatGPT tab found in attached browser.");
  }

  await fs.mkdir(outDir, { recursive: true });

  const storageState = await context.storageState({ indexedDB: true });
  await fs.writeFile(storageStatePath, JSON.stringify(storageState, null, 2), "utf8");

  const sessionStorageData = await page.evaluate(() => {
    const data = {};
    for (let i = 0; i < sessionStorage.length; i += 1) {
      const key = sessionStorage.key(i);
      if (key) {
        data[key] = sessionStorage.getItem(key);
      }
    }
    return data;
  }).catch(() => ({}));

  await fs.writeFile(sessionStatePath, JSON.stringify(sessionStorageData, null, 2), "utf8");

  const summary = {
    endpoint,
    pageUrl: page.url(),
    cookies: storageState.cookies?.length || 0,
    origins: storageState.origins?.length || 0,
    sessionStorageKeys: Object.keys(sessionStorageData).length,
    storageStatePath,
    sessionStatePath
  };

  console.log(JSON.stringify(summary, null, 2));
} finally {
  browser._connection.close();
  process.exit(0);
}
