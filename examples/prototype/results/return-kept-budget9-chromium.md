# ParaPDF runtime prototype: coming back to pages, Chromium 156.0.8078.4

- Run at: 2026-10-27T11:48:24.916Z
- Machine: darwin 27.0.0 arm64, Apple M2 Pro (12 logical cores); Chromium 156.0.8078.4 (Playwright build, headless); power: AC
- One-minute load average: 4.6 at the start, 3.5 at the end, on 12 cores. The run waited 2 times (1 min in all) for other Playwright browsers or a load average above 10 and repeated 0 jobs that another browser overlapped.
- Method: pdf.js drawing on the main thread, GPU-backed canvases, 820×1000 at devicePixelRatio 2 and fit-width, 3 runs; medians. Variants: none keeps no canvases of pages that unmount (`maxKeptPixels: 0`); kept-<budget> keeps them, at most that budget (<n>vp: n viewports' worth, 13 MiB each; default: the viewer's default), and draws them back when the pages mount again.
- From the start of the way back, a probe records after every frame's animation frame callbacks and layout. No blank: from the first frame after which no page in view lacked pixels (`blankFraction()` 0). Sharp: from the first frame after which the visible pages' `sharpness()` stayed at 0.99 or more. Blank frames count frames with any blank area until sharp; mean blank and mean sharpness are over the frames while scrolling or flipping. Renders and layers drawn back count from the start of the way back until sharp. Main thread blocked sums a 4 ms timer's lateness beyond 2 ms or the idle 95th percentile; dropped frames are longer than 1.5 idle frames. Memory: width × height × 4 bytes of every canvas in the viewport and of the kept ones, at their peaks.
- Reproduce: `pnpm --filter @parapdf/bench corpus && pnpm --filter @parapdf/prototype build && BROWSER=chromium node examples/prototype/scripts/return-bench.ts`

## jump-back: page 1 → page 13 → page 1, settling at page 13

| File · variant | No blank (ms) | Sharp (ms) | Blank frames | Renders base / detail (cancelled) | Drawn back | Main thread blocked (ms) · longest lag | Dropped / frames | Canvas · kept MiB |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| bill-hr815.pdf · kept-6vp | 3 | 3 | 0 | 0 / 0 (0) | 3 | 2 · 4 | 0 / 20 | 44 · 73 |
| bill-hr815.pdf · kept-9vp | 4 | 4 | 0 | 0 / 0 (0) | 3 | 2 · 4 | 0 / 20 | 44 · 73 |
| bill-hr815.pdf · kept-12vp | 3 | 3 | 0 | 0 / 0 (0) | 3 | 1 · 3 | 0 / 20 | 44 · 73 |
| synthetic-vector-pages.pdf · kept-6vp | 2 | 2 | 0 | 0 / 0 (0) | 3 | 0 · 1 | 0 / 20 | 38 · 63 |
| synthetic-vector-pages.pdf · kept-9vp | 3 | 3 | 0 | 0 / 0 (0) | 3 | 0 · 1 | 0 / 20 | 38 · 63 |
| synthetic-vector-pages.pdf · kept-12vp | 3 | 3 | 0 | 0 / 0 (0) | 3 | 0 · 1 | 0 / 20 | 38 · 63 |

## scroll-back: 10 pages down and back up at 3600 CSS px per second, settling at the bottom

| File · variant | No blank (ms) | Sharp (ms) | Blank frames | Mean blank % · sharpness moving | Renders base / detail (cancelled) | Drawn back | Main thread blocked (ms) · longest lag | Dropped / frames | Canvas · kept MiB |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| bill-hr815.pdf · kept-6vp | 0 | 3675 | 0 | 0.0 · 0.51 | 3 / 4 (0) | 5 | 27 · 12 | 0 / 240 | 92 · 74 |
| bill-hr815.pdf · kept-9vp | 0 | 3672 | 0 | 0.0 · 0.66 | 1 / 2 (0) | 7 | 16 · 8 | 0 / 239 | 92 · 102 |
| bill-hr815.pdf · kept-12vp | 0 | 2631 | 0 | 0.0 · 0.70 | 0 / 1 (0) | 8 | 4 · 6 | 0 / 222 | 92 · 116 |
| synthetic-vector-pages.pdf · kept-6vp | 0 | 3134 | 0 | 0.0 · 0.66 | 2 / 3 (0) | 6 | 0 · 2 | 0 / 207 | 80 · 75 |
| synthetic-vector-pages.pdf · kept-9vp | 0 | 2016 | 0 | 0.0 · 0.78 | 0 / 1 (0) | 8 | 0 · 2 | 0 / 195 | 80 · 100 |
| synthetic-vector-pages.pdf · kept-12vp | 0 | 2015 | 0 | 0.0 · 0.78 | 0 / 1 (0) | 8 | 1 · 3 | 0 / 195 | 80 · 100 |

