import { cpSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const exampleDir = fileURLToPath(new URL(".", import.meta.url));
const benchDir = join(exampleDir, "../../bench");
const publicDir = join(exampleDir, "public");
// Optional unreleased pdf.js master build (bench/scripts/build-pdfjs-next.sh).
const pdfjsNextDir = join(benchDir, "vendor/pdf.js/build/generic");
const hasPdfjsNext = existsSync(join(pdfjsNextDir, "build/pdf.renderer.mjs"));

const isolationHeaders = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
};

/** Stage pdf.js binary assets and the benchmark corpus as same-origin files. */
function stageStaticFiles(): Plugin {
  const stage = () => {
    const pdfjsDir = join(exampleDir, "node_modules/pdfjs-dist");
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

export default defineConfig(({ command }) => ({
  root: exampleDir,
  plugins: [react(), stageStaticFiles()],
  resolve: {
    alias: [
      {
        find: "pdfjs-next",
        replacement: hasPdfjsNext
          ? join(pdfjsNextDir, "build")
          : join(benchDir, "src/engines/pdfjs-next-stub"),
      },
      // Production builds use React's profiling renderer so <Profiler> can
      // count commits without the cost of a development build.
      ...(command === "build"
        ? [{ find: /^react-dom\/client$/, replacement: "react-dom/profiling" }]
        : []),
    ],
  },
  server: { headers: isolationHeaders },
  preview: { headers: isolationHeaders },
  worker: { format: "es" },
  build: {
    target: "es2023",
    outDir: "dist",
    emptyOutDir: true,
    assetsInlineLimit: 0,
    // calibrate.html measures the idle baseline for the scroll benchmark.
    rolldownOptions: {
      input: {
        main: join(exampleDir, "index.html"),
        calibrate: join(exampleDir, "calibrate.html"),
      },
    },
  },
}));
