/**
 * The application the bundle checks build (check-bundle.ts with Vite,
 * check-bundlers.ts with webpack, Rsbuild, and Next.js): the packed package
 * installed into it, the PDFs that need each of pdf.js's shipped files, the
 * viewer as the package's README shows it, and the checks that a page of the
 * built application loads those files and paints.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Browser } from "playwright";
import { captureFailure, restoreScaleFactor } from "../../../bench/scripts/browsers.ts";

export const exampleDir = fileURLToPath(new URL("..", import.meta.url));
export const packageDir = join(exampleDir, "../../packages/parapdf");
const corpusDir = join(exampleDir, "../../bench/corpus");

let failures = 0;

export function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) {
    failures++;
    captureFailure(name);
  }
}

/** Prints the result and exits with it. */
export function finish(): never {
  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

/** A one-page PDF with the given objects after the catalog, page tree, and page. */
function onePagePdf(page: string, content: string, objects: string[] = []): Buffer {
  const all = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 4 0 R ${page} >>`,
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    ...objects,
  ];
  let body = "%PDF-1.4\n";
  const offsets = all.map((object, index) => {
    const offset = body.length;
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  const xref = body.length;
  body += `xref\n0 ${all.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  body += `trailer\n<< /Size ${all.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, "latin1");
}

/**
 * A file's content for comparing it with a data: URL's: SVG text without
 * whitespace and with double quotes for single, since Vite rewrites an SVG
 * it inlines that way, and any other file's bytes.
 */
function fingerprint(bytes: Buffer, svg: boolean): string {
  const content = svg ? bytes.toString("utf8").replace(/\s+/g, "").replaceAll("'", '"') : bytes;
  return createHash("sha256").update(content).digest("hex");
}

const ON_DEMAND_DIRS = ["cmaps", "standard_fonts", "wasm", "iccs", "web/images"];

/** The files pdf.js loads on demand under the installed package's `pdfjs/`, by fingerprint. */
export function shippedFiles(pdfjsDir: string): Map<string, string> {
  const files = new Map<string, string>();
  for (const dir of ON_DEMAND_DIRS) {
    for (const name of readdirSync(join(pdfjsDir, dir))) {
      if (name.startsWith("LICENSE")) continue;
      files.set(fingerprint(readFileSync(join(pdfjsDir, dir, name)), name.endsWith(".svg")), name);
    }
  }
  return files;
}

/**
 * The installed package's worker scripts and the files pdf.js loads on
 * demand, by the hash of their bytes: bundlers that name what they emit by
 * its hash alone, as webpack does, are recognized by what they serve.
 */
function servedFiles(pdfjsDir: string): Map<string, string> {
  const files = new Map<string, string>();
  const add = (path: string) => files.set(fingerprint(readFileSync(path), false), basename(path));
  for (const name of readdirSync(pdfjsDir)) if (name.endsWith(".js")) add(join(pdfjsDir, name));
  for (const dir of ON_DEMAND_DIRS) {
    for (const name of readdirSync(join(pdfjsDir, dir))) {
      if (!name.startsWith("LICENSE")) add(join(pdfjsDir, dir, name));
    }
  }
  return files;
}

/** The shipped files that a build's JavaScript under `dir` holds as data: URLs. */
export function inlinedFiles(dir: string, shipped: Map<string, string>): string[] {
  const inlined: string[] = [];
  const scripts = readdirSync(dir, { recursive: true, encoding: "utf8" }).filter((file) =>
    file.endsWith(".js"),
  );
  for (const name of scripts) {
    const code = readFileSync(join(dir, name), "utf8");
    for (const [, , type = "", data = ""] of code.matchAll(/(["'`])data:([^,"'`]*),(.*?)\1/gs)) {
      let bytes: Buffer;
      try {
        bytes = type.endsWith(";base64")
          ? Buffer.from(data, "base64")
          : Buffer.from(decodeURIComponent(data), "utf8");
      } catch {
        continue;
      }
      const file = shipped.get(fingerprint(bytes, type.startsWith("image/svg+xml")));
      if (file) inlined.push(file);
    }
  }
  return inlined;
}

/**
 * Packs the package and extracts the tarball into `app`'s
 * `node_modules/parapdf`, as installing it would; returns that directory.
 */
