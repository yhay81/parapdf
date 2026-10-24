# ParaPDF runtime prototype: coming back to pages, WebKit 27.2

- Run at: 2026-10-24T02:40:10.154Z
- Machine: darwin 27.0.0 arm64, Apple M2 Pro (12 logical cores); WebKit 27.2 (Playwright build, headless); power: AC
- One-minute load average: 8.1 at the start, 4.8 at the end, on 12 cores. The run waited 3 times (17 min in all) for other Playwright browsers or a load average above 10 and repeated 2 jobs that another browser overlapped.
- Method: pdf.js drawing on the main thread, GPU-backed canvases, 820×1000 at devicePixelRatio 2 and fit-width, 3 runs; medians. Variants: direct draws into the displayed canvases as the package does; frames draws off screen and shows each finished drawing as an ImageBitmap through a `bitmaprenderer` canvas (`frames`); frames-cache also keeps copies of the drawings of pages that unmount, 128 MiB at most (`frameCachePixels`), and shows them when the pages mount again.
- From the start of the way back, a probe records after every frame's animation frame callbacks and layout. No blank: from the first frame after which no page in view lacked pixels (`blankFraction()` 0). Sharp: from the first frame after which the visible pages' `sharpness()` stayed at 0.99 or more. Blank frames count frames with any blank area until sharp; mean blank and mean sharpness are over the frames while scrolling or flipping. Renders and cached layers count from the start of the way back until sharp. Main thread blocked sums a 4 ms timer's lateness beyond 2 ms or the idle 95th percentile; dropped frames are longer than 1.5 idle frames. Memory: width × height × 4 bytes of every canvas in the viewport, and of the cache, at their peaks.
- Reproduce: `pnpm --filter @parapdf/bench corpus && pnpm --filter @parapdf/prototype build && BROWSER=webkit node examples/prototype/scripts/return-bench.ts`

## jump-back: page 1 → page 13 → page 1, settling at page 13

| File · variant | No blank (ms) | Sharp (ms) | Blank frames | Renders base / detail (cancelled) | Cached | Main thread blocked (ms) · longest lag | Dropped / frames | Canvas · cache MiB |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| bill-hr815.pdf · direct | 35 | 35 | 1 | 0 / 3 (0) | 0 | 1 · 8 | 2 / 24 | 44 · 0 |
| bill-hr815.pdf · frames | 35 | 35 | 1 | 0 / 3 (0) | 0 | 0 · 7 | 2 / 25 | 44 · 0 |
| bill-hr815.pdf · frames-cache | 7 | 7 | 0 | 0 / 0 (0) | 3 | 11 · 17 | 1 / 23 | 44 · 73 |
| synthetic-vector-pages.pdf · direct | 38 | 159 | 2 | 2 / 3 (1) | 0 | 0 · 6 | 0 / 34 | 39 · 0 |
| synthetic-vector-pages.pdf · frames | 37 | 161 | 2 | 2 / 3 (1) | 0 | 2 · 6 | 1 / 34 | 39 · 0 |
| synthetic-vector-pages.pdf · frames-cache | 2 | 2 | 0 | 0 / 0 (0) | 3 | 9 · 13 | 1 / 23 | 38 · 63 |

## scroll-back: 10 pages down and back up at 3600 CSS px per second, settling at the bottom

| File · variant | No blank (ms) | Sharp (ms) | Blank frames | Mean blank % · sharpness moving | Renders base / detail (cancelled) | Cached | Main thread blocked (ms) · longest lag | Dropped / frames | Canvas · cache MiB |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| bill-hr815.pdf · direct | 0 | 3563 | 0 | 0.0 · 0.51 | 7 / 4 (0) | 0 | 11 · 11 | 2 / 279 | 92 · 0 |
| bill-hr815.pdf · frames | 0 | 3564 | 0 | 0.0 · 0.51 | 7 / 4 (0) | 0 | 4 · 11 | 2 / 279 | 92 · 0 |
| bill-hr815.pdf · frames-cache | 0 | 2630 | 0 | 0.0 · 0.70 | 0 / 1 (0) | 8 | 16 · 11 | 0 / 266 | 92 · 116 |
| synthetic-vector-pages.pdf · direct | 0 | 3190 | 0 | 0.0 · 0.51 | 7 / 4 (0) | 0 | 11 · 8 | 0 / 252 | 79 · 0 |
| synthetic-vector-pages.pdf · frames | 0 | 3186 | 0 | 0.0 · 0.51 | 7 / 4 (0) | 0 | 2 · 7 | 0 / 252 | 79 · 0 |
| synthetic-vector-pages.pdf · frames-cache | 0 | 2017 | 0 | 0.0 · 0.78 | 0 / 1 (0) | 8 | 7 · 10 | 0 / 233 | 80 · 100 |

## flip-back: "page" mode, 8 flips forward settling after each, then 8 back 50 ms apart

| File · variant | No blank (ms) | Sharp (ms) | Blank frames | Mean blank % · sharpness moving | Each flip sharp, median · max (ms) | Renders base / detail (cancelled) | Cached | Main thread blocked (ms) · longest lag | Dropped / frames | Canvas · cache MiB |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| bill-hr815.pdf · direct | 7 | 7 | 0 | 0.0 · 1.00 | 10 · 26 | 0 / 6 (0) | 0 | 12 · 11 | 2 / 44 | 73 · 0 |
| bill-hr815.pdf · frames | 8 | 8 | 0 | 0.0 · 1.00 | 11 · 25 | 0 / 6 (0) | 0 | 12 · 11 | 2 / 44 | 73 · 0 |
| bill-hr815.pdf · frames-cache | 7 | 7 | 0 | 0.0 · 1.00 | 9 · 15 | 0 / 0 (0) | 6 | 8 · 12 | 2 / 47 | 73 · 116 |
| synthetic-vector-pages.pdf · direct | 2 | 2 | 0 | 0.0 · 1.00 | 6 · 13 | 0 / 6 (0) | 0 | 0 · 6 | 0 / 48 | 63 · 0 |
| synthetic-vector-pages.pdf · frames | 2 | 2 | 0 | 0.0 · 1.00 | 6 · 12 | 0 / 6 (0) | 0 | 1 · 6 | 0 / 48 | 63 · 0 |
| synthetic-vector-pages.pdf · frames-cache | 3 | 3 | 0 | 0.0 · 1.00 | 5 · 10 | 0 / 0 (0) | 6 | 0 · 6 | 1 / 47 | 63 · 100 |

