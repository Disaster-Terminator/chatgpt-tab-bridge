import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../src/extension/content-helpers.js", import.meta.url), "utf8");
const context = {
  globalThis: {}
};
vm.runInNewContext(source, context, {
  filename: "content-helpers.js"
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
  const composer = {};
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

  assert.equal(result.ok, false);
  assert.equal(result.mode, "button_disabled");
  assert.equal(result.error, "send_button_disabled");
});
