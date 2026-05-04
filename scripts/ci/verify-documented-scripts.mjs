#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";

const COMMAND_PATTERN = /\b(?:pnpm|npm)\s+run\s+([a-zA-Z0-9:_-]+)/g;

export function extractRunScriptReferences(markdownText) {
  const results = [];
  for (const match of markdownText.matchAll(COMMAND_PATTERN)) {
    results.push({
      script: match[1],
      command: match[0],
      index: match.index ?? -1
    });
  }
  return results;
}

export function findMissingDocumentedScripts({ references, availableScripts, filePath }) {
  const available = new Set(Object.keys(availableScripts ?? {}));
  return references
    .filter((reference) => !available.has(reference.script))
    .map((reference) => ({
      filePath,
      script: reference.script,
      command: reference.command
    }));
}

async function collectMarkdownFiles(rootDir) {
  const files = [path.join(rootDir, "README.md")];
  const docsDir = path.join(rootDir, "docs");

  async function walk(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile() && fullPath.endsWith(".md")) {
        files.push(fullPath);
      }
    }
  }

  try {
    await walk(docsDir);
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }

  return files;
}

async function main() {
  const rootDir = process.cwd();
  const packageJsonPath = path.join(rootDir, "package.json");
  const packageJson = JSON.parse(await fs.readFile(packageJsonPath, "utf8"));
  const markdownFiles = await collectMarkdownFiles(rootDir);

  const missing = [];
  for (const filePath of markdownFiles) {
    let content;
    try {
      content = await fs.readFile(filePath, "utf8");
    } catch (error) {
      if (error?.code === "ENOENT") {
        continue;
      }
      throw error;
    }

    const references = extractRunScriptReferences(content);
    missing.push(
      ...findMissingDocumentedScripts({
        references,
        availableScripts: packageJson.scripts,
        filePath: path.relative(rootDir, filePath)
      })
    );
  }

  if (missing.length > 0) {
    console.error("Documented npm/pnpm run scripts missing from package.json:");
    for (const item of missing) {
      console.error(`- ${item.filePath}: \`${item.command}\` (missing script: \`${item.script}\`)`);
    }
    process.exitCode = 1;
    return;
  }

  console.log("All documented npm/pnpm run scripts exist in package.json.");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
