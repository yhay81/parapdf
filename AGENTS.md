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
  - `hayro-wasm/` — wasm-bindgen wrapper around hayro, used by the benchmark
    and by the demo's hybrid engine.
  - `hayro-classify/` — the hybrid engine's page classifier: hayro-syntax
    only (no rasterizer, fonts, or image decoders) behind wasm-bindgen.
    `cargo run --release --example classify -- file.pdf` prints its counts
    for local PDFs.
  - `corpus/` — redistributable PDFs; sources and licenses are in its README.
  - `scripts/` — synthetic corpus generation, the Playwright runner, report
    generation, and `browsers.ts`, the browser launcher every Playwright
    script in the repository shares.
  - `results/` — committed result summaries per browser (`chromium`,
    `webkit`, `firefox` as `.md` and `.json`) and the cross-browser summary
    `browsers.md`.
- `packages/parapdf/` — the runtime prototype: engine boundary (`engine/`),
  layout, scheduler, and viewer runtime (`runtime/`), and React bindings
  (`react/`). Consumed as TypeScript source through the workspace.
- `examples/prototype/` — Vite + React 19 demo, the scripted scroll
  benchmark (`scripts/scroll-bench.ts`, results per browser in `results/`,
  summarized by `scripts/compare.ts` in `results/browsers.md`), the hybrid
  engine benchmark (`scripts/hybrid-bench.ts`, `results/hybrid-*.{json,md}`
  and `results/hybrid.md`), and functional checks (`scripts/check-*.ts`).

## Commands

- `pnpm install`
- `pnpm --filter @parapdf/bench exec playwright install chromium webkit firefox`
  — Playwright's browser builds for every script below.
- `pnpm --filter @parapdf/bench corpus` — regenerate the synthetic stress PDFs.
- `bench/scripts/build-pdfjs-next.sh` — optional: build unreleased pdf.js
  master (renderer worker) into `bench/vendor/`; enables the `pdfjs-next`
  engines.
- `pnpm bench:build` — build the hayro and page classifier wasm modules and
  the benchmark harness. The demo's hybrid engine needs both modules.
- `pnpm bench` — run the engine benchmark; results go to
  `bench/results/<browser>.{json,md}` and `bench/results/browsers.md`.
  `BROWSER` (`chromium`, `webkit`, or `firefox`) picks the browser;
  `ENGINES`, `FILES`, `RUNS`, `PAGES`, and `SCALE` narrow a run.
- `pnpm --filter @parapdf/prototype dev` — run the demo; query parameters
  select `engine` (`pdfjs`, `pdfjs-next`, or `hybrid`), `hwa`, `text`,
  `file`, and `preload`.
- `pnpm --filter @parapdf/prototype build && pnpm --filter @parapdf/prototype bench`
  — scripted scroll benchmark; `BROWSER` picks the browser, and `VARIANTS`,
  `TEXT`, `LINKS`, `FILES`, `SPEEDS` (CSS px per second), `RUNS`, `DURATION`,
  `PRELOAD`, and `OUTPUT` narrow or rename a run. `node
  examples/prototype/scripts/compare.ts` then rewrites `results/browsers.md`.
- `pnpm --filter @parapdf/prototype check:text` — functional checks for text
  selection, search highlights, normalization, and accessibility semantics
  (run after `build`; `BROWSER` applies here too).
- `pnpm --filter @parapdf/prototype check:links` — functional checks for
  internal and external links, keyboard activation, the back stack, and the
  outline on `usrguide.pdf` (run after `build`; `BROWSER` applies here too).
  `ENGINE=hybrid` runs this and `check:text` on the hybrid engine.
- `pnpm --filter @parapdf/prototype check:hybrid` — functional checks for the
  hybrid engine: which engine renders each page, that text documents never
  load hayro, hayro's pixels against pdf.js's, OCR text search and selection
  on hayro-rendered pages, and zoom (run after `build`; `BROWSER` applies).
