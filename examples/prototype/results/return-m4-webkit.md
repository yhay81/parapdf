# ParaPDF runtime prototype: coming back to pages, WebKit 27.2

- Run at: 2026-10-25T15:50:33.877Z
- Machine: darwin 27.0.0 arm64, Apple M2 Pro (12 logical cores); WebKit 27.2 (Playwright build, headless); power: AC
- One-minute load average: 3.9 at the start, 2.8 at the end, on 12 cores. The run waited 0 times (0 min in all) for other Playwright browsers and repeated 0 jobs that another browser overlapped.
- Method: pdf.js drawing on the main thread, GPU-backed canvases, 820×1000 at devicePixelRatio 2 and fit-width, 3 runs; medians. Variants: none keeps no canvases of pages that unmount (`maxKeptPixels: 0`); kept keeps them, six viewports' worth at most, and draws them back when the pages mount again. before is M3 f6f0f60, measured in turn with them.
- From the start of the way back, a probe records after every frame's animation frame callbacks and layout. No blank: from the first frame after which no page in view lacked pixels (`blankFraction()` 0). Sharp: from the first frame after which the visible pages' `sharpness()` stayed at 0.99 or more. Blank frames count frames with any blank area until sharp; mean blank and mean sharpness are over the frames while scrolling or flipping. Renders and layers drawn back count from the start of the way back until sharp. Main thread blocked sums a 4 ms timer's lateness beyond 2 ms or the idle 95th percentile; dropped frames are longer than 1.5 idle frames. Memory: width × height × 4 bytes of every canvas in the viewport and of the kept ones, at their peaks.
- Reproduce: `pnpm --filter @parapdf/bench corpus && pnpm --filter @parapdf/prototype build && BROWSER=webkit node examples/prototype/scripts/return-bench.ts`

## jump-back: page 1 → page 13 → page 1, settling at page 13

| File · variant | No blank (ms) | Sharp (ms) | Blank frames | Renders base / detail (cancelled) | Drawn back | Main thread blocked (ms) · longest lag | Dropped / frames | Canvas · kept MiB |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| bill-hr815.pdf · before | 13 | 13 | 0 | 0 / 0 (0) | 3 | 24 · 23 | 2 / 23 | 44 · 58 |
| bill-hr815.pdf · kept | 13 | 13 | 0 | 0 / 0 (0) | 3 | 20 · 22 | 1 / 23 | 44 · 58 |
| synthetic-vector-pages.pdf · before | 6 | 6 | 0 | 0 / 0 (0) | 3 | 13 · 18 | 1 / 23 | 38 · 63 |
| synthetic-vector-pages.pdf · kept | 9 | 9 | 0 | 0 / 0 (0) | 3 | 18 · 24 | 1 / 23 | 38 · 63 |

## scroll-back: 10 pages down and back up at 3600 CSS px per second, settling at the bottom

| File · variant | No blank (ms) | Sharp (ms) | Blank frames | Mean blank % · sharpness moving | Renders base / detail (cancelled) | Drawn back | Main thread blocked (ms) · longest lag | Dropped / frames | Canvas · kept MiB |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| bill-hr815.pdf · before | 0 | 3567 | 0 | 0.0 · 0.51 | 3 / 4 (0) | 5 | 23 · 13 | 1 / 280 | 92 · 62 |
| bill-hr815.pdf · kept | 0 | 3563 | 0 | 0.0 · 0.51 | 3 / 4 (0) | 5 | 27 · 17 | 1 / 279 | 92 · 62 |
| synthetic-vector-pages.pdf · before | 0 | 3184 | 0 | 0.0 · 0.59 | 3 / 4 (0) | 5 | 7 · 7 | 0 / 252 | 80 · 65 |
| synthetic-vector-pages.pdf · kept | 0 | 3185 | 0 | 0.0 · 0.59 | 3 / 4 (0) | 5 | 2 · 7 | 0 / 252 | 80 · 65 |

## flip-back: "page" mode, 8 flips forward settling after each, then 8 back 50 ms apart

| File · variant | No blank (ms) | Sharp (ms) | Blank frames | Mean blank % · sharpness moving | Each flip sharp, median · max (ms) | Renders base / detail (cancelled) | Drawn back | Main thread blocked (ms) · longest lag | Dropped / frames | Canvas · kept MiB |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| bill-hr815.pdf · before | 12 | 12 | 0 | 0.0 · 1.00 | 10 · 26 | 0 / 2 (0) | 4 | 23 · 14 | 3 / 44 | 73 · 58 |
| bill-hr815.pdf · kept | 12 | 12 | 0 | 0.0 · 1.00 | 12 · 27 | 0 / 2 (0) | 4 | 27 · 11 | 3 / 44 | 73 · 58 |
| synthetic-vector-pages.pdf · before | 4 | 4 | 0 | 0.0 · 1.00 | 5 · 13 | 0 / 1 (0) | 5 | 2 · 6 | 1 / 47 | 63 · 63 |
| synthetic-vector-pages.pdf · kept | 5 | 5 | 0 | 0.0 · 1.00 | 6 · 14 | 0 / 1 (0) | 5 | 2 · 6 | 1 / 47 | 63 · 63 |

