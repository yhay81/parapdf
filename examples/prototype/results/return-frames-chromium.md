# ParaPDF runtime prototype: coming back to pages, Chromium 156.0.8078.4

- Run at: 2026-10-24T02:17:23.403Z
- Machine: darwin 27.0.0 arm64, Apple M2 Pro (12 logical cores); Chromium 156.0.8078.4 (Playwright build, headless); power: AC
- One-minute load average: 31.5 at the start, 8.1 at the end, on 12 cores. The run waited 7 times (44 min in all) for other Playwright browsers or a load average above 10 and repeated 1 job that another browser overlapped.
- Method: pdf.js drawing on the main thread, GPU-backed canvases, 820×1000 at devicePixelRatio 2 and fit-width, 3 runs; medians. Variants: direct draws into the displayed canvases as the package does; frames draws off screen and shows each finished drawing as an ImageBitmap through a `bitmaprenderer` canvas (`frames`); frames-cache also keeps copies of the drawings of pages that unmount, 128 MiB at most (`frameCachePixels`), and shows them when the pages mount again.
- From the start of the way back, a probe records after every frame's animation frame callbacks and layout. No blank: from the first frame after which no page in view lacked pixels (`blankFraction()` 0). Sharp: from the first frame after which the visible pages' `sharpness()` stayed at 0.99 or more. Blank frames count frames with any blank area until sharp; mean blank and mean sharpness are over the frames while scrolling or flipping. Renders and cached layers count from the start of the way back until sharp. Main thread blocked sums a 4 ms timer's lateness beyond 2 ms or the idle 95th percentile; dropped frames are longer than 1.5 idle frames. Memory: width × height × 4 bytes of every canvas in the viewport, and of the cache, at their peaks.
- Reproduce: `pnpm --filter @parapdf/bench corpus && pnpm --filter @parapdf/prototype build && BROWSER=chromium node examples/prototype/scripts/return-bench.ts`

## jump-back: page 1 → page 13 → page 1, settling at page 13

| File · variant | No blank (ms) | Sharp (ms) | Blank frames | Renders base / detail (cancelled) | Cached | Main thread blocked (ms) · longest lag | Dropped / frames | Canvas · cache MiB |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| bill-hr815.pdf · direct | 22 | 22 | 1 | 0 / 3 (0) | 0 | 9 · 6 | 0 / 20 | 44 · 0 |
| bill-hr815.pdf · frames | 23 | 23 | 1 | 0 / 3 (0) | 0 | 7 · 6 | 0 / 21 | 44 · 0 |
| bill-hr815.pdf · frames-cache | 4 | 4 | 0 | 0 / 0 (0) | 3 | 1 · 3 | 0 / 20 | 44 · 73 |
| synthetic-vector-pages.pdf · direct | 35 | 167 | 2 | 2 / 3 (1) | 0 | 1 · 3 | 0 / 29 | 39 · 0 |
| synthetic-vector-pages.pdf · frames | 34 | 167 | 2 | 2 / 3 (1) | 0 | 0 · 2 | 0 / 30 | 39 · 0 |
| synthetic-vector-pages.pdf · frames-cache | 2 | 2 | 0 | 0 / 0 (0) | 3 | 0 · 2 | 0 / 20 | 38 · 63 |

## scroll-back: 10 pages down and back up at 3600 CSS px per second, settling at the bottom

| File · variant | No blank (ms) | Sharp (ms) | Blank frames | Mean blank % · sharpness moving | Renders base / detail (cancelled) | Cached | Main thread blocked (ms) · longest lag | Dropped / frames | Canvas · cache MiB |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| bill-hr815.pdf · direct | 0 | 3672 | 0 | 0.0 · 0.51 | 7 / 4 (0) | 0 | 21 · 8 | 0 / 239 | 92 · 0 |
| bill-hr815.pdf · frames | 0 | 3675 | 0 | 0.0 · 0.51 | 7 / 4 (0) | 0 | 32 · 12 | 0 / 239 | 92 · 0 |
| bill-hr815.pdf · frames-cache | 0 | 2632 | 0 | 0.0 · 0.70 | 0 / 1 (0) | 8 | 13 · 9 | 0 / 222 | 92 · 116 |
| synthetic-vector-pages.pdf · direct | 0 | 3132 | 0 | 0.0 · 0.51 | 7 / 4 (0) | 0 | 3 · 3 | 0 / 207 | 79 · 0 |
| synthetic-vector-pages.pdf · frames | 0 | 3135 | 0 | 0.0 · 0.51 | 7 / 4 (0) | 0 | 7 · 4 | 0 / 207 | 79 · 0 |
| synthetic-vector-pages.pdf · frames-cache | 0 | 2015 | 0 | 0.0 · 0.78 | 0 / 1 (0) | 8 | 1 · 3 | 0 / 195 | 80 · 100 |

## flip-back: "page" mode, 8 flips forward settling after each, then 8 back 50 ms apart

| File · variant | No blank (ms) | Sharp (ms) | Blank frames | Mean blank % · sharpness moving | Each flip sharp, median · max (ms) | Renders base / detail (cancelled) | Cached | Main thread blocked (ms) · longest lag | Dropped / frames | Canvas · cache MiB |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| bill-hr815.pdf · direct | 5 | 5 | 0 | 0.0 · 1.00 | 11 · 18 | 0 / 6 (0) | 0 | 11 · 5 | 0 / 42 | 73 · 0 |
| bill-hr815.pdf · frames | 7 | 7 | 0 | 0.0 · 1.00 | 14 · 19 | 0 / 6 (0) | 0 | 20 · 7 | 0 / 42 | 73 · 0 |
| bill-hr815.pdf · frames-cache | 8 | 8 | 0 | 0.0 · 1.00 | 13 · 20 | 0 / 0 (0) | 6 | 23 · 7 | 0 / 42 | 73 · 116 |
| synthetic-vector-pages.pdf · direct | 1 | 1 | 0 | 0.0 · 1.00 | 10 · 16 | 0 / 6 (0) | 0 | 1 · 2 | 0 / 42 | 63 · 0 |
| synthetic-vector-pages.pdf · frames | 1 | 1 | 0 | 0.0 · 1.00 | 5 · 15 | 0 / 6 (0) | 0 | 0 · 2 | 0 / 42 | 63 · 0 |
| synthetic-vector-pages.pdf · frames-cache | 1 | 1 | 0 | 0.0 · 1.00 | 9 · 16 | 0 / 0 (0) | 6 | 0 · 2 | 0 / 41 | 63 · 100 |

