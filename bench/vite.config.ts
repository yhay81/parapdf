import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { crossOriginIsolation } from "./scripts/isolation.ts";
import { benchmarkFiles } from "./scripts/static-files.ts";

const benchDir = fileURLToPath(new URL(".", import.meta.url));
// Optional unreleased pdf.js master build (scripts/build-pdfjs-next.sh).
const pdfjsNextDir = join(benchDir, "vendor/pdf.js/build/generic");
const hasPdfjsNext = existsSync(join(pdfjsNextDir, "build/pdf.renderer.mjs"));

export default defineConfig({
  root: benchDir,
  plugins: [
    benchmarkFiles(benchDir, {
      pdfjs: { directory: join(benchDir, "node_modules/pdfjs-dist") },
      "pdfjs-next": hasPdfjsNext ? { directory: join(pdfjsNextDir, "web") } : null,
    }),
    crossOriginIsolation(),
  ],
  resolve: {
    alias: {
      "pdfjs-next": hasPdfjsNext
        ? join(pdfjsNextDir, "build")
        : join(benchDir, "src/engines/pdfjs-next-stub"),
    },
  },
  worker: { format: "es" },
  optimizeDeps: { exclude: ["@embedpdf/pdfium"] },
  build: {
    target: "es2023",
    outDir: "dist",
    emptyOutDir: true,
    assetsInlineLimit: 0,
  },
});
