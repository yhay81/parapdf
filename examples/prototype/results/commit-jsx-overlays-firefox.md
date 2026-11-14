# ParaPDF runtime prototype: zoom commits, Firefox 159.0, this build

- Run at: 2026-11-14T13:19:07.505Z
- Machine: darwin 27.2.0 arm64, Apple M2 Pro (12 logical cores); Firefox 159.0 (Playwright build, headless); power: AC
- One-minute load average: 6.5 at the start, 3.8 at the end, on 12 cores. The run waited 0 times (0 min in all) for other Playwright browsers or a load average above 8 and repeated 0 jobs that another browser overlapped.
- Method: bill-hr815.pdf in pdf.js drawing on the main thread, 820×1000 at devicePixelRatio 2, 3 runs of each scenario. A probe composites each visible page's canvases as the page shows them, hidden ones left out, after every frame's animation frame callbacks, at a quarter of its CSS size. Blank: none of the pixels the page shows in its visible part is darker than 250 where its settled drawing has ink. Down to its base: the page showed a detail canvas before the commit and shows none. Frames are summed over the runs; the longest is the most any page stayed so.
- A second pass without the probe, which reads canvases back from the GPU and delays frames: time to sharp is from the commit until the visible pages' sharpness reached 0.99 for good; renders count those completed from the commit until the visible pages had stayed sharp for half a second; canvas memory is width × height × 4 bytes of every canvas in the viewport and of those kept for pages that unmounted, before the gesture and at its peak after the commit. Medians.
- Reproduce: `pnpm --filter @parapdf/prototype build && BROWSER=firefox node examples/prototype/scripts/commit-bench.ts`, with `DIST` pointing at the demo built from this build in a directory of its own

| Scenario | Scale | Frames with a blank page | Longest blank (ms) | Frames with a page down to its base | Longest (ms) | Time to sharp (ms) | Base renders | Detail renders | Cancelled | Canvas MiB before (peak after) |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pinch-out · decision 0041 13850bb | 1.11 → 1.84 | 0 | 0 | 0 | 0 | 76 | 0 | 5 | 0 | 73 (230) |
| pinch-out · as built | 1.11 → 1.84 | 0 | 0 | 0 | 0 | 75 | 0 | 5 | 0 | 73 (230) |
| pinch-in-start · decision 0041 13850bb | 1.11 → 0.32 | 0 | 0 | 0 | 0 | 12 | 3 | 5 | 0 | 44 (48) |
| pinch-in-start · as built | 1.11 → 0.32 | 0 | 0 | 0 | 0 | 12 | 3 | 5 | 0 | 44 (48) |
| pinch-in-drag · decision 0041 13850bb | 0.40 → 0.25 | 0 | 0 | 0 | 0 | 7 | 0 | 9 | 0 | 43 (45) |
| pinch-in-drag · as built | 0.40 → 0.25 | 0 | 0 | 0 | 0 | 7 | 0 | 9 | 0 | 43 (45) |
| scale-up · decision 0041 13850bb | 1.11 → 1.93 | 0 | 0 | 0 | 0 | 72 | 0 | 5 | 0 | 73 (251) |
| scale-up · as built | 1.11 → 1.93 | 0 | 0 | 0 | 0 | 71 | 0 | 5 | 0 | 73 (251) |
| scale-down · decision 0041 13850bb | 1.50 → 0.25 | 0 | 0 | 0 | 0 | 39 | 3 | 6 | 0 | 137 (86) |
| scale-down · as built | 1.50 → 0.25 | 0 | 0 | 0 | 0 | 37 | 3 | 6 | 0 | 137 (86) |
| zoom-step · decision 0041 13850bb | 1.11 → 1.22 | 0 | 0 | 0 | 0 | 66 | 0 | 5 | 0 | 73 (117) |
| zoom-step · as built | 1.11 → 1.22 | 0 | 0 | 0 | 0 | 62 | 0 | 5 | 0 | 73 (117) |
| zoom-in-far · decision 0041 13850bb | 1.11 → 5.00 | 0 | 0 | 0 | 0 | 116 | 5 | 1 | 0 | 73 (111) |
| zoom-in-far · as built | 1.11 → 5.00 | 0 | 0 | 0 | 0 | 109 | 5 | 1 | 0 | 73 (111) |
| zoom-out-far · decision 0041 13850bb | 5.00 → 1.11 | 0 | 0 | 0 | 0 | 38 | 5 | 5 | 0 | 104 (105) |
| zoom-out-far · as built | 5.00 → 1.11 | 0 | 0 | 0 | 0 | 39 | 5 | 5 | 0 | 104 (105) |
| zoom-in-whole · decision 0041 13850bb | 0.50 → 1.50 | 0 | 0 | 0 | 0 | 38 | 0 | 6 | 0 | 48 (196) |
| zoom-in-whole · as built | 0.50 → 1.50 | 0 | 0 | 0 | 0 | 42 | 0 | 6 | 0 | 48 (196) |
| zoom-twice · decision 0041 13850bb | 1.11 → 1.73 | 0 | 0 | 0 | 0 | 50 | 0 | 7 | 2 | 73 (191) |
| zoom-twice · as built | 1.11 → 1.73 | 0 | 0 | 0 | 0 | 101 | 0 | 6 | 2 | 73 (191) |
| ctrl-wheel · decision 0041 13850bb | 1.11 → 1.82 | 0 | 0 | 0 | 0 | 67 | 0 | 5 | 0 | 73 (226) |
| ctrl-wheel · as built | 1.11 → 1.82 | 0 | 0 | 0 | 0 | 73 | 0 | 5 | 0 | 73 (226) |

Scenarios:

- pinch-out: a touch pinch out, 100 to 200 CSS pixels between the fingers, at fit-width.
- pinch-in-start: a touch pinch in, 300 to 80 CSS pixels, at the document's start.
- pinch-in-drag: a touch pinch in, 300 to 150, dragging 400 CSS pixels up, at scale 0.4.
- scale-up: setScale() to 1.75 times fit-width.
- scale-down: setScale() from 1.5 to 0.25.
- zoom-step: zoomBy(1.1) at fit-width.
- zoom-in-far: setScale() from fit-width to 5, where detail covers part of the page.
- zoom-out-far: setScale() from 5 back to "fit-width".
- zoom-in-whole: setScale() from 0.5 to 1.5, where detail still covers each page, after a jump drew bases.
- zoom-twice: zoomBy(1.25) twice 30 ms apart at fit-width.
- ctrl-wheel: ctrl+wheel up by 50 at fit-width, which commits 150 ms after the event.

