---
title: Performance
description: What was measured, where ParaPDF wins, and where it loses.
---

Every performance claim here comes from a decision record in the
repository's [`docs/decisions/`](https://github.com/yhay81/parapdf/tree/main/docs/decisions)
and the benchmark results it cites, committed beside the benchmarks. Wins
and losses are published together, and so are the ideas measured and
rejected.

:::note[Where these numbers come from]
One machine (Apple M2 Pro), on AC power, in Playwright's headless builds of
Chromium 156, WebKit 27.2, and Firefox 157. **Playwright's WebKit is not
Safari**: Safari itself and mobile browsers are not measured. Each change
is measured against the build before it in the same run, job by job. The
[benchmark methodology](https://github.com/yhay81/parapdf/blob/main/AGENTS.md#benchmark-methodology)
says how jobs are isolated, how idle baselines are taken, and why runs on
battery are refused.
:::

## The engine

pdf.js, pdf.js master with its renderer worker, PDFium compiled to
WebAssembly, and hayro compiled to WebAssembly, on 14 PDFs, three runs, the
median across files (2026-10-18;
[results](https://github.com/yhay81/parapdf/blob/main/bench/results/browsers.md),
[decision 0001](https://github.com/yhay81/parapdf/blob/main/docs/decisions/0001-pdfjs-only.md)):

- **Payload.** Released pdf.js is 404 KiB with brotli; PDFium is 1,645 KiB
  and hayro 1,364 KiB.
- **Vector drawing.** On 200,000 vector segments, pdf.js committed the first
  page after 71 ms in Chromium, 89 in WebKit, and 96 in Firefox, against
  375, 379, and 410 for PDFium and 224, 234, and 261 for hayro.
- **First page.** In Chromium, released pdf.js, PDFium, and hayro
  committed it within 2 ms of each other (45.6 to 47.5 ms, the median
  across files). In WebKit and Firefox PDFium and hayro were faster: 49.0
  and 40.8 ms in WebKit and 39.2 and 32.7 in Firefox, against 56.1 and 56.8
  for released pdf.js on GPU-backed canvases.
- **Main thread.** Released pdf.js draws on the main thread: drawing ten
  pages on GPU-backed canvases blocked it for 4 ms in Chromium, 1 in
  WebKit, and 27 in Firefox, and for 21, 1, and 28 ms on CPU-backed
  canvases. pdf.js master's renderer worker on GPU-backed canvases brought
  that to 0, 0, and 3 ms; it is not released yet.
- **A hybrid** that drew scanned pages with hayro grew its WebAssembly
  memory by 51 to 103 MiB per scan without giving it back.

No engine beat pdf.js across the corpus, so ParaPDF uses pdf.js alone, and
directly.

## Scrolling

A scripted scroll of the demo at 1280×900, devicePixelRatio 2, fit-width,
on `synthetic-text-1000.pdf` and `bill-hr815.pdf` at 900 and 3,600 CSS
pixels per second, four seconds per job, three runs, the build of 0.5's
React API against the one before it (2026-10-26;
[decision 0011](https://github.com/yhay81/parapdf/blob/main/docs/decisions/0011-react-api.md)):

- **No blank viewport.** Every job, in every browser, had zero blank area.
- **React commits.** 4, 24, 4, and 20 over four seconds in the four cases,
  exactly when the mounted pages or the current page changed, in all three
  browsers.
- **Frames.** 0 or 1 of 240 to 289 frames dropped.
- **Main thread.** Blocked for 2.9 to 19.3 ms in Chromium, 5.5 to 61.9 in
  WebKit, and 39.6 to 85.0 in Firefox over the four cases, overlapping the
  build before in every case but two, where 0.5 was lower; another run the
  same day, under heavier load, went the other way, so no speed change is
  claimed. Compare blocked time within a browser, not across them.

## Coming back to pages

Pages keep their canvases when they unmount
([decision 0004](https://github.com/yhay81/parapdf/blob/main/docs/decisions/0004-kept-canvases.md)).
At 820×1000, devicePixelRatio 2, fit-width, three runs, medians, against the
build that drew them again, the time until page 1 was sharp after a jump
from page 13 and back:

| File | Chromium | WebKit | Firefox |
|---|---:|---:|---:|
| bill-hr815.pdf | 23 → 3 ms | 27 → 11 ms | 176 → 38 ms |
| synthetic-vector-pages.pdf | 167 → 5 ms | 172 → 3 ms | 168 → 19 ms |

On the way back nothing was drawn and no frame showed a blank page. Kept
canvases held 58 to 65 MiB with the default budget. At first they were
copied into new canvases, which blocked Chromium's main thread for up to
39 ms more over a scroll back; since 0.5's renderer owns the pages' DOM,
the canvases themselves move into the page's new host
([decision 0010](https://github.com/yhay81/parapdf/blob/main/docs/decisions/0010-renderer-owns-page-dom.md)).
Firefox, where copies cost most, then came back sharp sooner: after a jump
back on bill-hr815.pdf, 8 instead of 17 ms, and flipping back over it, 6
against 14 ms and, measured the other way round, 8 against 13.

## Zooming

Over ten kinds of zoom commit (touch pinches, `setScale()`, `zoomBy()`, and
Ctrl with the wheel) on bill-hr815.pdf, no page in view showed blank or only
its base in any frame, in all three browsers, and every zoom and pan at 4×
and 8× finished at full visible resolution
([decision 0009](https://github.com/yhay81/parapdf/blob/main/docs/decisions/0009-viewer-lifetimes.md)).
The new canvases of 0.5's renderer, which hold no pixels until drawn, took
about 1 MiB off the commits' peak canvas memory (decision 0010).

The cost is a spare canvas: a page draws its new detail while the old one
still shows. On phone-sized viewports (390×844, devicePixelRatio 3), the
time to sharp in Chromium falls into two groups, one under 100 ms and one
around 220 to 240 ms, whichever build measures it.

## Measured and rejected

- **Frames** (OffscreenCanvas shown as ImageBitmaps): never faster, and in
  Chromium pages got sharp 6 to 29 ms later after zoom commits
  ([decision 0005](https://github.com/yhay81/parapdf/blob/main/docs/decisions/0005-frame-display.md)).
- **pdf.js's partial rendering** of regions: recording the operations cost
  every page's first drawing, up to 61 ms of blocked main thread over ten
  pages in Chromium against 0, and zooming to 4× and 8× was no faster
  ([decision 0006](https://github.com/yhay81/parapdf/blob/main/docs/decisions/0006-partial-rendering.md)).
- **Keeping unmounted pages' parsed content**: pages came back sharp within
  11 ms of the build without it, while holding their memory
  ([decision 0007](https://github.com/yhay81/parapdf/blob/main/docs/decisions/0007-keep-parsed-pages.md)).
- **A whole-page detail scaled down into the base** when zooming past its
  budget: on phone-sized viewports pages got sharp up to three times sooner
  (to 8× on bill-hr815.pdf, 224 → 72 ms in Chromium, 134 → 55 in WebKit, 222
  → 55 in Firefox), but on desktop-sized ones WebKit got slower (125
  against 99 ms to 4×), Chromium zoomed out slower, and canvas memory ended
  6 MiB higher
  ([decision 0008](https://github.com/yhay81/parapdf/blob/main/docs/decisions/0008-demote-whole-page-detail.md)).
  Copying only whole-page details no larger than a base, which a phone's
  are and a desktop's are not, kept the gains without the losses and was
  adopted: to 8× on bill-hr815.pdf, 223 → 72 ms in Chromium, 157 → 55 in
  WebKit, 257 → 84 in Firefox
  ([decision 0012](https://github.com/yhay81/parapdf/blob/main/docs/decisions/0012-demote-small-whole-page-detail.md)).

## The rebuild

Each step of the rebuild toward 0.5 was measured against the one before it:
independent viewers (decision 0009), the renderer owning the page DOM
(decision 0010), and the React API (decision 0011). None showed a
regression beyond the runs' spread, and none is claimed as a speed
improvement where the ranges overlapped.

## Running the benchmarks

The repository's
[AGENTS.md](https://github.com/yhay81/parapdf/blob/main/AGENTS.md#commands)
lists every benchmark and its parameters: the engine benchmark, scrolling,
zooming, zoom commits, coming back to pages, main-thread profiles, and
GPU-backed against CPU-backed canvases.
