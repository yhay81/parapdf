# ParaPDF runtime prototype: coming back to pages, Chromium 159.0.8154.6

- Run at: 2026-11-20T01:25:51.386Z
- Machine: darwin 27.2.0 arm64, Apple M2 Pro (12 logical cores); Chromium 159.0.8154.6 (Playwright build, headless); power: AC
- One-minute load average: 4.3 at the start, 7.7 at the end, on 12 cores. The run waited 0 times (0 min in all) for other Playwright browsers and repeated 0 jobs that another browser overlapped.
- Method: pdf.js drawing on the main thread, GPU-backed canvases, 820×1000 at devicePixelRatio 2 and fit-width, 3 runs; medians. Variants: none keeps no canvases of pages that unmount (`maxKeptPixels: 0`); kept keeps them, six viewports' worth at most, and draws them back when the pages mount again. before is 61725aa, measured in turn with them.
- From the start of the way back, a probe records after every frame's animation frame callbacks and layout. No blank: from the first frame after which no page in view lacked pixels (`blankFraction()` 0). Sharp: from the first frame after which the visible pages' `sharpness()` stayed at 0.99 or more. Blank frames count frames with any blank area until sharp; mean blank and mean sharpness are over the frames while scrolling or flipping. Renders and layers drawn back count from the start of the way back until sharp. Main thread blocked sums a 4 ms timer's lateness beyond 2 ms or the idle 95th percentile; dropped frames are longer than 1.5 idle frames. Memory: width × height × 4 bytes of every canvas in the viewport and of the kept ones, at their peaks.
- Reproduce: `pnpm --filter @parapdf/bench corpus && pnpm --filter @parapdf/prototype build && BROWSER=chromium node examples/prototype/scripts/return-bench.ts`

## jump-back: page 1 → page 13 → page 1, settling at page 13

| File · variant | No blank (ms) | Sharp (ms) | Blank frames | Renders base / detail (cancelled) | Drawn back | Main thread blocked (ms) · longest lag | Dropped / frames | Canvas · kept MiB |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| bill-hr815.pdf · before | 8 | 8 | 0 | 0 / 0 (0) | 3 | 9 · 7 | 0 / 20 | 44 · 73 |
| bill-hr815.pdf · kept | 8 | 8 | 0 | 0 / 0 (0) | 3 | 10 · 6 | 0 / 20 | 44 · 73 |

## scroll-back: 10 pages down and back up at 3600 CSS px per second, settling at the bottom

| File · variant | No blank (ms) | Sharp (ms) | Blank frames | Mean blank % · sharpness moving | Renders base / detail (cancelled) | Drawn back | Main thread blocked (ms) · longest lag | Dropped / frames | Canvas · kept MiB |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| bill-hr815.pdf · before | 0 | 2632 | 0 | 0.0 · 0.70 | 0 / 1 (0) | 8 | 24 · 14 | 0 / 222 | 92 · 116 |
| bill-hr815.pdf · kept | 0 | 2632 | 0 | 0.0 · 0.70 | 0 / 1 (0) | 8 | 7 · 8 | 0 / 222 | 92 · 116 |

## long-scroll-back: 20 pages down and back up at 3600 CSS px per second, settling at the bottom

| File · variant | No blank (ms) | Sharp (ms) | Blank frames | Mean blank % · sharpness moving | Renders base / detail (cancelled) | Drawn back | Main thread blocked (ms) · longest lag | Dropped / frames | Canvas · kept MiB |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| bill-hr815.pdf · before | 0 | 5982 | 0 | 0.0 · 0.48 | 0 / 1 (0) | 18 | 2 · 4 | 0 / 423 | 92 · 139 |
| bill-hr815.pdf · kept | 0 | 5982 | 0 | 0.0 · 0.48 | 0 / 1 (0) | 18 | 5 · 4 | 0 / 423 | 92 · 139 |

## flip-back: "page" mode, 8 flips forward settling after each, then 8 back 50 ms apart

| File · variant | No blank (ms) | Sharp (ms) | Blank frames | Mean blank % · sharpness moving | Each flip sharp, median · max (ms) | Renders base / detail (cancelled) | Drawn back | Main thread blocked (ms) · longest lag | Dropped / frames | Canvas · kept MiB |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| bill-hr815.pdf · before | 5 | 5 | 0 | 0.0 · 1.00 | 12 · 19 | 0 / 0 (0) | 6 | 10 · 5 | 0 / 42 | 73 · 116 |
| bill-hr815.pdf · kept | 5 | 5 | 0 | 0.0 · 1.00 | 11 · 19 | 0 / 0 (0) | 6 | 12 · 6 | 0 / 42 | 73 · 116 |
