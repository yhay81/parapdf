/**
 * How much of pdfjs-dist's `build/pdf.mjs` an application's bundler can
 * leave out, and what keeps it from doing so
 * (bench/upstream/pdfjs-tree-shaking-issue.md).
 *
 * Writes variants of pdf.mjs into dist/tree-shaking/, each with more of the
 * statements that keep the annotation editor in every bundle rewritten, and
 * bundles each, as an application's production build would, with three sets
 * of imports: `getDocument` alone, what ParaPDF's viewer uses without
 * annotation editing, and that with the editor's classes. Vite (bench's own)
 * always measures; webpack and esbuild do when the prototype's
 * devDependencies provide them. Writes results/pdfjs-tree-shaking.md.
 *
 * Usage: node bench/scripts/pdfjs-tree-shaking.ts
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { brotliCompressSync, gzipSync } from "node:zlib";
import { build } from "vite";

const benchDir = fileURLToPath(new URL("..", import.meta.url));
const outDir = join(benchDir, "dist/tree-shaking");
const require = createRequire(import.meta.url);
const pdfjsDir = dirname(require.resolve("pdfjs-dist/package.json"));
const pdfjsVersion: string = JSON.parse(
  readFileSync(join(pdfjsDir, "package.json"), "utf8"),
).version;
const viteVersion: string = JSON.parse(
  readFileSync(join(dirname(require.resolve("vite/package.json")), "package.json"), "utf8"),
).version;

function replace(source: string, from: RegExp, to: string): string {
  const out = source.replace(from, to);
  if (out === source) throw new Error(`pdf.mjs no longer matches ${from}`);
  return out;
}

/** Each change, by the letter that names it in a variant. */
const CHANGES: Record<string, (source: string) => string> = {
  // `globalThis.pdfjsLib = { …every export… }`, which web/pdfjs.js reads.
  G: (s) => replace(s, /globalThis\.pdfjsLib = \{[\s\S]*?\n\};\n/, ""),
  // AnnotationEditorLayer's `static #editorTypes = new Map([FreeTextEditor, …].map(…))`.
  L: (s) =>
    replace(
      s,
      /static #editorTypes = (new Map\(\[FreeTextEditor[^\n]*\);)/,
      "static #editorTypesMap = null;\n  static get #editorTypes() {\n    return this.#editorTypesMap ??= $1\n  }",
    ),
  // Each editor's `static _editorType = AnnotationEditorType.…`.
  E: (s) =>
    replace(
      s,
      /static _editorType = (AnnotationEditorType\.\w+);/g,
      "static get _editorType() {\n    return $1;\n  }",
    ),
  // AnnotationEditor's `static _colorManager = new ColorManager()` and
  // SignatureExtractor's `static #neighborIdToIndex = new Int32Array(…)`.
  P: (s) =>
    replace(
      replace(
        s,
        /static _colorManager = new ColorManager\(\);/,
        "static _colorManager = /* @__PURE__ */ new ColorManager();",
      ),
      /static #neighborIdToIndex = new Int32Array\(/,
      "static #neighborIdToIndex = /* @__PURE__ */ new Int32Array(",
    ),
  // AnnotationStorage's `instanceof AnnotationEditor`. The stand-in is for
  // measuring only: it tells editors apart by their `serialize` method.
  I: (s) =>
    replace(
      s,
      /^class AnnotationStorage \{/m,
      'const isEditorValue = v => typeof v?.serialize === "function";\nclass AnnotationStorage {',
    ).replace(/(\w+) instanceof AnnotationEditor\b/g, "isEditorValue($1)"),
  // `globalThis._pdfjsTestingUtils = { HighlightOutliner }`, which the
  // generic build keeps.
  T: (s) =>
    replace(
      s,
      /\{\n {2}globalThis\._pdfjsTestingUtils = \{\n {4}HighlightOutliner: HighlightOutliner\n {2}\};\n\}\n/,
      "",
    ),
};
// The changes in turn, then all of them but one.
const VARIANTS = [
  "dist",
  "G",
  "GL",
  "GLE",
  "GLEP",
  "GLEPI",
  "GLEPIT",
  "LEPIT",
  "GEPIT",
  "GLPIT",
  "GLEIT",
  "GLEPT",
];

const VIEWER = [
  "getDocument",
  "GlobalWorkerOptions",
  "PDFWorker",
  "PDFDataRangeTransport",
  "PasswordException",
  "PasswordResponses",
  "PixelsPerInch",
  "PermissionFlag",
  "TextLayer",
  "AnnotationLayer",
  "AnnotationMode",
  "AnnotationType",
];
const IMPORTS: Record<string, string[]> = {
  getDocument: ["getDocument", "GlobalWorkerOptions"],
  viewer: VIEWER,
  "viewer + editor": [...VIEWER, "AnnotationEditorLayer", "AnnotationEditorUIManager", "DrawLayer"],
};

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
const dist = readFileSync(join(pdfjsDir, "build/pdf.mjs"), "utf8");
for (const variant of VARIANTS) {
  let source = dist;
  for (const change of variant === "dist" ? "" : variant) {
    const apply = CHANGES[change];
    if (!apply) throw new Error(`unknown change ${change}`);
    source = apply(source);
  }
  writeFileSync(join(outDir, `pdf-${variant}.mjs`), source);
}
const entries: { variant: string; imports: string; file: string }[] = [];
for (const variant of VARIANTS) {
  for (const [imports, names] of Object.entries(IMPORTS)) {
    const file = join(outDir, `entry-${variant}-${imports.replaceAll(" ", "")}.js`);
    writeFileSync(
      file,
      `import { ${names.join(", ")} } from "./pdf-${variant}.mjs";\nglobalThis.used = [${names.join(", ")}];\n`,
    );
    entries.push({ variant, imports, file });
  }
}

type Bundler = { name: string; bundle: (entry: string) => Promise<string> };
const bundlers: Bundler[] = [
  {
    name: `Vite ${viteVersion}`,
    async bundle(entry) {
      let code = "";
      await build({
        configFile: false,
        logLevel: "silent",
        build: { write: false, rollupOptions: { input: entry } },
        plugins: [
          {
            name: "collect",
            generateBundle(_options, bundle) {
              for (const chunk of Object.values(bundle))
                if (chunk.type === "chunk") code += chunk.code;
            },
          },
        ],
      });
      return code;
    },
  },
];
// The prototype pins webpack for check:bundlers; esbuild comes with it.
const prototypeRequire = createRequire(join(benchDir, "../examples/prototype/package.json"));
try {
  const webpackDir = dirname(prototypeRequire.resolve("webpack/package.json"));
  const webpack = prototypeRequire("webpack");
  const webpackRequire = createRequire(join(webpackDir, "package.json"));
  const out = join(outDir, "webpack");
  bundlers.push({
    name: `webpack ${webpack.version}`,
    bundle: (entry) =>
      new Promise((resolve, reject) =>
        webpack(
          {
            mode: "production",
            entry,
            devtool: false,
            output: { path: out, filename: "out.js" },
          },
          (error: Error | null, stats: { hasErrors(): boolean; toString(): string }) => {
            if (error || stats.hasErrors()) reject(error ?? new Error(stats.toString()));
            else resolve(readFileSync(join(out, "out.js"), "utf8"));
          },
        ),
      ),
  });
  const esbuild = webpackRequire("esbuild");
  bundlers.push({
    name: `esbuild ${esbuild.version}`,
    async bundle(entry) {
      const result = await esbuild.build({
        entryPoints: [entry],
        bundle: true,
        minify: true,
        format: "esm",
        write: false,
        logLevel: "silent",
      });
      return result.outputFiles[0].text;
    },
  });
} catch (error) {
  console.warn(`webpack and esbuild skipped: ${(error as Error).message}`);
}

const kb = (bytes: number) => (bytes / 1024).toFixed(1);
const lines = [
  "# pdf.js's display bundle, tree-shaken",
  "",
  `pdfjs-dist ${pdfjsVersion}, \`node bench/scripts/pdfjs-tree-shaking.ts\`, ${new Date().toISOString().slice(0, 10)}.`,
  "Sizes in KiB of the minified output, then gzip (level 9) and brotli.",
  "Variants: G, L, E, P, I, T as in bench/upstream/pdfjs-tree-shaking-issue.md.",
];
for (const bundler of bundlers) {
  lines.push(
    "",
    `## ${bundler.name}`,
    "",
    "| pdf.mjs | imports | minified | gzip | brotli |",
    "|---|---|---|---|---|",
  );
  for (const { variant, imports, file } of entries) {
    const code = await bundler.bundle(file);
    const row = `| ${variant} | ${imports} | ${kb(code.length)} | ${kb(gzipSync(code, { level: 9 }).length)} | ${kb(brotliCompressSync(code).length)} |`;
    lines.push(row);
    console.log(`${bundler.name} ${row}`);
  }
}
writeFileSync(join(benchDir, "results/pdfjs-tree-shaking.md"), `${lines.join("\n")}\n`);
