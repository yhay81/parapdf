/**
 * Checks that the `-frame` variants of the pdf.js engines draw what the
 * engines they vary draw: each page is read back at full resolution after it
 * renders and compared by SHA-256 and, where the digests differ, by a 256 px
 * wide sample. Writes bench/results/<OUTPUT>fidelity-<browser>.{json,md}.
 *
 * Environment: BROWSER, FILES (comma-separated; default every corpus file),
 * PAGES (10), SCALE (2.6667), PAIRS (comma-separated "engine:variant"; by
 * default every pdf.js engine with its `-frame` variant, pdf.js master's
 * only when it is built), OUTPUT ("frames-").
 */
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import type { Browser } from "playwright";
import { preview } from "vite";
import { browserFromEnv, launchBrowser } from "./browsers.ts";

const benchDir = fileURLToPath(new URL("..", import.meta.url));
const distDir = join(benchDir, "dist");
const resultsDir = join(benchDir, "results");
if (!existsSync(join(distDir, "index.html"))) {
  throw new Error("dist/ is missing; run `pnpm bench:build` first.");
}
const hasPdfjsNext = existsSync(
  join(benchDir, "vendor/pdf.js/build/generic/build/pdf.renderer.mjs"),
);
const engines = ["pdfjs", "pdfjs-hwa", ...(hasPdfjsNext ? ["pdfjs-next", "pdfjs-next-hwa"] : [])];
const pairs = (
  process.env.PAIRS?.split(",") ?? engines.map((engine) => `${engine}:${engine}-frame`)
)
  .map((pair) => pair.split(":"))
  .map(([engine = "", variant = ""]) => ({ engine, variant }));
const pages = Number(process.env.PAGES ?? "10");
const scale = Number(process.env.SCALE ?? "2.6667");
const output = process.env.OUTPUT ?? "frames-";
const files = process.env.FILES
  ? process.env.FILES.split(",")
  : readdirSync(join(distDir, "corpus"))
      .filter((name) => name.endsWith(".pdf"))
      .sort();

interface PagePixels {
  width: number;
  height: number;
  digest: string;
  sample: { width: number; height: number; rgba: string };
}

async function pixelsOf(
  browser: Browser,
  baseUrl: string,
  engine: string,
  file: string,
): Promise<PagePixels[]> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  try {
    const page = await context.newPage();
    const query = new URLSearchParams({
      engine,
      file,
      scale: String(scale),
      pages: String(pages),
      digest: "1",
    });
    await page.goto(`${baseUrl}?${query}`);
    await page.waitForFunction(() => (window as { __done?: boolean }).__done === true, undefined, {
      timeout: 300_000,
    });
    const result = (await page.evaluate(() => (window as { __result?: unknown }).__result)) as {
      error?: string;
      pixels?: PagePixels[];
    };
    if (result.error) throw new Error(result.error.split("\n")[0]);
    return result.pixels ?? [];
  } finally {
    await context.close();
  }
}

/**
 * How two samples differ: the largest channel difference, the share of
 * pixels off by more than 16, and where those are, as shares of the page
 * ([left, top, right, bottom]).
 */
function compareSamples(a: PagePixels["sample"], b: PagePixels["sample"]) {
  const left = Buffer.from(a.rgba, "base64");
  const right = Buffer.from(b.rgba, "base64");
  if (a.width !== b.width || a.height !== b.height || left.length !== right.length) {
    return { maxDiff: 255, offShare: 1, offBox: [0, 0, 1, 1] };
  }
  let maxDiff = 0;
  let off = 0;
  const box = [a.width, a.height, 0, 0];
  for (let at = 0; at < left.length; at += 4) {
    let pixel = 0;
    for (let channel = 0; channel < 3; channel++) {
      pixel = Math.max(pixel, Math.abs((left[at + channel] ?? 0) - (right[at + channel] ?? 0)));
    }
    maxDiff = Math.max(maxDiff, pixel);
    if (pixel <= 16) continue;
    off++;
    const x = (at / 4) % a.width;
    const y = Math.floor(at / 4 / a.width);
    box[0] = Math.min(box[0] ?? x, x);
    box[1] = Math.min(box[1] ?? y, y);
    box[2] = Math.max(box[2] ?? x, x + 1);
    box[3] = Math.max(box[3] ?? y, y + 1);
  }
  const round = (value: number) => Math.round(value * 1000) / 1000;
  return {
    maxDiff,
    offShare: off / (left.length / 4),
    offBox: off
      ? [
          round((box[0] ?? 0) / a.width),
          round((box[1] ?? 0) / a.height),
          round((box[2] ?? 0) / a.width),
          round((box[3] ?? 0) / a.height),
        ]
      : null,
  };
}

