# AGENTS.md

This file is the canonical development context for coding agents.
`CLAUDE.md` only imports this file; update this file instead.

ParaPDF is a React PDF viewer built for maximum performance. "Para" carries two
meanings: flipping quickly through pages (Japanese "parapara") and parallel,
off-main-thread rendering.

## Status

Phase 0: engine comparison benchmark and runtime prototype. The runtime is
published on npm as `parapdf` 0.x, first as 0.1.0 on 2026-10-20, for early
use: its API is experimental, and any minor release may change it. Record
every change to the package in `CHANGELOG.md`, and keep
`packages/parapdf/README.md`, the package's documentation on npm, in step
with the API.

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
- Domain-neutral. ParaPDF shows PDFs as documents (reading, search,
  selection, links, annotations, forms) and knows nothing of drawings or any
  other domain: no scales, real-world lengths, measuring tools, or CAD layers.
  Libraries for such domains draw PDFs with a PDF engine and add those
  themselves; ParaPDF never depends on them. A feature belongs here if people
  who never treat a PDF as a drawing need it: optional content toggles do,
  measurement does not. Whether the engine boundary becomes a public API for
  such libraries is decided after Phase 0.

## Repository layout

- `bench/` — browser engine benchmark (`@parapdf/bench`, private).
  - `src/engines/` — one adapter per engine behind `EngineAdapter`.
  - `hayro-wasm/` — wasm-bindgen wrapper around hayro, used only by the
    benchmark.
  - `corpus/` — redistributable PDFs; sources and licenses are in its README.
  - `scripts/` — synthetic corpus generation, the Playwright runner, report
    generation, and `browsers.ts`, the browser launcher every Playwright
    script in the repository shares.
  - `results/` — committed result summaries per browser (`chromium`,
    `webkit`, `firefox` as `.md` and `.json`) and the cross-browser summary
    `browsers.md`.
