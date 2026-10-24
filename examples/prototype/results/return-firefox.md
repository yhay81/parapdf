# ParaPDF runtime prototype: coming back to pages, Firefox 157.0

> Builds: before is e10dcc4, the build before M1; none and kept are M1's
> build, with `maxKeptPixels` 0 and its default.

- Run at: 2026-10-24T07:04:48.357Z
- Machine: darwin 27.0.0 arm64, Apple M2 Pro (12 logical cores); Firefox 157.0 (Playwright build, headless); power: AC
- One-minute load average: 5.2 at the start, 7.2 at the end, on 12 cores. The run waited 0 times (0 min in all) for other Playwright browsers or a load average above 10 and repeated 0 jobs that another browser overlapped.
- Method: pdf.js drawing on the main thread, GPU-backed canvases, 820×1000 at devicePixelRatio 2 and fit-width, 3 runs; medians. Variants: none keeps no canvases of pages that unmount (`maxKeptPixels: 0`); kept keeps them, six viewports' worth at most, and draws them back when the pages mount again. before is before, measured in turn with them.
- From the start of the way back, a probe records after every frame's animation frame callbacks and layout. No blank: from the first frame after which no page in view lacked pixels (`blankFraction()` 0). Sharp: from the first frame after which the visible pages' `sharpness()` stayed at 0.99 or more. Blank frames count frames with any blank area until sharp; mean blank and mean sharpness are over the frames while scrolling or flipping. Renders and layers drawn back count from the start of the way back until sharp. Main thread blocked sums a 4 ms timer's lateness beyond 2 ms or the idle 95th percentile; dropped frames are longer than 1.5 idle frames. Memory: width × height × 4 bytes of every canvas in the viewport and of the kept ones, at their peaks.
- Reproduce: `pnpm --filter @parapdf/bench corpus && pnpm --filter @parapdf/prototype build && BROWSER=firefox node examples/prototype/scripts/return-bench.ts`

## jump-back: page 1 → page 13 → page 1, settling at page 13

| File · variant | No blank (ms) | Sharp (ms) | Blank frames | Renders base / detail (cancelled) | Drawn back | Main thread blocked (ms) · longest lag | Dropped / frames | Canvas · kept MiB |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| bill-hr815.pdf · before | 48 | 176 | 3 | 2 / 3 (1) | 0 | 50 · 26 | 0 / 30 | 45 · — |
| bill-hr815.pdf · none | 35 | 175 | 2 | 2 / 3 (1) | 0 | 30 · 16 | 0 / 30 | 45 · 0 |
| bill-hr815.pdf · kept | 38 | 38 | 0 | 0 / 0 (0) | 3 | 37 · 39 | 1 / 20 | 44 · 58 |
| synthetic-vector-pages.pdf · before | 64 | 168 | 4 | 2 / 3 (1) | 0 | 28 · 17 | 0 / 30 | 39 · — |
| synthetic-vector-pages.pdf · none | 78 | 167 | 5 | 2 / 3 (1) | 0 | 19 · 13 | 0 / 30 | 39 · 0 |
| synthetic-vector-pages.pdf · kept | 19 | 19 | 0 | 0 / 0 (0) | 3 | 17 · 19 | 0 / 20 | 38 · 63 |

## scroll-back: 10 pages down and back up at 3600 CSS px per second, settling at the bottom

| File · variant | No blank (ms) | Sharp (ms) | Blank frames | Mean blank % · sharpness moving | Renders base / detail (cancelled) | Drawn back | Main thread blocked (ms) · longest lag | Dropped / frames | Canvas · kept MiB |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| bill-hr815.pdf · before | 1 | 3636 | 0 | 0.0 · 0.51 | 7 / 4 (0) | 0 | 59 · 22 | 0 / 238 | 92 · — |
| bill-hr815.pdf · none | 1 | 3655 | 0 | 0.0 · 0.51 | 7 / 4 (0) | 0 | 40 · 16 | 0 / 239 | 92 · 0 |
| bill-hr815.pdf · kept | 0 | 3654 | 0 | 0.0 · 0.51 | 3 / 4 (0) | 5 | 52 · 16 | 0 / 239 | 92 · 62 |
| synthetic-vector-pages.pdf · before | 1 | 3134 | 0 | 0.0 · 0.51 | 7 / 4 (0) | 0 | 76 · 22 | 0 / 207 | 79 · — |
| synthetic-vector-pages.pdf · none | 0 | 3142 | 0 | 0.0 · 0.51 | 7 / 4 (0) | 0 | 83 · 25 | 0 / 208 | 79 · 0 |
| synthetic-vector-pages.pdf · kept | 1 | 3135 | 0 | 0.0 · 0.59 | 3 / 4 (0) | 5 | 62 · 15 | 0 / 208 | 80 · 65 |

## flip-back: "page" mode, 8 flips forward settling after each, then 8 back 50 ms apart

| File · variant | No blank (ms) | Sharp (ms) | Blank frames | Mean blank % · sharpness moving | Each flip sharp, median · max (ms) | Renders base / detail (cancelled) | Drawn back | Main thread blocked (ms) · longest lag | Dropped / frames | Canvas · kept MiB |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| bill-hr815.pdf · before | 12 | 12 | 0 | 0.0 · 1.00 | 14 · 21 | 0 / 6 (0) | 0 | 28 · 15 | 0 / 42 | 73 · — |
| bill-hr815.pdf · none | 11 | 11 | 0 | 0.0 · 1.00 | 14 · 26 | 0 / 6 (0) | 0 | 37 · 14 | 0 / 42 | 73 · 0 |
| bill-hr815.pdf · kept | 16 | 16 | 0 | 0.0 · 1.00 | 14 · 24 | 0 / 2 (0) | 4 | 29 · 19 | 0 / 42 | 73 · 58 |
| synthetic-vector-pages.pdf · before | 7 | 7 | 0 | 0.0 · 1.00 | 10 · 17 | 0 / 6 (0) | 0 | 33 · 9 | 0 / 41 | 63 · — |
| synthetic-vector-pages.pdf · none | 3 | 3 | 0 | 0.0 · 1.00 | 7 · 16 | 0 / 6 (0) | 0 | 43 · 13 | 0 / 42 | 63 · 0 |
| synthetic-vector-pages.pdf · kept | 9 | 9 | 0 | 0.0 · 1.00 | 12 · 17 | 0 / 1 (0) | 5 | 16 · 10 | 0 / 41 | 63 · 63 |