- `pnpm --filter @parapdf/prototype bench:hybrid` — hybrid engine benchmark
  (`pdfjs-next-hwa` against `hybrid-hwa`); `BROWSER`, `VARIANTS`, `FILES`,
  `SPEEDS`, `RUNS`, `DURATION`, and `OUTPUT` narrow or rename a run. Before
  every job it waits until no Playwright browser started by another process
  is open and the 1-minute load average is at most `MAX_LOAD` (half the
  logical cores), and it gives up after two hours of waiting; `IGNORE_PIDS`
  exempts an idle runner stuck holding its browser. Results are saved after
  every job, `RESUME=1` continues an interrupted run with the same settings,
  and `REPORT_ONLY=1` rewrites `results/hybrid.md` from the stored JSON.
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
- `TextSelectionTracker` (`runtime/selection.ts`, ported from pdf.js's
  `TextLayerBuilder` and attributed in `NOTICE.md`) gives every text layer a
  selection touches the `selecting` class, which stretches its
  `.endOfContent` over the page. In WebKit and Chromium before 148 it also
  moves `.endOfContent` next to the changing end of the selection, so a drag
  past a line's end does not select the rest of the page. Each viewer owns
  its listeners, so closing one viewer leaves the others working (pdf.js
  issue 22129). In WebKit a drag across the gap between two pages still jumps
  to the end of the next page.
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
- Annotation layers use pdf.js's core `AnnotationLayer` inside
  `.parapdf-annotation-layer`, after the page's text layer in the same idle
  pipeline, with `renderForms: false`: form widgets stay on the canvas. A
  ParaPDF implementation of the link service methods pdf.js calls routes
  internal links and named actions (`NextPage`, `PrevPage`, `FirstPage`,
  `LastPage`, `GoBack`) to the runtime; external links get `target="_blank"`
  and `rel="noopener noreferrer nofollow"`. pdf.js puts the linked text in
  each internal link's `title`, its accessible name.
- `goToDestination` resolves named and explicit destinations through the
  engine and places an explicit top at the viewport's top edge. Link and
  outline jumps push the previous position (a page plus a fraction, so zoom
  does not invalidate it) onto a 50-entry back stack exposed as `canGoBack`
  and `back()`. The outline loads in the background after the first layout.
- Browsers: `check:text` and `check:links` pass in Playwright's Chromium,
  WebKit, and Firefox. WebKit has neither `requestIdleCallback` nor
  `scheduler.yield`, so idle text and annotation layers fall back to a 16 ms
  timer and search yields through `setTimeout(0)`.
- Hybrid engine (experiment): `createHybridEngine` (`engine/hybrid.ts`)
  wraps the pdf.js engine behind the same boundary. Image-only pages render
  with hayro; every other page, and every page's text layer, links, search,
  outline, and size, stay on pdf.js. Its worker (`engine/hybrid-worker.ts`,
  entry `examples/prototype/src/hybrid.worker.ts`) starts with the engine,
  loads the page classifier (93 KiB brotli), fetches the PDF itself, and
  classifies each page before its first render without decoding images. A
  page goes to hayro when it has no visible text (rendering modes 3 and 7,
  which OCR layers use, count as invisible), an image covering at least half
  of the crop box, at most 64 path segments, no shadings, and no non-link
  annotation appearances; the walk stops at the first visible text, the 65th
  segment, or before decoding more than 256 KiB of encoded content. The hayro
  module (1.36 MiB brotli) loads in the same worker on the first render of an
  image-only page. A render waits up to 250 ms for its page's classification,
  then uses pdf.js. hayro's bitmaps reach the canvas through a
  `bitmaprenderer` context (a canvas pdf.js drew first gets `drawImage`, and
  pdf.js draws through a scratch canvas when hayro owns the target); after
  two hayro failures in a document, every page goes to pdf.js.
- Hybrid engine costs: the worker downloads the PDF again (from the HTTP
  cache when the response allows it), the classifier and hayro parse it again,
  and hayro decodes a page's images for every render (base and detail),
  where pdf.js keeps decoded images between renders of a page; on the
  JBIG2 and JPEG manuscript this makes page 1 sharp 36–47 ms later in
  Chromium and Firefox. hayro's wasm memory grows to 51–103 MiB per scanned
  document at devicePixelRatio 2 and never shrinks. Results in
  `examples/prototype/results/hybrid.md`. The benchmark
  wrapper in `bench/hayro-wasm` leaks each parsed document (`Box::leak`),
  which is fine for one document per page but not for an application.