- `packages/parapdf/` — the runtime, published as `parapdf`: engine
  boundary (`engine/`), layout, scheduler, and viewer runtime (`runtime/`),
  and React bindings (`react/`), whose modules declare `"use client"`; unit
  tests of the modules that need no DOM (`test/`, Node's test runner); and
  `README.md`, the user documentation npm shows. The workspace consumes its
  TypeScript source. `build` emits JavaScript and declarations to `dist/`,
  and packing ships `dist/` (through `publishConfig`, so pack and publish
  with pnpm), `src/` for the source maps, the README, and the license and
  notices the pdf.js code it derives from requires.
- `examples/prototype/` — Vite + React 19 demo, the scripted scroll
  benchmark (`scripts/scroll-bench.ts`, results per browser in `results/`,
  summarized by `scripts/compare.ts` in `results/browsers.md`), and
  functional checks (`scripts/check-*.ts`).

## Commands

- `pnpm install`
- `pnpm --filter @parapdf/bench exec playwright install chromium webkit firefox`
  — Playwright's browser builds for every script below.
- `pnpm --filter @parapdf/bench corpus` — regenerate the synthetic stress PDFs.
- `bench/scripts/build-pdfjs-next.sh` — optional: build unreleased pdf.js
  master (renderer worker) into `bench/vendor/`; enables the `pdfjs-next`
  engines.
- `pnpm bench:build` — build the hayro wasm module and the benchmark harness.
- `pnpm bench` — run the engine benchmark; results go to
  `bench/results/<browser>.{json,md}` and `bench/results/browsers.md`.
  `BROWSER` (`chromium`, `webkit`, or `firefox`) picks the browser;
  `ENGINES`, `FILES`, `RUNS`, `PAGES`, and `SCALE` narrow a run.
- `pnpm --filter @parapdf/prototype dev` — run the demo; query parameters
  select `engine` (`pdfjs` or `pdfjs-next`), `hwa`, `text`, `file`,
  `preload`, `lang` (the page's language, `en` by default), and `source`
  (`data` opens the PDF from bytes the demo fetched instead of its URL).
- `pnpm --filter @parapdf/prototype build && pnpm --filter @parapdf/prototype bench`
  — scripted scroll benchmark; `BROWSER` picks the browser, and `VARIANTS`,
  `TEXT`, `LINKS`, `FILES`, `SPEEDS` (CSS px per second), `RUNS`, `DURATION`,
  `PRELOAD`, and `OUTPUT` narrow or rename a run. `node
  examples/prototype/scripts/compare.ts` then rewrites `results/browsers.md`.
- `pnpm --filter @parapdf/prototype check:text` — functional checks for text
  selection, search highlights, normalization, accessibility semantics
  including the text's language, and text runs ending on their glyphs on
  English and Japanese pages and after zooming (run after `build`; `BROWSER`
  applies here too).
- `pnpm --filter @parapdf/prototype check:links` — functional checks for
  internal and external links, keyboard activation, the back stack, and the
  outline on `usrguide.pdf` (run after `build`; `BROWSER` applies here too).
- `pnpm --filter @parapdf/prototype check:lifecycle` — functional checks for
  document sharing under StrictMode (on the Vite development server), for
  closing viewers while work runs, for keeping the document under a new but
  equal source object, and for data sources, whose bytes must stay the
  application's and open again after their document was destroyed (run
  after `build`; `BROWSER` applies).
- `pnpm --filter @parapdf/prototype check:rotation` — functional checks for
  view rotation (page boxes, canvases, text, overlays, search, link jumps)
  and the `usePdfDocument()` escape hatch (run after `build`; `BROWSER`
  applies).
- `pnpm --filter @parapdf/prototype check:options` — functional checks for
  the options an embedding app sets: pages of mixed sizes centered in the
  viewport, "fit-width" following resizes and turns, per-canvas and total
  canvas pixel limits, one render for the first paint of a small page, inert
  external links, and getDocument parameters (run after `pnpm --filter
  @parapdf/bench corpus` and `build`; `BROWSER` and `ENGINE` apply).
- `pnpm --filter @parapdf/prototype check:pinch` — functional checks for zoom
  gestures: touch pinches zoom the document around the point between the
  fingers and pan with it while the page itself stays unzoomed, two fingers
  that keep their distance scroll, one finger still scrolls natively, Safari's
  gesture events are prevented and zoom the document, ctrl+wheel zooms
  around the pointer, and a pinch in at the document's start previews page 1
  where its commit puts it (run after `build`; `BROWSER` and `ENGINE`
  apply).
  Chromium gets real touches through the DevTools protocol; Playwright cannot
  put two fingers down in WebKit or Firefox, so there the check dispatches
  touch pointer events, and in WebKit gesture events.
- `pnpm --filter parapdf build` — JavaScript and declarations in
  `packages/parapdf/dist/`; `pnpm --filter parapdf pack` builds and packs the
  tarball.
- `pnpm test` — unit tests of the package's layout, search normalization,
  store, and document sharing.
- `pnpm --filter parapdf check:package` — packs the package and checks the
  tarball as an application would install it: its files and manifest, the
  `"use client"` directives, TypeScript against its declarations with
  bundler and nodenext resolution, and rendering on the server.
- `node examples/prototype/scripts/zoom-bench.ts` — zoom benchmark: sharpness,
  time to sharp, and canvas memory after zooming to `SCALES` (4,8) and
  panning, on desktop and phone-sized viewports (run after `build`; `BROWSER`,
  `VARIANTS`, `FILE`, `RUNS`, and `OUTPUT` apply).
- `node examples/prototype/scripts/main-thread-bench.ts` — main-thread cost of
  zooming and slow scrolling in Chromium: task, script, layout, and style time
  from the DevTools protocol, a JavaScript CPU profile, and the renders the
  scheduler completed. Run after `build`, or after `pnpm --filter
  @parapdf/prototype exec vite build --minify false` to read function names in
  the profile. `SCENARIOS`, `VARIANTS`, `TEXT`, `LINKS`, `FILE`, `DPR`,
  `START_SCALE`, `ZOOM` (zoom factors), `SPEED`, `DURATION`, `RUNS`, and
  `OUTPUT` apply.
- `node examples/prototype/scripts/hwa-bench.ts` — GPU-backed against
  CPU-backed canvases (`enableHWA`): blocked main thread, dropped frames, and
  the physical footprint of every process of a browser launched for each job
  (macOS `footprint`, which counts the IOSurfaces GPU canvases live in) while
  a document opens, scrolls, zooms, and pans (run after `build`; `BROWSER`,
  `VARIANTS`, `FILES`, `RUNS`, and `OUTPUT` apply).
- `pnpm check` — Biome lint and format check. `pnpm format` applies fixes.
- `pnpm typecheck` — TypeScript checks for every workspace package.
- The functional checks default to `ENGINE=pdfjs-next`, which needs
  `bench/scripts/build-pdfjs-next.sh`; `ENGINE=pdfjs` runs them on released
  pdfjs-dist, as CI does (`.github/workflows/ci.yml`, Chromium only).

## Releasing

1. Update `version` in `packages/parapdf/package.json` and add the release
   to `CHANGELOG.md`.
2. Run `pnpm check`, `pnpm typecheck`, `pnpm test`, `pnpm --filter parapdf
   check:package`, and every functional check in Chromium, WebKit, and
   Firefox.
3. Commit, tag `vX.Y.Z`, and push the branch and the tag.
4. `pnpm --filter parapdf publish` from `main` in a checkout without
   uncommitted or untracked files, which pnpm's git checks refuse: pnpm
   applies `publishConfig` and runs `prepack`, which builds and copies the
   license and notices in. npm asks the maintainer to authenticate.
5. Create the GitHub release for the tag from its `CHANGELOG.md` entry.

## Runtime prototype

- `PdfViewerRuntime` owns scrolling, layout, zoom, and the render scheduler.
  It publishes only `status`, `layout`, the mounted window (`first`/`last`),
  `currentPage`, `scale`, and `zoomMode` through a small store read with
  `useSyncExternalStore`; scrolling recomputes every frame but publishes only
  changes.
- Layouts are immutable per zoom level. The runtime sizes the content element
  imperatively so zoom can restore the anchored scroll position before React
  re-renders the mounted pages. A zoom keeps its anchor as a share of the same
  page in both directions: a share of the content's width moved points on a
  page narrower than the content sideways.
- Zoom gestures preview with a CSS transform of the content around the
  content point where they started, and then commit like `setScale`, that
  point at the place the preview shows it:
  - Ctrl or meta with the wheel, which trackpad pinches produce in Chromium
    and Firefox, commits 150 ms after the last event.
  - Two touches commit when either lifts. `PdfViewport` sets `touch-action:
    pan-x pan-y`, so one finger still scrolls natively, but a pinch reaches
    the runtime's pointer listeners instead of zooming the page. Chromium then
    does not scroll with two fingers either and keeps their pointers, so the
    preview pans with their midpoint; their zoom starts once their distance
    changed by 16 CSS pixels, so a two-finger drag or tap only scrolls.
  - Safari's `gesturestart`, `gesturechange`, and `gestureend` are always
    prevented, which keeps Safari from zooming the page. With no touches,
    as for macOS trackpad pinches, their `scale` zooms around their
    `clientX`/`clientY` and commits at `gestureend` or 150 ms after the last
    event. iPadOS reports touch pinches with both kinds of events: pointer
    events drive them, and if Safari cancels the pointers, the gesture events
    carry the zoom on from where the touches left it.
  - A relayout during a preview (a resize that refits, a turn, the page-size
    pass, a button) commits the gesture first; a pinch whose preview another
    gesture committed starts again from its fingers' current positions.
  - The preview shows the content where the commit puts it: it computes the
    commit's scroll position (`zoomTarget()`, shared with `setScale`) and
    shifts the transform by what the scroll range clamps off it. The
    gesture's point then stays under the fingers except where scrolling
    cannot keep it there: at the document's start or end, or once a page
    narrower than the viewport is centered. Previewing the unconstrained
    place made the content jump at the commit, 334 CSS pixels down and 96
    sideways in Safari in the iPadOS simulator.
  - In Safari on iPadOS, a pinch that starts while a fling still scrolls
    reaches the page through no event at all: the fling stops, the zoom does
    not change, and a second pinch works. A long two-finger drag at a low
    zoom pans only the preview, so pages it brings in mount at the commit.
- `setScale("fit-width")`, which `initialScale` defaults to, sets `zoomMode`
  to "fit-width": the page at the viewport's center is fitted to the
  viewport's width again whenever that width changes, the view turns, or the
  background pass learns that page's real size, like pdf.js's "page-width".
  A numeric `setScale`, `zoomBy`, and wheel zoom set it to "custom". The
  scroller keeps a stable scrollbar gutter, so a scrollbar that comes and
  goes cannot refit back and forth.
- Each page is centered in the viewport, and a page wider than the viewport
  starts at the gap: `pageLeft()` in `layout.ts`, used for visible areas,
  destinations, and search scrolling. `PdfViewport` places pages by the same
  rule in CSS against the scroller's width (`100cqw`; the scroller is an
  inline-size query container), so a resize moves pages without a React
  render. Centering pages in the widest page's width pushed narrower pages
  past the viewport's right edge.
