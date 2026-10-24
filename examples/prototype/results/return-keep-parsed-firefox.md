# ParaPDF runtime prototype: coming back to pages, Firefox 157.0

> Measured on an uncommitted build of the work on `claude/frame-bench` that
> also skipped `page.cleanup()` for the last six pages that unmounted
> (decision 0007): its none kept no canvases but kept those pages' parsed
> content, and its kept did both. before is e10dcc4. The Reproduce line
> runs today's build, not that one.

- Run at: 2026-10-24T03:33:00.857Z
- Machine: darwin 27.0.0 arm64, Apple M2 Pro (12 logical cores); Firefox 157.0 (Playwright build, headless); power: AC
- One-minute load average: 3.6 at the start, 5.9 at the end, on 12 cores. The run waited 0 times (0 min in all) for other Playwright browsers or a load average above 10 and repeated 0 jobs that another browser overlapped.
- Method: pdf.js drawing on the main thread, GPU-backed canvases, 820×1000 at devicePixelRatio 2 and fit-width, 3 runs; medians. Variants: none keeps no canvases of pages that unmount (`maxKeptPixels: 0`); kept keeps them, six viewports' worth at most, and draws them back when the pages mount again. before is the build before (e10dcc4), measured in turn with them.
- From the start of the way back, a probe records after every frame's animation frame callbacks and layout. No blank: from the first frame after which no page in view lacked pixels (`blankFraction()` 0). Sharp: from the first frame after which the visible pages' `sharpness()` stayed at 0.99 or more. Blank frames count frames with any blank area until sharp; mean blank and mean sharpness are over the frames while scrolling or flipping. Renders and layers drawn back count from the start of the way back until sharp. Main thread blocked sums a 4 ms timer's lateness beyond 2 ms or the idle 95th percentile; dropped frames are longer than 1.5 idle frames. Memory: width × height × 4 bytes of every canvas in the viewport and of the kept ones, at their peaks.
- Reproduce: `pnpm --filter @parapdf/bench corpus && pnpm --filter @parapdf/prototype build && BROWSER=firefox node examples/prototype/scripts/return-bench.ts`

## jump-back: page 1 → page 13 → page 1, settling at page 13

| File · variant | No blank (ms) | Sharp (ms) | Blank frames | Renders base / detail (cancelled) | Drawn back | Main thread blocked (ms) · longest lag | Dropped / frames | Canvas · kept MiB |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| bill-hr815.pdf · before | 62 | 184 | 3 | 2 / 3 (1) | 0 | 41 · 21 | 0 / 29 | 45 · — |
| bill-hr815.pdf · none | 39 | 173 | 2 | 2 / 3 (1) | 0 | 41 · 19 | 0 / 30 | 45 · 0 |
| bill-hr815.pdf · kept | 28 | 28 | 0 | 0 / 0 (0) | 3 | 33 · 28 | 0 / 20 | 44 · 58 |
| synthetic-vector-pages.pdf · before | 65 | 166 | 4 | 2 / 3 (1) | 0 | 22 · 13 | 0 / 30 | 39 · — |
| synthetic-vector-pages.pdf · none | 81 | 171 | 5 | 2 / 3 (1) | 0 | 27 · 14 | 0 / 30 | 39 · 0 |
| synthetic-vector-pages.pdf · kept | 23 | 23 | 0 | 0 / 0 (0) | 3 | 21 · 24 | 0 / 20 | 38 · 63 |

## scroll-back: 10 pages down and back up at 3600 CSS px per second, settling at the bottom

| File · variant | No blank (ms) | Sharp (ms) | Blank frames | Mean blank % · sharpness moving | Renders base / detail (cancelled) | Drawn back | Main thread blocked (ms) · longest lag | Dropped / frames | Canvas · kept MiB |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| bill-hr815.pdf · before | 0 | 3652 | 0 | 0.0 · 0.51 | 7 / 4 (0) | 0 | 70 · 18 | 0 / 238 | 92 · — |
| bill-hr815.pdf · none | 1 | 3599 | 0 | 0.0 · 0.51 | 7 / 4 (0) | 0 | 63 · 15 | 0 / 236 | 92 · 0 |
| bill-hr815.pdf · kept | 0 | 3607 | 0 | 0.0 · 0.51 | 3 / 4 (0) | 5 | 47 · 15 | 0 / 236 | 92 · 62 |
| synthetic-vector-pages.pdf · before | 1 | 3099 | 0 | 0.0 · 0.51 | 7 / 4 (0) | 0 | 63 · 21 | 0 / 205 | 79 · — |
| synthetic-vector-pages.pdf · none | 0 | 3109 | 0 | 0.0 · 0.51 | 7 / 4 (0) | 0 | 58 · 20 | 0 / 206 | 79 · 0 |
| synthetic-vector-pages.pdf · kept | 1 | 3117 | 0 | 0.0 · 0.59 | 3 / 4 (0) | 5 | 75 · 13 | 0 / 206 | 80 · 65 |

## flip-back: "page" mode, 8 flips forward settling after each, then 8 back 50 ms apart

| File · variant | No blank (ms) | Sharp (ms) | Blank frames | Mean blank % · sharpness moving | Each flip sharp, median · max (ms) | Renders base / detail (cancelled) | Drawn back | Main thread blocked (ms) · longest lag | Dropped / frames | Canvas · kept MiB |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| bill-hr815.pdf · before | 10 | 10 | 0 | 0.0 · 1.00 | 14 · 22 | 0 / 6 (0) | 0 | 39 · 11 | 0 / 42 | 73 · — |
| bill-hr815.pdf · none | 15 | 15 | 0 | 0.0 · 1.00 | 15 · 19 | 0 / 6 (0) | 0 | 64 · 19 | 0 / 42 | 73 · 0 |
| bill-hr815.pdf · kept | 14 | 14 | 0 | 0.0 · 1.00 | 14 · 24 | 0 / 2 (0) | 4 | 45 · 18 | 0 / 42 | 73 · 58 |
| synthetic-vector-pages.pdf · before | 7 | 7 | 0 | 0.0 · 1.00 | 13 · 19 | 0 / 6 (0) | 0 | 41 · 13 | 0 / 42 | 63 · — |
| synthetic-vector-pages.pdf · none | 7 | 7 | 0 | 0.0 · 1.00 | 12 · 24 | 0 / 6 (0) | 0 | 36 · 15 | 0 / 42 | 63 · 0 |
| synthetic-vector-pages.pdf · kept | 10 | 10 | 0 | 0.0 · 1.00 | 12 · 17 | 0 / 1 (0) | 5 | 19 · 10 | 0 / 42 | 63 · 63 |