/** A PNG of RGBA pixels, for looking at pages that differ. */
function png(width: number, height: number, rgba: Buffer): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (bytes: Buffer) => {
    let c = 0xffffffff;
    for (const byte of bytes) c = (crcTable[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([length, body, sum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 6, 0, 0, 0], 8);
  const rows = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    rgba.copy(rows, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(rows)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Saves both samples and a mask of the pixels off by more than 16, side by side. */
function saveDifference(name: string, a: PagePixels["sample"], b: PagePixels["sample"]): void {
  const left = Buffer.from(a.rgba, "base64");
  const right = Buffer.from(b.rgba, "base64");
  if (a.width !== b.width || a.height !== b.height) return;
  const width = a.width * 3;
  const out = Buffer.alloc(width * a.height * 4);
  for (let y = 0; y < a.height; y++) {
    for (let x = 0; x < a.width; x++) {
      const at = (y * a.width + x) * 4;
      let pixel = 0;
      for (let channel = 0; channel < 3; channel++) {
        pixel = Math.max(pixel, Math.abs((left[at + channel] ?? 0) - (right[at + channel] ?? 0)));
      }
      const row = y * width * 4;
      left.copy(out, row + x * 4, at, at + 4);
      right.copy(out, row + (a.width + x) * 4, at, at + 4);
      out.set(pixel > 16 ? [255, 0, 0, 255] : [255, 255, 255, 255], row + (2 * a.width + x) * 4);
    }
  }
  mkdirSync(join(resultsDir, "raw"), { recursive: true });
  writeFileSync(join(resultsDir, "raw", name), png(width, a.height, out));
}

const server = await preview({
  root: benchDir,
  configFile: join(benchDir, "vite.config.ts"),
  logLevel: "warn",
  preview: { port: 4180, host: "127.0.0.1", strictPort: false, open: false },
});
const baseUrl = server.resolvedUrls?.local[0] ?? "http://127.0.0.1:4180/";
const browserName = browserFromEnv();
const launched = await launchBrowser(browserName);

interface Row {
  file: string;
  engine: string;
  variant: string;
  pages: number;
  identical: number;
  error?: string;
  differing: {
    page: number;
    sizes: string;
    maxDiff: number;
    offShare: number;
    offBox: number[] | null;
  }[];
}
const rows: Row[] = [];
try {
  for (const file of files) {
    for (const { engine, variant } of pairs) {
      const row: Row = { file, engine, variant, pages: 0, identical: 0, differing: [] };
      try {
        const [drawn, framed] = [
          await pixelsOf(launched.browser, baseUrl, engine, file),
          await pixelsOf(launched.browser, baseUrl, variant, file),
        ];
        row.pages = Math.min(drawn.length, framed.length);
        for (let page = 0; page < row.pages; page++) {
          const a = drawn[page] as PagePixels;
          const b = framed[page] as PagePixels;
          if (a.width === b.width && a.height === b.height && a.digest === b.digest) {
            row.identical++;
            continue;
          }
          row.differing.push({
            page: page + 1,
            sizes: `${a.width}×${a.height} / ${b.width}×${b.height}`,
            ...compareSamples(a.sample, b.sample),
          });
          saveDifference(
            `${output}fidelity-${browserName}-${file}-${engine}-${variant}-p${page + 1}.png`,
            a.sample,
            b.sample,
          );
        }
      } catch (error) {
        row.error = error instanceof Error ? error.message : String(error);
      }
      rows.push(row);
      console.log(
        `${file} · ${engine} vs ${variant}: ${row.error ? `ERROR ${row.error}` : `${row.identical}/${row.pages} pages identical`}`,
      );
    }
  }
} finally {
  await launched.close();
  await server.close();
}

const runAt = new Date().toISOString();
writeFileSync(
  join(resultsDir, `${output}fidelity-${browserName}.json`),
  `${JSON.stringify({ runAt, browser: launched.label, pages, scale, rows }, null, 2)}\n`,
);
const percent = (share: number) => `${(share * 100).toFixed(share < 0.01 ? 2 : 1)}%`;
const report = [
  `# Frame display fidelity: ${launched.label}`,
  "",
  `- Run at: ${runAt}`,
  `- Method: the first ${pages} pages of each file at scale ${scale}, read back from the displayed canvas through a 2D canvas after each render, in a fresh page per engine. Identical means the same size and the same SHA-256 of every pixel. Pages that differ are compared on 256 px wide samples: the largest channel difference, the share of sample pixels off by more than 16, and the box around them as shares of the page (left top right bottom). bench/results/raw/ keeps each such page's samples and a mask of those pixels.`,
  `- Reproduce: \`pnpm bench:build && BROWSER=${browserName} node bench/scripts/fidelity.ts\``,
  "",
  "| File | Engine | Variant | Identical pages | Differing pages (largest difference, share off, where) |",
  "|---|---|---|---:|---|",
  ...rows.map((row) => {
    const differing = row.error
      ? `error: ${row.error}`
      : row.differing
          .map(
            (page) =>
              `p${page.page} (${page.maxDiff}, ${percent(page.offShare)}${page.offBox ? ` in ${page.offBox.join(" ")}` : ""})`,
          )
          .join(", ") || "—";
    return `| ${row.file} | ${row.engine} | ${row.variant} | ${row.identical}/${row.pages} | ${differing} |`;
  }),
  "",
].join("\n");
const target = join(resultsDir, `${output}fidelity-${browserName}.md`);
writeFileSync(target, report);
console.log(`\nWrote ${target}`);
