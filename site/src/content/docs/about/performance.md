---
title: Performance
description: How soon a PDF becomes readable, how much canvas memory it uses, and what happens as you turn pages, scroll, and zoom.
---

## Opening a document

In ParaPDF 0.10, visible pages get the first drawing slots. A spare slot can prepare
one neighboring page at low resolution. In the test below, page 1 opened sharp and
preparing page 2 for an immediate turn cost less than 1 MiB of canvas storage.

For a 110-page bill, we timed a cold open to a sharp first page and checked that its
pixels matched a direct pdf.js drawing.

| Time to a sharp first page | Chromium 159 | WebKit 27.2 | Firefox 159 |
| --- | ---: | ---: | ---: |
| ParaPDF | 151 ms | 158 ms | 216 ms |
| Direct pdf.js | 126 ms | 130 ms | 171 ms |

The table shows medians of nine cold opens at fit-width (820 × 900, device pixel ratio
2), served locally on an Apple M2 Pro on November 20, 2026. Across the bill, a
1,000-page text PDF, and a scan, the viewer’s medians were 14–69 ms later. The test used
React’s profiling build and headless Playwright browsers. Safari and mobile devices need
separate measurements.
[Cold-open measurements and individual runs](https://github.com/yhay81/parapdf/blob/main/examples/prototype/results/startup-first-display.md)

- **Opening memory.** At first display, the bill used **15.41 MiB** of attached canvas
  storage, down from 29.00–43.51 MiB before the preview change. A single
  full-resolution page needs 14.50 MiB. Once three pages and their text and links were
  ready, Chromium held 43.68 MiB in canvases in both builds. These estimates count four
  bytes per canvas pixel and exclude other browser, pdf.js, and GPU allocations.
  [Memory measurements](https://github.com/yhay81/parapdf/blob/main/docs/decisions/0054-first-visible-drawing.md#memory-after-the-initial-viewport-settles)
- **Turning to page 2.** Clicking Next as soon as page 1 appeared showed page 2 in 1–16
  ms across the bill and scan, with sharp detail in 14–73 ms (five-run medians). With a
  100 ms pause before the click, page 2 was already sharp in every trial on these PDFs.
  [Page-turn results](https://github.com/yhay81/parapdf/blob/main/examples/prototype/results/startup-first-display.md#next-immediately-after-opening)
- **Larger screens and slower connections.** At 1280 × 900, the bill first appeared as a
  preview using 4.51 MiB of canvas pixels. Full resolution took 171–277 ms across the
  three browsers. At the smaller viewport, adding 60 ms of latency and limiting
  bandwidth to 20 Mbit/s brought Chromium's sharp first page to 747 ms. If your app
  knows the next document in advance, `preloadDocument()` can start loading it before
  the viewer mounts.
  [Viewport and network measurements](https://github.com/yhay81/parapdf/blob/main/docs/decisions/0054-first-visible-drawing.md#larger-viewport-and-delayed-network) · [Loading early](/setup/pdfjs/#loading-early)

## Scrolling and zooming

During a fast scroll, the viewer prioritizes visible pages. Sharp detail, selectable
text, and links can follow after motion stops. In a four-second scroll across nine pages
of a 1,000-page PDF, all three browsers recorded zero blank frames. The median React
commit count fell from 25 to 11 compared with 0.9.1. Main-thread timing varied with the
browser and machine load.
[Scroll measurements](https://github.com/yhay81/parapdf/blob/main/docs/decisions/0051-batched-mounting-exact-settle-and-hot-path-tightening.md#final-build-with-controller-owned-page-hosts)

When you zoom, the old drawing stays visible until a sharper one is ready. That briefly
needs room for both drawings. Across 11 zoom scenarios in each of the three browsers, no
sampled frame showed a blank page or fell back to a low-resolution preview.
[Zoom measurements](https://github.com/yhay81/parapdf/blob/main/docs/decisions/0051-batched-mounting-exact-settle-and-hot-path-tightening.md#evidence-from-the-intermediate-build)

## Coming back to pages

The viewer keeps recently visited canvases so it can show them again without drawing. In
a jump from page 13 back to page 1 of the bill, the cached page was sharp in 3 ms in
Chromium, 11 ms in WebKit, and 38 ms in Firefox. Redrawing took 23, 27, and 176 ms
respectively.
[Return-navigation measurements](https://github.com/yhay81/parapdf/blob/main/docs/decisions/0004-kept-canvases.md#evidence)

The default cache holds up to twelve viewports’ worth of device pixels. To spend less
memory on return visits, lower `maxKeptPixels` or set it to `0`. To budget visible
and cached page canvases together, set `maxCanvasPixels`. The viewer releases cached
canvases first. A tight budget can reduce visible detail.
[Memory and rendering options](/reference/options/#memory-and-rendering)

## Searching a large document

The first full-document search reads text from every page. ParaPDF keeps the index
so later searches with the same options can reuse it. On the 1,000-page text PDF,
the index used 11.4 MiB for match positions, down from 45.6 MiB before the index
was compacted. This counts the position buffers for one set of options. Extracted
text, search results, and canvases use additional memory.
[Search measurements](https://github.com/yhay81/parapdf/blob/main/docs/decisions/0052-search-memory-and-page-work.md#document-search) · [Search guide](/guides/search/)

## Against react-pdf

A November 16, 2026 comparison of **ParaPDF 0.9.0** and **react-pdf 11.0.0 with
react-window** used two text PDFs, two scroll speeds, and five runs per condition on the
M2 Pro. Across Chromium 158, WebKit 27.2, and Firefox 159, ParaPDF held 16–56% fewer
canvas pixels at the post-scroll sample. Both viewers showed zero sampled blank area.
ParaPDF showed its first pixels sooner in all 12 conditions, though a preview could
count as its first drawing.

Main-thread results depended on the workload. In the fast scroll on the 1,000-page
document, ParaPDF blocked Chromium for 51 ms versus 17 ms with react-pdf. On WebKit the
same comparison was 5 versus 22 ms, and on Firefox 80 versus 140 ms. These totals cover
the four seconds of scrolling and exclude work deferred until it stops. Each viewer used
its own bundled pdf.js version.
[Full comparison, method, and reproduction steps](https://github.com/yhay81/parapdf/blob/main/examples/prototype/results/compare-react-pdf-20261116.md)

## The engine

ParaPDF uses pdf.js. In the October 2026 engine comparison across 14 PDFs, its
compressed payload was the smallest of the three engines tested, and it drew the
200,000-segment vector page fastest in every tested browser. PDFium and hayro had lower
median first-page times in WebKit and Firefox.
[Engine comparison](https://github.com/yhay81/parapdf/blob/main/bench/results/browsers.md)

By default, pdf.js draws pages on the main thread and requests GPU-backed canvases. The optional
drawing worker reduced main-thread blocking on the bill in all three browsers, but the
scanned patent appeared later in Chromium and WebKit.
[Worker measurements](https://github.com/yhay81/parapdf/blob/main/docs/decisions/0028-released-renderer-worker.md#evidence) · [pdf.js configuration](/setup/pdfjs/)
