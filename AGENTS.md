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
`packages/parapdf/README.md`, the package's documentation on npm, and the
documentation site (`site/`, https://parapdf.yhay81.com) in step with the
API.

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
- Applications choose no engine. The package depends on one exact pdfjs-dist,
  ships its worker and the files it loads on demand, and exports nothing of
  the engine boundary: `<PdfDocument source={url}>` needs no setup.
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
  boundary, the pdf.js adapter, and the loader that creates it (`engine/`),
  layout, scheduler, and viewer runtime (`runtime/`), and React bindings
  (`react/`), whose modules declare `"use client"`; unit tests of the modules
  that need no DOM (`test/`, Node's test runner); and `README.md`, the user
  documentation npm shows. `scripts/pdfjs-files.ts`, run by `pnpm install`
  (prepare) and `build`, copies pdf.js's worker, behind ParaPDF's prelude
  (`scripts/worker-prelude.js`), and the files it loads on demand from
  pdfjs-dist into `pdfjs/` (not committed), and writes
  `src/engine/pdfjs-files.ts` (committed), which references each with
  `new URL(…, import.meta.url)`. The workspace consumes its TypeScript
  source. `build` emits JavaScript and declarations to `dist/`, and packing
  ships `dist/` (through `publishConfig`, so pack and publish with pnpm),
  `src/` for the source maps, `pdfjs/`, the README, and the license and
  notices the pdf.js code it derives from requires.
- `examples/prototype/` — Vite + React 19 demo, the scripted scroll
  benchmark (`scripts/scroll-bench.ts`, results per browser in `results/`,
  summarized by `scripts/compare.ts` in `results/browsers.md`), and
  functional checks (`scripts/check-*.ts`).
- `site/` — the documentation site (`@parapdf/site`, private), Astro with
  Starlight: guides and reference in `src/content/docs/`, live examples
  (`src/components/examples.tsx`), and the full demo at `/demo/`
  (`src/components/demo/`, `src/pages/demo.astro`). It is served by a
  Cloudflare Worker with static assets (`wrangler.jsonc`, which also
  attaches the custom domain) and deployed by `.github/workflows/site.yml`.
  The samples it serves are listed in `src/samples.ts` with their sources
  and copied from `bench/corpus/` by `astro.config.ts`, which also keeps
  Vite from inlining pdf.js's files. The docs are written for people: they
  restate `packages/parapdf/README.md` by topic, with examples that run.
- `CONTRIBUTING.md` and `SECURITY.md` — what a pull request needs and how
  to report a vulnerability, for people. They summarize this file: keep them
  in step with it. `.github/` holds CI, the issue forms, the pull request
  template, and the Dependabot configuration.

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
  select `engine` (`pdfjs`, the pdf.js the package ships, or `pdfjs-next`),
  `hwa`, `text`, `file`, `lang` (the page's language, `en` by default),
  `source` (`data` opens the PDF from bytes the demo fetched instead of its
  URL), `count` (count the documents pdf.js opens and destroys, for
  `check:lifecycle`), `forms` (`1` for fillable fields), `spread` (`odd` or
  `even`), `scroll` (`horizontal`, `wrapped`, or `page`), `page` (the
  one-based page shown first), `scale` (a number, `fit-width`, or
  `fit-page`), `password` (the source's password), `annotations` (`1`
  for annotation editing, with a second toolbar that keeps exported
  annotations in localStorage and copies the document's text), `view`
  (`document` opens where and as the document asks, and its sidebar panel;
  `spread`, `scroll`, `page`, and `scale` still win when given),
  `destinationZoom` (`0` keeps the zoom at link jumps), `permissions`
  (`1` follows what the document permits), and `viewState` (a view state
  as JSON, to open with).
- `pnpm --filter @parapdf/prototype build && pnpm --filter @parapdf/prototype bench`
  — scripted scroll benchmark; `BROWSER` picks the browser, and `VARIANTS`,
  `TEXT`, `LINKS`, `SCROLL` (scroll modes: `vertical`, `horizontal`,
  `wrapped`, or a list; it scrolls sideways in `horizontal`), `SCALE`
  (`fit-width`, `fit-page`, CSS px per point, or a list), `FILES`, `SPEEDS`
  (CSS px per second), `RUNS`, `DURATION`, and `OUTPUT` narrow or rename a
  run; `LATENCY` (ms) and `BANDWIDTH` (Mbit/s) give Chromium's requests the
  delays a server on this machine lacks, through the DevTools protocol.
  `node examples/prototype/scripts/compare.ts` then rewrites
  `results/browsers.md`; with `PREFIX`, it summarizes the runs written as
  `OUTPUT=<PREFIX><browser>` in `results/<PREFIX>browsers.md`.
- `pnpm --filter @parapdf/prototype check:text` — functional checks for text
  selection, search highlights, normalization, accessibility semantics
  including the text's language, and text runs ending on their glyphs on
  English and Japanese pages and after zooming, and for `getText()`: every
  page's text, unmounted pages included, the text between a search match's
  and a selection's ends, joined lines, and aborting (run after `build`;
  `BROWSER` applies here too).
- `pnpm --filter @parapdf/prototype check:annotations` — functional checks
  for annotation editing on `usrguide.pdf`: drawing, text, highlights of
  selected text, images, and typed signatures; styles, undo, redo, and
  deleting; switching tools while typing; annotations staying in place,
  without taking focus or adding undo steps, as their page mounts again,
  zooms, and turns; `save()` writing them into the PDF, read back by
  pdf.js; and exporting and importing them, on an unmounted page too (run
  after `build`; `BROWSER` and `ENGINE` apply).
- `pnpm --filter @parapdf/prototype check:document` — functional checks for
  what the document asks of the viewer and what an application reads and
  sets in it: the view of every kind of destination (XYZ with and without a
  zoom, Fit, FitH, FitV, FitR), clicked or followed, back and forward with
  their zoom, `destinationZoom: false`, the initial view (/OpenAction,
  /PageLayout, /PageMode) and the options that win over it, permissions
  reported and followed, form fields listed, entered, heard, set, shown,
  and saved, and view states kept and shown again, at open in a narrower
  viewport and later, with values out of range ignored (run after `pnpm --filter @parapdf/bench corpus` and `build`;
  `BROWSER` and `ENGINE` apply).
- `pnpm --filter @parapdf/prototype check:links` — functional checks for
  internal and external links, keyboard activation, the back stack, and the
  outline on `usrguide.pdf` (run after `build`; `BROWSER` applies here too).
- `pnpm --filter @parapdf/prototype check:lifecycle` — functional checks for
  document sharing under StrictMode (on the Vite development server), for
  closing viewers while work runs, for keeping the document under a new but
  equal source object, and for data sources, whose bytes must stay the
  application's and open again after their document was destroyed (run
  after `build`; `BROWSER` applies).
- `pnpm --filter @parapdf/prototype check:features` — functional checks for
  what a document viewer offers besides its pages, the features other React
  PDF viewers have: the password prompt, load progress, page labels,
  metadata, attachments, layers, comment popups, form filling and saving,
  printing, downloading, thumbnails, "fit-page", keyboard zoom, the initial
  page, the hand tool, search options, spreads, selections in PDF points,
  and tagged structure (run after `pnpm --filter @parapdf/bench corpus` and
  `build`; `BROWSER` and `ENGINE` apply). It reads colors on pages from
  screenshots, because pdf.js's renderer worker draws into canvases the main
  thread cannot read.
- `pnpm --filter @parapdf/prototype check:scroll` — functional checks for
  scroll modes on the document of mixed page sizes: where pages sit in
  "vertical", "horizontal", "wrapped", and "page" mode, alone and in odd
  spreads; the current page; zooming around a point; "fit-width" and
  "fit-page"; scrolling to a search match; switching modes on the current
  page; filling rows again after a resize; and flipping pages in "page" mode
  with keys, the demo's buttons, `goToPage()`, and one-finger swipes (real
  touches in Chromium, dispatched touch events in WebKit and Firefox), while
  a zoomed page scrolls within itself and short, slanted, and two-finger
  swipes and annotation tools do not flip (run after `pnpm --filter @parapdf/bench corpus` and
  `build`; `BROWSER` and `ENGINE` apply).
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
  that keep their distance only scroll, side by side or one above the other
  and however fast they move, with the preview following them in every
  frame, one finger still scrolls natively, Safari's gesture events are
  prevented and zoom the document, ctrl+wheel zooms around the pointer, a
  pinch in at the document's start previews page 1 where its commit puts
  it, a long two-finger drag at the lowest zoom, or a pinch in that drags as
  far, mounts and draws the pages its preview shows before the fingers lift,
  and in every frame after a pinch out or in commits, each page in view shows
  its drawing, neither blank nor only its base, as its canvases composite
  (run after `build`; `BROWSER` and `ENGINE` apply).
  Chromium gets real touches through the DevTools protocol; Playwright cannot
  put two fingers down in WebKit or Firefox, so there the check dispatches
  touch pointer events, and in WebKit gesture events. Dispatched pointers,
  which Chromium gets too, move one finger and then the other in each
  animation frame, as browsers deliver a gesture.
- `pnpm --filter @parapdf/prototype check:bundle` — functional checks for
  the pdf.js files the package ships: packs the package into a temporary Vite
  application that configures nothing and opens a Japanese PDF without
  embedded fonts, a JBIG2 scan, a page in Symbol and ZapfDingbats, and a CMYK
  page, from Vite's development server and from a build, checking that the
  worker, CMaps, fonts, decoders, and ICC color management load, and that
  pdf.js takes the preloaded download; and that the build's JavaScript holds
  none of the shipped files as `data:` URLs and the chunk with their URLs,
  split off in a second build, stays within 4 KB with gzip (run after `pnpm
  --filter @parapdf/bench corpus`; `BROWSER` applies).
- `pnpm --filter parapdf build` — JavaScript and declarations in
  `packages/parapdf/dist/`; `pnpm --filter parapdf pack` builds and packs the
  tarball.
- `pnpm --filter @parapdf/site dev` — the documentation site on Astro's
  development server; `build` writes it to `site/dist/` and `preview` serves
  that (both after `pnpm --filter @parapdf/bench corpus`, whose documents the
  demo shows). Release tags and runs started by hand deploy it to
  https://parapdf.yhay81.com (`wrangler deploy`), and `main` uploads a
  version without deploying it, shown at
  https://next-parapdf.yusuke8h.workers.dev (`wrangler versions upload
  --preview-alias next`); pull requests only build it. CI needs the
  `CLOUDFLARE_API_TOKEN` (with the "Edit Cloudflare Workers" template's
  permissions) and `CLOUDFLARE_ACCOUNT_ID` secrets; locally, `wrangler
  login` with the account that holds yhay81.com.
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
- `node examples/prototype/scripts/commit-bench.ts` — zoom commit benchmark:
  in every frame after ten kinds of zoom commit (touch pinches, `setScale`,
  `zoomBy`, ctrl+wheel), whether a page in view shows blank or only its base,
  read from its canvases as it shows them, then, in a second pass without
  that probe, which reads canvases back from the GPU, the time until the
  pages in view are sharp, the renders, and canvas memory (run after
  `build`; `BROWSER`, `ENGINE` (`pdfjs`), `SCENARIOS`, `RUNS`, `THROTTLE`
  (Chromium's CPU slowdown), `DIST` and `LABEL` (another build of the demo,
  such as an older commit's built in a directory of its own), and `OUTPUT`
  apply).
- `node examples/prototype/scripts/main-thread-bench.ts` — main-thread cost of
  zooming and slow scrolling in Chromium: task, script, layout, and style time
  from the DevTools protocol, a JavaScript CPU profile, and the renders the
  scheduler completed. Run after `build`, or after `pnpm --filter
  @parapdf/prototype exec vite build --minify false` to read function names in
  the profile. `SCENARIOS`, `VARIANTS`, `TEXT`, `LINKS`, `SCROLL` (scroll
  modes, as for the scroll benchmark), `FILE`, `DPR`, `START_SCALE` (CSS px
  per point, `fit-width`, or `fit-page`), `ZOOM` (zoom factors), `SPEED`,
  `DURATION`, `RUNS`, and `OUTPUT` apply.
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
- The checks that run after `build` serve `examples/prototype/dist/`, or,
  with `DIST`, a build of the demo in a directory of its own (`pnpm --filter
  @parapdf/prototype exec vite build --outDir <dir>`), so that they do not
  replace the build a benchmark of another session is measuring.

## Releasing

1. Update `version` in `packages/parapdf/package.json` and add the release
   to `CHANGELOG.md`.
2. Run `pnpm check`, `pnpm typecheck`, `pnpm test`, `pnpm --filter parapdf
   check:package`, and every functional check in Chromium, WebKit, and
   Firefox.
3. Commit, tag `vX.Y.Z`, and push the branch and the tag; the tag deploys
   the documentation site.
4. `pnpm --filter parapdf publish` from `main` in a checkout without
   uncommitted or untracked files, which pnpm's git checks refuse: pnpm
   applies `publishConfig` and runs `prepack`, which builds and copies the
   license and notices in. npm asks the maintainer to authenticate.
5. Create the GitHub release for the tag from its `CHANGELOG.md` entry.

When pdfjs-dist publishes a security fix, release on it soon, and say so in
the release's `CHANGELOG.md` entry: `SECURITY.md` promises it, because the
package ships pdf.js's worker and applications cannot move to another pdf.js
themselves.

## Runtime prototype

- `PdfViewerRuntime` owns scrolling, layout, zoom, and the render scheduler.
  It publishes `status`, `layout`, the mounted window (`first`/`last`),
  `currentPage`, `scale`, and `zoomMode`, and document information that
  changes rarely, through a small store read with `useSyncExternalStore`;
  scrolling and gesture previews recompute every frame but publish only
  changes.
- Layouts are immutable per zoom level. The runtime sizes the content element
  imperatively so zoom can restore the anchored scroll position before React
  re-renders the mounted pages. A zoom keeps its anchor as a share of the same
  page in both directions: a share of the content's width moved points on a
  page narrower than the content sideways.
- Zoom gestures preview with a CSS transform of the content around the
  content point where they started, and then commit like `setScale`, that
  point at the place the preview shows it. `ViewerGestures`
  (`runtime/gestures.ts`) owns them and "page" mode's swipes, through a
  small host interface of the runtime's; how the scroller moves and where
  its edges are is in `runtime/scrolling.ts`:
  - Ctrl or meta with the wheel, which trackpad pinches produce in Chromium
    and Firefox, commits 150 ms after the last event.
  - Two touches commit when either lifts. `PdfViewport` sets `touch-action:
    pan-x pan-y`, so one finger still scrolls natively, but a pinch reaches
    the runtime's pointer listeners instead of zooming the page. Chromium then
    does not scroll with two fingers either and keeps their pointers, so the
    preview pans with their midpoint; their zoom starts once their distance
    changed by 16 CSS pixels, so a two-finger drag or tap only scrolls.
    The touches are read once a frame, before the update in the animation
    frame callback, and before a lift or another commit (`readTouches()`).
    Browsers deliver the two fingers' moves one after the other, so read at
    each move, the distance measured the moved finger against where the
    other was a frame before, and a two-finger drag zoomed once one frame's
    movement changed that by 16 pixels: at 17 CSS pixels a frame with one
    finger above the other but not at 15, and from 100 side by side 300
    pixels apart, in all three browsers. A pinch now starts zooming relative
    to the distance of its first frame past the 16 pixels, so its ratio
    depends on how its moves fall into frames: Chromium's synthesized pinch
    out by 2 committed 2.04 to 2.14 over three runs, 2.14 each time when read
    at each move. `#update()` called directly, from a relayout, reads no
    touches: a pinch that started again there would preview against the
    layout being replaced.
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
  - The mounted window, `currentPage`, and the scheduler follow the part of
    the content the preview shows, the viewport mapped back through the
    preview's transform (`shownViewport()`), so the pages a two-finger drag
    or a zoom out brings into view mount and draw before the commit. The
    scheduler's `Viewport` keeps the scroller's width, which pages are
    centered in, apart from the width the preview shows. A drag's speed defers
    full-resolution work as scrolling's does. It is measured once a frame,
    since the moves of the two fingers come microseconds apart, and on the
    gesture: against scrolling's last move, a zoom's commit, which jumps to
    another scroll position, would look like a fling. While a preview zooms,
    it counts as fast scrolling, so only base renders start: the commit draws
    the pages again at its zoom. Following the scroll position alone, which a
    preview leaves in place, left a blank band below the mounted pages during
    a long two-finger drag at a low zoom, 218 CSS pixels in the iPadOS
    simulator.
  - In Safari on iPadOS, a pinch that starts while a fling still scrolls
    reaches the page through no event at all: the fling stops, the zoom does
    not change, and a second pinch works.
- `setScale("fit-width")`, which `initialScale` defaults to, sets `zoomMode`
  to "fit-width": the current page is fitted to the viewport's width again
  whenever that width changes, the view turns, or the background pass learns
  that page's real size, like pdf.js's "page-width".
  A numeric `setScale`, `zoomBy`, and wheel zoom set it to "custom". The
  scroller keeps a stable scrollbar gutter, so a scrollbar that comes and
  goes cannot refit back and forth.
- Each page is centered in the viewport, and a page wider than the viewport
  starts at the gap: `pageLeft()` in `layout.ts`, used for visible areas,
  destinations, and search scrolling. `PdfViewport` places pages by the same
  rule in CSS against the scroller's width (`100cqw`; the scroller is a size
  query container), so a resize moves pages without a React render.
  Centering pages in the widest page's width pushed narrower pages past the
  viewport's right edge. In "horizontal" and "page" mode, rows are centered
  in the viewport's height the same way: `pageTop()` and `100cqh`.
