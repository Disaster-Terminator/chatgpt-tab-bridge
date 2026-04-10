import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";

const chromeExecutable = process.env.CHATGPT_CDP_BROWSER || process.env.BROWSER_EXECUTABLE_PATH || "/usr/bin/google-chrome";
const cdpPort = process.env.CHATGPT_CDP_PORT || "9333";
const profileDir = process.env.CHATGPT_CDP_PROFILE_DIR || path.resolve(process.env.HOME || process.cwd(), ".chatgpt-cdp-profile");
const extensionPath = path.resolve(process.cwd(), "dist/extension");
const targetUrl = process.argv.includes("--no-open-chatgpt") ? "about:blank" : "https://chatgpt.com";

const args = [
  `--remote-debugging-port=${cdpPort}`,
  `--user-data-dir=${profileDir}`,
  `--disable-extensions-except=${extensionPath}`,
  `--load-extension=${extensionPath}`,
  "--no-first-run",
  "--no-default-browser-check",
  targetUrl
];

console.log("[cdp-launch] Launching dedicated browser profile for manual login...");
console.log(`[cdp-launch] Executable: ${chromeExecutable}`);
console.log(`[cdp-launch] Profile dir: ${profileDir}`);
console.log(`[cdp-launch] CDP endpoint: http://127.0.0.1:${cdpPort}`);
console.log("[cdp-launch] Log in manually once in that browser, then keep the browser open and run attach-based scripts.");

const child = spawn(chromeExecutable, args, {
  detached: false,
  stdio: "inherit"
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
