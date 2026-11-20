/**
 * Verifies that a release tag (`vX.Y.Z`) matches `packages/parapdf/package.json`
 * and writes its `CHANGELOG.md` section to the given file (or stdout).
 *
 * Usage: node .github/scripts/release-notes.mjs <tag> [output-file]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const rawTag = process.argv[2]?.replace(/^refs\/tags\//, "");
const outputPath = process.argv[3];

if (!rawTag || !/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(rawTag)) {
  console.error(`Expected a vX.Y.Z release tag; got ${JSON.stringify(rawTag)}.`);
  process.exit(1);
}

const version = rawTag.slice(1);
const root = new URL("../../", import.meta.url);
const manifest = JSON.parse(
  readFileSync(fileURLToPath(new URL("packages/parapdf/package.json", root)), "utf8"),
);

if (manifest.version !== version) {
  console.error(
    `Tag ${rawTag} does not match packages/parapdf/package.json version ${manifest.version}.`,
  );
  process.exit(1);
}

const changelog = readFileSync(fileURLToPath(new URL("CHANGELOG.md", root)), "utf8");
const escaped = version.replaceAll(".", "\\.");
const headingPattern = new RegExp(`^## ${escaped}(?:\\s+—\\s+\\S+)?\\s*$`, "m");
const match = headingPattern.exec(changelog);

if (!match) {
  console.error(`CHANGELOG.md has no "## ${version}" heading.`);
  process.exit(1);
}

const rest = changelog.slice(match.index + match[0].length);
const nextHeading = /^## /m.exec(rest);
const notes = (nextHeading ? rest.slice(0, nextHeading.index) : rest).trim();

if (!notes) {
  console.error(`CHANGELOG.md entry for ${version} is empty.`);
  process.exit(1);
}

if (outputPath) {
  writeFileSync(outputPath, `${notes}\n`);
} else {
  process.stdout.write(`${notes}\n`);
}
