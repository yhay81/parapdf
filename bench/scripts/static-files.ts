import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";

const corpus = fileURLToPath(new URL("../corpus/", import.meta.url));

interface PdfjsAssets {
  directory: string;
  annotationIcons?: boolean;
}

/** Serve the current corpus and pdf.js files in development and copy them into each build. */
export function benchmarkFiles(root: string, engines: Record<string, PdfjsAssets | null>): Plugin {
  function stage(output: string): void {
    for (const [name, assets] of Object.entries(engines)) {
      if (!assets) continue;
      const dirs = ["cmaps", "standard_fonts", "wasm", "iccs"];
      if (assets.annotationIcons) dirs.push("images");
      for (const dir of dirs) {
        const target = dir === "images" ? "web/images" : dir;
        cpSync(join(assets.directory, dir), join(output, name, target), { recursive: true });
      }
    }
    const destination = join(output, "corpus");
    mkdirSync(destination, { recursive: true });
    for (const directory of [corpus, join(corpus, "generated")]) {
      if (!existsSync(directory)) continue;
      for (const file of readdirSync(directory)) {
        if (file.endsWith(".pdf")) cpSync(join(directory, file), join(destination, file));
      }
    }
  }

  return {
    name: "parapdf-benchmark-files",
    config(_config, { command, isPreview }) {
      // A build writes straight to its own output. Preview only serves that output.
      if (command === "build") return { publicDir: false };
      if (isPreview) return;

      const publicDir = join(root, "public");
      for (const name of ["corpus", ...Object.keys(engines)]) {
        rmSync(join(publicDir, name), { recursive: true, force: true });
      }
      stage(publicDir);
    },
    writeBundle({ dir }) {
      if (dir) stage(dir);
    },
  };
}
