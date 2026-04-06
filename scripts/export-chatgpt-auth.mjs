/**
 * Export ChatGPT authentication state for Playwright reuse.
 *
 * Usage:
 *   pnpm run auth:export
 *   node scripts/export-chatgpt-auth.mjs
 *
 * Flow:
 *   1. Copies your WSL Chrome Default profile to a temp directory
 *   2. Launches Chrome with Playwright using that copied profile
 *   3. If already logged in, exports storageState directly
 *   4. If not logged in or Cloudflare challenge appears, waits for you to complete
 *
 * Output:
 *   playwright/.auth/chatgpt.json          - Playwright storageState
 *   playwright/.auth/chatgpt.session.json  - Session storage (if applicable)
 *
 * Requirements:
 *   - WSL Chrome must have a logged-in Default profile at ~/.config/google-chrome/Default
 *   - Or CHROME_DATA_DIR environment variable pointing to your Chrome profile
 *
 * IMPORTANT: Do NOT commit auth files to git. playwright/.auth is in .gitignore.
 */

import { chromium } from "playwright";
import process from "node:process";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";

const AUTH_DIR = path.resolve(process.cwd(), "playwright/.auth");
const STORAGE_STATE = path.join(AUTH_DIR, "chatgpt.json");
const SESSION_STATE = path.join(AUTH_DIR, "chatgpt.session.json");
const CHATGPT_URL = "https://chatgpt.com";

/** @param {string} message */
function log(message) {
  console.log(`[export-auth] ${message}`);
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

  // Chrome configuration
  const chromeDataDir = process.env.CHROME_DATA_DIR ||
    path.join(process.env.HOME || "/home/raystorm", ".config/google-chrome");
  const chromeExecutable = process.env.CHROME_EXECUTABLE || "/usr/bin/google-chrome";

  log(`Chrome executable: ${chromeExecutable}`);
  log(`Chrome profile source: ${chromeDataDir}`);

  // Copy Default profile to temp dir to avoid SingletonLock issues
  log("复制 Default profile 到临时目录...");
  const tempProfileDir = await fs.mkdtemp(path.join(os.tmpdir(), "chatgpt-auth-profile-"));
  const defaultProfileSource = path.join(chromeDataDir, "Default");

  try {
    await fs.mkdir(tempProfileDir, { recursive: true });
    await fs.cp(defaultProfileSource, path.join(tempProfileDir, "Default"), { recursive: true });

    // Remove SingletonLock if it exists
    for (const file of ["SingletonLock", "SingletonSocket", "SingletonCookie"]) {
      const filePath = path.join(tempProfileDir, file);
      await fs.unlink(filePath).catch(() => {});
      await fs.rm(filePath, { recursive: true, force: true }).catch(() => {});
    }

    log("Profile 复制完成。");
  } catch (err) {
    console.error(`复制 profile 失败: ${err.message}`);
    process.exitCode = 1;
    return;
  }

  let context;

  try {
    // Launch Chrome with Playwright using copied profile
    context = await chromium.launchPersistentContext(tempProfileDir, {
      headless: false,
      executablePath: chromeExecutable,
      args: [
        "--no-first-run",
        "--no-default-browser-check"
      ]
    });

    log("Chrome 已启动（Playwright 模式）。");

    // Navigate to ChatGPT
    log("正在导航到 chatgpt.com...");
    const pages = context.pages();
    const page = pages[0] || await context.newPage();
    await page.goto(CHATGPT_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(3000);

    // Check auth status
    const authStatus = await checkAuthStatus(page);
    log(`认证状态: ${authStatus.status}`);

    if (!authStatus.authenticated) {
      log(`未检测到登录态 (${authStatus.status})`);
      log("请在浏览器中完成 Cloudflare 验证，然后在终端按 Enter 继续...");
      await new Promise((resolve) => {
        process.stdin.once("data", () => resolve());
      });

      // Re-check after user interaction
      const finalStatus = await checkAuthStatus(page);
      if (!finalStatus.authenticated) {
        console.error("仍未检测到有效登录态。请确认已完成验证后重试。");
        await context.close();
        process.exitCode = 1;
        return;
      }
    }

    log(`登录态确认: ${authStatus.status}`);

    // Export storageState
    log("正在导出 storageState...");
    const storageState = await context.storageState();
    await fs.writeFile(STORAGE_STATE, JSON.stringify(storageState, null, 2), "utf8");
    log(`storageState 已导出: ${STORAGE_STATE}`);

    // Export sessionStorage
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

    // Log cookie summary
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
    const screenshotPath = path.join(screenshotDir, "auth-export-status.png");
    await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
    log(`页面截图已保存: ${screenshotPath}`);

    await context.close();
    log("认证状态导出完成。");
  } catch (error) {
    console.error(`导出失败: ${error.message}`);
    if (context) {
      try {
        await context.close();
      } catch {
        // ignore cleanup
      }
    }
    process.exitCode = 1;
  } finally {
    // Clean up temp profile
    log("清理临时 profile 目录...");
    await fs.rm(tempProfileDir, { recursive: true, force: true, maxRetries: 5 }).catch(() => {});
  }
}

main();