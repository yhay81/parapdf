# ParaPDF runtime prototype: coming back to pages, WebKit 27.2

- Run at: 2026-10-27T12:05:32.866Z
- Machine: darwin 27.0.0 arm64, Apple M2 Pro (12 logical cores); WebKit 27.2 (Playwright build, headless); power: AC
- One-minute load average: 3.5 at the start, 5.8 at the end, on 12 cores. The run waited 3 times (7 min in all) for other Playwright browsers or a load average above 10 and repeated 1 job that another browser overlapped.
- Method: pdf.js drawing on the main thread, GPU-backed canvases, 820×1000 at devicePixelRatio 2 and fit-width, 3 runs; medians. Variants: none keeps no canvases of pages that unmount (`maxKeptPixels: 0`); kept-<budget> keeps them, at most that budget (<n>vp: n viewports' worth, 13 MiB each; default: the viewer's default), and draws them back when the pages mount again.
- From the start of the way back, a probe records after every frame's animation frame callbacks and layout. No blank: from the first frame after which no page in view lacked pixels (`blankFraction()` 0). Sharp: from the first frame after which the visible pages' `sharpness()` stayed at 0.99 or more. Blank frames count frames with any blank area until sharp; mean blank and mean sharpness are over the frames while scrolling or flipping. Renders and layers drawn back count from the start of the way back until sharp. Main thread blocked sums a 4 ms timer's lateness beyond 2 ms or the idle 95th percentile; dropped frames are longer than 1.5 idle frames. Memory: width × height × 4 bytes of every canvas in the viewport and of the kept ones, at their peaks.
- Reproduce: `pnpm --filter @parapdf/bench corpus && pnpm --filter @parapdf/prototype build && BROWSER=webkit node examples/prototype/scripts/return-bench.ts`

## jump-back: page 1 → page 13 → page 1, settling at page 13

| File · variant | No blank (ms) | Sharp (ms) | Blank frames | Renders base / detail (cancelled) | Drawn back | Main thread blocked (ms) · longest lag | Dropped / frames | Canvas · kept MiB |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| bill-hr815.pdf · kept-6vp | 8 | 8 | 0 | 0 / 0 (0) | 3 | 4 · 10 | 1 / 23 | 44 · 73 |
| bill-hr815.pdf · kept-9vp | 8 | 8 | 0 | 0 / 0 (0) | 3 | 1 · 8 | 1 / 23 | 44 · 73 |
| bill-hr815.pdf · kept-12vp | 8 | 8 | 0 | 0 / 0 (0) | 3 | 2 · 10 | 1 / 23 | 44 · 73 |
| synthetic-vector-pages.pdf · kept-6vp | 3 | 3 | 0 | 0 / 0 (0) | 3 | 0 · 5 | 0 / 23 | 38 · 63 |
| synthetic-vector-pages.pdf · kept-9vp | 3 | 3 | 0 | 0 / 0 (0) | 3 | 0 · 5 | 1 / 23 | 38 · 63 |
| synthetic-vector-pages.pdf · kept-12vp | 3 | 3 | 0 | 0 / 0 (0) | 3 | 1 · 5 | 0 / 23 | 38 · 63 |

## scroll-back: 10 pages down and back up at 3600 CSS px per second, settling at the bottom

| File · variant | No blank (ms) | Sharp (ms) | Blank frames | Mean blank % · sharpness moving | Renders base / detail (cancelled) | Drawn back | Main thread blocked (ms) · longest lag | Dropped / frames | Canvas · kept MiB |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| bill-hr815.pdf · kept-6vp | 0 | 3577 | 0 | 0.0 · 0.51 | 3 / 4 (0) | 5 | 10 · 12 | 1 / 280 | 92 · 74 |
| bill-hr815.pdf · kept-9vp | 0 | 3564 | 0 | 0.0 · 0.66 | 1 / 2 (0) | 7 | 8 · 11 | 1 / 280 | 92 · 102 |
| bill-hr815.pdf · kept-12vp | 0 | 2630 | 0 | 0.0 · 0.70 | 0 / 1 (0) | 8 | 7 · 12 | 0 / 266 | 92 · 116 |
| synthetic-vector-pages.pdf · kept-6vp | 0 | 3174 | 0 | 0.0 · 0.66 | 2 / 3 (0) | 6 | 6 · 7 | 0 / 252 | 80 · 75 |
| synthetic-vector-pages.pdf · kept-9vp | 0 | 2017 | 0 | 0.0 · 0.78 | 0 / 1 (0) | 8 | 3 · 6 | 0 / 233 | 80 · 100 |
| synthetic-vector-pages.pdf · kept-12vp | 0 | 2005 | 0 | 0.0 · 0.78 | 0 / 1 (0) | 8 | 1 · 6 | 0 / 233 | 80 · 100 |

