# 0050. Quiet-gated background page measurement, direct scroll-event offsets, and rotation-only annotation layer updates

- Status: adopted
- Date: 2026-11-19

## Decision

Three hot-path and background scheduling improvements are adopted across
`document/`, `view/`, and `render/` (`docs/architecture.md`), and two candidate
sub-changes tested alongside them are rejected:

1. **Adopted — Yield before background page-size batches and gate them on quiet
   viewers and idle renderers (`DocumentSession.measurePages()`,
   `trackActivity()`, `notifyIdle()`)**: `#showReady()` previously started
   `measurePages()` synchronously before React mounted page 1's `<section>`,
   queuing 64 `getPage()` RPCs in pdf.js's worker ahead of page 1's first paint
   and continuing 64-page batches during active scrolling. `measurePages()` now
   yields a macrotask (`setTimeout(0)`) before each 64-page batch and waits
   (`#whenIdle()`) while any attached `Renderer` has running drawings or
   unpainted visible pages (`renderer.busy`) or any attached `ViewerController`
   is scrolling or zooming (`!#isScrollQuiet()`, `SETTLE_DELAY` = 120 ms),
   reading already-loaded `PDFPageProxy`s synchronously from `#knownPages`.
2. **Adopted — Direct `scrollLeft` / `scrollTop` read in `ViewerController.#onScroll`**:
   `#onScroll` previously called `positionOf(scrollMode, viewportOf(scroller))`
   on every raw `scroll` event, reading `offsetWidth`, `clientWidth`,
   `scrollWidth`, and `clientHeight` and allocating a 6-field `Viewport` object
   when `move()` needed only the single scroll offset along the active axis.
   `#onScroll` now reads `scroller.scrollLeft` or `scroller.scrollTop` directly,
   leaving full `viewportOf()` geometry to the once-per-frame `#update()` pass.
3. **Adopted — Skip scale-only `AnnotationLayer.update()` idle passes (`DomLayers`)**:
   `pdfjs-dist`'s `AnnotationLayer.prototype.update()` applies only
   `{ rotation: viewport.rotation }` to `setLayerDimensions` (link and popup
   boxes scale in CSS via `--total-scale-factor`, and `drawPage()` already calls
   `form.layer.update()` directly when redrawing widget canvases for `<PdfForms>`).
   `linksStale` now checks `page.annotationRotation !== rotation` only, avoiding
   N no-op idle wakeups across visible pages after every zoom commit.
4. **Rejected — Calling `PDFPageProxy.cleanup()` on unheld pages inside
   `measurePages()`**: `getPage()` parses no operator list or font data, yet
   `cleanup()` still posts a `cleanupPage` message to pdf.js's worker for every
   page (999 extra worker RPCs on a 1,000-page document), raising Chromium
   3,600 px/s blocked time on `synthetic-text-1000.pdf` from 79 ms to 85 ms for
   zero memory saved.
5. **Rejected — Scheduling `measurePages()` batches via `requestIdleCallback`
   with 16- or 32-page slices**: `requestIdleCallback` fires at most once per
   animation frame, stretching 1,000-page warmup past a 500–600 ms post-open
   reading pause so later batches overlap subsequent scrolling (86 ms vs 73 ms
   blocked in Chromium at 3,600 px/s), and gating only on `input.settled`
   (`velocity < 2.0` CSS px/ms) still allowed batches to run during 900 CSS px/s
   scrolling. Keeping `MEASURED_PAGES = 64` with `setTimeout(0)` once
   `#whenIdle()` confirms rendering and scrolling are quiet finishes 1,000-page
   warmup in ~150 ms while keeping first paint and active scrolling clear.

## Evidence

[`session.test.ts`](../../packages/parapdf/test/session.test.ts) verifies that
`measurePages()` yields before its first background batch, pauses while a
tracked activity predicate reports busy, resumes once `notifyIdle()` fires, and
stops on `closeSession()`.

