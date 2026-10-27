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
import {
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
import { gzipSync } from "node:zlib";
import { build, createServer, preview } from "vite";
import { launchBrowser } from "../../../bench/scripts/browsers.ts";
import {
  APP_JS,
  check,
  checkFiles,
  finish,
  inlinedFiles,
  installPackage,
  LEGACY_JS,
  MAIN_JS,
  packageDir,
  shippedFiles,
  writePublicFiles,
} from "./bundle-app.ts";

const require = createRequire(join(packageDir, "package.json"));

/**
 * The most the chunk with the list of the shipped files' URLs may weigh with
 * gzip: 3.1 KB when the files are emitted, 52.6 KB when Vite inlined the 145
 * under 4 KB.
 */
const FILE_LIST_LIMIT = 4096;

const app = mkdtempSync(join(tmpdir(), "parapdf-bundle-"));
const launched = await launchBrowser();
console.log(launched.label);

try {
  const installed = installPackage(app);
  for (const name of ["react", "react-dom", "pdfjs-dist"]) {
    symlinkSync(
      dirname(require.resolve(`${name}/package.json`)),
      join(app, "node_modules", name),
      "dir",
    );
  }
  writePublicFiles(join(app, "public"));
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
  writeFileSync(join(app, "main.js"), MAIN_JS);
  writeFileSync(join(app, "legacy.js"), LEGACY_JS);
  writeFileSync(join(app, "app.js"), APP_JS);

  const dev = await createServer({
    root: app,
    configFile: false,
    logLevel: "warn",
    server: { port: 4183, host: "127.0.0.1", strictPort: false },
  });
  await dev.listen();
  try {
    const url = dev.resolvedUrls?.local[0] ?? "http://127.0.0.1:4183/";
    await checkFiles(launched.browser, installed, "development server", url);
    await checkFiles(
      launched.browser,
      installed,
      "development server, legacy build",
      `${url}legacy.html`,
      true,
    );
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
  const inlined = inlinedFiles(join(app, "dist"), shippedFiles(join(installed, "pdfjs")));
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
    await checkFiles(launched.browser, installed, "production build", url);
    await checkFiles(
      launched.browser,
      installed,
      "production build, legacy build",
      `${url}legacy.html`,
      true,
    );
  } finally {
    await new Promise<void>((resolve) => server.httpServer.close(() => resolve()));
  }
} finally {
  await launched.close();
  rmSync(app, { recursive: true, force: true });
}

finish();
