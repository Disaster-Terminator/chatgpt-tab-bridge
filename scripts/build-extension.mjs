import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

const extensionRoot = path.resolve(process.cwd(), "src/extension");
const manifestPath = path.join(extensionRoot, "manifest.json");

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
await validateManifestFiles(manifest);
await validateJavascriptSources(extensionRoot);

console.log("Build validation succeeded.");

async function validateManifestFiles(currentManifest) {
  const refs = new Set([
    currentManifest.background?.service_worker,
    currentManifest.action?.default_popup,
    ...(currentManifest.content_scripts ?? []).flatMap((entry) => [
      ...(entry.js ?? []),
      ...(entry.css ?? [])
    ])
  ]);

  for (const ref of refs) {
    if (!ref) {
      continue;
    }

    const fullPath = path.join(extensionRoot, ref);
    await stat(fullPath);
  }
}

async function validateJavascriptSources(rootDirectory) {
  const files = await listFiles(rootDirectory);
  const jsFiles = files.filter((file) => file.endsWith(".js") || file.endsWith(".mjs"));

  for (const file of jsFiles) {
    const result = spawnSync(process.execPath, ["--check", file], {
      encoding: "utf8"
    });

    if (result.status !== 0) {
      throw new Error(result.stderr || `Syntax check failed for ${file}`);
    }
  }
}

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(fullPath)));
      continue;
    }
    files.push(fullPath);
  }

  return files;
}
