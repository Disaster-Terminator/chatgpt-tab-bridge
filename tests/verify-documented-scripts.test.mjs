import test from "node:test";
import assert from "node:assert/strict";

import {
  extractRunScriptReferences,
  findMissingDocumentedScripts
} from "../scripts/ci/verify-documented-scripts.mjs";

test("extractRunScriptReferences finds npm and pnpm run commands", () => {
  const markdown = [
    "Use `pnpm run build` for builds.",
    "Run npm run test:smoke in CI prep.",
    "Ignore plain `pnpm build` and other text."
  ].join("\n");

  const references = extractRunScriptReferences(markdown).map(({ script, command }) => ({ script, command }));

  assert.deepEqual(references, [
    { script: "build", command: "pnpm run build" },
    { script: "test:smoke", command: "npm run test:smoke" }
  ]);
});

test("findMissingDocumentedScripts reports missing scripts with file context", () => {
  const references = [
    { script: "build", command: "pnpm run build" },
    { script: "check:repo", command: "pnpm run check:repo" }
  ];

  assert.deepEqual(
    findMissingDocumentedScripts({
      references,
      availableScripts: { build: "node build.mjs", test: "node --test" },
      filePath: "docs/commands.md"
    }),
    [
      {
        filePath: "docs/commands.md",
        script: "check:repo",
        command: "pnpm run check:repo"
      }
    ]
  );
});