- Each mounted page stacks a base canvas (half a device pixel per CSS pixel,
  at most 2 MP) under a detail canvas at full device resolution. A page whose
  full-resolution render fits in 16 MP gets detail for the whole page. Beyond
  that, as in pdf.js's `PDFPageDetailView` (attributed in `NOTICE.md`), only
  visible pages get detail, drawn through the engine's `region` request for
  the visible area grown by up to its own size on each side within the 16 MP
  budget, and redrawn when the view leaves that region or sits three times
  closer to one side than the other, margins under 2% of the visible span
  aside: a region without a margin, which a budget below the visible area
  leaves, was drawn about 60 times a second in a still view, its sides
  uneven by the pixel snapping adds. Pages leaving the viewport drop their
  detail canvases. Priority: visible base, visible detail once scrolling
  settles (120 ms quiet or below 2 px/ms), overscan base, overscan detail, then
  stale base. Once scrolling settles, overscan pages that get whole-page detail
  skip the base, and no page draws a base under current whole-page detail:
  slow scrolling used to render every page it brought in twice. Such a page
  gets a base only once it needs one: in view while its detail is stale, or
  when a zoom drops its detail. If it scrolls into view during fast scrolling
  before its detail render finishes, the render is cancelled for a quick base.
  Once scrolling settles, a visible page without pixels also gets its
  whole-page detail without a base when that holds at most four times the
  base budget (`QUICK_DETAIL_BASES`): a base repeats the page's drawing work.
  `ViewerOptions` sets the two budgets (`maxDetailPixels`, `maxBasePixels`),
  `maxDetailViewports`, which caps the detail at a multiple of the viewport's
  device pixels so that its margin follows the viewport's size, and
  `maxCanvasPixels`, a budget for all of a viewer's canvases, visible pages
  included. Visible pages come first: their bases count whether drawn or not,
  and each one's detail gets a share of the rest by visible area. A detail
  that does not fit its share loses its margin first and then resolution, in
  quarter-octave steps (`REDUCED_DETAIL_STEP`) that small changes of the share
  do not cross, with what a step leaves spent on its margin again; a detail
  no sharper than its base is not drawn, and one 25% over its share is drawn
  again, smaller. Pages outside the viewport render only within what is left
  and give their pixels back, farthest first and detail before base
  (`stats.trimmed`). Visible bases are never given back, so a visible page
  never goes blank. Lowering the resolution, rather than letting visible
  pages exceed the budget, keeps it a bound an application can rely on: the
  budget exists for browsers that cap all canvases together, as iOS Safari
  does, where going past the cap leaves canvases blank. Visible pages used to
  keep all the detail `maxDetailPixels` allowed, whatever the budget.
  A render clears its canvas, so the page counts that layer as empty until
  the render completes.
  Unmounted pages zero their canvases and release pdf.js page data.
  `sharpness()` reports the resolution of the visible pixels as a share of
  full device resolution. The zoom goes up to 10 CSS pixels per point.