- Scroll modes (`scrollMode`, `setScrollMode()`) follow pdf.js's viewer.
  `computeLayout()` breaks the pages into rows of whole spreads: one per row
  in "vertical" and "page" mode, all of them in "horizontal", and as many as
  fit the scroller's width with the gaps in "wrapped". A resize fills wrapped
  rows again only once a page moves to another row (`sameRows()`); rows are
  centered in CSS, so other resizes need no layout. "page" mode puts every
  row in the same place and shows one (`shown`, which `showPage()` switches
  without new arrays): the content is sized to that row and clips the others
  (`overflow: clip`), which stay mounted within the overscan, hidden, so the
  next row has pixels before a flip shows it. Without the clip, hidden rows
  widened the scroll range: to 1,507 px for a 1,024 px wide spread at
  "fit-page".
  `goToPage()`, `nextPage()`, `previousPage()`, links, search, and `back()`
  show the row they need, and keys that would scroll past an edge of the row
  shown flip it (Page Down, space, and ↓ at its bottom, → at its right edge,
  and back the other way), showing the next row from the edge they crossed
  at the same place along the other axis; the wheel only scrolls within a
  zoomed row. A one-finger swipe of 50 CSS pixels within 30° of an axis
  flips too (left or up forward, right or down back), only past an edge
  the row was scrolled to both when the finger went down and when it
  lifted, so a swipe within a zoomed row scrolls it and the next one from
  its edge flips; two fingers, a selection made during the touch, a touch
  on a form control, and a chosen annotation tool do not flip. It listens
  to touch events: Chromium cancels the touch's pointer at its first move
  even with nothing to scroll (a pointercancel after one pointermove, then
  touchmoves to the touchend). The fling a swipe leaves goes on into the
  flipped row, 102 CSS pixels down in Chromium: the scroller loses its
  overflow until the reader touches, presses, wheels, or types, or for a
  second, since one frame or 300 ms left 5 pixels of it once the overflow
  was back; the hold restores the overflow `PdfViewport` sets inline.
  Before, a swipe never flipped: at "fit-page", and at "fit-width" on a
  phone, a row shown whole had nothing to scroll, so only the
  application's buttons turned pages; pdf.js's viewer component has no
  swipe either. "fit-width" and "fit-page" fit one page, not a
  spread, in "horizontal" mode, as pdf.js does. The mounted window is
  rounded out to whole rows except in "horizontal" mode, and scrolling's
  speed is measured along the axis pages follow each other on.
