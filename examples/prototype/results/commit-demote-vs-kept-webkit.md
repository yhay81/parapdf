# ParaPDF runtime prototype: zoom commits, WebKit 27.2, this build

- Run at: 2026-10-24T06:04:33.117Z
- Machine: darwin 27.0.0 arm64, Apple M2 Pro (12 logical cores); WebKit 27.2 (Playwright build, headless); power: AC
- One-minute load average: 6.3 at the start, 6.6 at the end, on 12 cores. The run waited 0 times (0 min in all) for other Playwright browsers or a load average above 10 and repeated 0 jobs that another browser overlapped.
- Method: bill-hr815.pdf in pdf.js drawing on the main thread, 820×1000 at devicePixelRatio 2, 3 runs of each scenario. A probe composites each visible page's canvases as the page shows them, hidden ones left out, after every frame's animation frame callbacks, at a quarter of its CSS size. Blank: none of the pixels the page shows in its visible part is darker than 250 where its settled drawing has ink. Down to its base: the page showed a detail canvas before the commit and shows none. Frames are summed over the runs; the longest is the most any page stayed so.
- A second pass without the probe, which reads canvases back from the GPU and delays frames: time to sharp is from the commit until the visible pages' sharpness reached 0.99 for good; renders count those completed from the commit until the visible pages had stayed sharp for half a second; canvas memory is width × height × 4 bytes of every canvas in the viewport, before the gesture and at its peak after the commit. Medians.
- Reproduce: `pnpm --filter @parapdf/prototype build && BROWSER=webkit node examples/prototype/scripts/commit-bench.ts`, with `DIST` pointing at the demo built from this build in a directory of its own

| Scenario | Scale | Frames with a blank page | Longest blank (ms) | Frames with a page down to its base | Longest (ms) | Time to sharp (ms) | Base renders | Detail renders | Cancelled | Canvas MiB before (peak after) |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pinch-out · kept (1 failed) | 1.11 → 1.84 | 0 | 0 | 0 | 0 | 25 | 0 | 5 | 0 | 73 (217) |
| pinch-out · as built (1 failed) | 1.11 → 1.84 | 0 | 0 | 0 | 0 | 27 | 0 | 5 | 0 | 73 (217) |
| scale-up · kept (2 failed) | 1.11 → 1.93 | 0 | 0 | 0 | 0 | 8 | 0 | 5 | 0 | 73 (237) |
| scale-up · as built (2 failed) | 1.11 → 1.93 | 0 | 0 | 0 | 0 | 6 | 0 | 5 | 0 | 73 (237) |
| zoom-step · kept (2 failed) | 1.11 → 1.22 | 0 | 0 | 0 | 0 | 8 | 0 | 5 | 0 | 73 (115) |
| zoom-step · as built (2 failed) | 1.11 → 1.22 | 0 | 0 | 0 | 0 | 6 | 0 | 5 | 0 | 73 (115) |
| zoom-in-far · kept (2 failed) | 1.11 → 5.00 | 0 | 0 | 0 | 0 | 33 | 5 | 1 | 0 | 73 (104) |
| zoom-in-far · as built (2 failed) | 1.11 → 5.00 | 0 | 0 | 0 | 0 | 11 | 0 | 1 | 0 | 73 (104) |
| zoom-out-far · kept (2 failed) | 5.00 → 1.11 | 0 | 0 | 0 | 0 | 11 | 5 | 5 | 0 | 104 (105) |
| zoom-out-far · as built (2 failed) | 5.00 → 1.11 | 0 | 0 | 0 | 0 | 7 | 5 | 5 | 0 | 104 (105) |

Scenarios:

- pinch-out: a touch pinch out, 100 to 200 CSS pixels between the fingers, at fit-width.
- scale-up: setScale() to 1.75 times fit-width.
- zoom-step: zoomBy(1.1) at fit-width.
- zoom-in-far: setScale() from fit-width to 5, where detail covers part of the page.
- zoom-out-far: setScale() from 5 back to "fit-width".

