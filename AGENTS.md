# AGENTS.md

This file is the canonical development context for coding agents.
`CLAUDE.md` only imports this file; update this file instead.

ParaPDF is a React PDF viewer built for maximum performance. "Para" carries two
meanings: flipping quickly through pages (Japanese "parapara") and parallel,
off-main-thread rendering.

## Status

Phase 0: engine comparison benchmark and runtime prototype. Nothing is
published and there is no public API yet. The repository stays local-only
until the benchmark results justify the architecture.

## Product principles

- React-first. The runtime is designed around React semantics: concurrent
  rendering, Suspense, transitions, Server Components, and the React Compiler.
  It is not a framework-agnostic core with thin adapters.
- React stays out of the hot path. Scrolling and zooming must not commit React
  state per frame; commits happen only when the mounted page window or the
  current page changes. Pixels reach canvases through refs, never through
  state.
- Rendering stays off the main thread wherever the engine allows it. The main
  thread composites bitmaps, maintains layout, and owns visible text layers.
- pdf.js is the first engine and is used through its core display API only
  (`getDocument`, `PDFPageProxy.render`, `TextLayer`, `AnnotationLayer`). Do not
  use or copy the viewer components from `pdfjs-dist/web/`. Do not fork or
  patch pdf.js; propose upstream changes instead. Algorithms ported from the
  pdf.js viewer require Apache-2.0 attribution in `NOTICE.md`.
- A narrow internal engine boundary (load, page metadata, region rendering,
  text, cancellation) keeps alternative engines measurable. Another engine
  replaces pdf.js only after the benchmark shows a reproducible win.
- Performance claims must be measured. Publish wins and losses together.

## Repository layout

- `bench/` — browser engine benchmark (`@parapdf/bench`, private).
  - `src/engines/` — one adapter per engine behind `EngineAdapter`.
  - `hayro-wasm/` — wasm-bindgen wrapper around hayro, used only by the
    benchmark.
  - `corpus/` — redistributable PDFs; sources and licenses are in its README.
  - `scripts/` — synthetic corpus generation and the Playwright runner.
  - `results/` — committed result summaries (`latest.md`, `latest.json`).
- `packages/` — future library packages (runtime and React bindings).

## Commands

- `pnpm install`
- `pnpm --filter @parapdf/bench corpus` — regenerate the synthetic stress PDFs.
- `bench/scripts/build-pdfjs-next.sh` — optional: build unreleased pdf.js
  master (renderer worker) into `bench/vendor/`; enables the `pdfjs-next`
  engines.
- `pnpm bench:build` — build the hayro wasm module and the benchmark harness.
- `pnpm bench` — run the engine benchmark; results go to `bench/results/`.
  `ENGINES`, `FILES`, `RUNS`, `PAGES`, and `SCALE` narrow a run.
- `pnpm check` — Biome lint and format check. `pnpm format` applies fixes.
- `pnpm typecheck` — TypeScript checks for every workspace package.

## Benchmark methodology

- Every job runs in a fresh, cross-origin-isolated Chromium page driven by
  Playwright. On macOS the runner passes `--use-angle=metal`; headless
  Chromium otherwise falls back to SwiftShader and GPU-backed canvases become
  meaningless.
- Engines: `pdfjs` (released pdfjs-dist, main-thread drawing), `pdfjs-next`
  (pdf.js master with its renderer worker), `pdfium` (the raw
  `@embedpdf/pdfium` API in a worker, without fallback fonts), and `hayro`
  (wasm-bindgen wrapper with simd128, embedded Standard 14 fonts and CMaps).
  `-hwa` variants set `enableHWA` for a GPU-backed canvas.
- Worker engines transfer an ImageBitmap and display it through a
  `bitmaprenderer` context, so no engine pays an extra main-thread copy.
- "Visible" is the time until pixels are committed to the canvas plus two
  animation frames, because GPU canvases may rasterize after the commit.
- "Main thread blocked" is the summed lateness of a 4 ms timer chain during the
  render phase: time the page could not respond to input or scrolling.
- Payload is the brotli size of each engine's own assets in `bench/dist/`; the
  `pdfjs-next` workers are unminified.
- Review fidelity in `bench/results/raw/contact.html` before trusting a speed
  win: an engine that skips content is fast for the wrong reason.
- Disk: the pdf.js master dev dependencies (~600 MB) are deleted after the
  build, and `bench/hayro-wasm/target/` holds ~270 MB of Rust artifacts.

## Conventions

- Write code, comments, documentation, and commit messages in English.
  Japanese is allowed in localized documentation and in CJK test data.
- Node 24+ runs TypeScript scripts directly through type stripping. Avoid
  TypeScript-only runtime syntax (enums, namespaces, parameter properties) in
  scripts and keep `erasableSyntaxOnly` enabled.
- Pin exact versions of every engine under test (`pdfjs-dist`,
  `@embedpdf/pdfium`, hayro) so results are reproducible, and record the
  versions in each result file.
- Corpus additions need a redistributable license, a documented source, and
  coverage that is not already represented. Generated stress documents are
  recreated by `bench/scripts/gen-synthetic.ts` and are never committed.
