# ParaPDF runtime prototype: coming back to pages, WebKit 27.2

- Run at: 2026-10-27T08:38:54.474Z
- Machine: darwin 27.0.0 arm64, Apple M2 Pro (12 logical cores); WebKit 27.2 (Playwright build, headless); power: AC
- One-minute load average: 7.0 at the start, 18.0 at the end, on 12 cores. The run waited 13 times (28 min in all) for other Playwright browsers and repeated 13 jobs that another browser overlapped.
- Method: pdf.js drawing on the main thread, GPU-backed canvases, 820×1000 at devicePixelRatio 2 and fit-width, 3 runs; medians. Variants: none keeps no canvases of pages that unmount (`maxKeptPixels: 0`); kept-<budget> keeps them, at most that budget (<n>vp: n viewports' worth, 13 MiB each; default: the viewer's default), and draws them back when the pages mount again.
- From the start of the way back, a probe records after every frame's animation frame callbacks and layout. No blank: from the first frame after which no page in view lacked pixels (`blankFraction()` 0). Sharp: from the first frame after which the visible pages' `sharpness()` stayed at 0.99 or more. Blank frames count frames with any blank area until sharp; mean blank and mean sharpness are over the frames while scrolling or flipping. Renders and layers drawn back count from the start of the way back until sharp. Main thread blocked sums a 4 ms timer's lateness beyond 2 ms or the idle 95th percentile; dropped frames are longer than 1.5 idle frames. Memory: width × height × 4 bytes of every canvas in the viewport and of the kept ones, at their peaks.
- Reproduce: `pnpm --filter @parapdf/bench corpus && pnpm --filter @parapdf/prototype build && BROWSER=webkit node examples/prototype/scripts/return-bench.ts`

## jump-back: page 1 → page 13 → page 1, settling at page 13

| File · variant | No blank (ms) | Sharp (ms) | Blank frames | Renders base / detail (cancelled) | Drawn back | Main thread blocked (ms) · longest lag | Dropped / frames | Canvas · kept MiB |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| bill-hr815.pdf · none | 38 | 38 | 1 | 0 / 3 (0) | 0 | 1 · 8 | 2 / 24 | 44 · 0 |
| bill-hr815.pdf · kept-3vp | 36 | 36 | 1 | 0 / 1 (0) | 2 | 0 · 8 | 2 / 25 | 44 · 29 |
| bill-hr815.pdf · kept-default | 10 | 10 | 0 | 0 / 0 (0) | 3 | 4 · 10 | 1 / 23 | 44 · 58 |
| bill-hr815.pdf · kept-12vp | 8 | 8 | 0 | 0 / 0 (0) | 3 | 0 · 6 | 1 / 23 | 44 · 73 |
| bill-hr815.pdf · kept-24vp | 7 | 7 | 0 | 0 / 0 (0) | 3 | 0 · 8 | 1 / 23 | 44 · 73 |
| synthetic-vector-pages.pdf · none | 38 | 160 | 2 | 2 / 3 (1) | 0 | 1 · 6 | 1 / 33 | 39 · 0 |
| synthetic-vector-pages.pdf · kept-3vp | 3 | 3 | 0 | 0 / 0 (0) | 3 | 0 · 5 | 1 / 23 | 38 · 38 |
| synthetic-vector-pages.pdf · kept-default | 3 | 3 | 0 | 0 / 0 (0) | 3 | 1 · 5 | 1 / 23 | 38 · 63 |
| synthetic-vector-pages.pdf · kept-12vp | 3 | 3 | 0 | 0 / 0 (0) | 3 | 0 · 5 | 0 / 23 | 38 · 63 |
| synthetic-vector-pages.pdf · kept-24vp | 3 | 3 | 0 | 0 / 0 (0) | 3 | 0 · 5 | 0 / 23 | 38 · 63 |

## scroll-back: 10 pages down and back up at 3600 CSS px per second, settling at the bottom

| File · variant | No blank (ms) | Sharp (ms) | Blank frames | Mean blank % · sharpness moving | Renders base / detail (cancelled) | Drawn back | Main thread blocked (ms) · longest lag | Dropped / frames | Canvas · kept MiB |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| bill-hr815.pdf · none | 0 | 3567 | 0 | 0.0 · 0.51 | 7 / 4 (0) | 0 | 6 · 12 | 1 / 279 | 92 · 0 |
| bill-hr815.pdf · kept-3vp | 0 | 3563 | 0 | 0.0 · 0.51 | 5 / 4 (0) | 3 | 5 · 10 | 1 / 279 | 92 · 34 |
| bill-hr815.pdf · kept-default | 0 | 3564 | 0 | 0.0 · 0.51 | 3 / 4 (0) | 5 | 6 · 9 | 1 / 280 | 92 · 62 |
| bill-hr815.pdf · kept-12vp | 0 | 2632 | 0 | 0.0 · 0.70 | 0 / 1 (0) | 8 | 9 · 13 | 1 / 266 | 92 · 116 |
| bill-hr815.pdf · kept-24vp | 0 | 2629 | 0 | 0.0 · 0.70 | 0 / 1 (0) | 8 | 4 · 12 | 0 / 266 | 92 · 116 |
| synthetic-vector-pages.pdf · none | 0 | 3188 | 0 | 0.0 · 0.51 | 7 / 4 (0) | 0 | 4 · 7 | 0 / 252 | 79 · 0 |
| synthetic-vector-pages.pdf · kept-3vp | 0 | 3189 | 0 | 0.0 · 0.51 | 5 / 4 (0) | 3 | 13 · 10 | 0 / 252 | 80 · 38 |
| synthetic-vector-pages.pdf · kept-default | 0 | 3185 | 0 | 0.0 · 0.59 | 3 / 4 (0) | 5 | 5 · 7 | 0 / 252 | 80 · 65 |
| synthetic-vector-pages.pdf · kept-12vp | 0 | 2018 | 0 | 0.0 · 0.78 | 0 / 1 (0) | 8 | 4 · 5 | 0 / 233 | 80 · 100 |
| synthetic-vector-pages.pdf · kept-24vp | 0 | 2004 | 0 | 0.0 · 0.78 | 0 / 1 (0) | 8 | 2 · 6 | 0 / 233 | 80 · 100 |