- `currentPage` is the page nearest the viewport's center, but the current
  page stays current while all of it is in view, as in pdf.js's viewer, and
  navigation (`goToPage()`, links, `back()`, search) makes the page it shows
  current. At the start of a horizontal row of portrait pages fitted to the
  viewport's height, or of wrapped rows, the page at the center was the
  second or third. A page taller than the viewport is never all in view, so
  at "fit-width" the current page is still the one at the center.
- Scroll modes cost what the pages they bring into view cost
  (`results/scroll-modes-browsers.md`, `main-thread-scroll-modes*.md`:
  `synthetic-text-1000.pdf` on released pdf.js with GPU canvases, measured at
  6d85eb8, before pdf.js shipped in the package). The scroll benchmark
  scrolls sideways in "horizontal" mode and downward in the others; "page"
  mode flips instead and is not measured. In all three browsers, at 900 and
  3600 CSS px per second and at "fit-width", "fit-page", and 0.5 CSS px per
  point, no run left any of the viewport blank, and the median run dropped
  no frame, except one of 289 in WebKit in "horizontal" and "wrapped" mode
  at 0.5 and 900 px/s; the worst run dropped 6 (WebKit, "wrapped" at 0.5
  and 900 px/s). In every run, React committed exactly as often as the store
  published a new mounted window or current page, 1 to 17 times a second
  against 60 frames (72 in WebKit). Fast sideways scrolling defers full-resolution renders as
  vertical scrolling does: at 3600 px/s and "fit-width", 11 bases and no
  detail (vertical: 9 and none). "wrapped" at "fit-width" and "fit-page"
  lays out one page per row, as "vertical" does, and shows the noise of main
  thread blocked: up to 7 ms apart in Chromium, 12 in WebKit, and 23 in
  Firefox.
  - "horizontal" at "fit-width" costs what "vertical" does: main thread
    blocked within that noise in every browser and speed, and in Chromium's
    profile, slow scrolling took 74 against 69 ms of main-thread tasks and
    four zoom steps 84 against 72, within the runs' spread.
  - At "fit-page" and at 0.5, pages are narrower than they are tall, so the
    same speed crosses 1.3 times as many pages sideways (22 against 17 at
    3600 px/s and "fit-page"), and the window, which is not rounded to rows
    there, changes when a page enters and again when one leaves (41 against
    16 changes). Chromium blocked 39 against 8 ms at "fit-page" and 3600
    px/s and 50 against 24 at 0.5; its profile of that scroll at "fit-page"
    found 270 against 187 ms of tasks, most of it drawing (`fillText` 48
    against 31 ms for 21 bases against 16), which released pdf.js does on
    the main thread. WebKit at 0.5 and 900 px/s blocked 38 against 6 ms and
    Firefox 83 against 44; the other cells are within the noise.
  - "wrapped" at 0.5 fits four pages to a row and crosses three times as
    many pages as "vertical" at the same zoom and speed (28 against 9 at 900
    px/s, 109 against 36 at 3600) and draws three times as many, while
    commits stay per row (24 against 23 at 900 px/s). Main thread blocked
    1.6 to 18 times as long: 60 against 16 and 168 against 24 ms in Chromium,
    113 against 6 and 57 against 22 in WebKit, and 167 against 44 and 286
    against 175 in Firefox, with longest stalls of 11, 15, and 18 ms. In
    Chromium's profile, slow scrolling took 292 against 147 ms of tasks:
    drawing (`fillText` 30 against 14 ms) and the style and layout that
    reading the scroll position flushes over the larger number of mounted
    pages (`viewportOf` 30 against 13 ms). Four zoom steps took 183 against
    124 ms, rewrapping the rows included.
