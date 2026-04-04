import { access, readFile } from "node:fs/promises";

const roots = ["../dist/extension/", "../src/extension/"];
const moduleExtensions = [".mjs", ".js", ".ts"];
const sourceExtensions = [".js", ".mjs", ".ts"];

export async function importExtensionModule(moduleStem) {
  const moduleUrl = await resolveExtensionPath(moduleStem, moduleExtensions);
  return import(moduleUrl.href);
}

export async function readExtensionSource(sourceStem) {
  const sourceUrl = await resolveExtensionPath(sourceStem, sourceExtensions);
  return {
    fileUrl: sourceUrl,
    source: await readFile(sourceUrl, "utf8")
  };
}

async function resolveExtensionPath(stem, extensions) {
  for (const root of roots) {
    for (const extension of extensions) {
      const candidate = new URL(`${root}${stem}${extension}`, import.meta.url);
      if (await pathExists(candidate)) {
        return candidate;
      }
    }
  }

  throw new Error(`Unable to resolve extension test fixture for ${stem}`);
}

async function pathExists(fileUrl) {
  try {
    await access(fileUrl);
    return true;
  } catch {
    return false;
  }
}