## long-scroll-back: 20 pages down and back up at 3600 CSS px per second, settling at the bottom

| File · variant | No blank (ms) | Sharp (ms) | Blank frames | Mean blank % · sharpness moving | Renders base / detail (cancelled) | Drawn back | Main thread blocked (ms) · longest lag | Dropped / frames | Canvas · kept MiB |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| bill-hr815.pdf · kept-6vp | 0 | 6939 | 0 | 0.0 · 0.38 | 12 / 4 (0) | 6 | 14 · 12 | 1 / 523 | 92 · 74 |
| bill-hr815.pdf · kept-9vp | 0 | 6940 | 0 | 0.0 · 0.42 | 2 / 3 (0) | 16 | 12 · 11 | 1 / 522 | 92 · 111 |
| bill-hr815.pdf · kept-12vp | 0 | 5977 | 0 | 0.0 · 0.48 | 0 / 1 (0) | 18 | 3 · 10 | 0 / 507 | 92 · 139 |
| synthetic-vector-pages.pdf · kept-6vp | 0 | 6064 | 0 | 0.0 · 0.38 | 12 / 4 (0) | 6 | 12 · 7 | 0 / 459 | 80 · 75 |
| synthetic-vector-pages.pdf · kept-9vp | 0 | 6062 | 0 | 0.0 · 0.46 | 2 / 3 (0) | 16 | 11 · 7 | 0 / 459 | 80 · 108 |
| synthetic-vector-pages.pdf · kept-12vp | 0 | 4922 | 0 | 0.0 · 0.52 | 0 / 1 (0) | 18 | 10 · 8 | 0 / 442 | 80 · 131 |

## flip-back: "page" mode, 8 flips forward settling after each, then 8 back 50 ms apart

| File · variant | No blank (ms) | Sharp (ms) | Blank frames | Mean blank % · sharpness moving | Each flip sharp, median · max (ms) | Renders base / detail (cancelled) | Drawn back | Main thread blocked (ms) · longest lag | Dropped / frames | Canvas · kept MiB |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| bill-hr815.pdf · kept-6vp | 8 | 8 | 0 | 0.0 · 1.00 | 11 · 16 | 0 / 1 (0) | 5 | 3 · 9 | 2 / 44 | 73 · 73 |
| bill-hr815.pdf · kept-9vp | 9 | 9 | 0 | 0.0 · 1.00 | 9 · 17 | 0 / 0 (0) | 6 | 3 · 8 | 1 / 47 | 73 · 102 |
| bill-hr815.pdf · kept-12vp | 7 | 7 | 0 | 0.0 · 1.00 | 9 · 16 | 0 / 0 (0) | 6 | 4 · 10 | 1 / 47 | 73 · 116 |
| synthetic-vector-pages.pdf · kept-6vp | 3 | 3 | 0 | 0.0 · 1.00 | 7 · 14 | 0 / 0 (0) | 6 | 1 · 5 | 0 / 48 | 63 · 75 |
| synthetic-vector-pages.pdf · kept-9vp | 3 | 3 | 0 | 0.0 · 1.00 | 6 · 13 | 0 / 0 (0) | 6 | 0 · 5 | 0 / 48 | 63 · 100 |
| synthetic-vector-pages.pdf · kept-12vp | 2 | 2 | 0 | 0.0 · 1.00 | 6 · 12 | 0 / 0 (0) | 6 | 0 · 5 | 0 / 48 | 63 · 100 |