[`scroll-bench.ts`](../../examples/prototype/scripts/scroll-bench.ts) (median of
5 runs, 4,000 ms scroll at 900 and 3,600 CSS px/s, 1280×900 at
`devicePixelRatio` 2, `fit-width`) and
[`commit-bench.ts`](../../examples/prototype/scripts/commit-bench.ts) (median of
3 runs across 11 zoom-commit scenarios on `bill-hr815.pdf`, 820×1000 at
`devicePixelRatio` 2) compared the candidate build (`DIST`) against the commit
immediately before it (`61bd098`, `BEFORE`) job by job in the same run on an
Apple M2 Pro on AC power in Playwright's headless Chromium 159.0.8154.6, WebKit
27.2 (not Safari), and Firefox 159.0
([`scroll-idle-measure-chromium.md`](../../examples/prototype/results/scroll-idle-measure-chromium.md),
[`-webkit`](../../examples/prototype/results/scroll-idle-measure-webkit.md),
[`-firefox`](../../examples/prototype/results/scroll-idle-measure-firefox.md);
[`commit-idle-measure-chromium.md`](../../examples/prototype/results/commit-idle-measure-chromium.md),
[`-webkit`](../../examples/prototype/results/commit-idle-measure-webkit.md),
[`-firefox`](../../examples/prototype/results/commit-idle-measure-firefox.md)):

| Browser & workload | First paint, before → after (ms) | First paint runs, before vs after (ms) | Blocked, before → after (ms) | Max lag, before → after (ms) | Blank / dropped |
|---|---:|---|---:|---:|---|
| Chromium 159, 1,000p @ 900 px/s | 186 → 203 | `182,196,186,187,184` vs `203,176,203,182,203` | 18 → 16 | 13 → 10 | 0.0% / 0 |
| Chromium 159, 1,000p @ 3,600 px/s | 190 → 199 | `186,202,199,185,190` vs `185,201,202,181,199` | 73 → 73 | 14 → 14 | 0.0% / 0 |
| Chromium 159, 110p @ 900 px/s | 164 → 170 | `179,155,158,195,164` vs `183,151,146,170,175` | 20 → 23 | 11 → 12 | 0.0% / 0 |
| Chromium 159, 110p @ 3,600 px/s | 162 → 159 | `160,138,181,178,162` vs `142,177,159,158,176` | 60 → 56 | 12 → 12 | 0.0% / 0 |
| WebKit 27.2, 1,000p @ 900 px/s | 223 → 215 | `214,254,230,223,206` vs `215,208,218,223,215` | 27 → 24 | 10 → 13 | 0.0% / 1 |
| WebKit 27.2, 1,000p @ 3,600 px/s | 219 → 207 | `204,219,223,221,217` vs `206,207,207,214,229` | 23 → 30 | 10 → 9 | 0.0% / 0 |
| WebKit 27.2, 110p @ 900 px/s | 191 → 191 | `190,191,191,204,191` vs `193,178,194,191,164` | 64 → 79 | 15 → 16 | 0.0% / 2 |
| WebKit 27.2, 110p @ 3,600 px/s | 192 → 182 | `193,191,191,192,192` vs `182,178,194,181,192` | 45 → 37 | 11 → 10 | 0.0% / 0 |
| Firefox 159, 1,000p @ 900 px/s | 298 → 296 | `289,306,298,307,288` vs `292,321,296,309,277` | 57 → 78 | 16 → 15 | 0.0% / 0 |
| Firefox 159, 1,000p @ 3,600 px/s | 293 → 288 | `303,293,293,262,291` vs `290,288,297,288,262` | 109 → 104 | 13 → 14 | 0.0% / 0 |
| Firefox 159, 110p @ 900 px/s | 254 → 236 | `270,235,270,254,233` vs `221,232,262,246,236` | 90 → 75 | 18 → 20 | 0.0% / 0 |
| Firefox 159, 110p @ 3,600 px/s | 266 → 235 | `266,234,237,269,267` vs `270,237,233,235,231` | 95 → 94 | 17 → 15 | 0.0% / 0 |

Across all 33 `commit-bench.ts` scenario × browser pairs, both builds recorded
0 frames with a blank page, 0 frames with a page down to its base, identical
render counts, and matching or slightly faster time-to-sharp (for example
Firefox `pinch-out` 88 → 82 ms, `zoom-twice` 142 → 128 ms, `zoom-out-far`
43 → 38 ms; Chromium `pinch-out` 22 → 21 ms, `ctrl-wheel` 22 → 20 ms; WebKit
`ctrl-wheel` 15 → 13 ms). First paint shifted a frame earlier on the majority of
runs in WebKit (`1,000p` and `110p` at 3,600 px/s) and Firefox (`110p` at 900
and 3,600 px/s), while Chromium first-paint frame counts split evenly across the
three runs of the experiment.

## Reopen if

- pdf.js adds a bulk page-geometry query on `PDFDocumentProxy` that returns all
  pages' `/MediaBox`, `/CropBox`, `/Rotate`, and `/UserUnit` in a single worker
  message without instantiating per-page `PDFPageProxy` objects.
