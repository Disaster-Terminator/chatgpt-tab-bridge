import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import { chromium } from "playwright";

const extensionPath = readPathFlag("--path") || path.resolve(process.cwd(), "dist/extension");
const browserExecutablePath = process.env.BROWSER_EXECUTABLE_PATH || null;
const interactive = process.argv.includes("--interactive");
const targetUrl = readFlag("--url") || "https://chatgpt.com";

const userDataDir = await mkdtemp(path.join(os.tmpdir(), "chatgpt-bridge-smoke-"));

let context;
let runError = null;

try {
  context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    ...(browserExecutablePath ? { executablePath: browserExecutablePath } : {}),
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--enable-unsafe-extension-debugging"
    ]
  });

  const threadPage = await context.newPage();
  await threadPage.goto(targetUrl, {
    waitUntil: "domcontentloaded"
  });
  await threadPage.waitForSelector(".chatgpt-bridge-overlay", {
    timeout: 30000
  });

  const extensionId = await threadPage.locator(".chatgpt-bridge-overlay").evaluate((node) => {
    return node.dataset.extensionId || "";
  });
  if (!extensionId) {
    throw new Error("Overlay rendered without an extension id.");
  }

  console.log(`Overlay injection smoke check: PASS (${targetUrl})`);

  const popupPage = await context.newPage();
  await popupPage.goto(`chrome-extension://${extensionId}/popup.html`, {
    waitUntil: "domcontentloaded"
  });

  await popupPage.waitForSelector("text=Popup control surface");
  await popupPage.waitForSelector("#bindAButton");
  await popupPage.waitForSelector("#startButton");

  console.log(`Extension loaded: ${extensionId}`);
  console.log("Popup smoke check: PASS");

  if (interactive) {
    console.log("Interactive mode enabled. Press Ctrl+C in the terminal to exit.");
    await new Promise(() => {});
  }
} catch (error) {
  runError = error;
} finally {
  if (context) {
    await context.close().catch(() => {});
  }

  try {
    await rm(userDataDir, {
      force: true,
      maxRetries: 5,
      recursive: true,
      retryDelay: 250
    });
  } catch (cleanupError) {
    if (!runError) {
      throw cleanupError;
    }
  }
}

if (runError) {
  throw runError;
}

function readFlag(flagName) {
  const index = process.argv.indexOf(flagName);
  if (index === -1) {
    return null;
  }

  return process.argv[index + 1] ?? null;
}

function readPathFlag(flagName) {
  const value = readFlag(flagName);
  if (!value) {
    return null;
  }

  // Resolve relative paths against cwd, preserve absolute paths
  return path.isAbsolute(value) ? value : path.resolve(process.cwd(), value);
}
