import test from "node:test";
import assert from "node:assert/strict";

import { parseChatGptThreadUrl } from "../src/extension/core/chatgpt-url.mjs";

test("parses regular ChatGPT thread URLs", () => {
  const parsed = parseChatGptThreadUrl("https://chatgpt.com/c/abc-123");

  assert.equal(parsed.supported, true);
  assert.equal(parsed.kind, "regular");
  assert.equal(parsed.conversationId, "abc-123");
  assert.equal(parsed.projectId, null);
});

test("parses project scoped ChatGPT thread URLs", () => {
  const parsed = parseChatGptThreadUrl(
    "https://chatgpt.com/g/g-p-1234567890/c/def-456?model=gpt-5"
  );

  assert.equal(parsed.supported, true);
  assert.equal(parsed.kind, "project");
  assert.equal(parsed.projectId, "g-p-1234567890");
  assert.equal(parsed.conversationId, "def-456");
});

test("rejects unsupported URLs", () => {
  const parsed = parseChatGptThreadUrl("https://chatgpt.com/");

  assert.equal(parsed.supported, false);
  assert.equal(parsed.reason, "unsupported_thread_url");
});