- The pdf.js adapter starts its parsing worker when the engine is created, and
  the demo preloads the PDF with React's `preload()`, matching the CORS mode
  pdf.js fetches with. The adapter asks for GPU-backed canvases unless
  `enableHWA` is `false`: in an embedding app's preview they blocked the main
  thread for 256 instead of 560 ms in Chromium, and 770 instead of 1,393 ms
  in WebKit, while panning a zoomed drawing. `documentOptions` (typed
  `PdfjsDocumentOptions`) adds getDocument parameters for every document,
  overriding `enableHWA` and the asset URLs from `assetBase`; the source and
  the worker stay the adapter's. The `pdfjs` option takes the legacy build as
  is.
- Text layers use pdf.js's core `TextLayer` inside `.parapdf-text-layer`, styled
  by rules derived from pdf.js's viewer CSS (attributed in `NOTICE.md`). Pages
  set `--total-scale-factor` and `--scale-round-x/y`, which `TextLayer` sizes
  against. The scheduler builds one text layer at a time, only after scrolling
  settles, during idle periods, and not while a visible page still renders
  its first pixels: the engine's worker parses the page again for text, which
  delayed the first pixels of a 200,000-segment page by 48 ms. Each text
  layer then carries the `--total-scale-factor` it was laid out for, and
  later zooms scale it with
  the CSS `scale` property: laying out every mounted page's runs again at each
  zoom step was most of the main thread's zoom cost. A visible page is laid
  out again, one per idle period, only after zooming in past twice its layout
  zoom, because runs laid out small carry rounding errors that scaling
  magnifies; zooming out keeps the finer layout. `content-visibility: auto` on
  text layers saved another 5–8 ms over four zoom steps but was dropped: a
  selection in Firefox then serializes off-screen text layers as blank lines.
  Text layer items and the search index read text content with identical
  options so element order matches item order.
