import path from "node:path";
import process from "node:process";

import {
  collectThreadObservation,
  connectBrowserWithExtensionOrCdp,
  readFlag,
  resolveBrowserStrategyFromCli,
  cleanupBrowserConnection
} from "./_playwright-bridge-helpers.mjs";

const extensionPath = path.resolve(process.cwd(), "dist/extension");
const browserExecutablePath = process.env.BROWSER_EXECUTABLE_PATH || null;
const cdpEndpointArg = readFlag("--cdp-endpoint");
const reuseOpenChatgptTab = !process.argv.includes("--no-reuse-open-chatgpt-tab");
const noNavOnAttach = !process.argv.includes("--nav-on-attach");

const strategy = resolveBrowserStrategyFromCli({
  cdpEndpointArg,
  reuseOpenChatgptTab,
  noNavOnAttach
});

if (strategy.mode !== "cdp") {
  console.error(
    "[cdp-smoke] CDP attach requires --cdp-endpoint or CHATGPT_CDP_ENDPOINT."
  );
  process.exit(1);
}

let connection = null;

try {
  connection = await connectBrowserWithExtensionOrCdp({
    extensionPath,
    browserExecutablePath,
    strategy
  });

  const contexts = connection.browser?.contexts() || [connection.context];
  const pages = connection.context.pages();
  const chatGptPages = pages.filter((page) =>
    page.url().startsWith("https://chatgpt.com")
  );
  const targetPage = chatGptPages[0] || null;
  const observation = targetPage ? await collectThreadObservation(targetPage) : null;

  const result = {
    mode: strategy.mode,
    cdpEndpoint: strategy.cdpEndpoint,
    contexts: contexts.length,
    pages: pages.length,
    chatGptPages: chatGptPages.length,
    targetUrl: targetPage?.url() || null,
    observation: observation
      ? {
          generating: observation.generating,
          latestUserHash: observation.latestUserHash,
          latestAssistantHash: observation.latestAssistantHash,
          userMessageCount: observation.userMessageCount,
          assistantMessageCount: observation.assistantMessageCount,
          sendButtonVisible: observation.sendButtonVisible
        }
      : null
  };

  console.log(JSON.stringify(result, null, 2));
} finally {
  await cleanupBrowserConnection(connection);
}
