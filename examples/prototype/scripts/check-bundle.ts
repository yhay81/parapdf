/**
 * Functional checks for pdf.js's files shipped in the package: an application
 * built with Vite that configures nothing must get pdf.js's worker, CMaps,
 * standard fonts, image decoders, and ICC color management from parapdf.
 * Packs the package, installs the tarball into a temporary Vite application
 * beside this workspace's React and pdf.js, and opens a Japanese PDF without
 * embedded fonts, a JBIG2 scan, a page in Symbol and ZapfDingbats, and a
 * CMYK page, from Vite's development server, which pre-bundles dependencies,
 * and from a production build, once as the application that configures
 * nothing and once with pdf.js's legacy build (parapdf/legacy). The build's
 * JavaScript must hold none of those files as data: URLs, which Vite makes of
 * files under 4 KB, and the list of their URLs must stay a few KB.
 *
 * Usage: pnpm --filter @parapdf/bench corpus && pnpm --filter @parapdf/prototype check:bundle
 * Environment: BROWSER (chromium, webkit, or firefox).
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import type { Browser } from "playwright";
import { build, createServer, preview } from "vite";
import { launchBrowser, restoreScaleFactor } from "../../../bench/scripts/browsers.ts";

const exampleDir = fileURLToPath(new URL("..", import.meta.url));
const packageDir = join(exampleDir, "../../packages/parapdf");
const corpusDir = join(exampleDir, "../../bench/corpus");
const require = createRequire(join(packageDir, "package.json"));
let failures = 0;

function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
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
 * The most the chunk with the list of the shipped files' URLs may weigh with
 * gzip: 3.1 KB when the files are emitted, 52.6 KB when Vite inlined the 145
 * under 4 KB.
 */
const FILE_LIST_LIMIT = 4096;

/**
 * A file's content for comparing it with a data: URL's: SVG text without
 * whitespace and with double quotes for single, since Vite rewrites an SVG
 * it inlines that way, and any other file's bytes.
 */
function fingerprint(bytes: Buffer, svg: boolean): string {
  const content = svg ? bytes.toString("utf8").replace(/\s+/g, "").replaceAll("'", '"') : bytes;
  return createHash("sha256").update(content).digest("hex");
}

/** The pdf.js files under the installed package's `pdfjs/`, by fingerprint. */
function shippedFiles(pdfjsDir: string): Map<string, string> {
  const files = new Map<string, string>();
  for (const dir of ["cmaps", "standard_fonts", "wasm", "iccs", "web/images"]) {
    for (const name of readdirSync(join(pdfjsDir, dir))) {
      if (name.startsWith("LICENSE")) continue;
      files.set(fingerprint(readFileSync(join(pdfjsDir, dir, name)), name.endsWith(".svg")), name);
    }
  }
  return files;
}