- Each mounted page stacks a base canvas (half a device pixel per CSS pixel,
  at most 2 MP) under a detail canvas at full device resolution, which has a
  spare beside it (see below). A page whose
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
  A render clears its canvas, and the canvas stays hidden until the render
  completes: a resized canvas with pdf.js's opaque context is black, pdf.js's
  renderer worker sends its first frame a round trip later, and pdf.js
  drawing on the main thread fills the canvas white before it draws over it
  in chunks, one per animation frame. A page that shows a detail draws the
  next one into the spare detail canvas, and the two change places when it
  completes, as pdf.js's viewer replaces a page's canvas only once the new
  one is drawn: after a zoom, the page shows its old detail, scaled by CSS,
  meanwhile. `commit-bench.ts` reads what the pages in view show in every
  frame after ten kinds of zoom commit, three runs each
  (`results/commit-*.md`). Drawn in place, as in 258f693, a page showed white
  in 39, 39, and 49 frames over nine of them in Chromium, WebKit, and
  Firefox, for up to 48, 100, and 154 ms; hidden while drawn, from 99b435b
  to 8e33a94, it showed only its base, at a quarter of the device's
  resolution, in 36, 36, and 38 frames, for up to 46, 111, and 64 ms; now in
  none, nor at Chromium's CPU slowed down four times, where the white lasted
  up to 119 ms and the base 106. In Safari in the iPadOS simulator the white
  lasted 80–175 ms and the base 100–130 ms, and neither showed after a pinch
  out, a pinch in at the document's start, or a pinch in while dragging. A
  stale whole-page detail that stays until its replacement needs no base
  under it, so the ten commits draw half as many bases (16, 15, and 16
  against 32, 34, and 34, the sum of the medians) and about as many details,
  and the pages in view are sharp after 3–36, 4–36, and 4–90 ms against 11–173,
  12–150, and 29–102, except after zooming to 5 and back, which draw the
  same as before and took up to 12 ms more or less. The cost: a commit holds
  the old and the new details while the new ones are drawn, up to 25–28 MiB
  more canvas memory at its peak, 115–118 against 89 MiB after a 10% zoom
  step. Within `maxCanvasPixels`, a detail that does not fit beside the old
  one is drawn in place, over the base. `check:pinch` reads the canvases in
  every frame after a pinch out and a pinch in commit, and fails on 258f693
  and 8e33a94: `hasPixels()` held while pages showed white, so checks of it
  had seen nothing.
  A canvas a page gives back is zeroed and hidden: Chromium paints a canvas
  with pdf.js's opaque context black over its whole box once its size is
  zero, so pages showed black after a turn until they were drawn again, and
  a zeroed detail canvas stacked over the shown one turned the page black,
  which `check:features` caught.
  Unmounted pages zero their canvases and release pdf.js page data.
  `sharpness()` reports the resolution of the visible pixels as a share of
  full device resolution. The zoom goes up to 10 CSS pixels per point.
