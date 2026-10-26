# ParaPDF runtime prototype: coming back to pages, WebKit 27.2

- Run at: 2026-10-26T09:51:33.676Z
- Machine: darwin 27.0.0 arm64, Apple M2 Pro (12 logical cores); WebKit 27.2 (Playwright build, headless); power: AC
- One-minute load average: 7.8 at the start, 3.8 at the end, on 12 cores. The run waited 0 times (0 min in all) for other Playwright browsers and repeated 0 jobs that another browser overlapped.
- Method: pdf.js drawing on the main thread, GPU-backed canvases, 820×1000 at devicePixelRatio 2 and fit-width, 3 runs; medians. Variants: none keeps no canvases of pages that unmount (`maxKeptPixels: 0`); kept keeps them, six viewports' worth at most, and draws them back when the pages mount again.
- From the start of the way back, a probe records after every frame's animation frame callbacks and layout. No blank: from the first frame after which no page in view lacked pixels (`blankFraction()` 0). Sharp: from the first frame after which the visible pages' `sharpness()` stayed at 0.99 or more. Blank frames count frames with any blank area until sharp; mean blank and mean sharpness are over the frames while scrolling or flipping. Renders and layers drawn back count from the start of the way back until sharp. Main thread blocked sums a 4 ms timer's lateness beyond 2 ms or the idle 95th percentile; dropped frames are longer than 1.5 idle frames. Memory: width × height × 4 bytes of every canvas in the viewport and of the kept ones, at their peaks.
- Reproduce: `pnpm --filter @parapdf/bench corpus && pnpm --filter @parapdf/prototype build && BROWSER=webkit node examples/prototype/scripts/return-bench.ts`

## jump-back: page 1 → page 13 → page 1, settling at page 13

| File · variant | No blank (ms) | Sharp (ms) | Blank frames | Renders base / detail (cancelled) | Drawn back | Main thread blocked (ms) · longest lag | Dropped / frames | Canvas · kept MiB |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| bill-hr815.pdf · none | 48 | 48 | 1 | 0 / 3 (0) | 0 | 10 · 13 | 2 / 25 | 44 · 0 |
| bill-hr815.pdf · kept | 16 | 16 | 0 | 0 / 0 (0) | 3 | 17 · 15 | 1 / 23 | 44 · 58 |
| synthetic-vector-pages.pdf · none | 61 | 170 | 3 | 2 / 3 (1) | 0 | 4 · 9 | 1 / 34 | 39 · 0 |
| synthetic-vector-pages.pdf · kept | 5 | 5 | 0 | 0 / 0 (0) | 3 | 0 · 6 | 1 / 23 | 38 · 63 |

## scroll-back: 10 pages down and back up at 3600 CSS px per second, settling at the bottom

| File · variant | No blank (ms) | Sharp (ms) | Blank frames | Mean blank % · sharpness moving | Renders base / detail (cancelled) | Drawn back | Main thread blocked (ms) · longest lag | Dropped / frames | Canvas · kept MiB |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| bill-hr815.pdf · none | 0 | 3577 | 0 | 0.0 · 0.51 | 7 / 4 (0) | 0 | 22 · 18 | 1 / 281 | 92 · 0 |
| bill-hr815.pdf · kept | 0 | 3565 | 0 | 0.0 · 0.51 | 3 / 4 (0) | 5 | 18 · 15 | 1 / 280 | 92 · 62 |
| synthetic-vector-pages.pdf · none | 0 | 3180 | 0 | 0.0 · 0.51 | 7 / 4 (0) | 0 | 11 · 8 | 0 / 252 | 79 · 0 |
| synthetic-vector-pages.pdf · kept | 0 | 3188 | 0 | 0.0 · 0.59 | 3 / 4 (0) | 5 | 4 · 9 | 0 / 252 | 80 · 65 |

## flip-back: "page" mode, 8 flips forward settling after each, then 8 back 50 ms apart

| File · variant | No blank (ms) | Sharp (ms) | Blank frames | Mean blank % · sharpness moving | Each flip sharp, median · max (ms) | Renders base / detail (cancelled) | Drawn back | Main thread blocked (ms) · longest lag | Dropped / frames | Canvas · kept MiB |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| bill-hr815.pdf · none | 11 | 11 | 0 | 0.0 · 1.00 | 11 · 17 | 0 / 6 (0) | 0 | 23 · 13 | 3 / 45 | 73 · 0 |
| bill-hr815.pdf · kept | 9 | 9 | 0 | 0.0 · 1.00 | 11 · 20 | 0 / 2 (0) | 4 | 16 · 11 | 3 / 44 | 73 · 58 |
| synthetic-vector-pages.pdf · none | 3 | 3 | 0 | 0.0 · 1.00 | 6 · 13 | 0 / 6 (0) | 0 | 1 · 6 | 0 / 48 | 63 · 0 |
| synthetic-vector-pages.pdf · kept | 4 | 4 | 0 | 0.0 · 1.00 | 7 · 14 | 0 / 1 (0) | 5 | 1 · 6 | 0 / 48 | 63 · 63 |

