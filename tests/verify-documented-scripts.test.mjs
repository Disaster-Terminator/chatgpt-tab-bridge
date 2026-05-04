import test from "node:test";
import assert from "node:assert/strict";

import {
  extractDocumentedScripts,
  findMissingScripts
} from "../scripts/ci/verify-documented-scripts.mjs";

test("extractDocumentedScripts finds npm and pnpm run commands", () => {
  const markdown = `
Use pnpm run build for bundles.
Then npm run test and pnpm run test:smoke.
Ignore plain npm install.
`;

  assert.deepEqual(extractDocumentedScripts(markdown), ["build", "test", "test:smoke"]);
});

test("findMissingScripts reports missing scripts with file context", () => {
  const result = findMissingScripts({
    packageScripts: {
      build: "node build.mjs",
      test: "node --test"
    },
    markdownFiles: [
      {
        filePath: "README.md",
        content: "Run pnpm run build and pnpm run check:all"
      },
      {
        filePath: "docs/usage.md",
        content: "Use npm run test"
      }
    ]
  });

  assert.deepEqual(result, [
    {
      filePath: "README.md",
      scriptName: "check:all",
      command: "pnpm run check:all"
    }
  ]);
});