- `engine/bundled.ts` loads pdf.js when the first `PdfDocument` renders in a
  browser (`preloadPdfjs()`): it imports `pdfjs-dist` and at once starts the
  shipped worker, whose file list (`pdfjs-files.ts`, 3.1 KB with gzip in a
  Vite build) is in the bundle, so that the worker's download overlaps pdf.js's module instead
  of following it, and gives the worker to the one pdf.js adapter every viewer
  shares once its script runs. A worker that fails to load leaves pdf.js to
  start its own, or to parse on the page, as before; a cross-origin worker
  script is left to pdf.js, which starts it from a `blob:` URL. `PdfDocument`
  also preloads a URL source's PDF with React's `preload()` while it renders,
  matching the CORS mode pdf.js fetches with, so pdf.js takes the response;
  with server rendering the preload is in the page's head. With 100 ms added
  to every request and 20 Mbit/s in Chromium, page 1 showed 115–129 ms sooner
  than with 0.2.0 set up as its README said, and within 3–16 ms of 0.2.0 with
  pdf.js in the main bundle and a preload written by hand
  (`results/startup-bundled.md`, from setups run in turn, one job each, five
  times over). The demo waits in a Suspense boundary only for a data source's
  bytes: waiting for 0.2.0's engine there held page 1 back by 270 ms on
  localhost. Headers and `disableStream`, which no preload can match, skip it.
- Bundlers give every shipped file a URL of its own, but pdf.js's worker
  fetches CMaps, standard fonts, decoders, and ICC profiles as a directory
  URL plus a file name. So the worker's URL carries the files' URLs by name,
  as JSON in its fragment, and the prelude in front of pdf.js's worker code
  sends the worker's `fetch` and synchronous XHR requests for those names to
  them; pdf.js gets `parapdf:/` as their directory. The worker must fetch
  them itself (`useWorkerFetch`): pdf.js manages ICC colors only then, and
  CMYK red came out as rgb(255 46 23) instead of rgb(236 31 37) when the main
  thread fetched them through a `BinaryDataFactory`. The standard fonts'
  directory stays unset, because pdf.js also adds fonts from it to the page
  as a CSS `url()` fallback for missing system fonts, which every browser
  logs as an error when the URL does not load; the worker then asks for
  "null" plus the font's name, which the prelude also routes. The worker,
  1.2 MB, keeps any bundler from inlining it as a `data:` URL: a separate
  1.6 KB entry was inlined by Vite, and pdf.js started it from a `blob:` URL,
  which a strict CSP refuses. The other files' and the annotation icons' URLs
  end in `?no-inline&url`, since bundlers inline small files: Vite any under
  4 KB unless the query has `no-inline`, and Rsbuild images and fonts unless
  it has `url`. Without the query, a Vite 8.3 build that configured nothing
  held 134 of the 168 CMaps and the 11 icons as `data:` URLs in the bundle
  every viewer loads: the file list, in a chunk of its own, weighed 146,001
  bytes, 52,557 with gzip, against 17,793 and 3,143 with it; in an Astro 7.4
  application, the client chunk with the viewer and the list weighed 260,250
  bytes, 91,958 with gzip, against 132,090 and 41,294; and Rsbuild 2's main
  chunk weighed 116,969 bytes with gzip, the icons inlined, against 111,403.
  webpack, which keeps the query in the URLs it emits, and Vite's
  build, which keeps `?url`, write the files without it, so `shippedUrl()`
  in `bundled.ts` takes it off. The workers get no query: Vite's
  development server answers a script requested with `?url` with a module
  that exports its URL. Vite 8 (development server and build), webpack 5,
  Rsbuild 2 (development server and build), and Next.js 16 (Turbopack and
  webpack, development and build) emit the files: on 2026-10-23, Vite 8.3.4,
  webpack 5.112.1, Rsbuild 2.2.14, and Next.js 16.4.2 served all 186 byte
  for byte at the URLs the worker got, and a comment's icon at the URL the
  annotation layer got. Parcel 2 wraps the worker in its own module system,
  which does not start, and esbuild and Bun copy nothing. Those take a copy of
  `pdfjs/` and `configurePdfjs({ assetBase })`, which uses pdf.js's own
  directory URLs.
