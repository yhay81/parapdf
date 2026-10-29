# ParaPDF runtime prototype: zoom commits, WebKit 27.2, after

- Run at: 2026-10-29T11:52:46.232Z
- Machine: darwin 27.0.0 arm64, Apple M2 Pro (12 logical cores); WebKit 27.2 (Playwright build, headless); power: AC
- One-minute load average: 44.5 at the start, 75.3 at the end, on 12 cores. The run waited 0 times (0 min in all) for other Playwright browsers and repeated 0 jobs that another browser overlapped.
- Method: bill-hr815.pdf in pdf.js drawing on the main thread, 820×1000 at devicePixelRatio 2, 3 runs of each scenario. A probe composites each visible page's canvases as the page shows them, hidden ones left out, after every frame's animation frame callbacks, at a quarter of its CSS size. Blank: none of the pixels the page shows in its visible part is darker than 250 where its settled drawing has ink. Down to its base: the page showed a detail canvas before the commit and shows none. Frames are summed over the runs; the longest is the most any page stayed so.
- A second pass without the probe, which reads canvases back from the GPU and delays frames: time to sharp is from the commit until the visible pages' sharpness reached 0.99 for good; renders count those completed from the commit until the visible pages had stayed sharp for half a second; canvas memory is width × height × 4 bytes of every canvas in the viewport and of those kept for pages that unmounted, before the gesture and at its peak after the commit. Medians.
- Reproduce: `pnpm --filter @parapdf/prototype build && BROWSER=webkit node examples/prototype/scripts/commit-bench.ts`, with `DIST` pointing at the demo built from after in a directory of its own

| Scenario | Scale | Frames with a blank page | Longest blank (ms) | Frames with a page down to its base | Longest (ms) | Time to sharp (ms) | Base renders | Detail renders | Cancelled | Canvas MiB before (peak after) |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pinch-out · before | 1.11 → 1.84 | 0 | 0 | 0 | 0 | 20 | 0 | 5 | 0 | 73 (216) |
| pinch-out · as built | 1.11 → 1.84 | 0 | 0 | 0 | 0 | 17 | 0 | 5 | 0 | 73 (216) |
| scale-down · before | 1.50 → 0.25 | 0 | 0 | 0 | 0 | 10 | 2 | 6 | 0 | 135 (85) |
| scale-down · as built | 1.50 → 0.25 | 0 | 0 | 0 | 0 | 12 | 2 | 6 | 0 | 135 (85) |
| zoom-out-far · before | 5.00 → 1.11 | 0 | 0 | 0 | 0 | 9 | 5 | 5 | 0 | 104 (105) |
| zoom-out-far · as built | 5.00 → 1.11 | 0 | 0 | 0 | 0 | 7 | 5 | 5 | 0 | 104 (105) |
| zoom-in-whole · before | 0.50 → 1.50 | 0 | 0 | 0 | 0 | 10 | 5 | 6 | 0 | 48 (198) |
| zoom-in-whole · as built | 0.50 → 1.50 | 0 | 0 | 0 | 0 | 12 | 0 | 6 | 0 | 48 (196) |

Scenarios:

- pinch-out: a touch pinch out, 100 to 200 CSS pixels between the fingers, at fit-width.
- scale-down: setScale() from 1.5 to 0.25.
- zoom-out-far: setScale() from 5 back to "fit-width".
- zoom-in-whole: setScale() from 0.5 to 1.5, where detail still covers each page, after a jump drew bases.

