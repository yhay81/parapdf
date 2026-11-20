/**
 * Measure the three source-position arrays kept by search, comparing every
 * normalized UTF-16 unit, its source positions, and two queries' match ranges.
 * Extract pdf.js text once, outside the timed construction and search passes.
 *
 * Generate the corpus first. From examples/prototype, run
 * BEFORE_SRC=/path/to/previous/packages/parapdf/src BROWSER=chromium RUNS=5 node scripts/search-index-bench.ts
 * (also webkit and firefox). Each job prints its bytes, timings, and SHA-256.
 */
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { stripTypeScriptTypes } from "node:module";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getDocument, version } from "pdfjs-dist/legacy/build/pdf.mjs";
import {
  assertMeasurementPower,
  launchBrowser,
  measureInTurn,
  restoreScaleFactor,
  turnTakingSummary,
} from "../../../bench/scripts/browsers.ts";
import type * as Search from "../../../packages/parapdf/src/features/search/text-search.ts";
import type { PageText } from "../../../packages/parapdf/src/pdfjs/text.ts";

const before = process.env.BEFORE_SRC;
if (!before) throw new Error("Set BEFORE_SRC to the baseline packages/parapdf/src directory");
const runs = Number(process.env.RUNS ?? 5);
if (!Number.isSafeInteger(runs) || runs < 1) throw new Error("RUNS must be a positive integer");
const root = fileURLToPath(new URL("../../../", import.meta.url));
const fonts = fileURLToPath(
  new URL("standard_fonts/", import.meta.resolve("pdfjs-dist/package.json")),
);
const files = [
  {
    name: "synthetic-text-1000",
    path: "generated/synthetic-text-1000.pdf",
    queries: ["lorem", "dolor"],
  },
  { name: "bill-hr815", path: "bill-hr815.pdf", queries: ["the", "section"] },
];
type InputPage = Pick<PageText, "items" | "endsLine">;

async function extractText(path: string): Promise<InputPage[]> {
  const data = new Uint8Array(await readFile(join(root, "bench/corpus", path)));
  const task = getDocument({ data, useSystemFonts: true, standardFontDataUrl: fonts });
  try {
    const doc = await task.promise;
    const pages: InputPage[] = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const proxy = await doc.getPage(p);
      const { items } = await proxy.getTextContent({
        includeMarkedContent: true,
        disableNormalization: true,
      });
      const runs = items.filter((item) => "str" in item);
      pages.push({ items: runs.map((r) => r.str), endsLine: runs.map((r) => r.hasEOL) });
    }
    return pages;
  } finally {
    await task.destroy();
  }
}

async function measure({
  file,
  variant,
  queries,
}: {
  file: string;
  variant: string;
  queries: string[];
}) {
  if (devicePixelRatio !== 2) throw new Error("Wrong devicePixelRatio");
  const {
    buildPageIndex,
    normalizeQuery,
    findMatches,
  }: Pick<typeof Search, "normalizeQuery" | "findMatches"> & {
    buildPageIndex(page: InputPage): Search.PageIndex;
  } = await import(`/${variant}.mjs`);
  const pages: InputPage[] = await (await fetch(`/${file}.json`)).json();
  const needles = queries.map((query) => normalizeQuery(query));
  const start = performance.now();
  const indexes = pages.map((page) => buildPageIndex(page));
  const built = performance.now();
  const found = indexes.map((index, page) => needles.flatMap((q) => findMatches(index, q, page)));
  const searched = performance.now();

  let retained = 0;
  let units = 0;
  let matched = 0;
  const encoder = new TextEncoder();
  const hashes: Promise<ArrayBuffer>[] = [];
  for (const [page, index] of indexes.entries()) {
    const { text, itemOf, startOf, endOf } = index;
    units += text.length;
    const columns = [itemOf, startOf, endOf];
    if (columns.some((column) => column.length !== text.length))
      throw new Error("Incomplete index");
    const buffers = new Set(columns.map((column) => column.buffer));
    for (const buffer of buffers) retained += buffer.byteLength;
    const canonical = new Uint32Array(4 * text.length);
    for (let i = 0; i < text.length; i++) {
      canonical[4 * i] = text.charCodeAt(i);
      canonical[4 * i + 1] = itemOf[i] ?? 0;
      canonical[4 * i + 2] = startOf[i] ?? 0;
      canonical[4 * i + 3] = endOf[i] ?? 0;
    }
    const matches = found[page] ?? [];
    matched += matches.length;
    hashes.push(crypto.subtle.digest("SHA-256", canonical));
    hashes.push(crypto.subtle.digest("SHA-256", encoder.encode(JSON.stringify(matches))));
  }
  const joined = new Uint8Array(hashes.length * 32);
  for (const [i, hash] of (await Promise.all(hashes)).entries())
    joined.set(new Uint8Array(hash), 32 * i);
  const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", joined))]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
  return {
    pages: pages.length,
    units,
    retained,
    matched,
    digest,
    indexMs: built - start,
    searchMs: searched - built,
  };
}

const responses = new Map<string, string>([["/", "<!doctype html><title>Search indexes</title>"]]);
for (const [variant, source] of Object.entries({
  before: resolve(before),
  after: join(root, "packages/parapdf/src"),
})) {
  const code = await readFile(join(source, "features/search/text-search.ts"), "utf8");
  responses.set(`/${variant}.mjs`, stripTypeScriptTypes(code));
}
for (const file of files)
  responses.set(`/${file.name}.json`, JSON.stringify(await extractText(file.path)));
const server = createServer((request, response) => {
  const url = request.url ?? "/";
  const body = responses.get(url);
  if (body === undefined) {
    response.writeHead(404).end();
    return;
  }
  response
    .writeHead(200, {
      "Content-Type":
        url === "/" ? "text/html" : url.endsWith(".mjs") ? "text/javascript" : "application/json",
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
      "Cache-Control": "no-store",
    })
    .end(body);
});
const base = "http://127.0.0.1:4188/";
const power = assertMeasurementPower();
await new Promise<void>((resolve, reject) =>
  server.once("error", reject).listen(4188, "127.0.0.1", resolve),
);
try {
  const launched = await launchBrowser();
  try {
    console.log(JSON.stringify({ browser: launched.label, pdfjs: version, power, runs }));
    for (const { name: file, queries } of files) {
      let expected: string | undefined;
      for (let run = 1; run <= runs; run++) {
        for (const variant of run % 2 ? ["before", "after"] : ["after", "before"]) {
          const result = await measureInTurn(launched, async (browser) => {
            const context = await browser.newContext({
              viewport: { width: 1280, height: 900 },
              deviceScaleFactor: 2,
            });
            try {
              const page = await context.newPage();
              await restoreScaleFactor(page, base);
              await page.goto(base);
              return await page.evaluate(measure, { file, variant, queries });
            } finally {
              await context.close();
            }
          });
          console.log(JSON.stringify({ file, run, variant, ...result }));
          expected ??= result.digest;
          if (result.digest !== expected) throw new Error(`Index or match mismatch for ${file}`);
        }
      }
    }
    console.log(turnTakingSummary());
  } finally {
    await launched.close();
  }
} finally {
  server.close();
}
