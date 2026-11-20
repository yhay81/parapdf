# 0051. Controller-owned page hosts, batched rendering, exact settle timers, uniform zoom previews, and streaming search

- Status: adopted
- Date: 2026-11-20

## Decision

Following a theoretical-limit audit of ParaPDF's runtime across `pdfjs/`,
`document/`, `view/`, `render/`, `features/`, and `react/`
(`docs/architecture.md`), the runtime adopts the following changes.

1. **Microtask-batched page-mount and extra-render scheduling with deferred
   `copyPage` skip (`Renderer.attach()`, `Renderer.enqueue()`,
   `ThumbnailRenderer.#draw()`)**. The viewer mounts `[first..last]` in
   ascending order (for example `[48, 49, 50, 51, 52]` when opening or jumping
   to page 51), and sibling `<PdfThumbnails>` mounts before `<PdfViewer>` in
   typical JSX layouts. Synchronous `#pump()` calls inside `attach()` and
   `enqueue()` previously started offscreen overscan pages (`48`, `49`) or
   sidebar thumbnails (`0`) ahead of the visible `focus` page (`50` or `0`),
   consuming both concurrent render slots and causing transient peak-canvas
   overshoots on zoom commits. `attach()` and `enqueue()` now coalesce onto a
   single microtask `#schedulePump()` (included in `renderer.busy` and cleared
   when `update()` pumps synchronously), `#extras` wait until
   `!#waitingForPixels()`, pick the queued job nearest `focus` (preserving FIFO
   on ties), and evaluate an optional `skip` callback before starting `drawPage`
   so `ThumbnailRenderer` copies a just-finished main-viewer canvas in place
   rather than rendering the same page twice.
2. **Exact remaining scroll-settle timer without extra animation-frame delay
   (`ViewerController.#update`)**: `#settleTimer` previously armed a full
   `SETTLE_DELAY` (`120 ms`) from the first scroll frame and scheduled
   `#requestUpdate()` when firing; when scrolling stopped mid-window, the timer
   fired early, re-armed another `120 ms`, and waited an extra `16.7 ms` frame
   (~230 ms total instead of ~121 ms) before unlocking sharp detail renders,
   idle `DomLayers`, background `measurePages()`, and `onViewStateChange`. It
   now schedules `Math.max(1, Math.ceil(SETTLE_DELAY - elapsed) + 1)` and calls
   `#update()` directly when no animation frame is already pending, while
   `#update()` skips `visibleArea()` when `currentPage === focus` and skips
   `store.set()` when `{ first, last, currentPage }` are unchanged.
3. **Worker-pipelined optional-content layers and zero-overhead empty
   `StructTree` / `AnnotationLayer` paths (`ViewerController.#load`,
   `preloadDocument()`, `LayerState.configPromise`, `pdfjs/text.ts`,
   `pdfjs/annotation-layer.ts`, `DocumentSession.measurePages()`)**: `#load()`
   and `preloadDocument()` kick off `session.layers()` alongside `pageSizes()`,
   `permissions()`, and `direction()` so `GetOptionalContentConfig` pipelines in
   the initial worker burst and `LayerState.configPromise` is reused across
   renders without per-draw `Promise.resolve` wrappers. `buildTextLayer()` now
   returns `structTree: null` when `StructTreeBuilder.build()` yields `null` on
   untagged pages (avoiding spurious `getAnnotationIds()` /
   `getAriaAttributes()` awaits), `annotation-layer.ts` skips empty-layer
   `querySelectorAll` walks, and `measurePages()` reuses page 1's `PageSize`
   object and `#firstSizes` array when all pages share uniform dimensions.
