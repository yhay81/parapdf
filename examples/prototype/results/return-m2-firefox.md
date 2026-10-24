# ParaPDF runtime prototype: coming back to pages, Firefox 157.0

- Run at: 2026-10-24T09:16:06.680Z
- Machine: darwin 27.0.0 arm64, Apple M2 Pro (12 logical cores); Firefox 157.0 (Playwright build, headless); power: AC
- One-minute load average: 3.4 at the start, 3.9 at the end, on 12 cores. The run waited once (1 min in all) for other Playwright browsers or a load average above 5 and repeated 0 jobs that another browser overlapped.
- Method: pdf.js drawing on the main thread, GPU-backed canvases, 820×1000 at devicePixelRatio 2 and fit-width, 3 runs; medians. Variants: none keeps no canvases of pages that unmount (`maxKeptPixels: 0`); kept keeps them, six viewports' worth at most, and draws them back when the pages mount again. before is main before M2 (a947f02), measured in turn with them.
- From the start of the way back, a probe records after every frame's animation frame callbacks and layout. No blank: from the first frame after which no page in view lacked pixels (`blankFraction()` 0). Sharp: from the first frame after which the visible pages' `sharpness()` stayed at 0.99 or more. Blank frames count frames with any blank area until sharp; mean blank and mean sharpness are over the frames while scrolling or flipping. Renders and layers drawn back count from the start of the way back until sharp. Main thread blocked sums a 4 ms timer's lateness beyond 2 ms or the idle 95th percentile; dropped frames are longer than 1.5 idle frames. Memory: width × height × 4 bytes of every canvas in the viewport and of the kept ones, at their peaks.
- Reproduce: `pnpm --filter @parapdf/bench corpus && pnpm --filter @parapdf/prototype build && BROWSER=firefox node examples/prototype/scripts/return-bench.ts`

## jump-back: page 1 → page 13 → page 1, settling at page 13

| File · variant | No blank (ms) | Sharp (ms) | Blank frames | Renders base / detail (cancelled) | Drawn back | Main thread blocked (ms) · longest lag | Dropped / frames | Canvas · kept MiB |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| bill-hr815.pdf · before | 22 | 22 | 0 | 0 / 0 (0) | 3 | 22 · 22 | 0 / 21 | 44 · 58 |
| bill-hr815.pdf · kept | 23 | 23 | 0 | 0 / 0 (0) | 3 | 28 · 23 | 0 / 20 | 44 · 58 |
| synthetic-vector-pages.pdf · before | 28 | 28 | 0 | 0 / 0 (0) | 3 | 28 · 29 | 0 / 20 | 38 · 63 |
| synthetic-vector-pages.pdf · kept | 18 | 18 | 0 | 0 / 0 (0) | 3 | 14 · 17 | 0 / 20 | 38 · 63 |

## scroll-back: 10 pages down and back up at 3600 CSS px per second, settling at the bottom

| File · variant | No blank (ms) | Sharp (ms) | Blank frames | Mean blank % · sharpness moving | Renders base / detail (cancelled) | Drawn back | Main thread blocked (ms) · longest lag | Dropped / frames | Canvas · kept MiB |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| bill-hr815.pdf · before | 1 | 3663 | 0 | 0.0 · 0.51 | 3 / 4 (0) | 5 | 32 · 16 | 1 / 238 | 92 · 62 |
| bill-hr815.pdf · kept | 1 | 3618 | 0 | 0.0 · 0.51 | 3 / 4 (0) | 5 | 64 · 18 | 0 / 237 | 92 · 62 |
| synthetic-vector-pages.pdf · before | 1 | 3109 | 0 | 0.0 · 0.59 | 3 / 4 (0) | 5 | 65 · 19 | 0 / 206 | 80 · 65 |
| synthetic-vector-pages.pdf · kept | 1 | 3105 | 0 | 0.0 · 0.59 | 3 / 4 (0) | 5 | 75 · 21 | 0 / 206 | 80 · 65 |

## flip-back: "page" mode, 8 flips forward settling after each, then 8 back 50 ms apart

| File · variant | No blank (ms) | Sharp (ms) | Blank frames | Mean blank % · sharpness moving | Each flip sharp, median · max (ms) | Renders base / detail (cancelled) | Drawn back | Main thread blocked (ms) · longest lag | Dropped / frames | Canvas · kept MiB |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| bill-hr815.pdf · before | 12 | 12 | 0 | 0.0 · 1.00 | 12 · 25 | 0 / 2 (0) | 4 | 38 · 15 | 0 / 42 | 73 · 58 |
| bill-hr815.pdf · kept | 17 | 17 | 0 | 0.0 · 1.00 | 12 · 24 | 0 / 2 (0) | 4 | 43 · 20 | 0 / 41 | 73 · 58 |
| synthetic-vector-pages.pdf · before | 11 | 11 | 0 | 0.0 · 1.00 | 11 · 17 | 0 / 1 (0) | 5 | 19 · 9 | 0 / 41 | 63 · 63 |
| synthetic-vector-pages.pdf · kept | 11 | 11 | 0 | 0.0 · 1.00 | 13 · 17 | 0 / 1 (0) | 5 | 17 · 12 | 0 / 41 | 63 · 63 |

