# ParaPDF runtime prototype: coming back to pages, Firefox 157.0

- Run at: 2026-10-27T09:09:44.259Z
- Machine: darwin 27.0.0 arm64, Apple M2 Pro (12 logical cores); Firefox 157.0 (Playwright build, headless); power: AC
- One-minute load average: 18.0 at the start, 16.4 at the end, on 12 cores. The run waited 11 times (12 min in all) for other Playwright browsers and repeated 12 jobs that another browser overlapped.
- Method: pdf.js drawing on the main thread, GPU-backed canvases, 820×1000 at devicePixelRatio 2 and fit-width, 3 runs; medians. Variants: none keeps no canvases of pages that unmount (`maxKeptPixels: 0`); kept-<budget> keeps them, at most that budget (<n>vp: n viewports' worth, 13 MiB each; default: the viewer's default), and draws them back when the pages mount again.
- From the start of the way back, a probe records after every frame's animation frame callbacks and layout. No blank: from the first frame after which no page in view lacked pixels (`blankFraction()` 0). Sharp: from the first frame after which the visible pages' `sharpness()` stayed at 0.99 or more. Blank frames count frames with any blank area until sharp; mean blank and mean sharpness are over the frames while scrolling or flipping. Renders and layers drawn back count from the start of the way back until sharp. Main thread blocked sums a 4 ms timer's lateness beyond 2 ms or the idle 95th percentile; dropped frames are longer than 1.5 idle frames. Memory: width × height × 4 bytes of every canvas in the viewport and of the kept ones, at their peaks.
- Reproduce: `pnpm --filter @parapdf/bench corpus && pnpm --filter @parapdf/prototype build && BROWSER=firefox node examples/prototype/scripts/return-bench.ts`

## jump-back: page 1 → page 13 → page 1, settling at page 13

| File · variant | No blank (ms) | Sharp (ms) | Blank frames | Renders base / detail (cancelled) | Drawn back | Main thread blocked (ms) · longest lag | Dropped / frames | Canvas · kept MiB |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| bill-hr815.pdf · none | 31 | 167 | 2 | 2 / 3 (1) | 0 | 19 · 15 | 0 / 29 | 45 · 0 |
| bill-hr815.pdf · kept-3vp | 32 | 201 | 2 | 1 / 1 (1) | 2 | 63 · 49 | 2 / 30 | 44 · 29 |
| bill-hr815.pdf · kept-default | 10 | 10 | 0 | 0 / 0 (0) | 3 | 3 · 9 | 0 / 20 | 44 · 58 |
| bill-hr815.pdf · kept-12vp | 9 | 9 | 0 | 0 / 0 (0) | 3 | 3 · 8 | 0 / 20 | 44 · 73 |
| bill-hr815.pdf · kept-24vp | 11 | 11 | 0 | 0 / 0 (0) | 3 | 8 · 12 | 0 / 20 | 44 · 73 |
| synthetic-vector-pages.pdf · none | 62 | 194 | 4 | 2 / 3 (1) | 0 | 37 · 35 | 1 / 30 | 39 · 0 |
| synthetic-vector-pages.pdf · kept-3vp | 7 | 7 | 0 | 0 / 0 (0) | 3 | 4 · 6 | 0 / 20 | 38 · 38 |
| synthetic-vector-pages.pdf · kept-default | 7 | 7 | 0 | 0 / 0 (0) | 3 | 2 · 5 | 0 / 20 | 38 · 63 |
| synthetic-vector-pages.pdf · kept-12vp | 7 | 7 | 0 | 0 / 0 (0) | 3 | 5 · 7 | 0 / 20 | 38 · 63 |
| synthetic-vector-pages.pdf · kept-24vp | 6 | 6 | 0 | 0 / 0 (0) | 3 | 2 · 4 | 0 / 20 | 38 · 63 |

## scroll-back: 10 pages down and back up at 3600 CSS px per second, settling at the bottom

| File · variant | No blank (ms) | Sharp (ms) | Blank frames | Mean blank % · sharpness moving | Renders base / detail (cancelled) | Drawn back | Main thread blocked (ms) · longest lag | Dropped / frames | Canvas · kept MiB |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| bill-hr815.pdf · none | 0 | 3673 | 0 | 0.0 · 0.51 | 7 / 4 (0) | 0 | 40 · 22 | 0 / 240 | 92 · 0 |
| bill-hr815.pdf · kept-3vp | 0 | 3668 | 0 | 0.0 · 0.51 | 5 / 4 (0) | 3 | 31 · 17 | 0 / 240 | 92 · 34 |
| bill-hr815.pdf · kept-default | 0 | 3649 | 0 | 0.0 · 0.51 | 3 / 4 (0) | 5 | 25 · 16 | 0 / 238 | 92 · 62 |
| bill-hr815.pdf · kept-12vp | 0 | 2621 | 0 | 0.0 · 0.70 | 0 / 1 (0) | 8 | 26 · 12 | 0 / 222 | 92 · 116 |
| bill-hr815.pdf · kept-24vp | 0 | 2621 | 0 | 0.0 · 0.70 | 0 / 1 (0) | 8 | 18 · 8 | 0 / 223 | 92 · 116 |
| synthetic-vector-pages.pdf · none | 0 | 3136 | 0 | 0.0 · 0.51 | 7 / 4 (0) | 0 | 55 · 19 | 2 / 203 | 79 · 0 |
| synthetic-vector-pages.pdf · kept-3vp | 0 | 3136 | 0 | 0.0 · 0.51 | 5 / 4 (0) | 3 | 42 · 15 | 0 / 208 | 80 · 38 |
| synthetic-vector-pages.pdf · kept-default | 0 | 3137 | 0 | 0.0 · 0.59 | 3 / 4 (0) | 5 | 37 · 16 | 0 / 207 | 80 · 65 |
| synthetic-vector-pages.pdf · kept-12vp | 0 | 2000 | 0 | 0.0 · 0.78 | 0 / 1 (0) | 8 | 11 · 8 | 0 / 194 | 80 · 100 |
| synthetic-vector-pages.pdf · kept-24vp | 0 | 2001 | 0 | 0.0 · 0.78 | 0 / 1 (0) | 8 | 21 · 8 | 0 / 194 | 80 · 100 |

