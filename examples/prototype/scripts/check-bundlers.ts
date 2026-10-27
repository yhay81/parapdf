/**
 * Functional checks for pdf.js's files shipped in the package with the
 * bundlers the package says work as they are, besides Vite (check-bundle.ts):
 * webpack 5, Rsbuild 2, and Next.js 16 with Turbopack and with webpack. For
 * each, packs the package, installs the tarball into an application under
 * `.bundlers/` that configures nothing, and opens the PDFs that need pdf.js's
 * worker, CMaps, standard fonts, image decoders, and ICC profile, from a
 * development build or server and from a production build, with pdf.js's
 * modern and legacy builds. A production build's JavaScript must hold none
 * of those files as data: URLs. The bundlers' versions are pinned in this
 * package's devDependencies.
 *
 * Usage: pnpm --filter @parapdf/bench corpus && pnpm --filter @parapdf/prototype check:bundlers
 * Environment: BROWSER (chromium, webkit, or firefox); BUNDLERS, a
 * comma-separated subset of webpack, rsbuild, next-turbopack, and next-webpack.
 */
import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { createReadStream, existsSync, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { createRsbuild } from "@rsbuild/core";
import webpack from "webpack";
import { launchBrowser } from "../../../bench/scripts/browsers.ts";
import {
  APP_JS,
  check,
  checkFiles,
  exampleDir,
  finish,
  inlinedFiles,
  installPackage,
  LEGACY_JS,
  MAIN_JS,
  shippedFiles,
  writePublicFiles,
} from "./bundle-app.ts";

const BUNDLERS = ["webpack", "rsbuild", "next-turbopack", "next-webpack"] as const;
type Bundler = (typeof BUNDLERS)[number];

const selected = (process.env.BUNDLERS?.split(",") ?? BUNDLERS).map((name) => name.trim());
for (const name of selected) {
  if (!(BUNDLERS as readonly string[]).includes(name)) throw new Error(`Unknown bundler ${name}`);
}

// Inside the workspace, so that the applications resolve this package's
// React, pdf.js, and bundlers, and Turbopack's root holds all of them.
const appsDir = join(exampleDir, ".bundlers");
const PORT = 4185;
const launched = await launchBrowser();
console.log(launched.label);

/** A new application for `bundler`: the packed package and the PDFs; returns it and the package. */
function createApp(bundler: Bundler): { app: string; installed: string } {
  const app = join(appsDir, bundler);
  rmSync(app, { recursive: true, force: true });
  mkdirSync(app, { recursive: true });
  writeFileSync(join(app, "package.json"), JSON.stringify({ type: "module", private: true }));
  const installed = installPackage(app);
  writePublicFiles(join(app, "public"));
  return { app, installed };
}

/** The application's index.js and legacy.js entries in `dir`, on the README's viewer. */
function writeEntries(dir: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "index.js"), MAIN_JS);
  writeFileSync(join(dir, "legacy.js"), LEGACY_JS);
  writeFileSync(join(dir, "app.js"), APP_JS);
}

const TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".wasm": "application/wasm",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
};

/** Serves the first of `dirs` that has the requested file. */
async function serveStatic(dirs: string[]): Promise<{ url: string; close(): Promise<void> }> {
  const server = createServer((request, response) => {
    const path = normalize(decodeURIComponent(new URL(request.url ?? "/", "http://x").pathname));
    const file = dirs
      .map((dir) => join(dir, path.endsWith("/") ? `${path}index.html` : path))
      .find((candidate) => existsSync(candidate) && statSync(candidate).isFile());
    if (!file) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, {
      "content-type": TYPES[extname(file)] ?? "application/octet-stream",
      "cache-control": "max-age=3600",
    });
    createReadStream(file).pipe(response);
  });
  await new Promise<void>((resolve) => server.listen(PORT, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${PORT}/`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

/** Waits until `url` answers, for servers started as processes. */
async function waitForServer(url: string, process: ChildProcess): Promise<void> {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (process.exitCode !== null) throw new Error(`The server exited with ${process.exitCode}`);
    try {
      const response = await fetch(url);
      if (response.status < 500) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`${url} did not answer`);
}

/** Waits until nothing answers at `url`. */
async function waitForClosed(url: string): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      await fetch(url);
    } catch {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`${url} still answers`);
}

/** Checks the modern and legacy pages of the application at `url`. */
async function checkPages(
  installed: string,
  mode: string,
  modern: string,
  legacy: string,
): Promise<void> {
  await checkFiles(launched.browser, installed, mode, modern);
  await checkFiles(launched.browser, installed, `${mode}, legacy build`, legacy, true);
}

function checkInlined(mode: string, dir: string, installed: string): void {
  const inlined = inlinedFiles(dir, shippedFiles(join(installed, "pdfjs")));
  check(
    `${mode}: the build's JavaScript holds none of the shipped files as data: URLs`,
    inlined.length === 0,
    `${inlined.length} inlined${inlined.length ? `: ${inlined.slice(0, 5).join(", ")}` : ""}`,
  );
}

async function checkWebpack(): Promise<void> {
  const { app, installed } = createApp("webpack");
  writeEntries(join(app, "src"));
  for (const mode of ["development", "production"] as const) {
    const outDir = join(app, `dist-${mode}`);
    const compiler = webpack({
      mode,
      context: app,
      entry: { index: "./src/index.js", legacy: "./src/legacy.js" },
      output: { path: outDir, clean: true },
    });
    await new Promise<void>((resolve, reject) =>
      compiler.run((error, stats) => {
        compiler.close(() => {});
        if (error) reject(error);
        else if (stats?.hasErrors()) reject(new Error(stats.toString("errors-only")));
        else resolve();
      }),
    );
    for (const entry of ["index", "legacy"]) {
      writeFileSync(
        join(outDir, `${entry}.html`),
        `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>parapdf webpack check</title></head>
  <body style="margin: 0"><div id="root"></div><script src="/${entry}.js"></script></body>
</html>
`,
      );
    }
    const label = `webpack, ${mode} build`;
    if (mode === "production") checkInlined(label, outDir, installed);
    const server = await serveStatic([outDir, join(app, "public")]);
    try {
      await checkPages(installed, label, server.url, `${server.url}legacy.html`);
    } finally {
      await server.close();
    }
  }
}

