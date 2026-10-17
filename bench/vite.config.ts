import { cpSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";

const benchDir = fileURLToPath(new URL(".", import.meta.url));
const publicDir = join(benchDir, "public");
// Optional unreleased pdf.js master build (scripts/build-pdfjs-next.sh).
const pdfjsNextDir = join(benchDir, "vendor/pdf.js/build/generic");
const hasPdfjsNext = existsSync(join(pdfjsNextDir, "build/pdf.renderer.mjs"));

// Cross-origin isolation enables precise timers, SharedArrayBuffer, and
// performance.measureUserAgentSpecificMemory for every engine equally.
const isolationHeaders = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
};

/** Stage pdf.js binary assets and the corpus as same-origin static files. */
function stageStaticFiles(): Plugin {
  const stage = () => {
    const pdfjsDir = join(benchDir, "node_modules/pdfjs-dist");
    for (const dir of ["cmaps", "standard_fonts", "wasm", "iccs"]) {
      cpSync(join(pdfjsDir, dir), join(publicDir, "pdfjs", dir), { recursive: true });
      if (hasPdfjsNext) {
        cpSync(join(pdfjsNextDir, "web", dir), join(publicDir, "pdfjs-next", dir), {
          recursive: true,
        });
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

export default defineConfig({
  root: benchDir,
  plugins: [stageStaticFiles()],
  resolve: {
    alias: {
      "pdfjs-next": hasPdfjsNext
        ? join(pdfjsNextDir, "build")
        : join(benchDir, "src/engines/pdfjs-next-stub"),
    },
  },
  server: { headers: isolationHeaders },
  preview: { headers: isolationHeaders },
  worker: { format: "es" },
  optimizeDeps: { exclude: ["@embedpdf/pdfium"] },
  build: {
    target: "es2023",
    outDir: "dist",
    emptyOutDir: true,
    assetsInlineLimit: 0,
  },
});
