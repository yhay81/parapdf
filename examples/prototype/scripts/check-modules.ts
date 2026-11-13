/**
 * Features are modules that only applications using them pay for.
 * Builds the demo with source maps and Vite's manifest, and reads which of
 * the package's modules each entry loads: the code of its own chunk and of
 * the chunks it imports statically, which the browser loads with it. The
 * minimal demo (minimal.html), which uses neither search, forms,
 * annotation editing, print, nor autoLinks, must load none of their modules —
 * and when built as an application of its own, must emit none of their
 * chunks on disk at all. The full demo (index.html) loads search and print
 * with it, and `<PdfForms>`, `<PdfAnnotationEditor>`, and `<PdfAutoLinks>`
 * from lazy chunks of their own.
 *
 * Usage: pnpm --filter @parapdf/prototype check:modules
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";

const exampleDir = fileURLToPath(new URL("..", import.meta.url));
let failures = 0;

function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

interface Chunk {
  file: string;
  imports?: string[];
  dynamicImports?: string[];
}

/** The package's modules, by the feature they are part of. */
const FEATURES: Record<string, RegExp> = {
  search: /packages\/parapdf\/src\/features\/search\//,
  forms: /packages\/parapdf\/src\/features\/forms\//,
  annotations: /packages\/parapdf\/src\/(features\/annotations\.ts|pdfjs\/editor(-labels)?\.ts)$/,
  print: /packages\/parapdf\/src\/features\/print\//,
  autoLinks: /packages\/parapdf\/src\/features\/auto-links\.ts$/,
};

function readManifest(dir: string) {
  const manifest = JSON.parse(readFileSync(join(dir, ".vite/manifest.json"), "utf8")) as Record<
    string,
    Chunk
  >;
  /** The chunks `entry` loads with it: its own and those it imports statically. */
  const loaded = (entry: string): Set<string> => {
    const chunks = new Set<string>();
    const visit = (key: string) => {
      if (chunks.has(key)) return;
      chunks.add(key);
      for (const imported of manifest[key]?.imports ?? []) visit(imported);
    };
    visit(entry);
    return chunks;
  };
  /** The source modules of `chunks`, read from their source maps. */
  const modules = (chunks: Iterable<string>): string[] =>
    [...chunks].flatMap((key) => {
      const file = manifest[key]?.file;
      // Vite's own helpers, such as its preload polyfill, come without a map.
      if (!file?.endsWith(".js") || !existsSync(join(dir, `${file}.map`))) return [];
      const map = JSON.parse(readFileSync(join(dir, `${file}.map`), "utf8")) as {
        sources: string[];
      };
      return map.sources;
    });
  const featuresIn = (sources: readonly string[]): string[] =>
    Object.entries(FEATURES)
      .filter(([, pattern]) => sources.some((source) => pattern.test(source)))
      .map(([name]) => name);
  return { manifest, loaded, modules, featuresIn };
}

const outDir = mkdtempSync(join(tmpdir(), "parapdf-modules-"));
const minimalOutDir = mkdtempSync(join(tmpdir(), "parapdf-minimal-modules-"));
try {
  await build({
    configFile: join(exampleDir, "vite.config.ts"),
    logLevel: "warn",
    build: { outDir, emptyOutDir: true, sourcemap: true, manifest: true },
  });
  const { manifest, loaded, modules, featuresIn } = readManifest(outDir);

  const minimal = featuresIn(modules(loaded("minimal.html")));
  check(
    "the minimal demo loads no search, forms, annotation editing, print, or autoLinks",
    minimal.length === 0,
    minimal.join(", "),
  );
  const fullModules = modules(loaded("index.html"));
  const full = featuresIn(fullModules);
  // The demo hands `getFormFields` and `setFormValues` to the checks; `<PdfForms>`
  // loads `features/forms/layers.ts` in its own chunk.
  const formLayers = fullModules.some((source) => source.endsWith("features/forms/layers.ts"));
  check(
    "the full demo loads search and print with it, and neither form layers, editing, nor autoLinks",
    full.includes("search") &&
      full.includes("print") &&
      !full.includes("annotations") &&
      !full.includes("autoLinks") &&
      !formLayers,
    `${full.join(", ")}${formLayers ? ", form layers" : ""}`,
  );
  const lazy = Object.entries(manifest)
    .filter(([key]) => !loaded("index.html").has(key) && !loaded("minimal.html").has(key))
    .flatMap(([key]) => featuresIn(modules([key])));
  check(
    "forms, annotation editing, and autoLinks come in chunks of their own",
    lazy.includes("forms") && lazy.includes("annotations") && lazy.includes("autoLinks"),
    lazy.join(", "),
  );

  // Built as an application of its own, minimal.html must statically tree-shake
  // every unused feature with zero dead feature chunks emitted on disk.
  await build({
    configFile: join(exampleDir, "vite.config.ts"),
    logLevel: "warn",
    build: {
      outDir: minimalOutDir,
      emptyOutDir: true,
      sourcemap: true,
      manifest: true,
      rolldownOptions: { input: join(exampleDir, "minimal.html") },
    },
  });
  const standalone = readManifest(minimalOutDir);
  const standaloneFeatures = standalone.featuresIn(
    standalone.modules(Object.keys(standalone.manifest)),
  );
  check(
    "a standalone minimal build emits zero chunks for search, forms, annotation editing, print, or autoLinks",
    standaloneFeatures.length === 0,
    standaloneFeatures.join(", "),
  );
} finally {
  rmSync(outDir, { recursive: true, force: true });
  rmSync(minimalOutDir, { recursive: true, force: true });
}

if (failures > 0) {
  console.error(`${failures} check(s) failed`);
  process.exit(1);
}
console.log("All module checks passed");
