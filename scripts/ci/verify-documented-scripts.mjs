#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const SCRIPT_PATTERN = /\b(?:pnpm|npm)\s+run\s+([a-zA-Z0-9:_-]+)/g;

export function extractDocumentedScripts(markdownText) {
  const scripts = [];
  let match;
  while ((match = SCRIPT_PATTERN.exec(markdownText)) !== null) {
    scripts.push(match[1]);
  }
  return scripts;
}

export function findMissingScripts({ markdownFiles, packageScripts }) {
  const missing = [];

  for (const markdownFile of markdownFiles) {
    const documentedScripts = extractDocumentedScripts(markdownFile.content);
    for (const scriptName of documentedScripts) {
      if (!Object.prototype.hasOwnProperty.call(packageScripts, scriptName)) {
        missing.push({
          filePath: markdownFile.filePath,
          scriptName,
          command: `${markdownFile.commandTool ?? "pnpm"} run ${scriptName}`
        });
      }
    }
  }

  return missing;
}

function collectMarkdownFiles(rootDir) {
  const files = [];
  const readmePath = path.join(rootDir, "README.md");
  if (fs.existsSync(readmePath)) {
    files.push(readmePath);
  }

  const docsDir = path.join(rootDir, "docs");
  if (!fs.existsSync(docsDir)) {
    return files;
  }

  const stack = [docsDir];
  while (stack.length > 0) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile() && fullPath.endsWith(".md")) {
        files.push(fullPath);
      }
    }
  }

  return files;
}

function getPackageScripts(rootDir) {
  const packageJsonPath = path.join(rootDir, "package.json");
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  return packageJson.scripts ?? {};
}

function detectToolForScript(content, scriptName) {
  const regex = new RegExp(`\\b(pnpm|npm)\\s+run\\s+${scriptName.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}\\b`);
  const match = content.match(regex);
  return match?.[1] ?? "pnpm";
}

function main() {
  const rootDir = process.cwd();
  const packageScripts = getPackageScripts(rootDir);
  const markdownPaths = collectMarkdownFiles(rootDir);

  const markdownFiles = markdownPaths.map((filePath) => {
    const content = fs.readFileSync(filePath, "utf8");
    return {
      filePath: path.relative(rootDir, filePath),
      content
    };
  });

  const missing = [];
  for (const markdownFile of markdownFiles) {
    const documentedScripts = extractDocumentedScripts(markdownFile.content);
    for (const scriptName of documentedScripts) {
      if (!Object.prototype.hasOwnProperty.call(packageScripts, scriptName)) {
        const tool = detectToolForScript(markdownFile.content, scriptName);
        missing.push({
          filePath: markdownFile.filePath,
          scriptName,
          command: `${tool} run ${scriptName}`
        });
      }
    }
  }

  if (missing.length > 0) {
    console.error("Found documented scripts that do not exist in package.json scripts:\n");
    for (const entry of missing) {
      console.error(`- ${entry.filePath}: ${entry.command}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(`Verified documented scripts in ${markdownFiles.length} markdown file(s). No missing scripts found.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
