import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { crossOriginIsolation } from "../../bench/scripts/isolation.ts";
import { benchmarkFiles } from "../../bench/scripts/static-files.ts";

const exampleDir = fileURLToPath(new URL(".", import.meta.url));
const benchDir = join(exampleDir, "../../bench");
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

export default defineConfig(({ command }) => ({
  root: exampleDir,
  plugins: [
    react(),
    benchmarkFiles(exampleDir, {
      "react-pdf": { directory: reactPdfPdfjsDir },
      "pdfjs-next": hasPdfjsNext
        ? { directory: join(pdfjsNextDir, "web"), annotationIcons: true }
        : null,
    }),
    crossOriginIsolation(),
  ],
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
  // The comparison page imports a URL to its pdf.js worker. Keep Vite's URL transform in dev.
  optimizeDeps: { exclude: ["react-pdf-worker?url"] },
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
