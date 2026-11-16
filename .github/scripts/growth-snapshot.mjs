/**
 * Save a manual growth snapshot without publishing maintainer-only traffic.
 * Run from any directory with Node 24+ and an authenticated GitHub CLI:
 *   node .github/scripts/growth-snapshot.mjs
 * Snapshots go to the ignored .growth/ directory. No schedule is installed.
 */
import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const repository = "yhay81/parapdf";
const output = fileURLToPath(new URL("../../.growth/", import.meta.url));
const observedAt = new Date().toISOString();

async function github(path) {
  const { stdout } = await run(
    "gh",
    [
      "api",
      `repos/${repository}${path}`,
      "-H",
      "Accept: application/vnd.github+json",
      "-H",
      "X-GitHub-Api-Version: 2026-03-10",
    ],
    { timeout: 30_000, maxBuffer: 2 * 1024 * 1024 },
  );
  return JSON.parse(stdout);
}

async function json(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.json();
}

const requests = {
  repository: async () => {
    const repo = await github("");
    return {
      url: repo.html_url,
      stars: repo.stargazers_count,
      forks: repo.forks_count,
      description: repo.description,
      homepage: repo.homepage,
      topics: repo.topics,
    };
  },
  views: () => github("/traffic/views?per=day"),
  clones: () => github("/traffic/clones?per=day"),
  referrers: () => github("/traffic/popular/referrers"),
  paths: () => github("/traffic/popular/paths"),
  npmDownloads: () => json("https://api.npmjs.org/downloads/point/last-week/parapdf"),
  npmRelease: async () => {
    const release = await json("https://registry.npmjs.org/parapdf/latest");
    return { version: release.version, peerDependencies: release.peerDependencies };
  },
};

const entries = Object.entries(requests);
const results = await Promise.allSettled(entries.map(([, request]) => request()));
const sources = Object.fromEntries(
  results.map((result, index) => [
    entries[index][0],
    result.status === "fulfilled"
      ? { status: "ok", data: result.value }
      : { status: "unavailable", reason: String(result.reason).slice(0, 500) },
  ]),
);

await mkdir(output, { recursive: true, mode: 0o700 });
const path = `${output}${observedAt.replaceAll(":", "-")}.json`;
await writeFile(path, `${JSON.stringify({ observedAt, repository, sources }, null, 2)}\n`, {
  flag: "wx",
  mode: 0o600,
});
console.log(`Saved ${path}`);
for (const [name, source] of Object.entries(sources)) {
  console.log(`${name}: ${source.status}`);
}
// An unavailable source must not silently look like zero or a complete snapshot.
if (results.some((result) => result.status === "rejected")) process.exitCode = 1;
