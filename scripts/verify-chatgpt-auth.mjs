/**
 * Verify exported ChatGPT authentication state can be reused by Playwright.
 *
 * Usage:
 *   node scripts/verify-chatgpt-auth.mjs
 *   node scripts/verify-chatgpt-auth.mjs --auth-state playwright/.auth/chatgpt.json
 *
 * Verification criteria:
 *   - PASS: Authenticated state detected (account menu, conversation UI)
 *   - FAIL: Unauthenticated (login prompt, auth redirect)
 *
 * Output:
 *   tmp/auth-verify-*.png - Screenshots of verification result
 *   tmp/auth-verify-*.json - Verification result summary
 */

import { chromium } from "playwright";
import process from "node:process";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";

/** @param {string} message */
function log(message) {
  console.log(`[verify-auth] ${message}`);
}

/** @param {import("playwright").Page} page */
async function checkAuthStatus(page) {
  const url = page.url();

  // Redirected to auth page - definitely not authenticated
  if (url.includes("/auth/") || url.includes("login")) {
    return { authenticated: false, status: "unauthenticated_auth_page", evidence: url };
  }

  try {
    // Check for account menu indicator (sign of authenticated user)
    const accountTrigger = page.locator('button[data-testid="account-trigger"]').first();
    if (await accountTrigger.isVisible({ timeout: 8000 }).catch(() => false)) {
      return { authenticated: true, status: "authenticated_account_visible", evidence: "account-trigger-visible" };
    }

    // Check for conversation thread sidebar - indicates logged in
    const hasSidebarHistory = await page
      .locator('[data-testid*="sidebar-history"]').first()
      .isVisible({ timeout: 5000 })
      .catch(() => false);
    if (hasSidebarHistory) {
      return { authenticated: true, status: "authenticated_sidebar_visible", evidence: "sidebar-history-visible" };
    }

    // Check for composer - another authenticated indicator
    const composer = page.locator('[contenteditable="true"][role="textbox"]').first();
    if (await composer.isVisible({ timeout: 5000 }).catch(() => false)) {
      return { authenticated: true, status: "authenticated_composer_visible", evidence: "composer-visible" };
    }

    // Check for login prompt
    const loginPrompt = page.locator('text=Log in').first();
    if (await loginPrompt.isVisible({ timeout: 3000 }).catch(() => false)) {
      return { authenticated: false, status: "unauthenticated_login_prompt", evidence: "login-prompt-visible" };
    }

    // Check for "Try now" / "Continue with" buttons (login page)
    const continueWithButton = page.locator('[data-provider]').first();
    if (await continueWithButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      return { authenticated: false, status: "unauthenticated_oauth_page", evidence: "oauth-buttons-visible" };
    }

    // Ambiguous state - page might still be loading or in transition
    // Check URL for thread patterns - if we're on a thread, we're authenticated
    if (url.match(/\/c\/[a-zA-Z0-9-]+/) || url.match(/\/g\/[a-zA-Z0-9-]+\/c\/[a-zA-Z0-9-]+/)) {
      return { authenticated: true, status: "authenticated_thread_url", evidence: url };
    }

    return { authenticated: false, status: "unknown_landing", evidence: url };
  } catch (error) {
    return { authenticated: false, status: "page_check_error", evidence: error instanceof Error ? error.message : String(error) };
  }
}