/** The shipped files that a build's JavaScript holds as data: URLs. */
function inlinedFiles(assetsDir: string, shipped: Map<string, string>): string[] {
  const inlined: string[] = [];
  for (const name of readdirSync(assetsDir).filter((file) => file.endsWith(".js"))) {
    const code = readFileSync(join(assetsDir, name), "utf8");
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

const app = mkdtempSync(join(tmpdir(), "parapdf-bundle-"));
const launched = await launchBrowser();
console.log(launched.label);

interface Visit {
  /** Paths of the responses, with their statuses. */
  responses: { path: string; status: number }[];
  errors: string[];
  painted: boolean;
  /** The color at the center of page 1's topmost canvas. */
  center: number[];
}

async function visit(browser: Browser, url: string): Promise<Visit> {
  const context = await browser.newContext({ viewport: { width: 800, height: 600 } });
  const page = await context.newPage();
  await restoreScaleFactor(page, new URL("/blank.html", url).href);
  const responses: Visit["responses"] = [];
  const errors: string[] = [];
  page.on("response", (response) => {
    responses.push({ path: new URL(response.url()).pathname, status: response.status() });
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
      { timeout: 30_000 },
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
  await context.close();
  return { responses, errors, painted, center };
}

const loaded = (result: Visit, pattern: RegExp) =>
  result.responses.some(({ path, status }) => pattern.test(path) && status === 200);

/** Checks one page of the application: index.html (the modern build) or legacy.html. */
async function checkFiles(mode: string, baseUrl: string, legacy = false): Promise<void> {
  const pageUrl = legacy ? `${baseUrl}legacy.html` : baseUrl;
  const open = (file: string) => visit(launched.browser, `${pageUrl}?file=${file}`);

  const cjk = await open("synthetic-cjk-nonembedded.pdf");
  check(`${mode}: a Japanese PDF without embedded fonts paints`, cjk.painted);
  check(
    `${mode}: pdf.js's ${legacy ? "legacy " : ""}worker starts from the shipped file, not a data: or blob: URL`,
    loaded(cjk, legacy ? /\/pdf\.worker\.legacy[^/]*\.js$/ : /\/pdf\.worker[^/]*\.js$/) &&
      (legacy || !loaded(cjk, /\/pdf\.worker\.legacy/)) &&
      !cjk.responses.some(({ path }) => /^\/[0-9a-f-]{36}$/.test(path)),
    cjk.responses.map(({ path }) => path).join(" "),
  );
  check(`${mode}: the worker loads CMaps`, loaded(cjk, /UniJIS-UCS2-H[^/]*\.bcmap$/));
  const downloads = cjk.responses.filter(({ path }) =>
    path.endsWith("/synthetic-cjk-nonembedded.pdf"),
  ).length;
  if (launched.browser.browserType().name() === "webkit") {
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

try {
  execFileSync("pnpm", ["pack", "--pack-destination", app], {
    cwd: packageDir,
    stdio: ["ignore", "ignore", "inherit"],
  });
  const tarball = readdirSync(app).find((name) => name.endsWith(".tgz"));
  if (!tarball) throw new Error("pnpm pack wrote no tarball");
  const installed = join(app, "node_modules", "parapdf");
  mkdirSync(installed, { recursive: true });
  execFileSync("tar", ["-xzf", join(app, tarball), "-C", installed, "--strip-components=1"]);
  for (const name of ["react", "react-dom", "pdfjs-dist"]) {
    symlinkSync(
      dirname(require.resolve(`${name}/package.json`)),
      join(app, "node_modules", name),
      "dir",
    );
  }

  const publicDir = join(app, "public");
  mkdirSync(publicDir);
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
  writeFileSync(join(app, "package.json"), JSON.stringify({ type: "module", private: true }));
  writeFileSync(
    join(app, "index.html"),
    `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>parapdf bundle check</title></head>
  <body style="margin: 0"><div id="root"></div><script type="module" src="/main.js"></script></body>
</html>
`,
  );
  writeFileSync(
    join(app, "legacy.html"),
    `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>parapdf bundle check, legacy build</title></head>
  <body style="margin: 0"><div id="root"></div><script type="module" src="/legacy.js"></script></body>
</html>
`,
  );
  writeFileSync(join(app, "main.js"), `import { start } from "./app.js";\n\nstart();\n`);
  writeFileSync(
    join(app, "legacy.js"),
    `import { configurePdfjs } from "parapdf";
import { legacyBuild } from "parapdf/legacy";
import { start } from "./app.js";

configurePdfjs({ build: legacyBuild });
start();
`,
  );
  // The application as its README shows it, without JSX to stay plugin-free.
  writeFileSync(
    join(app, "app.js"),
    `import { createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { PdfDocument, PdfViewport, usePdfViewer } from "parapdf";

function Probe() {
  window.__viewer = usePdfViewer();
  return null;
}

export function start() {
  const file = new URLSearchParams(location.search).get("file");
  createRoot(document.getElementById("root")).render(
    h(PdfDocument, { source: "/" + file }, h(Probe), h(PdfViewport, { style: { height: "100vh" } })),
  );
}
`,
  );

  const dev = await createServer({
    root: app,
    configFile: false,
    logLevel: "warn",
    server: { port: 4183, host: "127.0.0.1", strictPort: false },
  });
  await dev.listen();
  try {
    const url = dev.resolvedUrls?.local[0] ?? "http://127.0.0.1:4183/";
    await checkFiles("development server", url);
    await checkFiles("development server, legacy build", url, true);
  } finally {
    await dev.close();
  }

  // An application that does not import parapdf/legacy emits no legacy worker.
  // This build puts the list of the shipped files' URLs, which the bundle
  // every viewer loads holds, in a chunk of its own to weigh it.
  const modernOnly = join(app, "dist-modern");
  await build({
    root: app,
    configFile: false,
    logLevel: "warn",
    build: {
      outDir: modernOnly,
      rolldownOptions: {
        output: {
          codeSplitting: {
            groups: [{ name: "pdfjs-files", test: /[\\/]pdfjs[\\/]files\.js$/ }],
          },
        },
      },
    },
  });
  const emitted = readdirSync(join(modernOnly, "assets"));
  check(
    "a build without parapdf/legacy emits the modern worker only",
    emitted.some((name) => /^pdf\.worker-/.test(name)) &&
      !emitted.some((name) => name.startsWith("pdf.worker.legacy")),
    emitted.filter((name) => name.startsWith("pdf.worker")).join(" "),
  );
  const fileList = emitted.find((name) => /^pdfjs-files-.*\.js$/.test(name));
  const fileListCode = fileList ? readFileSync(join(modernOnly, "assets", fileList)) : null;
  const fileListSize = fileListCode ? gzipSync(fileListCode).length : 0;
  check(
    `the list of the shipped files' URLs stays within ${FILE_LIST_LIMIT / 1024} KB with gzip`,
    fileListCode !== null && fileListSize <= FILE_LIST_LIMIT,
    fileListCode
      ? `${fileListCode.length} bytes, ${fileListSize} with gzip`
      : `no chunk of its own: ${emitted.filter((name) => name.endsWith(".js")).join(" ")}`,
  );
  rmSync(modernOnly, { recursive: true, force: true });

  await build({
    root: app,
    configFile: false,
    logLevel: "warn",
    build: {
      rollupOptions: { input: { main: join(app, "index.html"), legacy: join(app, "legacy.html") } },
    },
  });
  // Vite inlines files under 4 KB as data: URLs unless told not to, which
  // put most CMaps and the annotation icons into the bundle every viewer loads.
  const inlined = inlinedFiles(join(app, "dist", "assets"), shippedFiles(join(installed, "pdfjs")));
  check(
    "the build's JavaScript holds none of the shipped files as data: URLs",
    inlined.length === 0,
    `${inlined.length} inlined${inlined.length ? `: ${inlined.slice(0, 5).join(", ")}` : ""}`,
  );
  const server = await preview({
    root: app,
    configFile: false,
    logLevel: "warn",
    preview: { port: 4184, host: "127.0.0.1", strictPort: false },
  });
  try {
    const url = server.resolvedUrls?.local[0] ?? "http://127.0.0.1:4184/";
    await checkFiles("production build", url);
    await checkFiles("production build, legacy build", url, true);
  } finally {
    await new Promise<void>((resolve) => server.httpServer.close(() => resolve()));
  }
} finally {
  await launched.browser.close();
  rmSync(app, { recursive: true, force: true });
}

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
