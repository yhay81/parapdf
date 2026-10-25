# ParaPDF runtime prototype: zoom commits, Firefox 157.0, M2 6dd7349

- Run at: 2026-10-25T10:31:41.682Z
- Machine: darwin 27.0.0 arm64, Apple M2 Pro (12 logical cores); Firefox 157.0 (Playwright build, headless); power: AC
- One-minute load average: 3.5 at the start, 2.4 at the end, on 12 cores. The run waited 0 times (0 min in all) for other Playwright browsers and repeated 0 jobs that another browser overlapped.
- Method: bill-hr815.pdf in pdf.js drawing on the main thread, 820×1000 at devicePixelRatio 2, 5 runs of each scenario. A probe composites each visible page's canvases as the page shows them, hidden ones left out, after every frame's animation frame callbacks, at a quarter of its CSS size. Blank: none of the pixels the page shows in its visible part is darker than 250 where its settled drawing has ink. Down to its base: the page showed a detail canvas before the commit and shows none. Frames are summed over the runs; the longest is the most any page stayed so.
- A second pass without the probe, which reads canvases back from the GPU and delays frames: time to sharp is from the commit until the visible pages' sharpness reached 0.99 for good; renders count those completed from the commit until the visible pages had stayed sharp for half a second; canvas memory is width × height × 4 bytes of every canvas in the viewport and of those kept for pages that unmounted, before the gesture and at its peak after the commit. Medians.
- Reproduce: `pnpm --filter @parapdf/prototype build && BROWSER=firefox node examples/prototype/scripts/commit-bench.ts`, with `DIST` pointing at the demo built from M2 6dd7349 in a directory of its own

| Scenario | Scale | Frames with a blank page | Longest blank (ms) | Frames with a page down to its base | Longest (ms) | Time to sharp (ms) | Base renders | Detail renders | Cancelled | Canvas MiB before (peak after) |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| scale-up · M3 af2967e | 1.11 → 1.93 | 0 | 0 | 0 | 0 | 72 | 0 | 5 | 0 | 73 (252) |
| scale-up · as built | 1.11 → 1.93 | 0 | 0 | 0 | 0 | 62 | 0 | 5 | 0 | 73 (237) |
| zoom-in-far · M3 af2967e | 1.11 → 5.00 | 0 | 0 | 0 | 0 | 94 | 5 | 1 | 0 | 73 (111) |
| zoom-in-far · as built | 1.11 → 5.00 | 0 | 0 | 0 | 0 | 95 | 5 | 1 | 0 | 73 (111) |

Scenarios:

- scale-up: setScale() to 1.75 times fit-width.
- zoom-in-far: setScale() from fit-width to 5, where detail covers part of the page.
