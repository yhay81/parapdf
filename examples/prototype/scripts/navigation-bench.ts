/**
 * Compare opening a 1,000-item thumbnail list at page 501, including geometry
 * correction and outline controls, without PDF drawing. Fresh contexts, DPR 2,
 * two animation frames from React mount; each after/before pair runs in turn.
 * Build each revision with BUILD_ONLY=1 DIST=<dir> node scripts/navigation-bench.ts
 * (copy this script and navigation-controls.tsx to the baseline first).
 * Then BROWSER=chromium DIST=<after> BEFORE=<before> RUNS=5 node scripts/navigation-bench.ts.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { arch, cpus, platform, release } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build, preview } from "vite";
import {
  assertMeasurementPower,
  launchBrowser,
  measureInTurn,
  restoreScaleFactor,
  turnTaking,
} from "../../../bench/scripts/browsers.ts";
import type { checkNavigationControls } from "./navigation-controls.tsx";

const exampleDir = fileURLToPath(new URL("..", import.meta.url));
const configFile = join(exampleDir, "vite.config.ts");
const dist = resolve(process.env.DIST ?? join(exampleDir, ".navigation-bench"));
const entry = join(exampleDir, "navigation-bench.html");

if (process.env.BUILD_ONLY === "1") {
  writeFileSync(
    entry,
    `<html><head><title>Navigation controls</title></head><body><script type="module">
    import { checkNavigationControls } from "/scripts/navigation-controls.tsx";
    window.checkNavigationControls = checkNavigationControls;
    </script></body></html>`,
    { flag: "wx" },
  );
  try {
    await build({
      configFile,
      build: { outDir: dist, rolldownOptions: { input: { navigation: entry } } },
    });
  } finally {
    rmSync(entry);
  }
} else {
  if (!process.env.BEFORE) throw new Error("BEFORE must identify the baseline navigation build");
  const power = assertMeasurementPower();
  const servers = [];
  const launched = await launchBrowser();
  type Result = Awaited<ReturnType<typeof checkNavigationControls>>;
  const jobs: { run: number; variant: string; result: Result }[] = [];
  try {
    for (const [i, directory] of [dist, resolve(process.env.BEFORE)].entries()) {
      servers.push(
        await preview({
          configFile,
          build: { outDir: directory },
          preview: { host: "127.0.0.1", port: 4186 + i, strictPort: true, open: false },
        }),
      );
    }
    for (let run = 1; run <= Number(process.env.RUNS ?? 5); run++) {
      for (const [i, server] of servers.entries()) {
        const result = await measureInTurn(launched, async (browser) => {
          const context = await browser.newContext({
            viewport: { width: 1280, height: 900 },
            deviceScaleFactor: 2,
          });
          try {
            const page = await context.newPage();
            const base = server.resolvedUrls?.local[0];
            if (!base) throw new Error("No preview URL");
            await restoreScaleFactor(page, new URL("calibrate.html", base).href);
            await page.goto(new URL("navigation-bench.html", base).href);
            await page.waitForFunction(() => "checkNavigationControls" in window);
            if ((await page.evaluate(() => window.devicePixelRatio)) !== 2)
              throw new Error("Wrong devicePixelRatio");
            return await page.evaluate(() =>
              (
                window as unknown as { checkNavigationControls: typeof checkNavigationControls }
              ).checkNavigationControls(),
            );
          } finally {
            await context.close();
          }
        });
        const variant = i === 0 ? "after" : "before";
        if (
          i === 0 &&
          !(result.opened && result.rotated && result.resized && result.browsed && result.expanded)
        ) {
          throw new Error(`Navigation fidelity failed: ${JSON.stringify(result)}`);
        }
        jobs.push({ run, variant, result });
        console.log(
          `${variant} ${run}: ${result.openedMs.toFixed(1)} ms, active visible ${result.opened}, ${result.mountedItems} items`,
        );
      }
    }
    const resultsDir = join(exampleDir, "results");
    mkdirSync(resultsDir, { recursive: true });
    const pkg = JSON.parse(
      readFileSync(join(exampleDir, "../../packages/parapdf/package.json"), "utf8"),
    );
    const report = {
      date: new Date().toISOString(),
      browser: launched.label,
      machine: `${platform()} ${release()} ${arch()}, ${cpus()[0]?.model}`,
      power,
      versions: { pdfjs: pkg.dependencies["pdfjs-dist"], react: pkg.devDependencies.react },
      turnTaking,
      jobs,
    };
    writeFileSync(
      join(resultsDir, `navigation-review-${launched.name}.json`),
      `${JSON.stringify(report, null, 2)}\n`,
    );
  } finally {
    await launched.close();
    for (const server of servers) await server.close();
  }
}
