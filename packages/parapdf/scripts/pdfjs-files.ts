/**
 * Builds the parsing workers, lists the assets provided by pdfjs-dist for
 * the static copy command, and writes the asset URL manifest with
 * `new URL(…, import.meta.url)`. Bundlers emit files referenced that way with
 * the application's own assets, so the application configures nothing.
 * Runs on `pnpm install` (prepare) and before every build.
 * Usage: node scripts/pdfjs-files.ts
 */
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL("../", import.meta.url));
const pdfjsDist = dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json"));
const { version } = JSON.parse(readFileSync(join(pdfjsDist, "package.json"), "utf8")) as {
  version: string;
};
const out = join(here, "pdfjs");

/** The files pdf.js's worker loads on demand, by directory. */
const directories = [
  { dir: "cmaps", files: (name: string) => name.endsWith(".bcmap") },
  { dir: "standard_fonts", files: (name: string) => /\.(pfb|ttf)$/.test(name) },
  // The decoders only: the JavaScript fallbacks for browsers without
  // WebAssembly stay out, and the scripting engine, which the page loads
  // and not the worker, is copied below.
  { dir: "wasm", files: (name: string) => name.endsWith(".wasm") && !name.startsWith("quickjs") },
  { dir: "iccs", files: (name: string) => name.endsWith(".icc") },
];
const isLicense = (name: string) => name.startsWith("LICENSE");

/**
 * The query on the URLs of the files the worker loads and of the icons,
 * which keeps bundlers from inlining them as data: URLs: Vite inlines any
 * file under 4 KB unless the query has `no-inline`, and Rsbuild images and
 * fonts under 4 KB unless it has `url`. Without it, Vite 8 put 134 CMaps and
 * the icons into the bundle every viewer loads, 49 KB with gzip, where the
 * worker fetches a CMap only when a PDF needs it, and Rsbuild the icons.
 * webpack, which inlines nothing it reaches through new URL(), keeps the
 * query in the URLs it emits, and Vite's build keeps `?url`; the loader takes
 * it off (src/pdfjs/loader.ts). The workers go without: no bundler inlines
 * 1.2 MB, and Vite's development server answers a script requested with
 * `?url` with a module that exports its URL.
 */
const NO_INLINE = "?no-inline&url";

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
// ParaPDF's prelude, then pdf.js's worker as it is. An ES module like any
// other script: the .js extension keeps servers that do not know .mjs from
// serving it with a type browsers refuse for workers. At 1.2 MB, no bundler
// inlines it as a data: URL, which pages with a strict CSP could not start.
writeFileSync(
  join(out, "pdf.worker.js"),
  `${readFileSync(join(here, "scripts/worker-prelude.js"), "utf8")}\n${readFileSync(
    join(pdfjsDist, "build/pdf.worker.min.mjs"),
    "utf8",
  )}`,
);
// The legacy build's worker, for older browsers (parapdf/legacy), behind
// the same prelude; it loads the same files.
writeFileSync(
  join(out, "pdf.worker.legacy.js"),
  `${readFileSync(join(here, "scripts/worker-prelude.js"), "utf8")}\n${readFileSync(
    join(pdfjsDist, "legacy/build/pdf.worker.min.mjs"),
    "utf8",
  )}`,
);
cpSync(join(pdfjsDist, "LICENSE"), join(out, "LICENSE"));
for (const [build, name] of [
  ["build", "pdf.renderer.js"],
  ["legacy/build", "pdf.renderer.legacy.js"],
] as const) {
  cpSync(join(pdfjsDist, build, "pdf.renderer.min.mjs"), join(out, name));
}

// The static export preserves the paths pdf.js expects. In a bundle the
// annotation layer looks up each comment icon by its original file name.
const shared: string[] = [];
const icons: string[] = [];
for (const name of readdirSync(join(pdfjsDist, "web/images")).sort()) {
  if (!/^annotation-.*\.svg$/.test(name)) continue;
  shared.push(`web/images/${name}`);
  icons.push(name);
}

const names = new Set<string>();
for (const { dir, files } of directories) {
  for (const name of readdirSync(join(pdfjsDist, dir)).sort()) {
    if (!files(name) && !isLicense(name)) continue;
    shared.push(`${dir}/${name}`);
    if (!files(name)) continue;
    // The worker's prelude finds a file by its name alone.
    if (names.has(name)) throw new Error(`Two files named ${name}`);
    names.add(name);
  }
}

// The scripting engine, QuickJS, which form scripts load on the page, and
// the module through which pdf.js's sandbox takes it from ParaPDF
// (src/pdfjs/scripting.ts): the sandbox imports QuickJS from a URL it
// builds itself, which the files bundlers emit under names of their own
// do not match.
for (const name of ["quickjs-eval.js", "quickjs-eval.wasm"]) {
  shared.push(`wasm/${name}`);
}
writeFileSync(join(out, "shared.json"), JSON.stringify(shared));
writeFileSync(
  join(out, "quickjs.js"),
  `// ParaPDF's: pdf.js's sandbox imports this module for QuickJS, which it
// starts from the URLs ParaPDF gives (src/pdfjs/scripting.ts).
export default async () => {
  const { quickjs, wasm } = globalThis[Symbol.for("parapdf.quickjs")];
  const { default: QuickJS } = await import(quickjs);
  return QuickJS({ locateFile: () => wasm });
};
`,
);

