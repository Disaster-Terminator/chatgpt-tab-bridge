import test from "node:test";
import assert from "node:assert/strict";

import {
  classifyExtensionLoadedEvidence,
  classifyChatGptAuthState,
  isChatGptLoginOrAuthUrl,
  isExpectedPendingBoundaryVisible
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

test("isExpectedPendingBoundaryVisible accepts the exposed between-hop boundary", () => {
  assert.equal(
    isExpectedPendingBoundaryVisible({
      popupState: {
        nextHop: "B -> A",
        currentStep: "pending B -> A"
      },
      runtimeState: {
        activeHop: {
          sourceRole: "B",
          targetRole: "A",
          round: 2,
          hopId: "persisted-hop-id",
          stage: "pending"
        }
      },
      expectedSourceRole: "B",
      expectedTargetRole: "A"
    }),
    true
  );
});

test("isExpectedPendingBoundaryVisible rejects a consumed boundary once current step advances", () => {
  assert.equal(
    isExpectedPendingBoundaryVisible({
      popupState: {
        nextHop: "B -> A",
        currentStep: "reading B"
      },
      runtimeState: {
        activeHop: {
          sourceRole: "B",
          targetRole: "A",
          round: 2,
          hopId: null,
          stage: "pending"
        }
      },
      expectedSourceRole: "B",
      expectedTargetRole: "A"
    }),
    false
  );
});

// ===== Recoverable Auth Gate Tests =====

test("classifyChatGptAuthState detects recoverable account-selection gate with authenticated shell", () => {
  // This is the key recoverable gate: modal visible + sidebar/history evidence present
  const result = classifyChatGptAuthState({
    url: "https://chatgpt.com/",
    title: "ChatGPT",
    sidebarVisible: true,
    historyItemsVisible: true,
    accountChooserModalVisible: true
  });

  assert.equal(result.authenticated, false);
  assert.equal(result.status, "recoverable_account_selection_gate");
  assert.equal(result.markers.accountChooserModalVisible, true);
  assert.equal(result.markers.sidebarVisible, true);
});

test("classifyChatGptAuthState detects recoverable auth CTA with authenticated shell", () => {
  // Auth CTA visible but we have authenticated markers - recoverable, not terminal
  const result = classifyChatGptAuthState({
    url: "https://chatgpt.com/",
    title: "ChatGPT",
    sidebarVisible: true,
    composerVisible: true,
    authCtaVisible: true
  });

  assert.equal(result.authenticated, false);
  assert.equal(result.status, "recoverable_auth_cta_with_shell");
});

test("classifyChatGptAuthState treats auth CTA without authenticated markers as terminal", () => {
  // Auth CTA without any authenticated markers - terminal unauthenticated
  const result = classifyChatGptAuthState({
    url: "https://chatgpt.com/",
    title: "ChatGPT",
    composerVisible: true,
    authCtaVisible: true,
    sidebarVisible: false,
    historyItemsVisible: false,
    accountVisible: false
  });

  assert.equal(result.authenticated, false);
  assert.equal(result.status, "unauthenticated_auth_cta_visible");
});

test("classifyChatGptAuthState includes accountChooserModalVisible in markers", () => {
  const withModal = classifyChatGptAuthState({
    url: "https://chatgpt.com/",
    accountChooserModalVisible: true
  });
  const withoutModal = classifyChatGptAuthState({
    url: "https://chatgpt.com/"
  });

  assert.equal(withModal.markers.accountChooserModalVisible, true);
  assert.equal(withoutModal.markers.accountChooserModalVisible, false);
});

test("classifyChatGptAuthState does not treat empty dialog shell as recoverable gate", () => {
  const result = classifyChatGptAuthState({
    url: "https://chatgpt.com/",
    title: "ChatGPT",
    composerVisible: true,
    historyItemsVisible: true,
    accountChooserModalVisible: false
  });

  assert.equal(result.authenticated, true);
  assert.equal(result.status, "authenticated_history_items_visible");
});

test("classifyChatGptAuthState treats visible email input as recoverable gate when shell exists", () => {
  const result = classifyChatGptAuthState({
    url: "https://chatgpt.com/",
    title: "ChatGPT",
    composerVisible: true,
    historyItemsVisible: true,
    accountChooserModalVisible: true,
    loginPromptVisible: true
  });

  assert.equal(result.authenticated, false);
  assert.equal(result.status, "recoverable_account_selection_gate");
});
