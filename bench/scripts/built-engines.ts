import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * A built pdf.js master has a parsing worker and a separate renderer. When
 * master is absent, Vite emits the two identical placeholder files only once.
 * Inspect the selected build, which can come from another checkout.
 */
export function hasBuiltPdfjsNext(distDir: string): boolean {
  const assets = readdirSync(join(distDir, "assets"));
  return (
    assets.some((file) => file.startsWith("pdf.worker-")) &&
    assets.some((file) => file.startsWith("pdf.renderer-"))
  );
}

/** Vite embeds the installed versions in the worker engine adapters. */
export function embeddedEngineVersions(benchDir: string): Record<string, string> {
  return {
    PDFIUM_VERSION: JSON.stringify(
      JSON.parse(readFileSync(join(benchDir, "node_modules/@embedpdf/pdfium/package.json"), "utf8"))
        .version,
    ),
    HAYRO_VERSION: JSON.stringify(
      /name = "hayro"\nversion = "([^"]+)"/.exec(
        readFileSync(join(benchDir, "hayro-wasm/Cargo.lock"), "utf8"),
      )?.[1] ?? "unknown",
    ),
  };
}
