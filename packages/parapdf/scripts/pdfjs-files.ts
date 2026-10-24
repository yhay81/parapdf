/**
 * Copies pdf.js's worker and the files it loads on demand from pdfjs-dist
 * into this package's `pdfjs/` directory, and writes
 * `src/pdfjs/files.ts`, which references each of them with
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
  // WebAssembly and the scripting engine stay out.
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

// The icons of comments without an appearance of their own. A copy of
// pdfjs/ served with configurePdfjs({ assetBase }) has them where pdf.js's
// annotation layer looks, under one base URL; with the files bundlers emit,
// which each get a URL of their own, the annotation layer points the icons
// at them (src/pdfjs/annotation-layer.ts).
const icons: string[] = [];
mkdirSync(join(out, "web/images"), { recursive: true });
for (const name of readdirSync(join(pdfjsDist, "web/images")).sort()) {
  if (!/^annotation-.*\.svg$/.test(name)) continue;
  cpSync(join(pdfjsDist, "web/images", name), join(out, "web/images", name));
  icons.push(urlEntry(name, `web/images/${name}`));
}

const entries: string[] = [];
const names = new Set<string>();
for (const { dir, files } of directories) {
  mkdirSync(join(out, dir));
  for (const name of readdirSync(join(pdfjsDist, dir)).sort()) {
    if (!files(name) && !isLicense(name)) continue;
    cpSync(join(pdfjsDist, dir, name), join(out, dir, name));
    if (!files(name)) continue;
    // The worker's prelude finds a file by its name alone.
    if (names.has(name)) throw new Error(`Two files named ${name}`);
    names.add(name);
    entries.push(urlEntry(name, `${dir}/${name}`));
  }
}

/** `new URL()` for `path` under pdfjs/, wrapped as Biome formats it after `prefix`. */
function urlExpression(path: string, indent: string, prefix: string, suffix: string): string {
  const call = `new URL("../../pdfjs/${path}", import.meta.url)`;
  return `${indent}${prefix}${call}${suffix}`.length <= 100
    ? call
    : `new URL(\n${indent}  "../../pdfjs/${path}",\n${indent}  import.meta.url,\n${indent})`;
}

function urlEntry(name: string, path: string): string {
  return `  "${name}": ${urlExpression(`${path}${NO_INLINE}`, "  ", `"${name}": `, ",")},`;
}

const module = `// Generated by scripts/pdfjs-files.ts from pdfjs-dist ${version}; do not edit.

/*
 * pdf.js's worker and the files it loads on demand, copied into this package
 * by scripts/pdfjs-files.ts. Each is referenced with \`new URL(…,
 * import.meta.url)\`, so bundlers emit it with the application's assets and
 * give back its final URL; the query \`${NO_INLINE}\` keeps them from inlining
 * the small ones as data: URLs. The functions keep the URLs from being
 * resolved before they are needed, as on the server.
 */

/** The version of pdf.js the package ships. */
export const pdfjsVersion = "${version}";

/** pdf.js's worker script, after ParaPDF's prelude (scripts/worker-prelude.js). */
export const pdfjsWorkerUrl = (): URL => ${urlExpression("pdf.worker.js", "", "export const pdfjsWorkerUrl = (): URL => ", ";")};

/**
 * The files pdf.js's worker loads on demand, by name: CMaps, standard fonts,
 * image decoders, and the ICC profile.
 */
export const fileUrls = (): Record<string, URL> => ({
${entries.join("\n")}
});

/** pdf.js's annotation icons, by file name, for comments without an appearance of their own. */
export const iconUrls = (): Record<string, URL> => ({
${icons.join("\n")}
});
`;
writeFileSync(join(here, "src/pdfjs/files.ts"), module);

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
export const pdfjsLegacyWorkerUrl = (): URL =>
  new URL("../../pdfjs/pdf.worker.legacy.js", import.meta.url);
`,
);