## long-scroll-back: 20 pages down and back up at 3600 CSS px per second, settling at the bottom

| File · variant | No blank (ms) | Sharp (ms) | Blank frames | Mean blank % · sharpness moving | Renders base / detail (cancelled) | Drawn back | Main thread blocked (ms) · longest lag | Dropped / frames | Canvas · kept MiB |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| bill-hr815.pdf · none | 0 | 6938 | 0 | 0.0 · 0.38 | 17 / 4 (0) | 0 | 5 · 8 | 1 / 523 | 92 · 0 |
| bill-hr815.pdf · kept-3vp | 0 | 6938 | 0 | 0.0 · 0.38 | 15 / 4 (0) | 3 | 5 · 10 | 1 / 523 | 92 · 37 |
| bill-hr815.pdf · kept-default | 0 | 6938 | 0 | 0.0 · 0.38 | 13 / 4 (0) | 5 | 12 · 9 | 1 / 523 | 92 · 71 |
| bill-hr815.pdf · kept-12vp | 0 | 5977 | 0 | 0.0 · 0.48 | 0 / 1 (0) | 18 | 7 · 11 | 2 / 507 | 92 · 139 |
| bill-hr815.pdf · kept-24vp | 0 | 5991 | 0 | 0.0 · 0.48 | 0 / 1 (0) | 18 | 3 · 10 | 0 / 507 | 92 · 139 |
| synthetic-vector-pages.pdf · none | 0 | 6064 | 0 | 0.0 · 0.38 | 17 / 4 (0) | 0 | 11 · 9 | 0 / 459 | 79 · 0 |
| synthetic-vector-pages.pdf · kept-3vp | 0 | 6065 | 0 | 0.0 · 0.38 | 15 / 4 (0) | 3 | 9 · 7 | 1 / 459 | 80 · 38 |
| synthetic-vector-pages.pdf · kept-default | 0 | 6063 | 0 | 0.0 · 0.38 | 12 / 4 (0) | 6 | 5 · 7 | 0 / 459 | 80 · 72 |
| synthetic-vector-pages.pdf · kept-12vp | 0 | 4920 | 0 | 0.0 · 0.52 | 0 / 1 (0) | 18 | 8 · 6 | 0 / 442 | 80 · 131 |
| synthetic-vector-pages.pdf · kept-24vp | 0 | 4920 | 0 | 0.0 · 0.52 | 0 / 1 (0) | 18 | 7 · 6 | 0 / 442 | 80 · 131 |

## flip-back: "page" mode, 8 flips forward settling after each, then 8 back 50 ms apart

| File · variant | No blank (ms) | Sharp (ms) | Blank frames | Mean blank % · sharpness moving | Each flip sharp, median · max (ms) | Renders base / detail (cancelled) | Drawn back | Main thread blocked (ms) · longest lag | Dropped / frames | Canvas · kept MiB |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| bill-hr815.pdf · none | 8 | 8 | 0 | 0.0 · 1.00 | 12 · 26 | 0 / 6 (0) | 0 | 11 · 11 | 4 / 44 | 73 · 0 |
| bill-hr815.pdf · kept-3vp | 10 | 10 | 0 | 0.0 · 1.00 | 12 · 18 | 0 / 4 (0) | 2 | 5 · 10 | 3 / 44 | 73 · 29 |
| bill-hr815.pdf · kept-default | 7 | 7 | 0 | 0.0 · 1.00 | 11 · 18 | 0 / 2 (0) | 4 | 6 · 10 | 2 / 44 | 73 · 58 |
| bill-hr815.pdf · kept-12vp | 7 | 7 | 0 | 0.0 · 1.00 | 9 · 19 | 0 / 0 (0) | 6 | 2 · 10 | 3 / 47 | 73 · 116 |
| bill-hr815.pdf · kept-24vp | 7 | 7 | 0 | 0.0 · 1.00 | 7 · 16 | 0 / 0 (0) | 6 | 7 · 11 | 1 / 48 | 73 · 116 |
| synthetic-vector-pages.pdf · none | 2 | 2 | 0 | 0.0 · 1.00 | 6 · 12 | 0 / 6 (0) | 0 | 1 · 6 | 0 / 48 | 63 · 0 |
| synthetic-vector-pages.pdf · kept-3vp | 2 | 2 | 0 | 0.0 · 1.00 | 7 · 15 | 0 / 3 (0) | 3 | 0 · 6 | 0 / 48 | 63 · 38 |
| synthetic-vector-pages.pdf · kept-default | 2 | 2 | 0 | 0.0 · 1.00 | 7 · 13 | 0 / 1 (0) | 5 | 2 · 6 | 0 / 48 | 63 · 63 |
| synthetic-vector-pages.pdf · kept-12vp | 2 | 2 | 0 | 0.0 · 1.00 | 7 · 14 | 0 / 0 (0) | 6 | 0 · 5 | 0 / 48 | 63 · 100 |
| synthetic-vector-pages.pdf · kept-24vp | 2 | 2 | 0 | 0.0 · 1.00 | 8 · 13 | 0 / 0 (0) | 6 | 0 · 5 | 0 / 48 | 63 · 100 |

