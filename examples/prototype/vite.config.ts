import { cpSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { crossOriginIsolation } from "../../bench/scripts/isolation.ts";

const exampleDir = fileURLToPath(new URL(".", import.meta.url));
const benchDir = join(exampleDir, "../../bench");
const publicDir = join(exampleDir, "public");
// Optional unreleased pdf.js master build (bench/scripts/build-pdfjs-next.sh).
const pdfjsNextDir = join(benchDir, "vendor/pdf.js/build/generic");
const hasPdfjsNext = existsSync(join(pdfjsNextDir, "build/pdf.renderer.mjs"));
// The pdf.js react-pdf depends on, for compare.html: its worker and the files
// it loads on demand, which must match its version.
const reactPdfPdfjsDir = dirname(
  createRequire(createRequire(import.meta.url).resolve("react-pdf")).resolve(
    "pdfjs-dist/package.json",
  ),
);

/**
 * Stage the benchmark corpus, and pdf.js master's binary assets, as
 * same-origin files, and those of the pdf.js react-pdf depends on for
 * compare.html. The released pdf.js's come with ParaPDF.
 */
function stageStaticFiles(): Plugin {
  const stage = () => {
    for (const dir of ["cmaps", "standard_fonts", "wasm", "iccs", "web/images"]) {
      const reactPdfSource = join(reactPdfPdfjsDir, dir);
      if (dir !== "web/images" && existsSync(reactPdfSource)) {
        cpSync(reactPdfSource, join(publicDir, "react-pdf", dir), { recursive: true });
      }
      if (hasPdfjsNext) {
        // The generic build keeps its assets, the annotation icons included, under web/.
        const source =
          dir === "web/images" ? join(pdfjsNextDir, dir) : join(pdfjsNextDir, "web", dir);
        if (existsSync(source)) {
          cpSync(source, join(publicDir, "pdfjs-next", dir), { recursive: true });
        }
      }
    }
    const corpusOut = join(publicDir, "corpus");
    mkdirSync(corpusOut, { recursive: true });
    for (const dir of ["corpus", "corpus/generated"]) {
      const source = join(benchDir, dir);
      if (!existsSync(source)) continue;
      for (const name of readdirSync(source)) {
        if (name.endsWith(".pdf")) cpSync(join(source, name), join(corpusOut, name));
      }
    }
  };
  return { name: "parapdf-stage-static-files", config: stage };
}

export default defineConfig(({ command }) => ({
  root: exampleDir,
  plugins: [react(), stageStaticFiles(), crossOriginIsolation()],
  resolve: {
    alias: [
      {
        find: "pdfjs-next",
        replacement: hasPdfjsNext
          ? join(pdfjsNextDir, "build")
          : join(benchDir, "src/engines/pdfjs-next-stub"),
      },
      {
        find: /^react-pdf-worker(?=\?|$)/,
        replacement: join(reactPdfPdfjsDir, "build/pdf.worker.min.mjs"),
      },
      // Production builds use React's profiling renderer so <Profiler> can
      // count commits without the cost of a development build.
      ...(command === "build"
        ? [{ find: /^react-dom\/client$/, replacement: "react-dom/profiling" }]
        : []),
    ],
  },
  worker: { format: "es" },
  build: {
    target: "es2023",
    outDir: "dist",
    emptyOutDir: true,
    assetsInlineLimit: 0,
    // calibrate.html measures the idle baseline for the scroll benchmark;
    // minimal.html is the demo without search, forms, annotations, and print;
    // compare.html shows a document with react-pdf for the scroll benchmark.
    rolldownOptions: {
      input: {
        main: join(exampleDir, "index.html"),
        calibrate: join(exampleDir, "calibrate.html"),
        minimal: join(exampleDir, "minimal.html"),
        compare: join(exampleDir, "compare.html"),
      },
    },
  },
}));