4. **Shared single-page `Layout` arrays, uniform zoom previews, and
   allocation-free planner fast paths (`view/layout.ts`, `view/gestures.ts`,
   `render/planner.ts`)**: In `"vertical"` and `"page"` modes with
   `spread: "none"`, `computeLayout()` shares `rowTops === tops`,
   `rowWidths === widths`, `rowHeights === heights`, and `rowFirst === rowLast`
   (5 typed arrays instead of 9, 44% less layout memory) and records
   `layout.uniform`. During high-rate wheel/pinch zoom gestures on uniform
   single-page layouts outside `"wrapped"` mode, `ViewerGestures.#previewZoom`
   computes exact target scroll coordinates and content bounds in O(log N) via
   `previewZoomMetrics()` instead of running O(N) `computeLayout()` on every
   event, and writes `transformOrigin` once per gesture. In `planner.ts`,
   `staleDetail()` returns a shared constant immediately when a page holds and
   draws no detail, and `plan()` sorts mounted pages once, caches `detailPlan()`
   across slots, and skips settled-only phases during fast scrolling.
5. **Streaming typed-array `buildPageIndex()` and incremental `SearchHighlights`
   (`features/search/text-search.ts`, `highlights.ts`, `index.ts`,
   `features/text/document-text.ts`)**: `buildPageIndex()` replaces its
   per-character `SourceChar` object array, `joinLines()` generator, and per-unit
   Unicode normalization / RegExp calls on ASCII with a 3-slot scalar lookahead
   queue, an inline ASCII fast path, a bounded 4,096-entry non-ASCII code-point
   cache per option mode, and pre-sized `Uint16Array` / `Uint32Array` buffers.
   `search/index.ts` binary-searches sorted `matches` per page, and
   `SearchHighlights` caches each page's `Range`s so 100 ms search progress
   publishes and `next()` / `previous()` navigation swap only the active `Range`
   in O(1).
6. **External-selection, sidebar-scroll, and popover-measurement guards
   (`render/selection.ts`, `features/selection.ts`, `react/PdfThumbnails.tsx`,
   `react/PdfSelectionPopover.tsx`)**: `TextSelectionTracker` tracks
   `#hasMarked` and skips layer loops, style resets, and `cloneRange()` on
   `selectionchange` events outside `#pages`; `features/selection.ts` reuses scratch
   `Range` instances across run/walker loops; `PdfThumbnails` bails out before
   `setBounds()` when `[first, last]` are unchanged; and `PdfSelectionPopover`
   caches the popover's border-box dimensions. Its `ResizeObserver` watches
   that same box so a change to padding or borders repositions the toolbar.
7. **Controller-owned page hosts and stable React portals.** `ViewerController`
   mounts the page window before it updates the renderer. New pages use a
   forward insertion cursor, so prepending pages or jumping to a disjoint
   window takes O(n) host lookups for n mounted pages. React owns overlays.
   The viewport contains one portal keyed by each active page, preserving
   `onPageClick` bubbling and the DOM of fixed overlays when dynamic ones
   toggle. Fixed overlays subscribe to their own page's host and layout.
   Dynamic overlays subscribe to changes to the mounted window.

## Evidence from the intermediate build

