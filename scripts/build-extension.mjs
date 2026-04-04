import { cp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";

const extensionRoot = path.resolve(process.cwd(), "src/extension");
const distRoot = path.resolve(process.cwd(), "dist/extension");
const staticAssets = ["manifest.json", "popup.html", "popup.css", "overlay.css"];
const outputFilesBySource = new Map([
  ["background.mjs", "background.js"],
  ["background.ts", "background.js"],
  ["popup.ts", "popup.js"],
  ["content-script.ts", "content-script.js"],
  ["content-script.js", "content-script.js"],
  ["content-helpers.ts", "content-helpers.js"],
  ["content-helpers.js", "content-helpers.js"]
]);

await clearDistDirectory();
await buildRuntimeScripts();
await copyStaticAssets();

const manifest = await writeDistManifest();
await writeDistPopupHtml();
await validateManifestFiles(manifest);
await validatePopupHtmlAssets();

console.log("Extension build succeeded.");

async function clearDistDirectory() {
  await rm(distRoot, { recursive: true, force: true });
  await mkdir(distRoot, { recursive: true });
}

async function buildRuntimeScripts() {
  await build({
    absWorkingDir: extensionRoot,
    entryPoints: [
      { in: "background.ts", out: "background" },
      { in: "popup.ts", out: "popup" },
      { in: "content-script.ts", out: "content-script" },
      { in: "content-helpers.ts", out: "content-helpers" }
    ],
    outdir: distRoot,
    bundle: true,
    format: "esm",
    platform: "browser",
    target: ["chrome114"],
    logLevel: "silent",
    tsconfig: path.resolve(process.cwd(), "tsconfig.json")
  });
}

async function copyStaticAssets() {
  for (const asset of staticAssets) {
    await cp(path.join(extensionRoot, asset), path.join(distRoot, asset));
  }
}

async function writeDistManifest() {
  const manifestPath = path.join(extensionRoot, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const rewrittenManifest = structuredClone(manifest);

  if (rewrittenManifest.background?.service_worker) {
    rewrittenManifest.background.service_worker = toBuiltAsset(rewrittenManifest.background.service_worker);
  }

  if (Array.isArray(rewrittenManifest.content_scripts)) {
    rewrittenManifest.content_scripts = rewrittenManifest.content_scripts.map((entry) => ({
      ...entry,
      js: (entry.js ?? []).map((file) => toBuiltAsset(file))
    }));
  }

  await writeFile(
    path.join(distRoot, "manifest.json"),
    `${JSON.stringify(rewrittenManifest, null, 2)}\n`,
    "utf8"
  );

  return rewrittenManifest;
}

async function writeDistPopupHtml() {
  const popupHtmlPath = path.join(extensionRoot, "popup.html");
  const popupHtml = await readFile(popupHtmlPath, "utf8");
  const rewrittenPopupHtml = popupHtml.replace(/(["'])popup\.mjs\1/g, "$1popup.js$1");
  await writeFile(path.join(distRoot, "popup.html"), rewrittenPopupHtml, "utf8");
}

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

    const fullPath = path.join(distRoot, ref);
    await stat(fullPath);
  }
}

async function validatePopupHtmlAssets() {
  const popupHtmlPath = path.join(distRoot, "popup.html");
  const popupHtml = await readFile(popupHtmlPath, "utf8");
  const refs = [...popupHtml.matchAll(/<(?:script|link)\b[^>]+(?:src|href)=["']([^"']+)["'][^>]*>/g)].map(
    (match) => match[1]
  );

  for (const ref of refs) {
    if (isExternalAsset(ref)) {
      continue;
    }

    await stat(path.join(distRoot, ref));
  }
}

function toBuiltAsset(assetPath) {
  const normalizedPath = assetPath.replace(/\\/g, "/");
  return outputFilesBySource.get(normalizedPath) ?? normalizedPath;
}

function isExternalAsset(ref) {
  return /^(?:[a-z]+:)?\/\//i.test(ref) || ref.startsWith("data:") || ref.startsWith("#");
}