async function main() {
  // Read auth state path from command line or use default
  const authStateArgIndex = process.argv.indexOf("--auth-state");
  const authStatePath = authStateArgIndex !== -1
    ? (process.argv[authStateArgIndex + 1] || "playwright/.auth/chatgpt.json")
    : "playwright/.auth/chatgpt.json";

  const resolvedAuthStatePath = path.isAbsolute(authStatePath)
    ? authStatePath
    : path.resolve(process.cwd(), authStatePath);

  const sessionStatePath = path.join(path.dirname(resolvedAuthStatePath), "chatgpt.session.json");

  log(`认证状态文件: ${resolvedAuthStatePath}`);

  // Check if auth state file exists
  const authStateExists = await fs.access(resolvedAuthStatePath).then(() => true).catch(() => false);
  if (!authStateExists) {
    console.error(`认证状态文件不存在: ${resolvedAuthStatePath}`);
    console.error("请先运行 export-chatgpt-auth.mjs 导出认证状态。");
    process.exitCode = 1;
    return;
  }

  // Load auth state
  let storageState;
  try {
    const authStateContent = await fs.readFile(resolvedAuthStatePath, "utf8");
    storageState = JSON.parse(authStateContent);
    log(`已加载 storageState: ${(storageState.cookies?.length || 0)} 个 cookie`);
  } catch (error) {
    console.error(`加载认证状态失败: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
    return;
  }

  // Check for sessionStorage state
  let sessionStorageData = null;
  const sessionStateExists = await fs.access(sessionStatePath).then(() => true).catch(() => false);
  if (sessionStateExists) {
    try {
      const sessionContent = await fs.readFile(sessionStatePath, "utf8");
      sessionStorageData = JSON.parse(sessionContent);
      log(`已加载 sessionStorage: ${Object.keys(sessionStorageData).length} 项`);
    } catch (error) {
      console.error(`加载 sessionStorage 失败: ${error instanceof Error ? error.message : String(error)}`);
      // Continue without sessionStorage - it might not be critical
    }
  }

  // Create temporary user data directory for verification
  const tempUserDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "chatgpt-auth-verify-"));
  log(`临时用户数据目录: ${tempUserDataDir}`);

  let browserContext;
  let verificationResult;

  try {
    // Launch browser with auth state
    browserContext = await chromium.launchPersistentContext(tempUserDataDir, {
      headless: false, // Use headed mode to verify visually
      storageState: resolvedAuthStatePath,
      args: [
        "--no-first-run",
        "--no-default-browser-check"
      ]
    });

    log("浏览器已启动，正在导航到 chatgpt.com...");

    const page = await browserContext.newPage();

    // Restore sessionStorage if available
    if (sessionStorageData && Object.keys(sessionStorageData).length > 0) {
      await page.goto("https://chatgpt.com", { waitUntil: "domcontentloaded" });
      await page.evaluate((data) => {
        for (const [key, value] of Object.entries(data)) {
          try {
            sessionStorage.setItem(key, value);
          } catch {
            // Ignore sessionStorage errors
          }
        }
      }, sessionStorageData);
      log("已恢复 sessionStorage 数据。");
      // Reload to apply sessionStorage
      await page.reload({ waitUntil: "domcontentloaded" });
    } else {
      await page.goto("https://chatgpt.com", { waitUntil: "domcontentloaded" });
    }

    // Wait for page to stabilize
    await page.waitForTimeout(3000);

    // Check authentication status
    log("正在验证登录态...");
    const authStatus = await checkAuthStatus(page);

    verificationResult = {
      timestamp: new Date().toISOString(),
      authStatePath: resolvedAuthStatePath,
      sessionStatePath: sessionStateExists ? sessionStatePath : null,
      authStatus,
      verified: authStatus.authenticated,
      verdict: authStatus.authenticated ? "PASS" : "FAIL"
    };

    log(`验证结果: ${verificationResult.verdict}`);
    log(`状态: ${authStatus.status}`);
    log(`证据: ${authStatus.evidence}`);

    // Save screenshots
    const screenshotDir = path.resolve(process.cwd(), "tmp");
    await fs.mkdir(screenshotDir, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[.:]/g, "-");
    const screenshotPath = path.join(screenshotDir, `auth-verify-${timestamp}.png`);
    const resultPath = path.join(screenshotDir, `auth-verify-${timestamp}.json`);

    await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
    log(`截图已保存: ${screenshotPath}`);

    await fs.writeFile(resultPath, JSON.stringify(verificationResult, null, 2), "utf8");
    log(`验证结果已保存: ${resultPath}`);

    await browserContext.close();
  } catch (error) {
    console.error(`验证失败: ${error instanceof Error ? error.message : String(error)}`);
    verificationResult = {
      timestamp: new Date().toISOString(),
      authStatePath: resolvedAuthStatePath,
      sessionStatePath: sessionStateExists ? sessionStatePath : null,
      authStatus: { authenticated: false, status: "verification_error", evidence: error instanceof Error ? error.message : String(error) },
      verified: false,
      verdict: "FAIL",
      error: error instanceof Error ? error.message : String(error)
    };

    if (browserContext) {
      try {
        await browserContext.close();
      } catch {
        // ignore cleanup errors
      }
    }
  } finally {
    // Clean up temporary user data directory
    await fs.rm(tempUserDataDir, { recursive: true, force: true, maxRetries: 5 }).catch(() => {});
  }

  // Output final verdict
  console.log("\n=== 验收结论 ===");
  console.log(`认证状态复用: ${verificationResult.verified ? "成功" : "失败"}`);
  console.log(`认证状态文件: ${resolvedAuthStatePath}`);
  console.log(`sessionStorage 文件: ${sessionStateExists ? sessionStatePath : "不存在"}`);
  console.log(`验证 verdict: ${verificationResult.verdict}`);
  console.log(`验证状态: ${verificationResult.authStatus.status}`);

  if (!verificationResult.verified) {
    console.error("\n认证状态复用失败。");
    console.error("可能原因:");
    console.error("  1. storageState 未包含足够的认证 cookie");
    console.error("  2. ChatGPT 需要 sessionStorage 但未导出");
    console.error("  3. cookie 已过期或被 ChatGPT 服务端拒绝");
    console.error("  4. ChatGPT 登录态依赖其他未捕获的状态");
    console.error("\n建议:");
    console.error("  - 重新运行 export-chatgpt-auth.mjs 确保登录态有效");
    console.error("  - 检查 playwright/.auth/chatgpt.json 是否包含 __Secure- 相关 cookie");
    process.exitCode = 1;
  } else {
    console.log("\n认证状态可成功复用！");
    console.log("后续测试脚本可通过 --auth-state 参数加载此状态。");
  }
}

main();