## long-scroll-back: 20 pages down and back up at 3600 CSS px per second, settling at the bottom

| File · variant | No blank (ms) | Sharp (ms) | Blank frames | Mean blank % · sharpness moving | Renders base / detail (cancelled) | Drawn back | Main thread blocked (ms) · longest lag | Dropped / frames | Canvas · kept MiB |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| bill-hr815.pdf · kept-6vp | 0 | 7009 | 0 | 0.0 · 0.38 | 12 / 4 (0) | 6 | 18 · 9 | 0 / 440 | 92 · 74 |
| bill-hr815.pdf · kept-9vp | 0 | 7006 | 0 | 0.0 · 0.42 | 2 / 3 (0) | 16 | 20 · 11 | 0 / 440 | 92 · 111 |
| bill-hr815.pdf · kept-12vp | 0 | 5982 | 0 | 0.0 · 0.48 | 0 / 1 (0) | 18 | 7 · 6 | 0 / 423 | 92 · 139 |
| synthetic-vector-pages.pdf · kept-6vp | 0 | 6067 | 0 | 0.0 · 0.38 | 12 / 4 (0) | 6 | 5 · 3 | 0 / 384 | 80 · 75 |
| synthetic-vector-pages.pdf · kept-9vp | 0 | 6066 | 0 | 0.0 · 0.46 | 2 / 3 (0) | 16 | 1 · 3 | 0 / 383 | 80 · 108 |
| synthetic-vector-pages.pdf · kept-12vp | 0 | 4916 | 0 | 0.0 · 0.51 | 0 / 1 (0) | 18 | 0 · 2 | 0 / 368 | 80 · 131 |

## flip-back: "page" mode, 8 flips forward settling after each, then 8 back 50 ms apart

| File · variant | No blank (ms) | Sharp (ms) | Blank frames | Mean blank % · sharpness moving | Each flip sharp, median · max (ms) | Renders base / detail (cancelled) | Drawn back | Main thread blocked (ms) · longest lag | Dropped / frames | Canvas · kept MiB |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| bill-hr815.pdf · kept-6vp | 14 | 14 | 0 | 0.0 · 1.00 | 15 · 19 | 0 / 1 (0) | 5 | 28 · 13 | 0 / 42 | 73 · 73 |
| bill-hr815.pdf · kept-9vp | 8 | 8 | 0 | 0.0 · 1.00 | 12 · 20 | 0 / 0 (0) | 6 | 8 · 5 | 0 / 42 | 73 · 102 |
| bill-hr815.pdf · kept-12vp | 10 | 10 | 0 | 0.0 · 1.00 | 12 · 19 | 0 / 0 (0) | 6 | 21 · 7 | 0 / 42 | 73 · 116 |
| synthetic-vector-pages.pdf · kept-6vp | 2 | 2 | 0 | 0.0 · 1.00 | 9 · 15 | 0 / 0 (0) | 6 | 0 · 2 | 0 / 40 | 63 · 75 |
| synthetic-vector-pages.pdf · kept-9vp | 1 | 1 | 0 | 0.0 · 1.00 | 9 · 15 | 0 / 0 (0) | 6 | 0 · 2 | 0 / 42 | 63 · 100 |
| synthetic-vector-pages.pdf · kept-12vp | 2 | 2 | 0 | 0.0 · 1.00 | 8 · 16 | 0 / 0 (0) | 6 | 0 · 1 | 0 / 42 | 63 · 100 |

