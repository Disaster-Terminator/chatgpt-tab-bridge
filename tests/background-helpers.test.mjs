import test from "node:test";
import assert from "node:assert/strict";

import { parseChatGptThreadUrl } from "../src/extension/core/chatgpt-url.mjs";
import {
  collectOverlaySyncTabIds,
  shouldKeepBindingForUrlChange
} from "../src/extension/core/background-helpers.mjs";

test("shouldKeepBindingForUrlChange preserves only the same normalized thread", () => {
  const binding = {
    tabId: 7,
    urlInfo: parseChatGptThreadUrl("https://chatgpt.com/c/thread-a")
  };

  assert.equal(
    shouldKeepBindingForUrlChange(
      binding,
      parseChatGptThreadUrl("https://chatgpt.com/c/thread-a?model=gpt-5")
    ),
    true
  );
  assert.equal(
    shouldKeepBindingForUrlChange(binding, parseChatGptThreadUrl("https://chatgpt.com/c/thread-b")),
    false
  );
});

test("collectOverlaySyncTabIds includes previous and next bound tabs", () => {
  const previousState = {
    bindings: {
      A: { tabId: 11 },
      B: { tabId: 22 }
    }
  };
  const nextState = {
    bindings: {
      A: null,
      B: { tabId: 22 }
    }
  };

  assert.deepEqual(
    collectOverlaySyncTabIds(previousState, nextState).sort((left, right) => left - right),
    [11, 22]
  );
});