- Not yet implemented: form filling, structure tree (tagged PDF) semantics,
  text for pages outside the mounted window, highlight fallback for browsers
  without the CSS Custom Highlight API, optional content toggles, attachments,
  and region rendering above the pixel cap.

## Benchmark methodology

- Every job runs in a fresh, cross-origin-isolated page in Playwright's
  headless Chromium, WebKit, or Firefox build, launched by
  `bench/scripts/browsers.ts`. Playwright's WebKit is not Safari; never
  present its numbers as Safari's.
  - Chromium: on macOS the launcher passes `--use-angle=metal`; headless
    Chromium otherwise falls back to SwiftShader and GPU-backed canvases
    become meaningless.
  - Firefox: pinned to 60 Hz with `layout.frame_rate`, like the other two
    headless browsers. On macOS it runs with `CFFIXED_USER_HOME` pointing at a
    reused temporary home: macOS may refuse `~/Library/Application Support/Firefox`
    to processes another app started, and Firefox then exits with "Could not
    find profile folder".
  - WebKit refuses some ports outright (4190 among them); the runners use
    4179–4187.
- Measure on AC power. Low Power Mode, which this Mac enables on battery,
  drops WebKit's animation frames to 30 Hz and slows every engine by about a
  quarter. The measuring scripts check `pmset` before the run and between
  jobs and stop without writing results on battery or in Low Power Mode;
  `ALLOW_BATTERY=1` overrides, and reports then flag the run.
- Each job first measures an idle baseline: timer lateness and the
  animation-frame interval of a page doing nothing (the engine benchmark
  before its engine loads, the scroll benchmark on `calibrate.html`). An idle
  4 ms timer fires about 1 ms late in Chromium, 1–2 ms in Firefox, and 4 ms
  in WebKit. Blocked time counts only lateness beyond 2 ms or the idle 95th
  percentile, whichever is larger: the 2 ms floor keeps the small delays that
  every scrolled frame adds from piling up. Compare blocked time within a
  browser and compare browsers by their longest stalls. A dropped frame is one
  longer than 1.5 idle intervals.
- Background load moves these numbers: while a virtual machine used most of
  a CPU core, some scroll results moved severalfold between runs. Check
  `uptime` and Activity Monitor before measuring, and rerun when in doubt.
- On a second visit in the same browser context, WebKit refused pdf.js's
  module worker scripts in the cross-origin-isolated demo ("Worker load was
  blocked by Cross-Origin-Embedder-Policy"), apparently when it took them
  from its cache, and pdf.js silently parsed on the main thread ("Setting up
  fake worker"). Open every document in a fresh browser context, as the
  runners and checks do.
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
  render phase, beyond the threshold above: time the page could not respond
  to input or scrolling.
- Payload is the brotli size of each engine's own assets in `bench/dist/`; the
  `pdfjs-next` workers are unminified.
- Playwright's Firefox 157 ignores `deviceScaleFactor` on cross-origin-isolated
  pages: with `deviceScaleFactor: 2`, a page reports `devicePixelRatio` 2
  without COOP and COEP and 1 with them. The demo is isolated, so its Firefox
  runs render detail canvases at a quarter of the pixels of the Chromium and
  WebKit runs; compare Firefox's demo timings within Firefox only until the
  launcher forces the ratio (for example with the `layout.css.devPixelsPerPx`
  pref). The engine benchmark renders at a fixed scale and is not affected.
- A runner that waits for other processes' Playwright browsers must tell its
  own apart by ancestry and skip WebKit's helpers (`com.apple.WebKit.*`),
  whose parent is launchd: counting them as foreign makes a runner wait for
  its own browser while holding it open, and every other careful runner then
  waits for it too (seen on 2026-10-18 for more than two hours).
- Review fidelity in `bench/results/raw/<browser>-contact.html` before
  trusting a speed win: an engine that skips content is fast for the wrong
  reason.
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
