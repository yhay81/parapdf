#!/usr/bin/env node
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const [destination] = process.argv.slice(2);
const usage = "Usage: parapdf-copy-assets <destination>";
if (destination === "--help" || destination === "-h") {
  console.log(usage);
  process.exit(0);
}
if (!destination || process.argv.length !== 3) {
  console.error(usage);
  process.exit(1);
}

const local = fileURLToPath(new URL("../pdfjs/", import.meta.url));
const upstream = dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json"));
const shared = JSON.parse(readFileSync(join(local, "shared.json"), "utf8"));
const out = resolve(destination);

function copy(root, path) {
  const target = join(out, path);
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(join(root, path), target);
}

for (const file of shared) copy(upstream, file);
for (const file of [
  "LICENSE",
  "pdf.worker.js",
  "pdf.worker.legacy.js",
  "pdf.renderer.js",
  "pdf.renderer.legacy.js",
  "quickjs.js",
])
  copy(local, file);
