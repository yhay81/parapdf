/**
 * Checks that `astro build` wrote every page of the site and its search
 * index, which it writes last. A page whose server render waits on a promise
 * that never settles lets Node exit with status 0 halfway through the build;
 * 0.5.0's site deployed that way, without its home page, reference, and
 * search. Run by `pnpm build` after `astro build`; exits non-zero on failure.
 */
import { existsSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

const root = join(import.meta.dirname, "..");
const dist = join(root, "dist");

/** The file the build writes for a source page, by its path without extension. */
const built = (page: string): string => join(dist, page === "index" ? "" : page, "index.html");

const sources = [
  ...readdirSync(join(root, "src/content/docs"), { recursive: true, encoding: "utf8" })
    .filter((file) => /\.mdx?$/.test(file))
    .map((file) => file.replace(/\.mdx?$/, "")),
  ...readdirSync(join(root, "src/pages"), { recursive: true, encoding: "utf8" })
    .filter((file) => file.endsWith(".astro"))
    .map((file) => file.replace(/\.astro$/, "")),
];

const missing = sources.map(built).filter((file) => !existsSync(file));
if (!existsSync(join(dist, "pagefind"))) missing.push(join(dist, "pagefind"));

if (missing.length > 0) {
  console.error(
    `The build is incomplete; missing:\n${missing.map((file) => `  ${relative(root, file)}`).join("\n")}`,
  );
  process.exit(1);
}
console.log(`The build wrote all ${sources.length} pages and the search index.`);