- `TextLayer` sizes each run by measuring it on a hidden canvas whose `lang`
  is the PDF's /Lang, or empty when the PDF declares none, and the generic
  fonts runs are drawn in resolve by language. An empty `lang` means an
  unknown language, which Firefox resolves to the operating system's and
  Chromium and WebKit to their default, while the runs inherit the page's.
  Runs therefore ended 12–15% short of their glyphs in Firefox on a Japanese
  system under the demo's `lang="en"`, and 14–18% past them in Chromium and
  WebKit under `lang="ja"`. The pdf.js adapter (`inLayerLanguage()` in
  `engine/pdfjs.ts`) passes the text content through a `TransformStream` that
  fills an empty `lang` with the language the layer inherits, and gives the
  layer the same `lang`: the PDF's, or the inherited one. pdf.js's own viewer
  measures PDFs without /Lang the same way and is affected too, Firefox's
  built-in viewer included when its UI language differs from the system's;
  not reported upstream yet.
- `TextSelectionTracker` (`runtime/selection.ts`, ported from pdf.js's
  `TextLayerBuilder` and attributed in `NOTICE.md`) gives every text layer a
  selection touches the `selecting` class, which stretches its unselectable
  `.endOfContent` over the page, so a drag past a line's end does not select
  the rest of the page. In browsers other than Firefox and Chromium 148 or
  later it also moves `.endOfContent` next to the changing end of the
  selection, as pdf.js does. Unlike pdf.js, it leaves `.endOfContent` alone
  when it already is the layer's last child: re-inserting it at every
  `selectionchange` left it without a box until the next style flush, and
  Firefox hit-tested a quick move from page 2's text into page 1's margin
  against the bare text layer, selecting all of page 1. Each viewer owns its
  listeners, so closing one viewer leaves the others working (pdf.js issue
  22129).
- The viewer CSS declares `-webkit-user-select` next to every `user-select`,
  as pdf.js's does: Playwright's WebKit 27.2 parses `user-select` but its
  mouse selection follows only the prefixed property. Without it,
  `.endOfContent` was selectable in WebKit, and a drag into the next page
  selected to that page's end.
- Over space without text, browsers end a drag selection at the start of an
  element rather than at the nearest text. The space between and beside the
  pages belongs to the pages element (`.parapdf-pages`): WebKit and Firefox
  send it to the start of the first mounted page, and Chromium the space
  beside a page to that page's start. So during a primary-button drag, until
  release, the pages element has `selecting`, which leaves only the text
  layers in it selectable: a drag holds over a gap, beside a page, and over
  the last pixel column and row of a page whose box, rounded to whole pixels,
  is larger than its text layer, which pdf.js rounds down (796 by 1,030 px
  around 795 by 1,029 at scale 1.3 on a US Letter page). Chromium and WebKit
  sent that column and row to the page's start, and a drag in 1 px steps
  reaches them: dragging up selected all of the page above. In WebKit and
  Firefox, text layers above the selection also have `selecting` and
  `before-selection`, whose selectable `.endOfContent` sends their blank space
  to the page's end, so a drag entering a page from either side selects up to
  the page boundary; Chromium picks the nearest text there by itself. pdf.js's
  own viewer selects all of the page above in WebKit and Firefox when a drag
  enters it from below; not yet reported upstream.
