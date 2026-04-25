import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";

import { readExtensionSource } from "./extension-test-harness.mjs";

const { source, fileUrl } = await readExtensionSource("content-helpers");
const context = {
  globalThis: {}
};
vm.runInNewContext(source, context, {
  filename: fileUrl.pathname.split("/").pop()
});

const helpers = context.globalThis.ChatGptBridgeContent;

test("applyComposerText uses value for textarea composers", () => {
  const dispatched = [];
  class FakeTextArea {}
  Object.defineProperty(FakeTextArea.prototype, "value", {
    get() {
      return this._value || "";
    },
    set(nextValue) {
      this._value = nextValue;
    }
  });
  context.HTMLTextAreaElement = FakeTextArea;
  context.globalThis.HTMLTextAreaElement = FakeTextArea;
  const composer = {
    __proto__: FakeTextArea.prototype,
    tagName: "TEXTAREA",
    focus() {},
    dispatchEvent(event) {
      dispatched.push(event.type);
      return true;
    }
  };

  const mode = helpers.applyComposerText(composer, "hello");
  assert.equal(mode, "value");
  assert.equal(composer.value, "hello");
  assert.deepEqual(dispatched, ["input", "change"]);
});

test("applyComposerText uses textContent for contenteditable composers", () => {
  const dispatched = [];
  const selection = {
    removeAllRanges() {},
    addRange() {}
  };
  const composer = {
    tagName: "DIV",
    textContent: "",
    ownerDocument: {
      createRange() {
        return {
          selectNodeContents() {},
          collapse() {}
        };
      },
      execCommand(_command, _showUi, value) {
        if (typeof value === "string") {
          composer.textContent = value;
        }
        return true;
      },
      getSelection() {
        return selection;
      }
    },
    focus() {},
    dispatchEvent(event) {
      dispatched.push(event.type);
      return true;
    }
  };

  const mode = helpers.applyComposerText(composer, "hello world");
  assert.equal(mode, "contenteditable");
  assert.equal(composer.textContent, "hello world");
  assert.deepEqual(dispatched, ["beforeinput", "input"]);
});

test("findBestComposer prefers visible contenteditable over hidden textarea", () => {
  const hiddenTextarea = {
    tagName: "TEXTAREA",
    hidden: false,
    getAttribute() {
      return null;
    },
    getClientRects() {
      return [];
    }
  };
  const visibleEditor = {
    tagName: "DIV",
    hidden: false,
    getAttribute() {
      return null;
    },
    getClientRects() {
      return [{ width: 100, height: 20 }];
    }
  };
  const root = {
    querySelectorAll(selector) {
      if (selector === '[contenteditable="true"][role="textbox"]') {
        return [visibleEditor];
      }
      if (selector === "textarea") {
        return [hiddenTextarea];
      }
      return [];
    }
  };

  const composer = helpers.findBestComposer(root);
  assert.equal(composer, visibleEditor);
});

test("triggerComposerSend fails explicitly when send button is unavailable", () => {
  const form = {
    requestSubmit() {
      form.called = true;
    }
  };
  const composer = {
    closest(selector) {
      return selector === "form" ? form : null;
    }
  };
  const sendButton = {
    disabled: true,
    click() {
      throw new Error("disabled button should not be clicked");
    },
    getAttribute() {
      return null;
    }
  };

  const result = helpers.triggerComposerSend({
    root: {},
    composer,
    sendButton
  });

  assert.equal(result.ok, true);
  assert.equal(result.mode, "form_submit");
  assert.equal(form.called, true);
});

test("isReplyGenerationInProgressFromDoc treats terminal bridge directives as settled even with stale stop UI", () => {
  const mockDoc = {
    querySelector: (selector) => {
      if (selector.includes("stop-button") || selector.includes("stop-generating-button")) {
        return {};
      }
      return null;
    }
  };
  const originalGlobal = globalThis.document;
  const originalContextDocument = context.document;
  globalThis.document = mockDoc;
  context.document = mockDoc;

  try {
    const result = helpers.isReplyGenerationInProgressFromDoc("done\n[BRIDGE_STATE] CONTINUE");
    assert.equal(result, false);
  } finally {
    globalThis.document = originalGlobal;
    context.document = originalContextDocument;
  }
});

test("isReplyGenerationInProgressFromDoc stays true for streaming replies without terminal evidence", () => {
  const mockDoc = {
    querySelector: (selector) => {
      if (selector.includes("stop-button") || selector.includes("stop-generating-button")) {
        return {};
      }
      return null;
    }
  };
  const originalGlobal = globalThis.document;
  const originalContextDocument = context.document;
  globalThis.document = mockDoc;
  context.document = mockDoc;

  try {
    const result = helpers.isReplyGenerationInProgressFromDoc("reply still streaming");
    assert.equal(result, true);
  } finally {
    globalThis.document = originalGlobal;
    context.document = originalContextDocument;
  }
});

test("isReplyGenerationInProgressFromDoc treats latest user after assistant as pending generation", () => {
  const assistant = {
    textContent: "previous assistant",
    compareDocumentPosition(other) {
      return other === user ? context.Node.DOCUMENT_POSITION_FOLLOWING : 0;
    }
  };
  const user = {
    textContent: "new user message",
    compareDocumentPosition() {
      return 0;
    }
  };
  const mockDoc = {
    querySelector: () => null,
    querySelectorAll(selector) {
      if (selector === '[data-message-author-role="assistant"]') {
        return [assistant];
      }
      if (selector === '[data-message-author-role="user"]') {
        return [user];
      }
      return [];
    }
  };
  const originalGlobal = globalThis.document;
  const originalContextDocument = context.document;
  const originalContextNode = context.Node;
  globalThis.document = mockDoc;
  context.document = mockDoc;
  context.Node = {
    DOCUMENT_POSITION_FOLLOWING: 4
  };

  try {
    const result = helpers.isReplyGenerationInProgressFromDoc("previous assistant");
    assert.equal(result, true);
  } finally {
    globalThis.document = originalGlobal;
    context.document = originalContextDocument;
    context.Node = originalContextNode;
  }
});
