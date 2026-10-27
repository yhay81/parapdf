# ParaPDF runtime prototype: coming back to pages, Firefox 157.0

- Run at: 2026-10-27T12:16:47.457Z
- Machine: darwin 27.0.0 arm64, Apple M2 Pro (12 logical cores); Firefox 157.0 (Playwright build, headless); power: AC
- One-minute load average: 5.8 at the start, 4.6 at the end, on 12 cores. The run waited 2 times (1 min in all) for other Playwright browsers or a load average above 10 and repeated 2 jobs that another browser overlapped.
- Method: pdf.js drawing on the main thread, GPU-backed canvases, 820×1000 at devicePixelRatio 2 and fit-width, 3 runs; medians. Variants: none keeps no canvases of pages that unmount (`maxKeptPixels: 0`); kept-<budget> keeps them, at most that budget (<n>vp: n viewports' worth, 13 MiB each; default: the viewer's default), and draws them back when the pages mount again.
- From the start of the way back, a probe records after every frame's animation frame callbacks and layout. No blank: from the first frame after which no page in view lacked pixels (`blankFraction()` 0). Sharp: from the first frame after which the visible pages' `sharpness()` stayed at 0.99 or more. Blank frames count frames with any blank area until sharp; mean blank and mean sharpness are over the frames while scrolling or flipping. Renders and layers drawn back count from the start of the way back until sharp. Main thread blocked sums a 4 ms timer's lateness beyond 2 ms or the idle 95th percentile; dropped frames are longer than 1.5 idle frames. Memory: width × height × 4 bytes of every canvas in the viewport and of the kept ones, at their peaks.
- Reproduce: `pnpm --filter @parapdf/bench corpus && pnpm --filter @parapdf/prototype build && BROWSER=firefox node examples/prototype/scripts/return-bench.ts`

## jump-back: page 1 → page 13 → page 1, settling at page 13

| File · variant | No blank (ms) | Sharp (ms) | Blank frames | Renders base / detail (cancelled) | Drawn back | Main thread blocked (ms) · longest lag | Dropped / frames | Canvas · kept MiB |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| bill-hr815.pdf · kept-6vp | 16 | 16 | 0 | 0 / 0 (0) | 3 | 13 · 16 | 0 / 20 | 44 · 73 |
| bill-hr815.pdf · kept-9vp | 17 | 17 | 0 | 0 / 0 (0) | 3 | 20 · 19 | 0 / 20 | 44 · 73 |
| bill-hr815.pdf · kept-12vp | 17 | 17 | 0 | 0 / 0 (0) | 3 | 22 · 21 | 0 / 20 | 44 · 73 |
| synthetic-vector-pages.pdf · kept-6vp | 11 | 11 | 0 | 0 / 0 (0) | 3 | 8 · 11 | 0 / 20 | 38 · 63 |
| synthetic-vector-pages.pdf · kept-9vp | 11 | 11 | 0 | 0 / 0 (0) | 3 | 7 · 10 | 0 / 20 | 38 · 63 |
| synthetic-vector-pages.pdf · kept-12vp | 15 | 15 | 0 | 0 / 0 (0) | 3 | 12 · 15 | 0 / 20 | 38 · 63 |

## scroll-back: 10 pages down and back up at 3600 CSS px per second, settling at the bottom

| File · variant | No blank (ms) | Sharp (ms) | Blank frames | Mean blank % · sharpness moving | Renders base / detail (cancelled) | Drawn back | Main thread blocked (ms) · longest lag | Dropped / frames | Canvas · kept MiB |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| bill-hr815.pdf · kept-6vp | 1 | 3638 | 0 | 0.0 · 0.51 | 3 / 4 (0) | 5 | 60 · 25 | 0 / 237 | 92 · 74 |
| bill-hr815.pdf · kept-9vp | 0 | 3649 | 0 | 0.0 · 0.66 | 1 / 2 (0) | 7 | 84 · 28 | 0 / 238 | 92 · 102 |
| bill-hr815.pdf · kept-12vp | 0 | 2621 | 0 | 0.0 · 0.70 | 0 / 1 (0) | 8 | 20 · 10 | 0 / 222 | 92 · 116 |
| synthetic-vector-pages.pdf · kept-6vp | 1 | 3118 | 0 | 0.0 · 0.66 | 2 / 3 (0) | 6 | 43 · 15 | 0 / 206 | 80 · 75 |
| synthetic-vector-pages.pdf · kept-9vp | 0 | 2003 | 0 | 0.0 · 0.78 | 0 / 1 (0) | 8 | 25 · 11 | 0 / 194 | 80 · 100 |
| synthetic-vector-pages.pdf · kept-12vp | 0 | 2006 | 0 | 0.0 · 0.78 | 0 / 1 (0) | 8 | 30 · 7 | 0 / 195 | 80 · 100 |

