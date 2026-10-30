---
title: Performance
description: What was measured, where ParaPDF wins, and where it loses.
---

Every number here comes from a decision record in the repository's
[`docs/decisions/`](https://github.com/yhay81/parapdf/tree/main/docs/decisions),
which cites the benchmark results it rests on. Wins and losses are published
together, and so are the ideas measured and rejected.

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
  that to 0, 0, and 3 ms; it is not in a pdfjs-dist release yet.
- **A hybrid** that drew scanned pages with hayro grew its WebAssembly
  memory by 51 to 103 MiB per scan without giving it back.

No engine beat pdf.js across the corpus, so ParaPDF uses pdf.js alone, and
directly.

## Scrolling

A scripted scroll of the demo at 1280×900, devicePixelRatio 2, fit-width,
on `synthetic-text-1000.pdf` and `bill-hr815.pdf` at 900 and 3,600 CSS
pixels per second, four seconds per job, three runs
([decision 0011](https://github.com/yhay81/parapdf/blob/main/docs/decisions/0011-react-api.md)):

- **No blank viewport.** Every job, in every browser, had zero blank area.
- **React commits.** 4, 24, 4, and 20 over four seconds in the four cases,
  exactly when the mounted pages or the current page changed, in all three
  browsers.
- **Frames.** 0 or 1 of 240 to 289 frames dropped.
- **Main thread.** Blocked for 2.9 to 19.3 ms in Chromium, 5.5 to 61.9 in
  WebKit, and 39.6 to 85.0 in Firefox over the four cases. Compare blocked
  time within a browser, not across them.

## Against react-pdf

The same scroll, five runs, against react-pdf 11.0.0 with every page
mounted and with react-window mounting only the rows in view
([decision 0017](https://github.com/yhay81/parapdf/blob/main/docs/decisions/0017-measured-against-react-pdf.md)). In Chromium, the
medians on `bill-hr815.pdf` (110 pages)
([results](https://github.com/yhay81/parapdf/blob/main/examples/prototype/results/compare-react-pdf-110-chromium.md)):

| Speed | Viewer | First paint | Blocked | React commits | Canvas memory |
|---|---|---:|---:|---:|---:|
| 900 | ParaPDF | 142 ms | 17 ms | 4 | 183 MiB |
| 900 | react-pdf, windowed | 187 ms | 5 ms | 10 | 217 MiB |
| 900 | react-pdf, every page | 278 ms | 488 ms | 3 | 3,972 MiB |
| 3600 | ParaPDF | 152 ms | 28 ms | 20 | 126 MiB |
| 3600 | react-pdf, windowed | 210 ms | 34 ms | 42 | 253 MiB |

In Chromium, WebKit, and Firefox, ParaPDF painted first sooner in every job
but one, committed React less than half as often, and held less canvas
memory. It blocked the main thread more at reading speed in Chromium and
Firefox (17 against 5 ms on 110 pages in Chromium), where both build the
same text and link layers, and less or as much at 3,600 px/s, where it
postpones them. So the claim is not "faster in every browser".

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
canvases held 58 to 65 MiB with the default budget. They move into the
page's new host instead of being copied
([decision 0010](https://github.com/yhay81/parapdf/blob/main/docs/decisions/0010-renderer-owns-page-dom.md)).

## Zooming

Over ten kinds of zoom commit (touch pinches, `setScale()`, `zoomBy()`, and
Ctrl with the wheel) on bill-hr815.pdf, no page in view showed blank or only
its base in any frame, in all three browsers, and every zoom and pan at 4×
and 8× finished at full visible resolution
([decision 0009](https://github.com/yhay81/parapdf/blob/main/docs/decisions/0009-viewer-lifetimes.md)).

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
- **Every whole-page detail scaled down into the base** when zooming past
  its budget: sharper sooner on phones, but slower in WebKit and more canvas
  memory on desktops
  ([decision 0008](https://github.com/yhay81/parapdf/blob/main/docs/decisions/0008-demote-whole-page-detail.md)). Copying only
  details no larger than a base kept the gains without the losses and was
  adopted: zooming to 8× on bill-hr815.pdf on a phone-sized viewport got
  sharp after 72 instead of 223 ms in Chromium, 55 instead of 157 in WebKit,
  and 84 instead of 257 in Firefox
  ([decision 0012](https://github.com/yhay81/parapdf/blob/main/docs/decisions/0012-demote-small-whole-page-detail.md)).
- **Text drawn as paths** by default: faster zoom commits in Chromium, but
  slower pages in Firefox and WebKit, and standard fonts change
  ([decision 0013](https://github.com/yhay81/parapdf/blob/main/docs/decisions/0013-path-text.md)).
- **Dropping the scroller's size query container** and **building text
  layers outside the document**, two attempts at Firefox's style and
  `measureText` costs while scrolling: neither lowered blocked time across
  the browsers
  ([decision 0018](https://github.com/yhay81/parapdf/blob/main/docs/decisions/0018-keep-the-size-query-container.md),
  [decision 0020](https://github.com/yhay81/parapdf/blob/main/docs/decisions/0020-text-layers-built-in-the-document.md)).

## Running the benchmarks

The repository's
[AGENTS.md](https://github.com/yhay81/parapdf/blob/main/AGENTS.md#commands)
lists every benchmark and its parameters: the engine benchmark, scrolling,
zooming, zoom commits, coming back to pages, main-thread profiles, and
GPU-backed against CPU-backed canvases.
