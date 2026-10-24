# ParaPDF runtime prototype: coming back to pages, Firefox 157.0

- Run at: 2026-10-24T02:45:12.683Z
- Machine: darwin 27.0.0 arm64, Apple M2 Pro (12 logical cores); Firefox 157.0 (Playwright build, headless); power: AC
- One-minute load average: 4.8 at the start, 4.8 at the end, on 12 cores. The run waited 0 times (0 min in all) for other Playwright browsers or a load average above 10 and repeated 0 jobs that another browser overlapped.
- Method: pdf.js drawing on the main thread, GPU-backed canvases, 820×1000 at devicePixelRatio 2 and fit-width, 3 runs; medians. Variants: direct draws into the displayed canvases as the package does; frames draws off screen and shows each finished drawing as an ImageBitmap through a `bitmaprenderer` canvas (`frames`); frames-cache also keeps copies of the drawings of pages that unmount, 128 MiB at most (`frameCachePixels`), and shows them when the pages mount again.
- From the start of the way back, a probe records after every frame's animation frame callbacks and layout. No blank: from the first frame after which no page in view lacked pixels (`blankFraction()` 0). Sharp: from the first frame after which the visible pages' `sharpness()` stayed at 0.99 or more. Blank frames count frames with any blank area until sharp; mean blank and mean sharpness are over the frames while scrolling or flipping. Renders and cached layers count from the start of the way back until sharp. Main thread blocked sums a 4 ms timer's lateness beyond 2 ms or the idle 95th percentile; dropped frames are longer than 1.5 idle frames. Memory: width × height × 4 bytes of every canvas in the viewport, and of the cache, at their peaks.
- Reproduce: `pnpm --filter @parapdf/bench corpus && pnpm --filter @parapdf/prototype build && BROWSER=firefox node examples/prototype/scripts/return-bench.ts`

## jump-back: page 1 → page 13 → page 1, settling at page 13

| File · variant | No blank (ms) | Sharp (ms) | Blank frames | Renders base / detail (cancelled) | Cached | Main thread blocked (ms) · longest lag | Dropped / frames | Canvas · cache MiB |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| bill-hr815.pdf · direct | 33 | 172 | 2 | 2 / 3 (1) | 0 | 23 · 17 | 0 / 29 | 45 · 0 |
| bill-hr815.pdf · frames | 46 | 171 | 2 | 2 / 3 (1) | 0 | 40 · 22 | 0 / 30 | 45 · 0 |
| bill-hr815.pdf · frames-cache | 12 | 12 | 0 | 0 / 0 (0) | 3 | 13 · 18 | 0 / 20 | 44 · 73 |
| synthetic-vector-pages.pdf · direct | 67 | 167 | 4 | 2 / 3 (1) | 0 | 24 · 15 | 0 / 30 | 39 · 0 |
| synthetic-vector-pages.pdf · frames | 67 | 173 | 4 | 2 / 3 (1) | 0 | 35 · 18 | 0 / 30 | 39 · 0 |
| synthetic-vector-pages.pdf · frames-cache | 11 | 11 | 0 | 0 / 0 (0) | 3 | 11 · 15 | 0 / 20 | 38 · 63 |

## scroll-back: 10 pages down and back up at 3600 CSS px per second, settling at the bottom

| File · variant | No blank (ms) | Sharp (ms) | Blank frames | Mean blank % · sharpness moving | Renders base / detail (cancelled) | Cached | Main thread blocked (ms) · longest lag | Dropped / frames | Canvas · cache MiB |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| bill-hr815.pdf · direct | 0 | 3634 | 0 | 0.0 · 0.51 | 7 / 4 (0) | 0 | 48 · 14 | 0 / 238 | 92 · 0 |
| bill-hr815.pdf · frames | 1 | 3620 | 0 | 0.0 · 0.51 | 7 / 4 (0) | 0 | 37 · 19 | 0 / 237 | 92 · 0 |
| bill-hr815.pdf · frames-cache | 1 | 2623 | 0 | 0.0 · 0.70 | 0 / 1 (0) | 8 | 160 · 15 | 0 / 222 | 92 · 116 |
| synthetic-vector-pages.pdf · direct | 1 | 3127 | 0 | 0.0 · 0.51 | 7 / 4 (0) | 0 | 70 · 19 | 0 / 207 | 79 · 0 |
| synthetic-vector-pages.pdf · frames | 1 | 3130 | 0 | 0.0 · 0.51 | 7 / 4 (0) | 0 | 135 · 25 | 1 / 207 | 79 · 0 |
| synthetic-vector-pages.pdf · frames-cache | 0 | 2006 | 0 | 0.0 · 0.78 | 0 / 1 (0) | 8 | 166 · 16 | 0 / 195 | 80 · 100 |

## flip-back: "page" mode, 8 flips forward settling after each, then 8 back 50 ms apart

| File · variant | No blank (ms) | Sharp (ms) | Blank frames | Mean blank % · sharpness moving | Each flip sharp, median · max (ms) | Renders base / detail (cancelled) | Cached | Main thread blocked (ms) · longest lag | Dropped / frames | Canvas · cache MiB |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| bill-hr815.pdf · direct | 6 | 6 | 0 | 0.0 · 1.00 | 13 · 24 | 0 / 6 (0) | 0 | 47 · 16 | 0 / 42 | 73 · 0 |
| bill-hr815.pdf · frames | 15 | 15 | 0 | 0.0 · 1.00 | 11 · 25 | 0 / 6 (0) | 0 | 35 · 22 | 0 / 40 | 73 · 0 |
| bill-hr815.pdf · frames-cache | 5 | 5 | 0 | 0.0 · 1.00 | 11 · 17 | 0 / 0 (0) | 6 | 11 · 9 | 0 / 42 | 73 · 116 |
| synthetic-vector-pages.pdf · direct | 2 | 2 | 0 | 0.0 · 1.00 | 8 · 19 | 0 / 6 (0) | 0 | 38 · 11 | 0 / 42 | 63 · 0 |
| synthetic-vector-pages.pdf · frames | 4 | 4 | 0 | 0.0 · 1.00 | 8 · 19 | 0 / 6 (0) | 0 | 37 · 14 | 0 / 42 | 63 · 0 |
| synthetic-vector-pages.pdf · frames-cache | 4 | 4 | 0 | 0.0 · 1.00 | 6 · 17 | 0 / 0 (0) | 6 | 22 · 8 | 0 / 42 | 63 · 100 |

