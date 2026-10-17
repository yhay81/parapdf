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
- `packages/parapdf/` — the runtime prototype: engine boundary (`engine/`),
  layout, scheduler, and viewer runtime (`runtime/`), and React bindings
  (`react/`). Consumed as TypeScript source through the workspace.
- `examples/prototype/` — Vite + React 19 demo and the scripted scroll
  benchmark (`scripts/scroll-bench.ts`, results in `results/`).

## Commands

- `pnpm install`
- `pnpm --filter @parapdf/bench corpus` — regenerate the synthetic stress PDFs.
- `bench/scripts/build-pdfjs-next.sh` — optional: build unreleased pdf.js
  master (renderer worker) into `bench/vendor/`; enables the `pdfjs-next`
  engines.
- `pnpm bench:build` — build the hayro wasm module and the benchmark harness.
- `pnpm bench` — run the engine benchmark; results go to `bench/results/`.
  `ENGINES`, `FILES`, `RUNS`, `PAGES`, and `SCALE` narrow a run.
- `pnpm --filter @parapdf/prototype dev` — run the demo; query parameters
  select `engine` (`pdfjs` or `pdfjs-next`), `hwa`, `text`, `file`, and
  `preload`.
- `pnpm --filter @parapdf/prototype build && pnpm --filter @parapdf/prototype bench`
  — scripted scroll benchmark; `VARIANTS`, `TEXT`, `FILES`, `SPEEDS`, `RUNS`,
  `DURATION`, `PRELOAD`, and `OUTPUT` narrow or rename a run.
- `pnpm --filter @parapdf/prototype check:text` — functional checks for text
  selection, search highlights, normalization, and accessibility semantics
  (run after `build`).
- `pnpm check` — Biome lint and format check. `pnpm format` applies fixes.
- `pnpm typecheck` — TypeScript checks for every workspace package.

## Runtime prototype

- `PdfViewerRuntime` owns scrolling, layout, zoom, and the render scheduler.
  It publishes only `status`, `layout`, the mounted window (`first`/`last`),
  `currentPage`, and `scale` through a small store read with
  `useSyncExternalStore`; scrolling recomputes every frame but publishes only
  changes.
- Layouts are immutable per zoom level. The runtime sizes the content element
  imperatively so zoom can restore the anchored scroll position before React
  re-renders the mounted pages. Ctrl or pinch wheel gestures preview with a CSS
  transform and commit 150 ms after the last event.
- Each mounted page stacks a base canvas (half a device pixel per CSS pixel)
  under a detail canvas (full device resolution, capped at 16 MP until region
  rendering exists). Priority: visible base, visible detail once scrolling
  settles (120 ms quiet or below 2 px/ms), overscan base, overscan detail, then
  stale base. Unmounted pages zero their canvases and release pdf.js page data.
- The pdf.js adapter starts its parsing worker when the engine is created, and
  the demo preloads the PDF with React's `preload()`, matching the CORS mode
  pdf.js fetches with.
- Text layers use pdf.js's core `TextLayer` inside `.parapdf-text-layer`, styled
  by rules derived from pdf.js's viewer CSS (attributed in `NOTICE.md`). Pages
  set `--total-scale-factor` and `--scale-round-x/y`, which `TextLayer` sizes
  against. The scheduler builds one text layer at a time, only after scrolling
  settles, during idle periods; zoom re-measures one page per idle period.
  Text layer items and the search index read text content with identical
  options so element order matches item order.
- Search indexes each page with per-character NFKC normalization, case folding,
  and whitespace collapsing, mapped back to UTF-16 offsets in text items.
  Results stream page by page; the first match at or after the current page is
  selected. Scrolling to a match uses text item boxes, so it works before the
  page's text layer exists. Highlights use the CSS Custom Highlight API
  (`::highlight(parapdf-search)` and `parapdf-search-current`) and never
  modify the text layer DOM.
- Accessibility: the viewport is a focusable, labelled `role="document"`;
  pages are labelled sections (region landmarks, as in pdf.js); canvases sit in
  an `aria-hidden` wrapper so assistive technology reads the text layer. The
  demo announces result counts through an `aria-live` `<output>`.
- Not yet implemented: annotation layer, structure tree (tagged PDF)
  semantics, text for pages outside the mounted window, highlight fallback for
  browsers without the CSS Custom Highlight API, and region rendering above the
  pixel cap.

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