- `configurePdfjs()` sets, before pdf.js loads, what the adapter takes: the
  adapter asks for GPU-backed canvases unless `enableHWA` is `false` (in an
  embedding app's preview they blocked the main thread for 256 instead of
  560 ms in Chromium, and 770 instead of 1,393 ms in WebKit, while panning a
  zoomed drawing); `documentOptions` (typed `PdfjsDocumentOptions`) adds
  getDocument parameters for every document, overriding `enableHWA` and the
  file options; `build: legacyBuild` (`parapdf/legacy`, `src/legacy.ts`)
  loads pdf.js's legacy build with the package's `pdf.worker.legacy.js`,
  the legacy worker behind the same prelude, whose URL lives in a module of
  its own (`pdfjs-legacy-files.ts`) so that only applications importing
  `parapdf/legacy` emit it; `pdfjs` with `workerSrc` and `assetBase` loads
  any other build, such as the demo's pdf.js master; and `rendererSrc`
  starts master's renderer worker. An embedding app found that with the
  legacy build set up through `workerSrc`, the shipped worker's early start
  and prelude did not apply and it still served its own 6.4 MB copy of the
  files; with `legacyBuild` it dropped that copy and its asset script, and
  its Next.js 16 static output fell from 14.5 to 9.4 MB, both workers
  included, with CMYK red at rgb(236 31 37) in WebKit. `passwordPrompt: false` (a viewer option) fails an encrypted
  document for that viewer instead of waiting, as before 0.3.0.
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
  between the pages, whether they are above and below each other or side by
  side. The nearest page is the nearest above or below first, then sideways. The browser still handles the press, so a click there
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
  engine and places an explicit top at the viewport's top edge; an explicit
  left scrolls sideways only when it is out of view, except in "horizontal"
  mode and for FitR. With `destinationZoom` (default true), it also takes
  the zoom the destination asks for (`ResolvedDestination.view`), as
  pdf.js's viewer does: XYZ's factor times 96/72 (0 and null keep the
  zoom), Fit as "fit-page", FitH as "fit-width", FitV the page's height
  within the gaps, and FitR the rectangle filling the scroller, from its
  top-left corner as the page shows it (on a page whose /Rotate turns it,
  the corner of the turned rectangle, not FitR's left and top). FitB* fit
  like Fit*. Link and outline jumps push the previous position (a page
  plus a fraction, so zoom does not invalidate it, the current page, and
  the zoom) onto a 50-entry back stack exposed as `canGoBack` and `back()`;
  `back()` moves it onto a forward stack (`canGoForward`, `forward()`), and
  a new jump clears that, as browsers do. Both restore the zoom, fitted
  zooms fitted to the viewport as it is now, since a destination may have
  changed it. The `GoBack` and `GoForward` named actions call them. The
  outline loads in the background after the first layout.
- View states (`getViewState()`, `setViewState()`, `initialViewState`) are
  plain objects: the page at the viewport's top-left corner, the point of
  it there in PDF points of the page unturned by the view (with its own
  /Rotate, as `ResolvedDestination`, so a view kept at one zoom, rotation,
  or viewport size lands on the same text in another), the zoom or the fit
  that keeps it, rotation, spread, and scroll mode. The gap above a row
  belongs to it, so a page shown from its top by `goToPage()` is that page
  with a small negative `y`, not the page above. Showing one sets the
  arrangement and zoom, lays out once, and places the point with `#jump()`
  scrolling sideways too (`exact`); it pushes no back entry. At open,
  `initialViewState` replaces `initialPage` and the /OpenAction jump, so
  nothing is drawn at another place first; with `initialView: "document"`,
  the fields it leaves out take the document's. A "fit-width" view fits
  again around the viewport's center when the viewport resizes later, as
  any fitted zoom does.
- The document's initial view (`getInitialView()`: /OpenAction's
  destination, /PageLayout, /PageMode) is published as `documentView` in
  the background. With `initialView: "document"`, the viewer fetches it
  beside the first page's size and applies it before the first layout:
  /PageLayout maps to spreads and scroll modes as pdf.js's
  `apiPageLayoutToViewerModes()` does (TwoColumn* to "odd" and "even"
  spreads, TwoPage* and SinglePage to "page" mode), and the destination is
  shown like a link's, without a back entry. Options the application set
  win: `initialPage` over the destination, `initialScale` over its zoom,
  `spread` and `scrollMode` over the layout. /PageMode only reaches the
  application, whose panels the runtime does not own; the demo opens its
  sidebar for it.
- Permissions (`getPermissions()`, pdf.js's `PermissionFlag`s; everything
  for documents that are not encrypted) are fetched beside the first page's
  size and published as `permissions`. With `enforcePermissions` (default
  false, as pdf.js's `enablePermissions`), the viewer follows them: without
  `copy`, the pages element has `parapdf-no-copy`, which makes text runs
  unselectable as pdf.js's viewer CSS does, and copy and cut events there
  are prevented; without `print`, `print()` throws; the annotation editor
  needs `annotate` (PDF 32000-1, Table 22; pdf.js asks for
  `MODIFY_CONTENTS`), and form fields render as HTML with `fillForms` or
  `annotate`, as in pdf.js. Text layers stay, so assistive technology and
  `getText()` still read the text.
- Form data (`engine/pdfjs-forms.ts`): `getFormFields()` lists fields from
  the display annotations of the pages `getFieldObjects()` names, since
  field objects lack `required` and all of a list's selections, with each
  value read from pdf.js's `annotationStorage` (a `{ value }` per widget:
  text, whether a box or radio button is checked, or the selected options)
  and the document's own value where nothing was stored. `setFormValues()`
  writes the same storage, clears a text field's `formattedValue`, and
  invalidates the content so form layers are built again from it.
  `onFormChange()` listens on the pages element: text fields and lists
  store at `input`, boxes and radio buttons at `change` (their `input`
  comes first, before pdf.js stores anything, and reported "Off" for a box
  just checked), and the field is found by the element's
  `data-element-id`.
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
- `getText()` reads the document's text from the engine's `getText()`, the
  page text the search index is built from and the text layer lays out,
  for every page between `from` and `to`, four pages requested ahead of the
  one read. `pageText()` (`runtime/document-text.ts`) joins a page's items
  with "\n" where lines end, or, with `lineBreaks: "join"`, through
  `joinLines()`, the search index's rules for line ends (`text-search.ts`),
  without its normalization; points (`TextPoint`: a page, an item, and a
  UTF-16 offset) cut it as search matches and selections do. A match may
  span a hyphenated line end, which "keep" reads as "Appro-\npriations".
  `getSelection()` maps the selection's ends to points through the text
  layer's runs, one per item. Extending the DOM selection over every page
  would need every page's text layer mounted.