export function installPackage(app: string): string {
  execFileSync("pnpm", ["pack", "--pack-destination", app], {
    cwd: packageDir,
    stdio: ["ignore", "ignore", "inherit"],
  });
  const tarball = readdirSync(app).find((name) => name.endsWith(".tgz"));
  if (!tarball) throw new Error("pnpm pack wrote no tarball");
  const installed = join(app, "node_modules", "parapdf");
  mkdirSync(installed, { recursive: true });
  execFileSync("tar", ["-xzf", join(app, tarball), "-C", installed, "--strip-components=1"]);
  return installed;
}

/** Writes the PDFs the checks open, and a blank page, into `publicDir`. */
export function writePublicFiles(publicDir: string): void {
  mkdirSync(publicDir, { recursive: true });
  copyFileSync(
    join(corpusDir, "generated/synthetic-cjk-nonembedded.pdf"),
    join(publicDir, "synthetic-cjk-nonembedded.pdf"),
  );
  copyFileSync(
    join(corpusDir, "wdl6812-manuscript.pdf"),
    join(publicDir, "wdl6812-manuscript.pdf"),
  );
  writeFileSync(join(publicDir, "cmyk.pdf"), onePagePdf("", "0 1 1 0 k 0 0 300 200 re f"));
  writeFileSync(
    join(publicDir, "symbol.pdf"),
    onePagePdf(
      "/Resources << /Font << /F1 5 0 R /F2 6 0 R >> >>",
      "BT /F1 36 Tf 20 120 Td (abgdp) Tj ET BT /F2 36 Tf 20 50 Td (3456) Tj ET",
      [
        "<< /Type /Font /Subtype /Type1 /BaseFont /Symbol >>",
        "<< /Type /Font /Subtype /Type1 /BaseFont /ZapfDingbats >>",
      ],
    ),
  );
  writeFileSync(join(publicDir, "blank.html"), "<!doctype html><title>blank</title>");
}

/** The viewer as the package's README shows it, without JSX to stay plugin-free. */
export const APP_JS = `import { createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { PdfDocument, PdfViewer, useViewer } from "parapdf";

function App({ file }) {
  const viewer = useViewer();
  window.__viewer = viewer;
  return h(PdfDocument, { source: "/" + file }, h(PdfViewer, { viewer, style: { height: "100vh" } }));
}

export function start() {
  const file = new URLSearchParams(location.search).get("file");
  createRoot(document.getElementById("root")).render(h(App, { file }));
}
`;

export const MAIN_JS = `import { start } from "./app.js";\n\nstart();\n`;

/** The same application on pdf.js's legacy build. */
export const LEGACY_JS = `import { configurePdfjs } from "parapdf";
import { legacyBuild } from "parapdf/legacy";
import { start } from "./app.js";

configurePdfjs({ build: legacyBuild });
start();
`;

interface Visit {
  /** The responses: their paths, statuses, and the shipped file each served, if any. */
  responses: { path: string; status: number; file: string | undefined }[];
  errors: string[];
  painted: boolean;
  /** The color at the center of page 1's topmost canvas. */
  center: number[];
}

