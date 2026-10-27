# ParaPDF runtime prototype: coming back to pages, Chromium 156.0.8078.4

- Run at: 2026-10-27T07:52:32.564Z
- Machine: darwin 27.0.0 arm64, Apple M2 Pro (12 logical cores); Chromium 156.0.8078.4 (Playwright build, headless); power: AC
- One-minute load average: 7.4 at the start, 7.0 at the end, on 12 cores. The run waited 4 times (6 min in all) for other Playwright browsers and repeated 3 jobs that another browser overlapped.
- Method: pdf.js drawing on the main thread, GPU-backed canvases, 820×1000 at devicePixelRatio 2 and fit-width, 3 runs; medians. Variants: none keeps no canvases of pages that unmount (`maxKeptPixels: 0`); kept-<budget> keeps them, at most that budget (<n>vp: n viewports' worth, 13 MiB each; default: the viewer's default), and draws them back when the pages mount again.
- From the start of the way back, a probe records after every frame's animation frame callbacks and layout. No blank: from the first frame after which no page in view lacked pixels (`blankFraction()` 0). Sharp: from the first frame after which the visible pages' `sharpness()` stayed at 0.99 or more. Blank frames count frames with any blank area until sharp; mean blank and mean sharpness are over the frames while scrolling or flipping. Renders and layers drawn back count from the start of the way back until sharp. Main thread blocked sums a 4 ms timer's lateness beyond 2 ms or the idle 95th percentile; dropped frames are longer than 1.5 idle frames. Memory: width × height × 4 bytes of every canvas in the viewport and of the kept ones, at their peaks.
- Reproduce: `pnpm --filter @parapdf/bench corpus && pnpm --filter @parapdf/prototype build && BROWSER=chromium node examples/prototype/scripts/return-bench.ts`

## jump-back: page 1 → page 13 → page 1, settling at page 13

| File · variant | No blank (ms) | Sharp (ms) | Blank frames | Renders base / detail (cancelled) | Drawn back | Main thread blocked (ms) · longest lag | Dropped / frames | Canvas · kept MiB |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| bill-hr815.pdf · none | 22 | 22 | 1 | 0 / 3 (0) | 0 | 7 · 7 | 0 / 20 | 44 · 0 |
| bill-hr815.pdf · kept-3vp | 21 | 21 | 1 | 0 / 1 (0) | 2 | 4 · 4 | 0 / 20 | 44 · 29 |
| bill-hr815.pdf · kept-default | 3 | 3 | 0 | 0 / 0 (0) | 3 | 2 · 4 | 0 / 20 | 44 · 58 |
| bill-hr815.pdf · kept-12vp | 3 | 3 | 0 | 0 / 0 (0) | 3 | 2 · 4 | 0 / 20 | 44 · 73 |
| bill-hr815.pdf · kept-24vp | 3 | 3 | 0 | 0 / 0 (0) | 3 | 1 · 3 | 0 / 20 | 44 · 73 |
| synthetic-vector-pages.pdf · none | 34 | 167 | 2 | 2 / 3 (1) | 0 | 1 · 3 | 0 / 29 | 39 · 0 |
| synthetic-vector-pages.pdf · kept-3vp | 2 | 2 | 0 | 0 / 0 (0) | 3 | 0 · 1 | 0 / 20 | 38 · 38 |
| synthetic-vector-pages.pdf · kept-default | 2 | 2 | 0 | 0 / 0 (0) | 3 | 0 · 1 | 0 / 20 | 38 · 63 |
| synthetic-vector-pages.pdf · kept-12vp | 2 | 2 | 0 | 0 / 0 (0) | 3 | 0 · 1 | 0 / 19 | 38 · 63 |
| synthetic-vector-pages.pdf · kept-24vp | 2 | 2 | 0 | 0 / 0 (0) | 3 | 0 · 1 | 0 / 20 | 38 · 63 |

## scroll-back: 10 pages down and back up at 3600 CSS px per second, settling at the bottom

| File · variant | No blank (ms) | Sharp (ms) | Blank frames | Mean blank % · sharpness moving | Renders base / detail (cancelled) | Drawn back | Main thread blocked (ms) · longest lag | Dropped / frames | Canvas · kept MiB |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| bill-hr815.pdf · none | 0 | 3674 | 0 | 0.0 · 0.51 | 7 / 4 (0) | 0 | 30 · 8 | 0 / 239 | 92 · 0 |
| bill-hr815.pdf · kept-3vp | 0 | 3672 | 0 | 0.0 · 0.51 | 5 / 4 (0) | 3 | 15 · 9 | 0 / 239 | 92 · 34 |
| bill-hr815.pdf · kept-default | 0 | 3673 | 0 | 0.0 · 0.51 | 3 / 4 (0) | 5 | 17 · 10 | 0 / 239 | 92 · 62 |
| bill-hr815.pdf · kept-12vp | 0 | 2632 | 0 | 0.0 · 0.70 | 0 / 1 (0) | 8 | 9 · 10 | 0 / 222 | 92 · 116 |
| bill-hr815.pdf · kept-24vp | 0 | 2632 | 0 | 0.0 · 0.70 | 0 / 1 (0) | 8 | 6 · 8 | 0 / 222 | 92 · 116 |
| synthetic-vector-pages.pdf · none | 0 | 3134 | 0 | 0.0 · 0.51 | 7 / 4 (0) | 0 | 2 · 4 | 0 / 208 | 79 · 0 |
| synthetic-vector-pages.pdf · kept-3vp | 0 | 3134 | 0 | 0.0 · 0.51 | 5 / 4 (0) | 3 | 1 · 3 | 0 / 208 | 80 · 38 |
| synthetic-vector-pages.pdf · kept-default | 0 | 3134 | 0 | 0.0 · 0.59 | 3 / 4 (0) | 5 | 0 · 2 | 0 / 208 | 80 · 65 |
| synthetic-vector-pages.pdf · kept-12vp | 0 | 2015 | 0 | 0.0 · 0.78 | 0 / 1 (0) | 8 | 0 · 2 | 0 / 194 | 80 · 100 |
| synthetic-vector-pages.pdf · kept-24vp | 0 | 2016 | 0 | 0.0 · 0.78 | 0 / 1 (0) | 8 | 0 · 2 | 0 / 194 | 80 · 100 |