The measurements in this section cover changes 1–6 with React placing page
hosts. The [integrated scroll comparison](0052-search-memory-and-page-work.md#integrated-scroll)
includes the controller-owned hosts and the overlay and popover fixes.

Unit tests in [`renderer.test.ts`](../../packages/parapdf/test/renderer.test.ts),
[`layout.test.ts`](../../packages/parapdf/test/layout.test.ts),
[`text-search.test.ts`](../../packages/parapdf/test/text-search.test.ts), and
[`highlights.test.ts`](../../packages/parapdf/test/highlights.test.ts) verify
focus-first batched mounting across ascending `[48..52]` mounts, `copyPage`
skipping on queued thumbnail jobs, `previewZoomMetrics()` parity with
`computeLayout()` + `zoomTarget()` across scroll modes, directions, and
rotations, `buildPageIndex()` parity with `joinLines(sourceChars(page))` across
ASCII, CJK, hyphens, ligatures, marks, and supplementary characters, and
`SearchHighlights` `Range` reuse across `current` transitions.

[`scroll-bench.ts`](../../examples/prototype/scripts/scroll-bench.ts) (median of
5 runs, 4,000 ms scroll at 900 and 3,600 CSS px/s, 1280×900 at
`devicePixelRatio` 2, `fit-width`),
[`commit-bench.ts`](../../examples/prototype/scripts/commit-bench.ts) (median of
3 runs across 11 zoom-commit scenarios on `bill-hr815.pdf`, 820×1000 at
`devicePixelRatio` 2), and
[`return-bench.ts`](../../examples/prototype/scripts/return-bench.ts) (median of
3 runs across 4 return-trip scenarios on `bill-hr815.pdf`) compared the build
(`DIST`) against the commit immediately before it (`61725aa`, `BEFORE`) job by
job in the same run on an Apple M2 Pro on AC power in Playwright's headless
Chromium 159.0.8154.6, WebKit 27.2 (not Safari), and Firefox 159.0
([`scroll-theoretical-limits-chromium.md`](../../examples/prototype/results/scroll-theoretical-limits-chromium.md),
[`-webkit`](../../examples/prototype/results/scroll-theoretical-limits-webkit.md),
[`-firefox`](../../examples/prototype/results/scroll-theoretical-limits-firefox.md);
[`commit-theoretical-limits-chromium.md`](../../examples/prototype/results/commit-theoretical-limits-chromium.md),
[`-webkit`](../../examples/prototype/results/commit-theoretical-limits-webkit.md),
[`-firefox`](../../examples/prototype/results/commit-theoretical-limits-firefox.md);
[`return-theoretical-limits-chromium.md`](../../examples/prototype/results/return-theoretical-limits-chromium.md),
[`-webkit`](../../examples/prototype/results/return-theoretical-limits-webkit.md),
[`-firefox`](../../examples/prototype/results/return-theoretical-limits-firefox.md)):

| Browser & scroll workload | First paint, before → after (ms) | First paint runs, before vs after (ms) | Blocked, before → after (ms) | Max lag, before → after (ms) | Blank / dropped |
|---|---:|---|---:|---:|---|
| Chromium 159, 1,000p @ 900 px/s | 182 → 178 | `179,184,215,180,182` vs `177,178,184,177,201` | 10 → 9 | 8 → 7 | 0.0% / 0 |
| Chromium 159, 1,000p @ 3,600 px/s | 184 → 197 | `177,202,184,182,198` vs `180,235,319,197,181` | 63 → 58 | 13 → 11 | 0.0% / 0 |
| Chromium 159, 110p @ 900 px/s | 164 → 174 | `175,176,159,164,139` vs `175,139,174,174,159` | 18 → 16 | 9 → 11 | 0.0% / 0 |
| Chromium 159, 110p @ 3,600 px/s | 163 → 170 | `175,150,172,163,153` vs `172,170,137,139,177` | 46 → 40 | 12 → 12 | 0.0% / 0 |
| WebKit 27.2, 1,000p @ 900 px/s | 213 → 212 | `200,213,239,213,199` vs `196,217,212,212,206` | 25 → 18 | 10 → 9 | 0.0% / 0 |
| WebKit 27.2, 1,000p @ 3,600 px/s | 205 → 203 | `193,222,200,210,205` vs `204,183,229,202,203` | 26 → 24 | 8 → 10 | 0.0% / 1 |
| WebKit 27.2, 110p @ 900 px/s | 176 → 178 | `176,194,169,173,177` vs `179,169,178,154,191` | 81 → 78 | 14 → 14 | 0.0% / 1 |
| WebKit 27.2, 110p @ 3,600 px/s | 179 → 165 | `181,203,162,177,179` vs `192,165,165,154,180` | 48 → 39 | 9 → 10 | 0.0% / 1 |
| Firefox 159, 1,000p @ 900 px/s | 290 → 293 | `276,291,295,290,279` vs `316,274,292,293,293` | 75 → 55 | 17 → 13 | 0.0% / 0 |
| Firefox 159, 1,000p @ 3,600 px/s | 291 → 289 | `298,291,294,273,274` vs `289,292,287,290,265` | 96 → 97 | 13 → 12 | 0.0% / 0 |
| Firefox 159, 110p @ 900 px/s | 229 → 218 | `221,230,217,230,229` vs `233,218,200,218,248` | 64 → 65 | 18 → 16 | 0.0% / 0 |
| Firefox 159, 110p @ 3,600 px/s | 213 → 229 | `213,213,203,229,232` vs `200,229,229,206,230` | 94 → 89 | 17 → 15 | 0.0% / 0 |

Main-thread blocked time decreased in 10 of 12 scroll workloads (including all 8
in Chromium and WebKit, and `75 → 55 ms` and `94 → 89 ms` in Firefox, with +1 ms
ties on the remaining two Firefox workloads and lower maximum frame lag on all 4
Firefox workloads). Across all 33 `commit-bench.ts` scenario × browser pairs,
both builds recorded 0 blank frames and 0 base-fallback frames, while batched
mount pumping lowered peak post-commit canvas memory across zoom-up and zoom-out
commits in all three browsers (`pinch-out` 216 → 205 MiB in Chromium and WebKit,
230 → 216 MiB in Firefox; `scale-up` 237 → 222 MiB in Chromium and WebKit;
`zoom-out-far` 105 → 98 MiB in all three; `zoom-in-whole` 196 → 190 MiB in all
three; `zoom-twice` 201 → 185 MiB with 9 → 7 detail renders in Chromium, and
191 → 185 MiB in WebKit and Firefox; `ctrl-wheel` 212 → 201 MiB in WebKit and
226 → 212 MiB in Firefox; Firefox `zoom-in-far` time-to-sharp 222 → 109 ms, with
`zoom-twice` median time-to-sharp 14 → 24 ms in Chromium and 55 → 104 ms in
Firefox when the superseded intermediate zoom render is skipped rather than
partially reused). In `return-bench.ts`, zero-copy kept-canvas counts (`3`, `8`,
`18`, `6`) and 0 blank frames held identically across all three browsers
(`scroll-back` blocked time 24 → 7 ms in Chromium and 43 → 14 ms in Firefox;
single-frame timing variance on 3-run `jump-back` / `flip-back` under concurrent
background load in WebKit 10 → 21 ms and Firefox 6 → 15 ms).

Paired 5-run A/B measurements (`61725aa` vs `after`, alternating in turn in
fresh 1280×900 DPR 2 contexts on the same AC-powered run) isolated the targeted
operations directly:

| Browser | Cold open @ page 51 (`bill-hr815.pdf`), before → after (ms) | Post-scroll settle latency, before → after (ms) | 200 ctrl+wheel zoom previews (`1,000p`), before → after (ms) | 1,000-page `findText()` indexing, before → after (ms) | 50 `search.next()` steps, before → after (ms) |
|---|---:|---:|---:|---:|---:|
| Chromium 159 | 200.9 → 184.7 (-8%) | 232.1 → 140.9 (-39%) | 16.00 → 7.00 (2.29×) | 655.5 → 160.7 (4.08×) | 1.76 → 0.34 (5.18×) |
| WebKit 27.2 | 337.7 → 324.6 (-4%) | 229.9 → 142.0 (-38%) | 37.70 → 29.40 (1.28×) | 439.3 → 119.9 (3.66×) | 2.90 → 0.76 (3.82×) |
| Firefox 159 | 230.5 → 197.3 (-14%) | 227.3 → 142.1 (-37%) | 17.72 → 12.40 (1.43×) | 552.8 → 312.6 (1.77×) | 5.36 → 1.14 (4.70×) |

## Final build with controller-owned page hosts

The browser checks exercise the final behavior. [`check:options`](../../examples/prototype/scripts/check-options.ts)
clicks a dynamic page rectangle and toggles dynamic overlays around a focused
input in a fixed overlay. [`check:text`](../../examples/prototype/scripts/check-text.ts)
adds 40 CSS pixels of horizontal padding to the visible selection popover and
checks that its center stays anchored. [`check:scroll`](../../examples/prototype/scripts/check-scroll.ts)
jumps back from the mounted window `[6, 7, 8]` to `[3, 4, 5, 6, 7]` and checks
the DOM reading order and the identity of the two surviving hosts. All three
checks passed with released pdf.js in Chromium, WebKit, and Firefox.

## Reopen if

- pdf.js adds off-main-thread text normalization or worker-side search indexing,
  or exposes a synchronous batch page-box table so non-uniform documents also
  qualify for uniform zoom-preview metrics before background measurement finishes.
