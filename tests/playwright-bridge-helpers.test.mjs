import test from "node:test";
import assert from "node:assert/strict";

import {
  classifyExtensionLoadedEvidence,
  classifyChatGptAuthState,
  isChatGptLoginOrAuthUrl
} from "../scripts/_playwright-bridge-helpers.mjs";

test("isChatGptLoginOrAuthUrl detects login and auth routes", () => {
  assert.equal(isChatGptLoginOrAuthUrl("https://chatgpt.com/auth/login"), true);
  assert.equal(isChatGptLoginOrAuthUrl("https://auth.openai.com/u/login"), true);
  assert.equal(isChatGptLoginOrAuthUrl("https://chatgpt.com/c/thread-123"), false);
});

test("classifyChatGptAuthState accepts authenticated account UI", () => {
  const result = classifyChatGptAuthState({
    url: "https://chatgpt.com/",
    title: "ChatGPT",
    accountVisible: true
  });

  assert.equal(result.authenticated, true);
  assert.equal(result.status, "authenticated_account_visible");
});

test("classifyChatGptAuthState accepts thread plus sidebar markers", () => {
  const result = classifyChatGptAuthState({
    url: "https://chatgpt.com/c/thread-123",
    title: "ChatGPT",
    sidebarVisible: true
  });

  assert.equal(result.authenticated, true);
  assert.equal(result.status, "authenticated_thread_sidebar_visible");
});

test("classifyChatGptAuthState rejects composer-only states", () => {
  const result = classifyChatGptAuthState({
    url: "https://chatgpt.com/",
    title: "ChatGPT",
    composerVisible: true
  });

  assert.equal(result.authenticated, false);
  assert.equal(result.status, "landing_composer_only");
});

test("classifyChatGptAuthState rejects thread composer without stronger logged-in markers", () => {
  const result = classifyChatGptAuthState({
    url: "https://chatgpt.com/c/thread-123",
    title: "ChatGPT",
    composerVisible: true
  });

  assert.equal(result.authenticated, false);
  assert.equal(result.status, "landing_thread_composer_only");
});

test("classifyChatGptAuthState rejects oauth and login prompts", () => {
  const oauth = classifyChatGptAuthState({
    url: "https://chatgpt.com/",
    oauthButtonsVisible: true
  });
  const loginPrompt = classifyChatGptAuthState({
    url: "https://chatgpt.com/",
    loginPromptVisible: true
  });

  assert.equal(oauth.authenticated, false);
  assert.equal(oauth.status, "unauthenticated_oauth_page");
  assert.equal(loginPrompt.authenticated, false);
  assert.equal(loginPrompt.status, "unauthenticated_login_prompt");
});

test("classifyChatGptAuthState rejects login/signup CTA landing pages", () => {
  const result = classifyChatGptAuthState({
    url: "https://chatgpt.com/",
    authCtaVisible: true,
    composerVisible: true
  });

  assert.equal(result.authenticated, false);
  assert.equal(result.status, "unauthenticated_auth_cta_visible");
});

test("classifyChatGptAuthState accepts authenticated shell with history items", () => {
  const result = classifyChatGptAuthState({
    url: "https://chatgpt.com/",
    composerVisible: true,
    historyItemsVisible: true,
    authCtaVisible: false
  });

  assert.equal(result.authenticated, true);
  assert.equal(result.status, "authenticated_history_items_visible");
});

test("classifyExtensionLoadedEvidence accepts overlay plus popup runtime without worker", () => {
  const result = classifyExtensionLoadedEvidence({
    serviceWorkerOk: false,
    overlayOk: true,
    popupOk: true,
    runtimePingOk: true
  });

  assert.equal(result.ok, true);
  assert.equal(result.mode, "overlay_popup_runtime");
});

test("classifyExtensionLoadedEvidence rejects partial extension evidence", () => {
  const result = classifyExtensionLoadedEvidence({
    serviceWorkerOk: false,
    overlayOk: true,
    popupOk: false,
    runtimePingOk: false
  });

  assert.equal(result.ok, false);
  assert.equal(result.mode, "insufficient_extension_evidence");
});