## long-scroll-back: 20 pages down and back up at 3600 CSS px per second, settling at the bottom

| File · variant | No blank (ms) | Sharp (ms) | Blank frames | Mean blank % · sharpness moving | Renders base / detail (cancelled) | Drawn back | Main thread blocked (ms) · longest lag | Dropped / frames | Canvas · kept MiB |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| bill-hr815.pdf · none | 0 | 7006 | 0 | 0.0 · 0.38 | 17 / 4 (0) | 0 | 29 · 8 | 0 / 439 | 92 · 0 |
| bill-hr815.pdf · kept-3vp | 0 | 7006 | 0 | 0.0 · 0.38 | 15 / 4 (0) | 3 | 31 · 9 | 0 / 439 | 92 · 37 |
| bill-hr815.pdf · kept-default | 0 | 7007 | 0 | 0.0 · 0.38 | 13 / 4 (0) | 5 | 20 · 7 | 0 / 439 | 92 · 71 |
| bill-hr815.pdf · kept-12vp | 0 | 5982 | 0 | 0.0 · 0.48 | 0 / 1 (0) | 18 | 2 · 3 | 0 / 423 | 92 · 139 |
| bill-hr815.pdf · kept-24vp | 0 | 5982 | 0 | 0.0 · 0.48 | 0 / 1 (0) | 18 | 4 · 6 | 0 / 423 | 92 · 139 |
| synthetic-vector-pages.pdf · none | 0 | 6067 | 0 | 0.0 · 0.38 | 17 / 4 (0) | 0 | 3 · 3 | 0 / 384 | 79 · 0 |
| synthetic-vector-pages.pdf · kept-3vp | 0 | 6067 | 0 | 0.0 · 0.38 | 15 / 4 (0) | 3 | 2 · 3 | 0 / 383 | 80 · 38 |
| synthetic-vector-pages.pdf · kept-default | 0 | 6067 | 0 | 0.0 · 0.38 | 12 / 4 (0) | 6 | 2 · 3 | 0 / 384 | 80 · 72 |
| synthetic-vector-pages.pdf · kept-12vp | 0 | 4915 | 0 | 0.0 · 0.51 | 0 / 1 (0) | 18 | 0 · 2 | 0 / 368 | 80 · 131 |
| synthetic-vector-pages.pdf · kept-24vp | 0 | 4916 | 0 | 0.0 · 0.51 | 0 / 1 (0) | 18 | 0 · 2 | 0 / 368 | 80 · 131 |

## flip-back: "page" mode, 8 flips forward settling after each, then 8 back 50 ms apart

| File · variant | No blank (ms) | Sharp (ms) | Blank frames | Mean blank % · sharpness moving | Each flip sharp, median · max (ms) | Renders base / detail (cancelled) | Drawn back | Main thread blocked (ms) · longest lag | Dropped / frames | Canvas · kept MiB |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| bill-hr815.pdf · none | 5 | 5 | 0 | 0.0 · 1.00 | 11 · 15 | 0 / 6 (0) | 0 | 9 · 5 | 0 / 41 | 73 · 0 |
| bill-hr815.pdf · kept-3vp | 5 | 5 | 0 | 0.0 · 1.00 | 11 · 20 | 0 / 4 (0) | 2 | 17 · 6 | 0 / 42 | 73 · 29 |
| bill-hr815.pdf · kept-default | 5 | 5 | 0 | 0.0 · 1.00 | 13 · 20 | 0 / 2 (0) | 4 | 9 · 5 | 0 / 42 | 73 · 58 |
| bill-hr815.pdf · kept-12vp | 7 | 7 | 0 | 0.0 · 1.00 | 14 · 20 | 0 / 0 (0) | 6 | 7 · 4 | 0 / 42 | 73 · 116 |
| bill-hr815.pdf · kept-24vp | 7 | 7 | 0 | 0.0 · 1.00 | 13 · 20 | 0 / 0 (0) | 6 | 11 · 6 | 0 / 42 | 73 · 116 |
| synthetic-vector-pages.pdf · none | 1 | 1 | 0 | 0.0 · 1.00 | 10 · 17 | 0 / 6 (0) | 0 | 0 · 2 | 0 / 42 | 63 · 0 |
| synthetic-vector-pages.pdf · kept-3vp | 1 | 1 | 0 | 0.0 · 1.00 | 9 · 16 | 0 / 3 (0) | 3 | 0 · 2 | 0 / 42 | 63 · 38 |
| synthetic-vector-pages.pdf · kept-default | 1 | 1 | 0 | 0.0 · 1.00 | 7 · 17 | 0 / 1 (0) | 5 | 0 · 1 | 0 / 42 | 63 · 63 |
| synthetic-vector-pages.pdf · kept-12vp | 1 | 1 | 0 | 0.0 · 1.00 | 7 · 12 | 0 / 0 (0) | 6 | 0 · 2 | 0 / 41 | 63 · 100 |
| synthetic-vector-pages.pdf · kept-24vp | 1 | 1 | 0 | 0.0 · 1.00 | 9 · 15 | 0 / 0 (0) | 6 | 0 · 1 | 0 / 41 | 63 · 100 |

