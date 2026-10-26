# ParaPDF runtime prototype: coming back to pages, Firefox 157.0

- Run at: 2026-10-25T23:44:06.262Z
- Machine: darwin 27.0.0 arm64, Apple M2 Pro (12 logical cores); Firefox 157.0 (Playwright build, headless); power: AC
- One-minute load average: 5.7 at the start, 11.1 at the end, on 12 cores. The run waited 0 times (0 min in all) for other Playwright browsers and repeated 0 jobs that another browser overlapped.
- Method: pdf.js drawing on the main thread, GPU-backed canvases, 820×1000 at devicePixelRatio 2 and fit-width, 3 runs; medians. Variants: none keeps no canvases of pages that unmount (`maxKeptPixels: 0`); kept keeps them, six viewports' worth at most, and draws them back when the pages mount again. before is M4 6325a81, measured in turn with them.
- From the start of the way back, a probe records after every frame's animation frame callbacks and layout. No blank: from the first frame after which no page in view lacked pixels (`blankFraction()` 0). Sharp: from the first frame after which the visible pages' `sharpness()` stayed at 0.99 or more. Blank frames count frames with any blank area until sharp; mean blank and mean sharpness are over the frames while scrolling or flipping. Renders and layers drawn back count from the start of the way back until sharp. Main thread blocked sums a 4 ms timer's lateness beyond 2 ms or the idle 95th percentile; dropped frames are longer than 1.5 idle frames. Memory: width × height × 4 bytes of every canvas in the viewport and of the kept ones, at their peaks.
- Reproduce: `pnpm --filter @parapdf/bench corpus && pnpm --filter @parapdf/prototype build && BROWSER=firefox node examples/prototype/scripts/return-bench.ts`

## jump-back: page 1 → page 13 → page 1, settling at page 13

| File · variant | No blank (ms) | Sharp (ms) | Blank frames | Renders base / detail (cancelled) | Drawn back | Main thread blocked (ms) · longest lag | Dropped / frames | Canvas · kept MiB |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| bill-hr815.pdf · before | 17 | 17 | 0 | 0 / 0 (0) | 3 | 17 · 19 | 0 / 19 | 44 · 58 |
| bill-hr815.pdf · none | 34 | 166 | 2 | 2 / 3 (1) | 0 | 23 · 14 | 0 / 30 | 45 · 0 |
| bill-hr815.pdf · kept | 8 | 8 | 0 | 0 / 0 (0) | 3 | 5 · 7 | 0 / 20 | 44 · 58 |
| synthetic-vector-pages.pdf · before | 12 | 12 | 0 | 0 / 0 (0) | 3 | 9 · 11 | 0 / 20 | 38 · 63 |
| synthetic-vector-pages.pdf · none | 62 | 170 | 4 | 2 / 3 (1) | 0 | 20 · 15 | 0 / 30 | 39 · 0 |
| synthetic-vector-pages.pdf · kept | 9 | 9 | 0 | 0 / 0 (0) | 3 | 5 · 7 | 0 / 20 | 38 · 63 |

## scroll-back: 10 pages down and back up at 3600 CSS px per second, settling at the bottom

| File · variant | No blank (ms) | Sharp (ms) | Blank frames | Mean blank % · sharpness moving | Renders base / detail (cancelled) | Drawn back | Main thread blocked (ms) · longest lag | Dropped / frames | Canvas · kept MiB |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| bill-hr815.pdf · before | 0 | 3667 | 0 | 0.0 · 0.51 | 3 / 4 (0) | 5 | 41 · 13 | 0 / 239 | 92 · 62 |
| bill-hr815.pdf · none | 0 | 3650 | 0 | 0.0 · 0.51 | 7 / 4 (0) | 0 | 26 · 15 | 0 / 238 | 92 · 0 |
| bill-hr815.pdf · kept | 0 | 3667 | 0 | 0.0 · 0.51 | 3 / 4 (0) | 5 | 55 · 13 | 0 / 240 | 92 · 62 |
| synthetic-vector-pages.pdf · before | 0 | 3136 | 0 | 0.0 · 0.59 | 3 / 4 (0) | 5 | 66 · 24 | 0 / 207 | 80 · 65 |
| synthetic-vector-pages.pdf · none | 0 | 3133 | 0 | 0.0 · 0.51 | 7 / 4 (0) | 0 | 26 · 15 | 0 / 208 | 79 · 0 |
| synthetic-vector-pages.pdf · kept | 0 | 3133 | 0 | 0.0 · 0.59 | 3 / 4 (0) | 5 | 31 · 15 | 0 / 208 | 80 · 65 |

## flip-back: "page" mode, 8 flips forward settling after each, then 8 back 50 ms apart

| File · variant | No blank (ms) | Sharp (ms) | Blank frames | Mean blank % · sharpness moving | Each flip sharp, median · max (ms) | Renders base / detail (cancelled) | Drawn back | Main thread blocked (ms) · longest lag | Dropped / frames | Canvas · kept MiB |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| bill-hr815.pdf · before | 8 | 8 | 0 | 0.0 · 1.00 | 15 · 24 | 0 / 2 (0) | 4 | 43 · 12 | 0 / 41 | 73 · 58 |
| bill-hr815.pdf · none | 6 | 6 | 0 | 0.0 · 1.00 | 17 · 22 | 0 / 6 (0) | 0 | 29 · 10 | 1 / 41 | 73 · 0 |
| bill-hr815.pdf · kept | 9 | 9 | 0 | 0.0 · 1.00 | 15 · 23 | 0 / 2 (0) | 4 | 104 · 18 | 5 / 37 | 73 · 58 |
| synthetic-vector-pages.pdf · before | 5 | 5 | 0 | 0.0 · 1.00 | 12 · 15 | 0 / 1 (0) | 5 | 15 · 9 | 0 / 42 | 63 · 63 |
| synthetic-vector-pages.pdf · none | 2 | 2 | 0 | 0.0 · 1.00 | 7 · 16 | 0 / 6 (0) | 0 | 42 · 12 | 0 / 42 | 63 · 0 |
| synthetic-vector-pages.pdf · kept | 2 | 2 | 0 | 0.0 · 1.00 | 11 · 16 | 0 / 1 (0) | 5 | 10 · 12 | 0 / 41 | 63 · 63 |

