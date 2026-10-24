# ParaPDF runtime prototype: zoom commits, WebKit 27.2, this build

- Run at: 2026-10-24T06:59:46.033Z
- Machine: darwin 27.0.0 arm64, Apple M2 Pro (12 logical cores); WebKit 27.2 (Playwright build, headless); power: AC
- One-minute load average: 4.0 at the start, 5.2 at the end, on 12 cores. The run waited 0 times (0 min in all) for other Playwright browsers or a load average above 10 and repeated 0 jobs that another browser overlapped.
- Method: bill-hr815.pdf in pdf.js drawing on the main thread, 820×1000 at devicePixelRatio 2, 3 runs of each scenario. A probe composites each visible page's canvases as the page shows them, hidden ones left out, after every frame's animation frame callbacks, at a quarter of its CSS size. Blank: none of the pixels the page shows in its visible part is darker than 250 where its settled drawing has ink. Down to its base: the page showed a detail canvas before the commit and shows none. Frames are summed over the runs; the longest is the most any page stayed so.
- A second pass without the probe, which reads canvases back from the GPU and delays frames: time to sharp is from the commit until the visible pages' sharpness reached 0.99 for good; renders count those completed from the commit until the visible pages had stayed sharp for half a second; canvas memory is width × height × 4 bytes of every canvas in the viewport and of those kept for pages that unmounted, before the gesture and at its peak after the commit. Medians.
- Reproduce: `pnpm --filter @parapdf/prototype build && BROWSER=webkit node examples/prototype/scripts/commit-bench.ts`, with `DIST` pointing at the demo built from this build in a directory of its own

| Scenario | Scale | Frames with a blank page | Longest blank (ms) | Frames with a page down to its base | Longest (ms) | Time to sharp (ms) | Base renders | Detail renders | Cancelled | Canvas MiB before (peak after) |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pinch-out · before | 1.11 → 1.84 | 0 | 0 | 0 | 0 | 22 | 0 | 5 | 0 | 73 (217) |
| pinch-out · as built | 1.11 → 1.84 | 0 | 0 | 0 | 0 | 20 | 0 | 5 | 0 | 73 (217) |
| scale-up · before | 1.11 → 1.93 | 0 | 0 | 0 | 0 | 12 | 0 | 5 | 0 | 73 (237) |
| scale-up · as built | 1.11 → 1.93 | 0 | 0 | 0 | 0 | 13 | 0 | 5 | 0 | 73 (237) |
| zoom-step · before | 1.11 → 1.22 | 0 | 0 | 0 | 0 | 6 | 0 | 5 | 0 | 73 (115) |
| zoom-step · as built | 1.11 → 1.22 | 0 | 0 | 0 | 0 | 12 | 0 | 5 | 0 | 73 (115) |
| zoom-in-far · before | 1.11 → 5.00 | 0 | 0 | 0 | 0 | 42 | 5 | 1 | 0 | 73 (104) |
| zoom-in-far · as built | 1.11 → 5.00 | 0 | 0 | 0 | 0 | 33 | 5 | 1 | 0 | 73 (104) |
| zoom-out-far · before | 5.00 → 1.11 | 0 | 0 | 0 | 0 | 14 | 5 | 5 | 0 | 104 (105) |
| zoom-out-far · as built | 5.00 → 1.11 | 0 | 0 | 0 | 0 | 11 | 5 | 5 | 0 | 104 (105) |

Scenarios:

- pinch-out: a touch pinch out, 100 to 200 CSS pixels between the fingers, at fit-width.
- scale-up: setScale() to 1.75 times fit-width.
- zoom-step: zoomBy(1.1) at fit-width.
- zoom-in-far: setScale() from fit-width to 5, where detail covers part of the page.
- zoom-out-far: setScale() from 5 back to "fit-width".

