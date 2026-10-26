# ParaPDF runtime prototype: coming back to pages, Firefox 157.0

- Run at: 2026-10-26T09:59:14.374Z
- Machine: darwin 27.0.0 arm64, Apple M2 Pro (12 logical cores); Firefox 157.0 (Playwright build, headless); power: AC
- One-minute load average: 7.4 at the start, 3.5 at the end, on 12 cores. The run waited 0 times (0 min in all) for other Playwright browsers and repeated 0 jobs that another browser overlapped.
- Method: pdf.js drawing on the main thread, GPU-backed canvases, 820×1000 at devicePixelRatio 2 and fit-width, 3 runs; medians. Variants: none keeps no canvases of pages that unmount (`maxKeptPixels: 0`); kept keeps them, six viewports' worth at most, and draws them back when the pages mount again.
- From the start of the way back, a probe records after every frame's animation frame callbacks and layout. No blank: from the first frame after which no page in view lacked pixels (`blankFraction()` 0). Sharp: from the first frame after which the visible pages' `sharpness()` stayed at 0.99 or more. Blank frames count frames with any blank area until sharp; mean blank and mean sharpness are over the frames while scrolling or flipping. Renders and layers drawn back count from the start of the way back until sharp. Main thread blocked sums a 4 ms timer's lateness beyond 2 ms or the idle 95th percentile; dropped frames are longer than 1.5 idle frames. Memory: width × height × 4 bytes of every canvas in the viewport and of the kept ones, at their peaks.
- Reproduce: `pnpm --filter @parapdf/bench corpus && pnpm --filter @parapdf/prototype build && BROWSER=firefox node examples/prototype/scripts/return-bench.ts`

## jump-back: page 1 → page 13 → page 1, settling at page 13

| File · variant | No blank (ms) | Sharp (ms) | Blank frames | Renders base / detail (cancelled) | Drawn back | Main thread blocked (ms) · longest lag | Dropped / frames | Canvas · kept MiB |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| bill-hr815.pdf · none | 35 | 177 | 2 | 2 / 3 (1) | 0 | 41 · 23 | 0 / 30 | 45 · 0 |
| bill-hr815.pdf · kept | 18 | 18 | 0 | 0 / 0 (0) | 3 | 14 · 18 | 0 / 20 | 44 · 58 |
| synthetic-vector-pages.pdf · none | 83 | 169 | 5 | 2 / 3 (1) | 0 | 33 · 13 | 0 / 30 | 39 · 0 |
| synthetic-vector-pages.pdf · kept | 12 | 12 | 0 | 0 / 0 (0) | 3 | 8 · 11 | 0 / 20 | 38 · 63 |

## scroll-back: 10 pages down and back up at 3600 CSS px per second, settling at the bottom

| File · variant | No blank (ms) | Sharp (ms) | Blank frames | Mean blank % · sharpness moving | Renders base / detail (cancelled) | Drawn back | Main thread blocked (ms) · longest lag | Dropped / frames | Canvas · kept MiB |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| bill-hr815.pdf · none | 0 | 3618 | 0 | 0.0 · 0.51 | 7 / 4 (0) | 0 | 79 · 24 | 0 / 237 | 92 · 0 |
| bill-hr815.pdf · kept | 1 | 3629 | 0 | 0.0 · 0.51 | 3 / 4 (0) | 5 | 74 · 20 | 1 / 237 | 92 · 62 |
| synthetic-vector-pages.pdf · none | 0 | 3143 | 0 | 0.0 · 0.51 | 7 / 4 (0) | 0 | 64 · 26 | 0 / 208 | 79 · 0 |
| synthetic-vector-pages.pdf · kept | 0 | 3105 | 0 | 0.0 · 0.59 | 3 / 4 (0) | 5 | 60 · 19 | 0 / 205 | 80 · 65 |

## flip-back: "page" mode, 8 flips forward settling after each, then 8 back 50 ms apart

| File · variant | No blank (ms) | Sharp (ms) | Blank frames | Mean blank % · sharpness moving | Each flip sharp, median · max (ms) | Renders base / detail (cancelled) | Drawn back | Main thread blocked (ms) · longest lag | Dropped / frames | Canvas · kept MiB |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| bill-hr815.pdf · none | 7 | 7 | 0 | 0.0 · 1.00 | 12 · 23 | 0 / 6 (0) | 0 | 30 · 10 | 0 / 42 | 73 · 0 |
| bill-hr815.pdf · kept | 12 | 12 | 0 | 0.0 · 1.00 | 13 · 22 | 0 / 2 (0) | 4 | 40 · 17 | 0 / 42 | 73 · 58 |
| synthetic-vector-pages.pdf · none | 8 | 8 | 0 | 0.0 · 1.00 | 11 · 17 | 0 / 6 (0) | 0 | 38 · 11 | 0 / 41 | 63 · 0 |
| synthetic-vector-pages.pdf · kept | 5 | 5 | 0 | 0.0 · 1.00 | 8 · 19 | 0 / 1 (0) | 5 | 10 · 7 | 0 / 41 | 63 · 63 |

