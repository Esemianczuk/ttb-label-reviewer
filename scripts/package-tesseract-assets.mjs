import { createGzip } from "zlib";
import { createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, rmdirSync, statSync, unlinkSync } from "fs";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { pipeline as streamPipeline } from "stream";
import { promisify } from "util";

const { copyFile, writeFile } = fs.promises;
const pipeline = promisify(streamPipeline);

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const browserDir = path.join(rootDir, "browser-demo");
const publicTesseractDir = path.join(browserDir, "public", "tesseract");
const coreSourceDir = path.join(browserDir, "node_modules", "tesseract.js-core");
const distSourceDir = path.join(browserDir, "node_modules", "tesseract.js", "dist");
const langSource = path.join(browserDir, "eng.traineddata");

const coreFiles = [
  "tesseract-core-lstm.wasm",
  "tesseract-core-lstm.wasm.js",
  "tesseract-core-simd-lstm.wasm",
  "tesseract-core-simd-lstm.wasm.js",
  "tesseract-core-relaxedsimd-lstm.wasm",
  "tesseract-core-relaxedsimd-lstm.wasm.js",
  "LICENSE"
];

function requireFile(filePath) {
  if (!existsSync(filePath)) {
    throw new Error(`Missing ${path.relative(rootDir, filePath)}. Run npm install in browser-demo before packaging OCR assets.`);
  }
}

async function main() {
  const workerSource = path.join(distSourceDir, "worker.min.js");
  const workerLicenseSource = path.join(distSourceDir, "worker.min.js.LICENSE.txt");

  requireFile(workerSource);
  requireFile(langSource);
  for (const filename of coreFiles) requireFile(path.join(coreSourceDir, filename));

  removeDirectory(publicTesseractDir);
  mkdirSync(path.join(publicTesseractDir, "core"), { recursive: true });
  mkdirSync(path.join(publicTesseractDir, "lang"), { recursive: true });

  await copyFile(workerSource, path.join(publicTesseractDir, "worker.min.js"));
  if (existsSync(workerLicenseSource)) {
    await copyFile(workerLicenseSource, path.join(publicTesseractDir, "worker.min.js.LICENSE.txt"));
  }

  for (const filename of coreFiles) {
    await copyFile(path.join(coreSourceDir, filename), path.join(publicTesseractDir, "core", filename));
  }

  await pipeline(createReadStream(langSource), createGzip({ level: 9 }), createWriteStream(path.join(publicTesseractDir, "lang", "eng.traineddata.gz")));
  await writeFile(
    path.join(publicTesseractDir, "README.md"),
    [
      "# Local Tesseract.js Assets",
      "",
      "These files are packaged by `npm run browser:package-tesseract` from `browser-demo/node_modules` and `browser-demo/eng.traineddata`.",
      "Production browser and console builds load OCR worker, WASM core, and English traineddata from this directory with no runtime CDN dependency.",
      "",
      "The CDN fallback is disabled by default and is available only for local development when `VITE_ALLOW_TESSERACT_CDN_FALLBACK=1` is set.",
      ""
    ].join("\n")
  );

  const relativeDir = path.relative(rootDir, publicTesseractDir);
  const bytes = directoryBytes(publicTesseractDir);
  console.log(`Packaged local Tesseract assets in ${relativeDir} (${formatBytes(bytes)}).`);
}

function directoryBytes(directory) {
  let total = 0;
  for (const entry of walk(directory)) total += statSync(entry).size;
  return total;
}

function* walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const child = path.join(directory, entry.name);
    if (entry.isDirectory()) yield* walk(child);
    else yield child;
  }
}

function removeDirectory(directory) {
  if (!existsSync(directory)) return;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const child = path.join(directory, entry.name);
    if (entry.isDirectory()) removeDirectory(child);
    else unlinkSync(child);
  }
  rmdirSync(directory);
}

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