async function checkRsbuild(): Promise<void> {
  const { app, installed } = createApp("rsbuild");
  writeEntries(join(app, "src"));
  const rsbuild = await createRsbuild({
    cwd: app,
    config: {
      logLevel: "warn",
      source: { entry: { index: "./src/index.js", legacy: "./src/legacy.js" } },
      server: { port: PORT, host: "127.0.0.1", strictPort: true },
    },
  });
  const dev = await rsbuild.startDevServer();
  try {
    const url = `http://127.0.0.1:${dev.port}/`;
    await checkPages(installed, "Rsbuild, development server", url, `${url}legacy.html`);
  } finally {
    await dev.server.close();
  }
  await rsbuild.build();
  checkInlined("Rsbuild, production build", join(app, "dist"), installed);
  const preview = await rsbuild.preview();
  try {
    const url = `http://127.0.0.1:${preview.port}/`;
    await checkPages(installed, "Rsbuild, production build", url, `${url}legacy.html`);
  } finally {
    await preview.server.close();
  }
}

/** Next.js's App Router application: `/` on pdf.js's modern build, `/legacy` on its legacy one. */
function writeNextApp(app: string): void {
  const dir = join(app, "app");
  mkdirSync(join(dir, "legacy"), { recursive: true });
  writeFileSync(join(app, "next.config.mjs"), "export default {};\n");
  writeFileSync(
    join(dir, "layout.js"),
    `import { createElement as h } from "react";

export default function RootLayout({ children }) {
  return h("html", { lang: "en" }, h("body", { style: { margin: 0 } }, children));
}
`,
  );
  writeFileSync(
    join(dir, "viewer.js"),
    `"use client";
import { createElement as h, useEffect, useState } from "react";
import { PdfDocument, PdfViewer, useViewer } from "parapdf";

export function Viewer() {
  const viewer = useViewer();
  const [file, setFile] = useState(null);
  useEffect(() => {
    window.__viewer = viewer;
    setFile(new URLSearchParams(location.search).get("file"));
  }, [viewer]);
  if (!file) return null;
  return h(PdfDocument, { source: "/" + file }, h(PdfViewer, { viewer, style: { height: "100vh" } }));
}
`,
  );
  writeFileSync(
    join(dir, "legacy-viewer.js"),
    `"use client";
import { createElement as h } from "react";
import { configurePdfjs } from "parapdf";
import { legacyBuild } from "parapdf/legacy";
import { Viewer } from "./viewer.js";

configurePdfjs({ build: legacyBuild });

export function LegacyViewer() {
  return h(Viewer);
}
`,
  );
  writeFileSync(
    join(dir, "page.js"),
    `import { createElement as h } from "react";
import { Viewer } from "./viewer.js";

export default function Page() {
  return h(Viewer);
}
`,
  );
  writeFileSync(
    join(dir, "legacy", "page.js"),
    `import { createElement as h } from "react";
import { LegacyViewer } from "../legacy-viewer.js";

export default function Page() {
  return h(LegacyViewer);
}
`,
  );
}

async function checkNext(bundler: "next-turbopack" | "next-webpack"): Promise<void> {
  const { app, installed } = createApp(bundler);
  writeNextApp(app);
  const next = join(exampleDir, "node_modules", ".bin", "next");
  const flags = bundler === "next-webpack" ? ["--webpack"] : ["--turbopack"];
  const name = bundler === "next-webpack" ? "Next.js with webpack" : "Next.js with Turbopack";
  const env = { ...process.env, NEXT_TELEMETRY_DISABLED: "1" };
  const url = `http://127.0.0.1:${PORT}/`;

  /** Runs `next <command>` until the pages are checked. */
  async function serve(command: string[], mode: string): Promise<void> {
    const server = spawn(next, [...command, "-p", String(PORT), "-H", "127.0.0.1"], {
      cwd: app,
      env,
      detached: true,
      stdio: ["ignore", "ignore", "inherit"],
    });
    try {
      await waitForServer(url, server);
      await checkPages(installed, `${name}, ${mode}`, url, `${url}legacy`);
    } finally {
      if (server.pid && server.exitCode === null) process.kill(-server.pid, "SIGTERM");
      await new Promise((resolve) =>
        server.exitCode === null ? server.once("exit", resolve) : resolve(null),
      );
      // `next dev` serves from a process of its own, which may still write
      // to .next after the one started here exited.
      await waitForClosed(url);
    }
  }

  await serve(["dev", ...flags], "development server");
  rmSync(join(app, ".next"), { recursive: true, force: true });
  execFileSync(next, ["build", ...flags], {
    cwd: app,
    env,
    stdio: ["ignore", "ignore", "inherit"],
  });
  checkInlined(`${name}, production build`, join(app, ".next", "static"), installed);
  await serve(["start"], "production build");
}

try {
  for (const bundler of selected as Bundler[]) {
    console.log(`\n${bundler}`);
    if (bundler === "webpack") await checkWebpack();
    else if (bundler === "rsbuild") await checkRsbuild();
    else await checkNext(bundler);
  }
} finally {
  await launched.close();
}

finish();
