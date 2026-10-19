/**
 * tsc rewrites the `.ts` extensions of relative imports in the JavaScript it
 * emits (rewriteRelativeImportExtensions) but keeps them in declaration
 * files. This rewrites those to `.js`, which TypeScript resolves to the
 * declaration files under every module resolution mode.
 * Usage: node scripts/declaration-imports.ts (after tsc -p tsconfig.build.json)
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const dist = fileURLToPath(new URL("../dist/", import.meta.url));
const relativeTs = /((?:from|import)\s*\(?\s*["']\.{1,2}\/[^"']*)\.ts(["'])/g;
for (const name of readdirSync(dist, { recursive: true, encoding: "utf8" })) {
  if (!name.endsWith(".d.ts")) continue;
  const path = `${dist}${name}`;
  const text = readFileSync(path, "utf8");
  const rewritten = text.replace(relativeTs, "$1.js$2");
  if (rewritten !== text) writeFileSync(path, rewritten);
}
