/**
 * Diagnostic verifier for exported ChatGPT authentication state.
 *
 * Usage:
 *   node scripts/verify-chatgpt-auth.mjs
 *   node scripts/verify-chatgpt-auth.mjs --auth-state playwright/.auth/chatgpt.cdp.storage.json
 *
 * Verification criteria:
 *   - PASS: Authenticated state detected (account menu, conversation UI)
 *   - FAIL: Unauthenticated (login prompt, auth redirect)
 *
 * Output:
 *   tmp/auth-verify-*.png - Screenshots of verification result
 *   tmp/auth-verify-*.json - Verification result summary
 *
 * This script is diagnostic-only. It does not define the primary auth carrier.
 */

import { chromium } from "playwright";
import process from "node:process";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";

import {
  DEFAULT_AUTH_PATHS,
  loadSessionStorageData,
  probeChatGptAuthState,
  readPathFlag,
  reloadAfterSessionRestore,
  restoreSessionStorage,
  resolveAuthOptions,
  validateAuthFiles
} from "./_playwright-bridge-helpers.mjs";

/** @param {string} message */
function log(message) {
  console.log(`[verify-auth:diagnostic] ${message}`);
}

async function main() {
  const explicitSessionStatePath = readPathFlag("--session-state");
  const defaultSessionStatePath = path.resolve(process.cwd(), DEFAULT_AUTH_PATHS.sessionStorage);
  let inferredSessionStatePath = explicitSessionStatePath;
  if (!inferredSessionStatePath) {
    inferredSessionStatePath = await fs.access(defaultSessionStatePath)
      .then(() => defaultSessionStatePath)
      .catch(() => null);
  }

  const authOptions = resolveAuthOptions({
    authStateArg: readPathFlag("--auth-state") || DEFAULT_AUTH_PATHS.storageState,
    sessionStateArg: inferredSessionStatePath || undefined
  });
  const resolvedAuthStatePath = authOptions.storageStatePath;
  const sessionStatePath = authOptions.sessionStoragePath;

  log(`认证状态文件: ${resolvedAuthStatePath}`);

  const authFiles = await validateAuthFiles(resolvedAuthStatePath, sessionStatePath);
  if (!authFiles.valid) {
    console.error(authFiles.error || `认证状态文件不存在: ${resolvedAuthStatePath}`);
    console.error("请先运行 pnpm run auth:export 导出 storageState。");
    process.exitCode = 1;
    return;
  }

  const authStateContent = await fs.readFile(resolvedAuthStatePath, "utf8");
  const storageState = JSON.parse(authStateContent);
  log(`已加载 storageState: ${(storageState.cookies?.length || 0)} 个 cookie`);

  const sessionStorageData = sessionStatePath
    ? await loadSessionStorageData(sessionStatePath)
    : null;
  const sessionStateExists = Boolean(sessionStorageData && sessionStatePath);
  if (sessionStorageData) {
    log(`已加载 sessionStorage: ${Object.keys(sessionStorageData).length} 项`);
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

      await page.goto("https://chatgpt.com", { waitUntil: "domcontentloaded" });
      await restoreSessionStorage(page, sessionStorageData);
      await reloadAfterSessionRestore(page, sessionStorageData);

      // Wait for page to stabilize
      await page.waitForTimeout(3000);

      // Check authentication status
      log("正在验证登录态...");
      const authStatus = await probeChatGptAuthState(page);

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
      console.error("  - 重新运行 pnpm run auth:export 确保 carrier state 有效");
      console.error("  - 检查 playwright/.auth/chatgpt.cdp.storage.json 是否包含 __Secure- 相关 cookie");
      process.exitCode = 1;
  } else {
    console.log("\n认证状态可成功复用！");
    console.log("后续测试脚本可通过 --auth-state 参数加载此状态。");
  }
}

main();