- Annotation editing (`annotationEditing`, `engine/pdfjs-editor.ts`, and
  its styles, `react/editor-styles.ts`) loads as chunks of their own, when
  a viewer that edits opens a document (`createAnnotationEditor()` imports
  it) and through `React.lazy` for the styles, so applications that do not
  edit annotations carry neither: 4.4 and 4.3 KB with gzip in the demo's
  Vite build, which took 7.6 KB off its main chunk.
  It runs on pdf.js's display API: one `AnnotationEditorUIManager` per viewer, an
  `AnnotationEditorLayer` per mounted page (`.parapdf-editor-layer`, over
  the annotation layer), and a `DrawLayer` per page whose highlight and
  ink SVGs go into the canvases' parent (`.parapdf-canvas-wrapper`), as in
  pdf.js's viewer. The manager hears of zoom commits, turns, and the
  current page through a small event bus of ParaPDF's (`scalechanging`,
  `rotationchanging`, `pagechanging`) and reports undo, selection, and
  styles back (`editingstateschanged`, `annotationeditorparamschanged`),
  published as `annotationState` and `annotationStyles`. The scheduler
  builds editor layers in the idle DOM pipeline, after a page's text layer
  and before its links; the editors themselves live in the manager and in
  the document's `annotationStorage`, so pages that unmount take only
  their layer down, and `saveDocument()` and printing (`ENABLE_STORAGE`)
  include them.
  - Drawings, highlights, and images record an undo step that removes
    them whenever a layer adds them, which a page's new layer does for the
    annotations it shows again: undo then removed an annotation created
    long before instead of the reader's last step. pdf.js's viewer does the
    same once a page leaves its page buffer (mozilla/pdf.js#22270); in
    ParaPDF, whose pages unmount two pages out of view, it happened all the
    time. Highlights and images also focus themselves as a layer adds them,
    which took focus from the application's controls when the page mounted
    again with a tool chosen (`check:annotations` failed without the fix);
    with no tool, the new layer is hidden while it adds them, and pdf.js's
    viewer builds every layer hidden. `quietly()` hides the layer and makes
    the manager's `addCommands` run commands without recording them, for
    the synchronous part of `render()` and of imports.
  - Annotations the PDF holds stay drawn on the canvas and in the annotation
    layer: the editor layers get no `annotationLayer`, so pdf.js does not
    turn them into editors, and no page has to be drawn again without them
    when a tool is chosen. The annotation layer's sections take no pointer
    while a tool is chosen (`parapdf-annotating`), as pdf.js disables its
    annotation layer.
  - Exports are pdf.js's copies (`serialize(true)`, what it pastes), plain
    arrays for typed arrays, and for highlights, which have no copy, what
    the PDF saves; imports deserialize them with `isClone`, which pdf.js
    places where the copy was instead of beside it. A text annotation still
    moves up by its font size, which pdf.js applies to every new one where
    it was clicked, and is moved back; pdf.js's own clones, of pasted
    pages, move too (mozilla/pdf.js#22271). Images are decoded before their
    editor is created, so it draws them at once: on a page that is not
    mounted, the editors are created on a layer outside the document and
    left with the manager, as those of an unmounted page are.
  - Selecting an annotation of another kind asks for its tool
    (`switchannotationeditormode`), which ParaPDF follows, except while the
    application switches tools: finishing the text being typed selected it
    and switched back to the text tool. pdf.js's viewer ends in the tool
    chosen, as its toolbar button takes focus from the text first.
  - In Playwright's WebKit 27.2, a signal from `AbortSignal.any()` that
    nothing references is collected, and aborting its sources then no
    longer removes listeners added with it: the window listener of a
    finished drawing stayed, and every later press threw a TypeError in it
    (3 errors without the fix, 0 with every such signal kept referenced).
    The manager's `combinedSignal` keeps each signal until it aborts. The
    same steps in pdf.js's viewer (6.5.262) threw nothing, and a standalone
    page did not reproduce it; reducing it for WebKit is yhay81/parapdf#1.
  - pdf.js initializes its editor classes once, with the first manager, and
    keeps that manager's view parameters in the defaults of new drawings;
    in pdf.js's viewer, a line drawn at 200% after opening another document
    was stroked 1.33 px wide instead of 2.67 (mozilla/pdf.js#22272). A new
    manager resets `AnnotationEditorLayer._initialized`, so the newest
    viewer that edits sets them.
  - pdf.js marks the elements its editors create with Fluent ids, which only
    its viewer translates; a `MutationObserver` per editor layer gives them
    `annotationLabels` as accessible names and titles. The alt text and
    comment buttons are hidden: ParaPDF shows no dialogs.
  - A viewer that edits annotations holds its own document
    (`acquireDocument(…, owner)`): annotations live in the document's
    storage, which another viewer of it would save too, and the editor ids
    of two managers would collide. StrictMode's second mount, by the same
    runtime, still reuses it. A viewport that detaches exports the
    annotations and the next one imports them; closing the document
    removes them from its storage.
- `usePdfDocument()` returns pdf.js's `PDFDocumentProxy` of the open
  document, for APIs ParaPDF does not wrap; the runtime publishes the
  engine's document as `document`, whose `native` it is.
- Features that other React PDF viewers have, added in one pass after 0.2.0
  so ParaPDF is not behind them (react-pdf 11, EmbedPDF, pdf.js's own
  viewer, and react-pdf-viewer, archived in March 2026):
  - Encrypted documents: the engine's `open()` takes `OpenOptions`
    (`onProgress`, `password`, `signal`). `acquireDocument` passes a shared
    document's progress and password requests to every viewer of it,
    replays them to viewers that join late, lets any of them answer
    (`submitPassword()`; null gives up), and aborts a load still waiting
    when its last viewer leaves. The viewer publishes `status: "password"`,
    `passwordReason`, and `progress` (once a frame).
  - Forms: with `forms`, renders pass the page's annotation container as
    `formLayer`, which the pdf.js engine turns into
    `AnnotationMode.ENABLE_FORMS` plus a per-container `annotationCanvasMap`:
    pdf.js draws check boxes and radio buttons into canvases of their own,
    one per state, which the annotation layer takes after it is built and
    again after every render (`refreshCanvases()`). Values live in pdf.js's
    `annotationStorage`, so a page's fields keep them when it remounts;
    `save()` is `saveDocument()` once anything was typed. A page drawn with
    forms is not copied into thumbnails, as in pdf.js. The viewer CSS keeps
    pdf.js's widget and popup rules: without the popup rules, comment
    popups used to open as unstyled transparent text. pdf.js builds a
    comment icon's URL from one base (`imageResourcesPath`), which the files
    a bundler emits do not share, so with the shipped files the engine
    gives the layer a transparent data URL as the base and then points each
    icon, named in the URL's fragment, at its emitted file (`placeIcons()`).
  - Layers: each viewer gets a `LayerState` from the engine (pdf.js's
    display `OptionalContentConfig`) that renders, annotation layers,
    thumbnails, and printouts take. It loads beside the first paint, not
    before it: until it arrives, renders draw the document's default
    layers, which it starts with (`setLayers()`). A change bumps the scheduler's content
    version (`invalidateContent()`): pages are drawn again but keep their
    old pixels meanwhile, and annotation layers are rebuilt. pdf.js refuses
    a display configuration for a print render, so printing replays the
    viewer's changes on a print configuration.
  - Thumbnails (`ThumbnailRenderer`) take render slots only when no page
    layer waits, and leave one slot free for the next page that scrolls in
    (`RenderScheduler.enqueue`); they copy a page's whole-page drawing when
    it is at least as large. An `IntersectionObserver` per scroll container,
    with a margin of its height, draws thumbnails near view and clears the
    rest, which bounds their canvas memory.
  - Printing (`runtime/print.ts`, after pdf.js's `PDFPrintService`): pages
    drawn one at a time with the print intent into PNG images in a
    print-only container, `@page` sized by the first page.
  - Spreads: the layout has rows (`rowTops`, `rowWidths`, `rowHeights`,
    `rowFirst`, `rowLast`, `offsets`); each row is centered like a page used
    to be, and pages are centered vertically in their row.
    `pageAtPoint()` picks the page under a point, which zoom anchors and the
    current page use. Fitting in a spread mode counts two pages, as pdf.js
    does, so the zoom stays the same from row to row.
  - Tagged PDFs: `engine/struct-tree.ts` ports pdf.js's
    `StructTreeLayerBuilder`. Each page renders a 0×0 canvas
    (`.parapdf-structure`) whose fallback content, as in pdf.js's viewer,
    holds the tree: read by assistive technology, never drawn or selected.
    The text layer's marked-content spans carry the ids it owns. The
    annotation layer gets the same builder for the labels the tree gives
    annotations.
  - Also: page labels, metadata, attachments and file attachment
    annotations (`openAttachment`), "fit-page", Ctrl or ⌘ with +, -, and 0
    on the viewport, `initialPage`, the hand tool (pointer capture on the
    scroller; a prevented `pointerdown` also suppresses the mouse events the
    selection tracker listens to), search options (`caseSensitive`,
    `entireWord`, `matchDiacritics`), `getSelection()` in unturned PDF
    points, and `pageColors`.
- Browsers: `check:text`, `check:links`, `check:lifecycle`,
  `check:rotation`, `check:options`, `check:pinch`, `check:bundle`,
  `check:features`, `check:scroll`, `check:annotations`, and `check:document` pass in Playwright's Chromium,
  WebKit, and Firefox. Playwright's WebKit keeps no
  HTTP cache, so it downloads a preloaded PDF again (it fetched a response
  with `max-age=3600` twice as well); `check:bundle` reports that as a note.
  Whether Safari takes the preload is not verified yet. Playwright's WebKit cannot put two fingers
  down, and its `GestureEvent` is a function whose objects are not events, so
  touch and Safari's gesture events were checked by hand in Safari 27 in the
  iPadOS 27 simulator (iPad Pro 11-inch): pinches, the point between the
  fingers, one-finger scrolling, long-press text selection, and two-finger
  drags behave as described here, pointer events drive pinches there, Safari
  never cancelled their pointers, and its gesture events carry `clientX` and
  `clientY` at the fingers' midpoint. After their commits, no page in view
  showed blank or only its base there, read from the canvases as
  `check:pinch` reads them. Safari on macOS and real iOS and iPadOS devices
  are not verified yet. WebKit has neither
  `requestIdleCallback` nor `scheduler.yield`, so idle text and annotation
  layers fall back to a 16 ms timer and search yields through `setTimeout(0)`.
- Not yet implemented: editing the annotations a PDF already holds, comments
  on created annotations, form scripts (pdf.js's sandbox: calculations,
  validation, and button actions), XFA forms, right-to-left page order
  (/ViewerPreferences /Direction), text
  layers for pages outside the mounted window (`getText()` reads their
  text), and a highlight fallback for browsers without the CSS Custom
  Highlight API.

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
    scroll and control results measured before this fix ran at
    devicePixelRatio 1; `firefox.md`, `browsers.md`, and `control.md` in
    `examples/prototype/results/` were measured again on 2026-10-20 at 2.
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
- A hybrid engine, measured on 2026-10-18 and 19 and not shipped, drew
  image-only pages (scans) with hayro and everything else with pdf.js: a
  hayro-syntax classifier in the worker sent a page to hayro when it had no
  visible text, an image over half its crop box, at most 64 path segments,
  no shadings, and no annotation appearances. Against `pdfjs-next-hwa`, the three
  scans showed their first paint 10–124 ms sooner and base renders took a
  third to two thirds of the time, but detail renders took 3–9 times as long
  in Chromium and up to twice as long in WebKit and Firefox, since hayro
  decodes a page's images for every render where pdf.js keeps them; hayro's
  wasm memory grew by 51–103 MiB per scan and never shrank, and Firefox's
  main thread was blocked 4–6 times longer while scrolling two of the scans. Results:
  `examples/prototype/results/hybrid*.md`. The code, its benchmark and
  checks, and a benchmark of ways to show worker bitmaps are kept in the tags
  `experiment/hybrid-hayro` and `experiment/hybrid-hayro-decode-once` (which
  rendered a hayro page once for both canvas layers, unmeasured); both start
  from the API before the engine became internal.
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