## long-scroll-back: 20 pages down and back up at 3600 CSS px per second, settling at the bottom

| File · variant | No blank (ms) | Sharp (ms) | Blank frames | Mean blank % · sharpness moving | Renders base / detail (cancelled) | Drawn back | Main thread blocked (ms) · longest lag | Dropped / frames | Canvas · kept MiB |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| bill-hr815.pdf · kept-6vp | 0 | 6957 | 0 | 0.0 · 0.38 | 12 / 4 (0) | 6 | 72 · 17 | 0 / 437 | 92 · 74 |
| bill-hr815.pdf · kept-9vp | 1 | 6936 | 0 | 0.0 · 0.42 | 2 / 3 (0) | 16 | 80 · 24 | 0 / 436 | 92 · 111 |
| bill-hr815.pdf · kept-12vp | 1 | 5975 | 0 | 0.0 · 0.48 | 0 / 1 (0) | 18 | 47 · 12 | 0 / 424 | 92 · 139 |
| synthetic-vector-pages.pdf · kept-6vp | 0 | 6053 | 0 | 0.0 · 0.38 | 12 / 4 (0) | 6 | 126 · 19 | 0 / 381 | 80 · 75 |
| synthetic-vector-pages.pdf · kept-9vp | 0 | 6030 | 0 | 0.0 · 0.46 | 2 / 3 (0) | 16 | 82 · 23 | 0 / 381 | 80 · 108 |
| synthetic-vector-pages.pdf · kept-12vp | 0 | 4906 | 0 | 0.0 · 0.51 | 0 / 1 (0) | 18 | 31 · 12 | 0 / 369 | 80 · 131 |

## flip-back: "page" mode, 8 flips forward settling after each, then 8 back 50 ms apart

| File · variant | No blank (ms) | Sharp (ms) | Blank frames | Mean blank % · sharpness moving | Each flip sharp, median · max (ms) | Renders base / detail (cancelled) | Drawn back | Main thread blocked (ms) · longest lag | Dropped / frames | Canvas · kept MiB |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| bill-hr815.pdf · kept-6vp | 9 | 9 | 0 | 0.0 · 1.00 | 14 · 22 | 0 / 1 (0) | 5 | 26 · 16 | 0 / 42 | 73 · 73 |
| bill-hr815.pdf · kept-9vp | 11 | 11 | 0 | 0.0 · 1.00 | 11 · 18 | 0 / 0 (0) | 6 | 31 · 16 | 0 / 42 | 73 · 102 |
| bill-hr815.pdf · kept-12vp | 9 | 9 | 0 | 0.0 · 1.00 | 14 · 19 | 0 / 0 (0) | 6 | 38 · 12 | 0 / 42 | 73 · 116 |
| synthetic-vector-pages.pdf · kept-6vp | 4 | 4 | 0 | 0.0 · 1.00 | 10 · 17 | 0 / 0 (0) | 6 | 5 · 6 | 0 / 42 | 63 · 75 |
| synthetic-vector-pages.pdf · kept-9vp | 4 | 4 | 0 | 0.0 · 1.00 | 13 · 18 | 0 / 0 (0) | 6 | 4 · 4 | 0 / 42 | 63 · 100 |
| synthetic-vector-pages.pdf · kept-12vp | 4 | 4 | 0 | 0.0 · 1.00 | 14 · 17 | 0 / 0 (0) | 6 | 2 · 4 | 0 / 42 | 63 · 100 |

