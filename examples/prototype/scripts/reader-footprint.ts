/**
 * Measures a fresh production npm install and the JS, CSS and worker scripts
 * a minimal Vite reader requests to display one selectable page. On-demand
 * fonts and PDF bytes are outside the code total. SINGLE_PAGE=1 also measures
 * react-pdf without a virtual list. OUTPUT saves the evidence.
 */
import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { build, preview } from "vite";
import {
  launchBrowser,
  measureInTurn,
  restoreScaleFactor,
} from "../../../bench/scripts/browsers.ts";

const project = fileURLToPath(new URL("..", import.meta.url));
const temp = mkdtempSync(join(tmpdir(), "parapdf-reader-install-"));
const pdf = join(project, "../../bench/corpus/bunka-kokugo-series-019-p4.pdf");
const manifest = (file: string) => JSON.parse(readFileSync(file, "utf8")) as { version: string };
const version = (name: string) =>
  manifest(join(project, "node_modules", name, "package.json")).version;
const versions = {
  parapdf: process.env.PARAPDF_VERSION ?? version("parapdf"),
  "react-pdf": version("react-pdf"),
  "react-window": version("react-window"),
  react: version("react"),
  "react-dom": version("react-dom"),
};

function installedBytes(dir: string): number {
  let size = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) size += installedBytes(path);
    if (entry.isFile() && entry.name !== ".package-lock.json") size += statSync(path).size;
  }
  return size;
}

const para = `
import { PdfDocument, PdfViewer } from "parapdf";
function Reader() {
  return <PdfDocument source="/page.pdf"><PdfViewer style={{height: "100vh"}} /></PdfDocument>;
}`;
const reactSetup = `
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/TextLayer.css";
import "react-pdf/dist/Page/AnnotationLayer.css";
pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).href;
const options = { cMapUrl: "/pdfjs/cmaps/", cMapPacked: true, standardFontDataUrl: "/pdfjs/standard_fonts/",
  wasmUrl: "/pdfjs/wasm/", iccUrl: "/pdfjs/iccs/" };`;
const reactPdf = `${reactSetup}
import { List } from "react-window";
const rowProps = {};
function Row({ index, style }) {
  return <div style={style}><Page pageNumber={index + 1} width={612}/></div>;
}
function Reader() {
  const [count, setCount] = React.useState(0);
  return <Document file="/page.pdf" options={options} onLoadSuccess={(pdf) => setCount(pdf.numPages)}>
    {count > 0 && <List style={{height: "100vh"}} rowCount={count} rowHeight={866}
      rowComponent={Row} rowProps={rowProps}/>}
  </Document>;
}`;

const reactSingle = `${reactSetup}
function Reader() {
  return <Document file="/page.pdf" options={options}><Page pageNumber={1} width={612}/></Document>;
}`;
const launched = await launchBrowser();
const results = [];
try {
  const readers = [
    { name: "parapdf", component: para, libraries: { parapdf: versions.parapdf } },
    {
      name: "react-pdf",
      component: reactPdf,
      libraries: { "react-pdf": versions["react-pdf"], "react-window": versions["react-window"] },
    },
    ...(process.env.SINGLE_PAGE === "1"
      ? [
          {
            name: "react-pdf-single",
            component: reactSingle,
            libraries: { "react-pdf": versions["react-pdf"] },
          },
        ]
      : []),
  ];
  for (const { name, component, libraries } of readers) {
    const root = join(temp, name);
    const publicDir = join(root, "public");
    mkdirSync(publicDir, { recursive: true });
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({
        private: true,
        type: "module",
        dependencies: { ...libraries, react: versions.react, "react-dom": versions["react-dom"] },
      }),
    );
    execFileSync("npm", ["install", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"], {
      cwd: root,
    });
    const modules = join(root, "node_modules");
    const bytes = installedBytes(modules);
    if (name !== "parapdf") {
      for (const dir of ["cmaps", "standard_fonts", "wasm", "iccs"]) {
        cpSync(join(modules, "pdfjs-dist", dir), join(publicDir, "pdfjs", dir), {
          recursive: true,
        });
      }
    }
    cpSync(pdf, join(publicDir, "page.pdf"));
    writeFileSync(
      join(root, "index.html"),
      '<!doctype html><meta charset="utf-8"><style>body{margin:0}</style><div id="root"></div><script type="module" src="/app.jsx"></script>',
    );
    writeFileSync(
      join(root, "app.jsx"),
      `import React from "react";
import {createRoot} from "react-dom/client";
${component}
createRoot(document.getElementById("root")).render(<Reader/>);`,
    );
    await build({ root, configFile: false, logLevel: "silent" });
    const files = new Set<string>();
    const server = await preview({
      root,
      configFile: false,
      logLevel: "silent",
      preview: { host: "127.0.0.1", port: 4179, strictPort: false },
      plugins: [
        {
          name: "count-reader-assets",
          configurePreviewServer(server) {
            server.middlewares.use((req, res, next) => {
              const path = new URL(req.url ?? "/", "http://localhost").pathname;
              res.on("finish", () => {
                if (res.statusCode === 200 && /\.(?:m?js|css)$/.test(path)) files.add(path);
              });
              next();
            });
          },
        },
      ],
    });
    try {
      const base = server.resolvedUrls?.local[0];
      if (!base) throw new Error("Missing preview URL");
      await measureInTurn(launched, async (browser) => {
        files.clear();
        const context = await browser.newContext({
          viewport: { width: 636, height: 900 },
          deviceScaleFactor: 2,
        });
        try {
          const page = await context.newPage();
          await restoreScaleFactor(page, base);
          await page.goto(base);
          await page.locator(".endOfContent").first().waitFor({ state: "attached" });
          await page.waitForFunction(() =>
            [...document.querySelectorAll("canvas")].some(
              (canvas) =>
                canvas.width >= 1224 &&
                canvas.height > 0 &&
                getComputedStyle(canvas).visibility === "visible",
            ),
          );
        } finally {
          await context.close();
        }
      });
      const code = [...files].sort().map((url) => {
        const data = readFileSync(join(root, "dist", url));
        return { file: basename(url), bytes: data.length, gzip: gzipSync(data).length };
      });
      if (!code.some((f) => f.file.includes("pdf.worker")))
        throw new Error("Missing worker response");
      const result = {
        name,
        version: manifest(join(modules, name === "parapdf" ? name : "react-pdf", "package.json"))
          .version,
        installedBytes: bytes,
        pdfjs: manifest(join(modules, "pdfjs-dist/package.json")).version,
        nativeCanvas: existsSync(join(modules, "@napi-rs/canvas/package.json"))
          ? manifest(join(modules, "@napi-rs/canvas/package.json")).version
          : null,
        gzipBytes: code.reduce((sum, file) => sum + file.gzip, 0),
        code,
      };
      results.push(result);
      console.log(JSON.stringify(result));
    } finally {
      await server.close();
    }
  }
  if (process.env.OUTPUT)
    writeFileSync(
      process.env.OUTPUT,
      JSON.stringify(
        {
          versions,
          vite: version("vite"),
          npm: execFileSync("npm", ["--version"], { encoding: "utf8" }).trim(),
          platform: process.platform,
          arch: process.arch,
          browser: launched.label,
          pdf: basename(pdf),
          results,
        },
        null,
        2,
      ),
    );
} finally {
  await launched.close();
  rmSync(temp, { recursive: true, force: true });
}
