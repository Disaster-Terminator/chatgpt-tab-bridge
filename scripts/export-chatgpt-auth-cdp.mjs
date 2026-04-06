/**
 * Export ChatGPT authentication state by connecting to existing Chrome via CDP.
 *
 * Usage:
 *   1. First, launch Chrome with remote debugging:
 *      google-chrome --remote-debugging-port=9222 --user-data-dir=/home/raystorm/.config/google-chrome
 *   2. Manually complete Cloudflare verification and login in that Chrome window
 *   3. Then run this script:
 *      node scripts/export-chatgpt-auth-cdp.mjs
 *
 * Output:
 *   playwright/.auth/chatgpt.json          - Playwright storageState
 *   playwright/.auth/chatgpt.session.json  - Session storage (if applicable)
 *
 * IMPORTANT: Do NOT commit auth files to git. playwright/.auth is in .gitignore.
 */

import { chromium } from "playwright";
import process from "node:process";
import path from "node:path";
import fs from "node:fs/promises";

const AUTH_DIR = path.resolve(process.cwd(), "playwright/.auth");
const STORAGE_STATE = path.join(AUTH_DIR, "chatgpt.json");
const SESSION_STATE = path.join(AUTH_DIR, "chatgpt.session.json");
const CHATGPT_URL = "https://chatgpt.com";
const CDP_PORT = 9222;

/** @param {string} message */
function log(message) {
  console.log(`[export-auth-cdp] ${message}`);
}

/** @param {import("playwright").Page} page */
async function extractSessionStorage(page) {
  return await page.evaluate(() => {
    const data = {};
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      if (key) {
        data[key] = sessionStorage.getItem(key);
      }
    }
    return data;
  });
}

/**
 * Check if user is authenticated on chatgpt.com.
 * @param {import("playwright").Page} page
 * @returns {Promise<{ authenticated: boolean, status: string }>}
 */
async function checkAuthStatus(page) {
  const url = page.url();

  if (url.includes("/auth/") || url.includes("login")) {
    return { authenticated: false, status: "unauthenticated_auth_page" };
  }

  try {
    const accountTrigger = page.locator('button[data-testid="account-trigger"]').first();
    if (await accountTrigger.isVisible({ timeout: 8000 }).catch(() => false)) {
      return { authenticated: true, status: "authenticated_account_visible" };
    }

    const hasThreads = await page
      .locator('[data-testid*="sidebar-history"]').first()
      .isVisible({ timeout: 5000 })
      .catch(() => false);
    if (hasThreads) {
      return { authenticated: true, status: "authenticated_sidebar_visible" };
    }

    const composer = page.locator('[contenteditable="true"][role="textbox"]').first();
    if (await composer.isVisible({ timeout: 5000 }).catch(() => false)) {
      return { authenticated: true, status: "authenticated_composer_visible" };
    }

    const loginPrompt = page.locator('text=Log in').first();
    if (await loginPrompt.isVisible({ timeout: 3000 }).catch(() => false)) {
      return { authenticated: false, status: "unauthenticated_login_prompt" };
    }

    const continueWithButton = page.locator('[data-provider]').first();
    if (await continueWithButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      return { authenticated: false, status: "unauthenticated_oauth_page" };
    }

    if (url.match(/\/c\/[a-zA-Z0-9-]+/) || url.match(/\/g\/[a-zA-Z0-9-]+\/c\/[a-zA-Z0-9-]+/)) {
      return { authenticated: true, status: "authenticated_thread_url" };
    }

    return { authenticated: false, status: "unknown_landing" };
  } catch {
    return { authenticated: false, status: "page_check_error" };
  }
}

async function main() {
  await fs.mkdir(AUTH_DIR, { recursive: true });

  log(`正在连接到 Chrome CDP (port ${CDP_PORT})...`);
  log("请确保 Chrome 已启动: google-chrome --remote-debugging-port=9222");

  let browser;
  let context;

  try {
    // Connect to existing Chrome via CDP
    browser = await chromium.connectOverCDP(`http://localhost:${CDP_PORT}`);
    log("已连接到 Chrome。");

    // Get the default browser context (the one with user's profile)
    const contexts = browser.contexts();
    context = contexts[0];

    if (!context) {
      console.error("无法获取 browser context。");
      await browser.close();
      process.exitCode = 1;
      return;
    }

    log("获取到 browser context。");

    // Find or create a page for ChatGPT
    const pages = context.pages();
    let page = pages.find(p => p.url().includes("chatgpt.com")) || pages[0];

    if (!page) {
      log("未找到现有页面，创建新页面...");
      page = await context.newPage();
    }

    // Navigate to ChatGPT
    log("正在导航到 chatgpt.com...");
    await page.goto(CHATGPT_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(3000);

    // Check auth status
    const authStatus = await checkAuthStatus(page);
    log(`认证状态: ${authStatus.status}`);

    if (!authStatus.authenticated) {
      console.error("未检测到有效的登录态。");
      console.error("请在 Chrome 中手动完成登录和 Cloudflare 验证，然后重新运行此脚本。");
      await browser.close();
      process.exitCode = 1;
      return;
    }

    log(`检测到已登录: ${authStatus.status}`);

    // Export storageState from the context
    log("正在导出 storageState...");
    const storageState = await context.storageState();

    // Save storageState
    await fs.writeFile(STORAGE_STATE, JSON.stringify(storageState, null, 2), "utf8");
    log(`storageState 已导出: ${STORAGE_STATE}`);

    // Extract sessionStorage
    const sessionStorageData = await extractSessionStorage(page);
    if (Object.keys(sessionStorageData).length > 0) {
      await fs.writeFile(SESSION_STATE, JSON.stringify(sessionStorageData, null, 2), "utf8");
      log(`sessionStorage 已导出: ${SESSION_STATE} (${Object.keys(sessionStorageData).length} 项)`);
    } else {
      log("未检测到 sessionStorage 登录态依赖。");
      if (await fs.access(SESSION_STATE).then(() => true).catch(() => false)) {
        await fs.unlink(SESSION_STATE).catch(() => {});
        log("已删除过期的 sessionStorage 文件。");
      }
    }

    // Log cookie summary (not sensitive content)
    const cookieCount = storageState.cookies?.length || 0;
    const relevantCookies = (storageState.cookies || []).filter((c) =>
      c.name.startsWith("__Secure-") ||
      c.name.startsWith("__Host-") ||
      c.domain?.includes("chatgpt.com") ||
      c.domain?.includes("openai.com") ||
      c.domain?.includes("auth0.com")
    );
    log(`storageState 包含 ${cookieCount} 个 cookie，其中 ${relevantCookies.length} 个与 ChatGPT/OpenAI 认证相关。`);
    log("敏感 cookie 内容未打印到终端。");

    // Save screenshot
    const screenshotDir = path.resolve(process.cwd(), "tmp");
    await fs.mkdir(screenshotDir, { recursive: true });
    const screenshotPath = path.join(screenshotDir, "auth-export-cdp-status.png");
    await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
    log(`页面截图已保存: ${screenshotPath}`);

    await browser.close();
    log("认证状态导出完成。");
  } catch (error) {
    console.error(`导出失败: ${error instanceof Error ? error.message : String(error)}`);
    if (browser) {
      try {
        await browser.close();
      } catch {
        // ignore cleanup errors
      }
    }
    process.exitCode = 1;
  }
}

main();