// Build the resource URLs from the exact dependency. A literal new URL for
// each one lets bundlers name and emit individual files.
const namesByKind = [
  ["fileUrls", [...names]],
  ["iconUrls", icons],
] as const;
const onDemand = new Map(shared.map((path) => [path.split("/").at(-1), path]));
const url = (path: string, query: string) =>
  `new URL("pdfjs-dist/${path}${query}", import.meta.url)`;
const body = namesByKind.map(([method, names]) => {
  const entries = names.map((name) => {
    const path = onDemand.get(name);
    if (!path) throw new Error(`Unknown asset: ${name}`);
    return `  "${name}": ${url(path, NO_INLINE)},`;
  });
  return `export const ${method} = () => ({\n${entries.join("\n")}\n});`;
});
body.push(`export const scriptingUrls = () => ({
  module: new URL("./quickjs.js?no-inline", import.meta.url),
  quickjs: ${url("wasm/quickjs-eval.js", "?no-inline")},
  wasm: ${url("wasm/quickjs-eval.wasm", NO_INLINE)},
});`);
writeFileSync(join(out, "urls.js"), `${body.join("\n")}\n`);
// Vite's optimizer rebases a dependency's bare resource URLs against its own
// module. Its dev server resolves the original source module correctly. A
// development-mode build still needs the bundled module (no HMR context).
writeFileSync(
  join(out, "dev-urls.js"),
  `// Load the manifest as a source module in the development server.
const url = new URL("./urls.js", import.meta.url);
export const { fileUrls, iconUrls, scriptingUrls } = import.meta.hot
  ? await import(/* @vite-ignore */ url.href)
  : await import("./urls.js");
`,
);
writeFileSync(
  join(out, "urls.d.ts"),
  `export function fileUrls(): Record<string, URL>;
export function iconUrls(): Record<string, URL>;
export function scriptingUrls(): { module: URL; quickjs: URL; wasm: URL };
`,
);
writeFileSync(
  join(here, "src/pdfjs/files.ts"),
  `// Generated by scripts/pdfjs-files.ts from pdfjs-dist ${version}; do not edit.

export { fileUrls, iconUrls, scriptingUrls } from "#parapdf-asset-urls";

/** The version of pdf.js the package ships. */
export const pdfjsVersion = "${version}";

/** pdf.js's worker script, after ParaPDF's prelude. */
export const pdfjsWorkerUrl = (): URL => new URL("../../pdfjs/pdf.worker.js", import.meta.url);

/** The optional drawing worker, from the package or its copy under assetBase. */
export const pdfjsRendererUrl = (assetBase?: string): URL =>
  assetBase !== undefined
    ? new URL("pdf.renderer.js", assetBase.endsWith("/") ? assetBase : \`\${assetBase}/\`)
    : new URL("../../pdfjs/pdf.renderer.js", import.meta.url);
`,
);

// The two icons of the annotation editor's toolbar, as data URLs in the
// viewer's editor styles: small enough that a file of their own, which the
// application would have to serve, costs more than it saves.
const editorIcon = (name: string) =>
  `data:image/svg+xml,${encodeURIComponent(
    readFileSync(join(pdfjsDist, "web/images", name), "utf8")
      .replace(/\s+/g, " ")
      .trim(),
  )}`;
writeFileSync(
  join(here, "src/react/editor-icons.ts"),
  `// Generated by scripts/pdfjs-files.ts from pdfjs-dist ${version}; do not edit.
// The icons are PDF.js's, Copyright Mozilla Foundation, Apache License 2.0,
// and changed for ParaPDF into data URLs; see NOTICE.md.

/** pdf.js's web/images/editor-toolbar-delete.svg. */
export const DELETE_ICON =
  "${editorIcon("editor-toolbar-delete.svg")}";

/** pdf.js's web/images/toolbarButton-menuArrow.svg. */
export const MENU_ARROW_ICON =
  "${editorIcon("toolbarButton-menuArrow.svg")}";
`,
);

// In a module of its own, so that only applications that import
// parapdf/legacy emit the legacy worker.
writeFileSync(
  join(here, "src/pdfjs/legacy-files.ts"),
  `// Generated by scripts/pdfjs-files.ts from pdfjs-dist ${version}; do not edit.

/** The legacy build's worker script, after ParaPDF's prelude (scripts/worker-prelude.js). */
export const pdfjsLegacyWorkerUrl = (assetBase?: string): URL =>
  assetBase !== undefined
    ? new URL("pdf.worker.legacy.js", assetBase.endsWith("/") ? assetBase : \`\${assetBase}/\`)
    : new URL("../../pdfjs/pdf.worker.legacy.js", import.meta.url);

/** The legacy build's optional drawing worker. */
export const pdfjsLegacyRendererUrl = (assetBase?: string): URL =>
  assetBase !== undefined
    ? new URL("pdf.renderer.legacy.js", assetBase.endsWith("/") ? assetBase : \`\${assetBase}/\`)
    : new URL("../../pdfjs/pdf.renderer.legacy.js", import.meta.url);
`,
);
