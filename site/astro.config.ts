import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@astrojs/react";
import starlight from "@astrojs/starlight";
import type { AstroIntegration } from "astro";
import { defineConfig } from "astro/config";
import { samples } from "./src/samples.ts";

const siteDir = fileURLToPath(new URL(".", import.meta.url));
const corpusDir = join(siteDir, "../bench/corpus");

/**
 * Copies the sample PDFs from the benchmark corpus into public/samples/, so
 * the demo and the examples open them from the site's own origin.
 */
function stageSamples(): AstroIntegration {
  return {
    name: "parapdf-stage-samples",
    hooks: {
      "astro:config:setup": () => {
        const out = join(siteDir, "public/samples");
        mkdirSync(out, { recursive: true });
        for (const { file, generated } of samples) {
          const source = join(corpusDir, generated ? "generated" : "", file);
          if (!existsSync(source)) {
            throw new Error(`${source} is missing: run pnpm --filter @parapdf/bench corpus`);
          }
          copyFileSync(source, join(out, file));
        }
      },
    },
  };
}

export default defineConfig({
  site: "https://parapdf.yhay81.com",
  integrations: [
    stageSamples(),
    starlight({
      title: "ParaPDF",
      description: "A fast PDF viewer for React, built on pdf.js.",
      favicon: "/favicon.svg",
      social: [{ icon: "github", label: "GitHub", href: "https://github.com/yhay81/parapdf" }],
      editLink: { baseUrl: "https://github.com/yhay81/parapdf/edit/main/site/" },
      customCss: ["./src/styles/docs.css"],
      sidebar: [
        {
          label: "Start here",
          items: ["getting-started", { label: "Live demo", link: "/demo/" }, "guides/controls"],
        },
        {
          label: "Guides",
          items: [
            "guides/layout",
            "guides/search",
            "guides/navigation",
            "guides/view-state",
            "guides/thumbnails",
            "guides/text",
            "guides/forms",
            "guides/annotations",
            "guides/encrypted",
            "guides/permissions",
            "guides/layers-attachments",
          ],
        },
        {
          label: "Setup",
          items: ["setup/bundlers", "setup/pdfjs", "setup/server-rendering"],
        },
        {
          label: "Reference",
          items: [
            "reference/components",
            "reference/options",
            "reference/state",
            "reference/viewer",
            "reference/sources",
          ],
        },
        {
          label: "About",
          items: [
            "about/how-it-works",
            "about/performance",
            "about/accessibility",
            "about/limitations",
            {
              label: "Changelog",
              link: "https://github.com/yhay81/parapdf/blob/main/CHANGELOG.md",
            },
          ],
        },
      ],
    }),
    react(),
  ],
  vite: {
    build: {
      // Vite inlines files under 4 KB as data: URLs, which put 134 of
      // pdf.js's CMaps, 94 KB with gzip, into the chunk every viewer loads.
      // Served as files, the worker fetches one only when a PDF needs it.
      assetsInlineLimit: (file) => (/[\\/]parapdf[\\/]pdfjs[\\/]/.test(file) ? false : undefined),
    },
  },
});