## long-scroll-back: 20 pages down and back up at 3600 CSS px per second, settling at the bottom

| File · variant | No blank (ms) | Sharp (ms) | Blank frames | Mean blank % · sharpness moving | Renders base / detail (cancelled) | Drawn back | Main thread blocked (ms) · longest lag | Dropped / frames | Canvas · kept MiB |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| bill-hr815.pdf · none | 0 | 6988 | 0 | 0.0 · 0.38 | 17 / 4 (0) | 0 | 66 · 18 | 0 / 439 | 92 · 0 |
| bill-hr815.pdf · kept-3vp | 0 | 6991 | 0 | 0.0 · 0.38 | 15 / 4 (0) | 3 | 94 · 24 | 0 / 439 | 92 · 37 |
| bill-hr815.pdf · kept-default | 0 | 7001 | 0 | 0.0 · 0.38 | 13 / 4 (0) | 5 | 77 · 16 | 0 / 439 | 92 · 71 |
| bill-hr815.pdf · kept-12vp | 0 | 5970 | 0 | 0.0 · 0.48 | 0 / 1 (0) | 18 | 48 · 13 | 0 / 424 | 92 · 139 |
| bill-hr815.pdf · kept-24vp | 0 | 5971 | 0 | 0.0 · 0.48 | 0 / 1 (0) | 18 | 41 · 10 | 0 / 423 | 92 · 139 |
| synthetic-vector-pages.pdf · none | 0 | 6073 | 0 | 0.0 · 0.38 | 17 / 4 (0) | 0 | 82 · 18 | 0 / 384 | 79 · 0 |
| synthetic-vector-pages.pdf · kept-3vp | 0 | 6071 | 0 | 0.0 · 0.38 | 15 / 4 (0) | 3 | 215 · 32 | 1 / 383 | 80 · 38 |
| synthetic-vector-pages.pdf · kept-default | 0 | 6070 | 0 | 0.0 · 0.38 | 12 / 4 (0) | 6 | 63 · 18 | 0 / 383 | 80 · 72 |
| synthetic-vector-pages.pdf · kept-12vp | 0 | 4904 | 0 | 0.0 · 0.51 | 0 / 1 (0) | 18 | 17 · 11 | 0 / 369 | 80 · 131 |
| synthetic-vector-pages.pdf · kept-24vp | 0 | 4904 | 0 | 0.0 · 0.51 | 0 / 1 (0) | 18 | 31 · 9 | 0 / 368 | 80 · 131 |

## flip-back: "page" mode, 8 flips forward settling after each, then 8 back 50 ms apart

| File · variant | No blank (ms) | Sharp (ms) | Blank frames | Mean blank % · sharpness moving | Each flip sharp, median · max (ms) | Renders base / detail (cancelled) | Drawn back | Main thread blocked (ms) · longest lag | Dropped / frames | Canvas · kept MiB |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| bill-hr815.pdf · none | 9 | 9 | 0 | 0.0 · 1.00 | 16 · 24 | 0 / 6 (0) | 0 | 53 · 14 | 0 / 42 | 73 · 0 |
| bill-hr815.pdf · kept-3vp | 6 | 6 | 0 | 0.0 · 1.00 | 15 · 25 | 0 / 4 (0) | 2 | 30 · 10 | 0 / 42 | 73 · 29 |
| bill-hr815.pdf · kept-default | 5 | 5 | 0 | 0.0 · 1.00 | 15 · 24 | 0 / 2 (0) | 4 | 22 · 12 | 0 / 42 | 73 · 58 |
| bill-hr815.pdf · kept-12vp | 5 | 5 | 0 | 0.0 · 1.00 | 15 · 18 | 0 / 0 (0) | 6 | 24 · 7 | 0 / 42 | 73 · 116 |
| bill-hr815.pdf · kept-24vp | 9 | 9 | 0 | 0.0 · 1.00 | 13 · 18 | 0 / 0 (0) | 6 | 18 · 10 | 0 / 42 | 73 · 116 |
| synthetic-vector-pages.pdf · none | 3 | 3 | 0 | 0.0 · 1.00 | 14 · 17 | 0 / 6 (0) | 0 | 46 · 12 | 0 / 42 | 63 · 0 |
| synthetic-vector-pages.pdf · kept-3vp | 2 | 2 | 0 | 0.0 · 1.00 | 14 · 18 | 0 / 3 (0) | 3 | 22 · 12 | 0 / 42 | 63 · 38 |
| synthetic-vector-pages.pdf · kept-default | 3 | 3 | 0 | 0.0 · 1.00 | 12 · 21 | 0 / 1 (0) | 5 | 11 · 11 | 0 / 41 | 63 · 63 |
| synthetic-vector-pages.pdf · kept-12vp | 3 | 3 | 0 | 0.0 · 1.00 | 13 · 18 | 0 / 0 (0) | 6 | 3 · 4 | 0 / 41 | 63 · 100 |
| synthetic-vector-pages.pdf · kept-24vp | 2 | 2 | 0 | 0.0 · 1.00 | 13 · 17 | 0 / 0 (0) | 6 | 1 · 5 | 0 / 42 | 63 · 100 |