- A press on the pages element itself started the selection at that same
  place: from beside page 1 to the end of one of its lines, all three
  browsers selected 3,357 characters where the line holds 49. The tracker
  starts such a drag at the nearest text instead: beside a page, the start or
  end of the nearest run, on the side of the press; in a gap, the boundary
  between the pages. The browser still handles the press, so a click there
  clears the selection. The tracker marks the layers for that position at the
  press, because Chromium and Firefox hit-test a pointer move before its
  listeners run; selects it at the first move as a range between two
  equivalent DOM positions, because Chromium extends a drag only from a range
  and otherwise restarts it from the pressed point; and puts the anchor back
  until release, because WebKit restarts the drag at the first text the
  pointer reaches. A drag that selects nothing leaves no selection. Shift,
  Ctrl, Alt, and Meta presses and double and triple clicks there keep the
  browser's behaviour.
- Search indexes each page with the normalization of pdf.js's
  `PDFFindController` (ported in `runtime/text-search.ts`, attributed in
  `NOTICE.md`) at its default options: compatibility forms, case, and
  diacritics are ignored except marks that make a different letter (Japanese
  voiced sound marks, viramas); a line end after a CJK character or inside a
  hyphenated word joins the lines, a dash before a line end stays, and any
  other line end reads as a space. Whitespace collapses, and every indexed
  character maps back to UTF-16 offsets in text items. The indexed text and
  the query stay decomposed (NFD), as pdf.js's normalized text does:
  recomposing each character on its own kept half-width katakana, which
  write voiced sound marks as characters of their own (ﾃﾞｰﾀ), from matching
  the composed letters (データ) either way.
  Results stream page by page; the first match at or after the current page is
  selected. Scrolling to a match uses text item boxes, so it works before the
  page's text layer exists. Highlights use the CSS Custom Highlight API
  (`::highlight(parapdf-search)` and `parapdf-search-current`) and never
  modify the text layer DOM.
- Accessibility: the viewport is a focusable, labelled `role="document"`;
  pages are labelled sections (region landmarks, as in pdf.js); canvases sit in
  an `aria-hidden` wrapper so assistive technology reads the text layer. The
  text layer's `lang` is the PDF's /Lang, so its text is announced in the
  document's language while page labels keep the page's; for PDFs without
  one it is the language the layer inherits. `PdfViewport`'s `label` and
  `pageLabel` name the document and its pages in the application's language
  ("PDF document" and "Page 3 of 12" by default); the demo's `?lang=ja` uses
  Japanese ones. The demo announces result counts through an `aria-live`
  `<output>`.
- Annotation layers use pdf.js's core `AnnotationLayer` inside
  `.parapdf-annotation-layer`, after the page's text layer in the same idle
  pipeline, with `renderForms: false`: form widgets stay on the canvas. A
  ParaPDF implementation of the link service methods pdf.js calls routes
  internal links and named actions (`NextPage`, `PrevPage`, `FirstPage`,
  `LastPage`, `GoBack`) to the runtime; external links get `target="_blank"`
  and `rel="noopener noreferrer nofollow"`, or, with `externalLinks:
  "disabled"`, no `href` at all, which leaves them neither focusable nor
  followable while internal links keep working. pdf.js puts the linked text in
  each internal link's `title`, its accessible name.
- `goToDestination` resolves named and explicit destinations through the
  engine and places an explicit top at the viewport's top edge. Link and
  outline jumps push the previous position (a page plus a fraction, so zoom
  does not invalidate it) onto a 50-entry back stack exposed as `canGoBack`
  and `back()`. The outline loads in the background after the first layout.
- `acquireDocument` (`runtime/documents.ts`) shares one loaded document per
  engine and source (the URL, or the identity of the data) among viewers, so
  StrictMode's double mount and quick remounts load it once. A document is
  destroyed one second after the last viewer releases it. `PdfDocument`
  reopens only when that key changes, so a new object for the same URL, such
  as an inline `{ url }`, keeps the open document; it used to reopen at every
  render, resetting the view. pdf.js transfers the bytes of a data source to
  its worker, which detached the application's buffer and kept the same
  bytes from opening again once their document was destroyed: the pdf.js
  adapter passes a copy. Closing a viewer
  disposes its scheduler, which cancels renders and layers and releases its
  pages, and moves the runtime to a new generation, so page-size passes,
  searches, and scrolls to a match stop. Background work that fails after its
  document closed fails quietly; while the document is open, failures are
  logged.
