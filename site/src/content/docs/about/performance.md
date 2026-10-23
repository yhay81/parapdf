---
title: Performance
description: What was measured, where ParaPDF wins, and where it loses.
---

Every performance claim here comes from a benchmark in the repository, with
its results committed beside it. Wins and losses are published together.

:::note[Where these numbers come from]
One machine (Apple M2 Pro), in Playwright's headless builds of Chromium,
WebKit, and Firefox. **Playwright's WebKit is not Safari**: Safari itself and
mobile browsers are not measured yet. The [benchmark
methodology](https://github.com/yhay81/parapdf/blob/main/AGENTS.md#benchmark-methodology)
says how jobs are isolated, how idle baselines are taken, and why runs on
battery are refused.
:::

## The engine (2026-10-18)

pdf.js, pdf.js master with its renderer worker, PDFium compiled to
WebAssembly, and hayro compiled to WebAssembly, on 14 PDFs, the median of
three runs ([results](https://github.com/yhay81/parapdf/blob/main/bench/results/browsers.md)):

- **Payload.** Released pdf.js is 404 KiB with brotli; PDFium is 1,645 KiB and
  hayro 1,364 KiB.
- **Japanese fonts that are not embedded.** Only pdf.js draws them, through
  the operating system's fonts, in all three browsers. PDFium and hayro need
  fallback fonts shipped with them.
- **First text page.** PDFium and hayro are faster: a median of 44–51 ms in
  Chromium, 43–45 ms in WebKit, and 34–36 ms in Firefox, against 53–80 ms for
  the pdf.js variants. hayro is the fastest on the large scan in all three.
- **Vector drawing.** pdf.js is fastest on 200,000 vector segments: 68 ms in
  Chromium, 72 in WebKit, and 93 in Firefox for its best variant, against
  224–261 ms for hayro and 375–410 ms for PDFium.
- **Main thread.** Released pdf.js draws on the main thread and stalls it for
  16–17 ms at worst on text-heavy documents in Chromium and 14–16 ms in
  Firefox. pdf.js master's renderer worker brings that down to 1.6 ms in
  Chromium and 4.2–4.6 ms in Firefox; it is not released yet.
- **Fidelity.** Released pdf.js 6.4.299 fails a JPEG 2000 image behind LZW
  that master fixes, and every pdf.js build differs from PDFium's reference
  rendering of a soft-mask blend, which PDFium and hayro match.

pdf.js stays the engine for its size, its CJK coverage, and its vector speed.

## Scrolling (2026-10-20)

A scripted scroll of the demo at devicePixelRatio 2, at 900 and 3,600 CSS
pixels per second ([results](https://github.com/yhay81/parapdf/blob/main/examples/prototype/results/browsers.md)):

- **No blank viewport.** No variant left any of the viewport blank in any
  browser: base renders stayed ahead of the scroll.
- **React commits.** 4–24 per run, one per change of the mounted pages or the
  current page, while the browsers drew 60 frames a second (72 in WebKit).
- **Main thread.** Chromium was blocked for 0–7 ms with pdf.js master's
  renderer worker on GPU-backed canvases, and 10–28 ms with released pdf.js
  on CPU-backed ones. WebKit blocked for 1–16 ms in every variant, and
  CPU-backed canvases dropped 7–12 frames where GPU-backed ones dropped none,
  which is why `enableHWA` is on by default.
- **Firefox costs more.** It blocked for 15–84 ms, with stalls of 7–20 ms, in
  every variant, the renderer worker included. Its scroll control, which
  scrolls pages that need no drawing, blocked for 7 ms: in Firefox, scrolling
  itself costs main-thread time that ParaPDF does not cause.
- **First page.** Page 1 showed after 142–257 ms in Chromium, 171–315 ms in
  WebKit, and 217–367 ms in Firefox.

## Zooming

After ten kinds of zoom commit (touch pinches, `setScale`, `zoomBy`, and
Ctrl with the wheel), no page in view showed blank or only its base in any
frame, in all three browsers: each page keeps its old drawing, scaled, until
the new one is complete. The cost is memory: a commit holds the old and the
new full-resolution canvases while the new ones are drawn, 25–28 MiB more at
its peak, 115–118 against 89 MiB after a 10% zoom step
([results](https://github.com/yhay81/parapdf/tree/main/examples/prototype/results)).

## Startup

With 100 ms added to every request and 20 Mbit/s in Chromium, page 1 showed
115–129 ms sooner than with 0.2.0 set up as its README said, and within
3–16 ms of 0.2.0 with pdf.js in the main bundle and a preload written by
hand ([results](https://github.com/yhay81/parapdf/blob/main/examples/prototype/results/startup-bundled.md)).
The losses: the build output holds about 5 MB more files, fetched only when
a PDF needs them, and Playwright's WebKit downloads a preloaded PDF twice;
whether Safari does is not verified yet.

## Running the benchmarks

The repository's
[AGENTS.md](https://github.com/yhay81/parapdf/blob/main/AGENTS.md#commands)
lists every benchmark and its parameters: the engine benchmark, scrolling,
zooming, zoom commits, main-thread profiles, and GPU-backed against
CPU-backed canvases.