async function visit(browser: Browser, url: string, served: Map<string, string>): Promise<Visit> {
  const context = await browser.newContext({ viewport: { width: 800, height: 600 } });
  const page = await context.newPage();
  await restoreScaleFactor(page, new URL("/blank.html", url).href);
  const responses: Visit["responses"] = [];
  const bodies: Promise<void>[] = [];
  const errors: string[] = [];
  const workers = new Set<string>();
  page.on("worker", (worker) => workers.add(worker.url().split("#")[0] ?? ""));
  // Scripts that are no shipped file's bytes, by URL: webpack's production
  // builds minify the worker too.
  const scripts = new Map<string, { entry: Visit["responses"][number]; body: Buffer }>();
  page.on("response", (response) => {
    const entry = {
      path: new URL(response.url()).pathname,
      status: response.status(),
      file: undefined as string | undefined,
    };
    responses.push(entry);
    bodies.push(
      response.body().then(
        (body) => {
          entry.file = served.get(fingerprint(body, false));
          if (!entry.file) scripts.set(response.url().split("#")[0] ?? "", { entry, body });
        },
        () => {},
      ),
    );
  });
  page.on("console", (message) => {
    if (message.type() === "error" || /fake worker/.test(message.text())) {
      errors.push(message.text());
    }
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(url);
  const painted = await page
    .waitForFunction(
      () => (window as { __viewer?: { hasPixels(index: number): boolean } }).__viewer?.hasPixels(0),
      undefined,
      { timeout: 60_000 },
    )
    .then(
      () => true,
      () => false,
    );
  // Fonts and decoders may still arrive for the detail render.
  await page.waitForTimeout(500);
  const center = await page.evaluate(() => {
    const canvases = [...document.querySelectorAll("section canvas")].filter(
      (canvas): canvas is HTMLCanvasElement =>
        canvas instanceof HTMLCanvasElement && canvas.width > 0,
    );
    const canvas = canvases.at(-1);
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return [];
    const x = Math.floor(canvas.width / 2);
    const y = Math.floor(canvas.height / 2);
    return [...context.getImageData(x, y, 1, 1).data.slice(0, 3)];
  });
  await Promise.all(bodies);
  // A worker started from a script that is no shipped file's bytes is
  // pdf.js's, transformed, and the legacy one if it holds core-js.
  for (const url of workers) {
    const script = scripts.get(url);
    if (!script) continue;
    const legacy = script.body.includes("__core-js_shared__");
    script.entry.file = `transformed ${legacy ? "pdf.worker.legacy.js" : "pdf.worker.js"}`;
  }
  await context.close();
  return { responses, errors, painted, center };
}

/** Whether a response succeeded with a file named like `pattern`, by its path or its content. */
const loaded = (result: Visit, pattern: RegExp) =>
  result.responses.some(
    ({ path, status, file }) => status === 200 && (pattern.test(path) || pattern.test(file ?? "")),
  );

/**
 * Checks one page of the built application, which shows the PDF its `file`
 * parameter names: that pdf.js's worker starts from the shipped file and
 * loads CMaps, decoders, standard fonts, and the ICC profile from it.
 */
export async function checkFiles(
  browser: Browser,
  installed: string,
  mode: string,
  pageUrl: string,
  legacy = false,
): Promise<void> {
  const served = servedFiles(join(installed, "pdfjs"));
  const open = (file: string) =>
    visit(browser, `${pageUrl}${pageUrl.includes("?") ? "&" : "?"}file=${file}`, served);

  const cjk = await open("synthetic-cjk-nonembedded.pdf");
  check(`${mode}: a Japanese PDF without embedded fonts paints`, cjk.painted);
  check(
    `${mode}: pdf.js's ${legacy ? "legacy " : ""}worker starts from the shipped file, not a data: or blob: URL`,
    loaded(cjk, legacy ? /pdf\.worker\.legacy[^/]*\.js$/ : /pdf\.worker(?!\.legacy)[^/]*\.js$/) &&
      (legacy || !loaded(cjk, /pdf\.worker\.legacy/)) &&
      !cjk.responses.some(({ path }) => /^\/[0-9a-f-]{36}$/.test(path)),
    cjk.responses.map(({ path, file }) => (file ? `${path} (${file})` : path)).join(" "),
  );
  check(`${mode}: the worker loads CMaps`, loaded(cjk, /UniJIS-UCS2-H[^/]*\.bcmap$/));
  const downloads = cjk.responses.filter(({ path }) =>
    path.endsWith("/synthetic-cjk-nonembedded.pdf"),
  ).length;
  if (browser.browserType().name() === "webkit") {
    // Playwright's WebKit keeps no HTTP cache: it fetched even a response
    // with max-age=3600 again, so it cannot reuse a preload either.
    console.log(`NOTE ${mode}: WebKit downloaded the PDF ${downloads} times`);
  } else {
    check(
      `${mode}: pdf.js reuses the preloaded download of the PDF`,
      downloads === 1,
      `${downloads} downloads`,
    );
  }

  const jbig2 = await open("wdl6812-manuscript.pdf");
  check(`${mode}: the worker loads the JBIG2 decoder`, loaded(jbig2, /jbig2[^/]*\.wasm$/));

  const symbol = await open("symbol.pdf");
  check(
    `${mode}: the worker loads standard font data`,
    loaded(symbol, /FoxitSymbol[^/]*\.pfb$/) && loaded(symbol, /FoxitDingbats[^/]*\.pfb$/),
  );

  const cmyk = await open("cmyk.pdf");
  const [red = 0, green = 0, blue = 0] = cmyk.center;
  check(
    `${mode}: pdf.js manages CMYK colors with the ICC profile`,
    loaded(cmyk, /qcms_bg[^/]*\.wasm$/) &&
      Math.abs(red - 236) <= 4 &&
      Math.abs(green - 31) <= 4 &&
      Math.abs(blue - 37) <= 4,
    `rgb(${cmyk.center.join(" ")}), rgb(236 31 37) expected`,
  );

  const errors = [cjk, jbig2, symbol, cmyk].flatMap((result) => result.errors);
  check(`${mode}: no errors`, errors.length === 0, errors.slice(0, 3).join(" | "));
}