- View rotation turns every page clockwise in quarter turns (`rotate()`,
  `setRotation()`, published as `rotation`). The layout swaps page boxes and
  the engine draws pages turned (pdf.js gets the page's own rotation plus the
  view's). Text and annotation layers stay laid out unturned and turn
  through pdf.js's `data-main-rotation` CSS, and so do overlays in
  `.parapdf-overlay-layer`, so `PdfPageRect` keeps unturned PDF coordinates.
  A turn drops the old canvases at once and re-renders them, while layers
  only change their attribute. Search scrolling and destinations map unturned
  points with `turnBox()`.
- `usePdfDocument()` returns the open `PdfEngineDocument` (published as
  `document`). Its `native` is the engine's own object, and
  `pdfjsDocumentOf()` returns pdf.js's `PDFDocumentProxy` for documents a
  pdf.js engine opened, for APIs ParaPDF does not wrap.
- Browsers: `check:text`, `check:links`, `check:lifecycle`,
  `check:rotation`, `check:options`, and `check:pinch` pass in Playwright's
  Chromium, WebKit, and Firefox. Playwright's WebKit cannot put two fingers
  down, and its `GestureEvent` is a function whose objects are not events, so
  touch and Safari's gesture events were checked by hand in Safari 27 in the
  iPadOS 27 simulator (iPad Pro 11-inch): pinches, the point between the
  fingers, one-finger scrolling, long-press text selection, and two-finger
  drags behave as described here, pointer events drive pinches there, Safari
  never cancelled their pointers, and its gesture events carry `clientX` and
  `clientY` at the fingers' midpoint. Safari on macOS and real iOS and iPadOS
  devices are not verified yet. WebKit has neither
  `requestIdleCallback` nor `scheduler.yield`, so idle text and annotation
  layers fall back to a 16 ms timer and search yields through `setTimeout(0)`.
- Not yet implemented: form filling, structure tree (tagged PDF) semantics,
  text for pages outside the mounted window, highlight fallback for browsers
  without the CSS Custom Highlight API, optional content toggles, and
  attachments.

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
  - Firefox loses a context's `deviceScaleFactor` when a page first
    navigates into a cross-origin-isolated process and renders at
    devicePixelRatio 1. `restoreScaleFactor()` visits `calibrate.html` and
    applies the viewport again before the real navigation, and the scroll and
    zoom benchmarks reject jobs whose devicePixelRatio is wrong. The Firefox
    scroll and control results measured before this fix (`firefox.md`,
    `browsers.md`, and `control.md` in `examples/prototype/results/`) ran at
    devicePixelRatio 1 and need a rerun.
  - WebKit refuses some ports outright (4190 among them); the runners use
    4179–4189. Their servers bind 127.0.0.1: with `localhost` they could listen
    on `::1` beside another session's server on 127.0.0.1, and the browser
    would reach the other server.
- Measure on AC power. Low Power Mode, which this Mac enables on battery,
  drops WebKit's animation frames to 30 Hz and slows every engine by about a
  quarter. The measuring scripts check `pmset` before the run and between
  jobs and stop without writing results on battery or in Low Power Mode;
  `ALLOW_BATTERY=1` overrides, and reports then flag the run.
- Measuring scripts take turns with other Playwright browsers, which other
  sessions run on this machine: a job measured beside one competed for the
  same cores and GPU. `measureInTurn()` in `bench/scripts/browsers.ts` starts
  each job once no other Playwright browser or test runner is open, waiting
  with the script's own browser closed so that two waiting scripts cannot
  block each other, plus a random 5–20 s so that they do not restart
  together. A job that another browser overlapped runs again, up to ten
  times. Other browsers are main processes under `ms-playwright` that do not
  descend from the script; their child processes and WebKit's helpers, which
  belong to launchd, are skipped. `MAX_LOAD` also waits for the one-minute
  load average, `IGNORE_PIDS` ignores the browsers of the listed processes
  (a stuck runner), `ALLOW_PARALLEL=1` measures regardless, and reports say
  how often a run waited and repeated a job.
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
  runners and checks do. The same happens to pdf.js's renderer worker when a
  document is reopened in the same page; `check:lifecycle` reports it as a
  note.
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
