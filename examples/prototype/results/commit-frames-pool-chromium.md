# ParaPDF runtime prototype: zoom commits, Chromium 156.0.8078.4, frame canvases kept

- Run at: 2026-10-24T02:56:12.885Z
- Machine: darwin 27.0.0 arm64, Apple M2 Pro (12 logical cores); Chromium 156.0.8078.4 (Playwright build, headless); power: AC
- One-minute load average: 3.8 at the start, 4.1 at the end, on 12 cores. The run waited once (4 min in all) for other Playwright browsers or a load average above 10 and repeated 0 jobs that another browser overlapped.
- Method: bill-hr815.pdf in pdf.js drawing on the main thread, 820×1000 at devicePixelRatio 2, 3 runs of each scenario. A probe composites each visible page's canvases as the page shows them, hidden ones left out, after every frame's animation frame callbacks, at a quarter of its CSS size. Blank: none of the pixels the page shows in its visible part is darker than 250 where its settled drawing has ink. Down to its base: the page showed a detail canvas before the commit and shows none. Frames are summed over the runs; the longest is the most any page stayed so.
- A second pass without the probe, which reads canvases back from the GPU and delays frames: time to sharp is from the commit until the visible pages' sharpness reached 0.99 for good; renders count those completed from the commit until the visible pages had stayed sharp for half a second; canvas memory is width × height × 4 bytes of every canvas in the viewport, before the gesture and at its peak after the commit. Medians.
- Reproduce: `pnpm --filter @parapdf/prototype build && BROWSER=chromium QUERY="|frames=1" node examples/prototype/scripts/commit-bench.ts`, with `DIST` pointing at the demo built from frame canvases kept in a directory of its own

| Scenario | Scale | Frames with a blank page | Longest blank (ms) | Frames with a page down to its base | Longest (ms) | Time to sharp (ms) | Base renders | Detail renders | Cancelled | Canvas MiB before (peak after) |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pinch-out · as built | 1.11 → 1.84 | 0 | 0 | 0 | 0 | 20 | 0 | 5 | 0 | 73 (217) |
| pinch-out · frames=1 | 1.11 → 1.84 | 0 | 0 | 0 | 0 | 35 | 0 | 5 | 0 | 73 (202) |
| pinch-in-start · as built | 1.11 → 0.32 | 0 | 0 | 0 | 0 | 5 | 3 | 5 | 0 | 44 (49) |
| pinch-in-start · frames=1 | 1.11 → 0.32 | 0 | 0 | 0 | 0 | 5 | 3 | 5 | 0 | 44 (46) |
| pinch-in-drag · as built | 0.40 → 0.25 | 0 | 0 | 0 | 0 | 4 | 0 | 9 | 0 | 14 (16) |
| pinch-in-drag · frames=1 | 0.40 → 0.25 | 0 | 0 | 0 | 0 | 4 | 0 | 9 | 0 | 14 (15) |
| scale-up · as built | 1.11 → 1.93 | 0 | 0 | 0 | 0 | 13 | 0 | 5 | 0 | 73 (237) |
| scale-up · frames=1 | 1.11 → 1.93 | 0 | 0 | 0 | 0 | 35 | 0 | 5 | 0 | 73 (223) |
| scale-down · as built | 1.50 → 0.25 | 0 | 0 | 0 | 0 | 19 | 3 | 6 | 0 | 137 (87) |
| scale-down · frames=1 | 1.50 → 0.25 | 0 | 0 | 0 | 0 | 29 | 3 | 6 | 0 | 137 (86) |
| zoom-step · as built | 1.11 → 1.22 | 0 | 0 | 0 | 0 | 13 | 0 | 5 | 0 | 73 (115) |
| zoom-step · frames=1 | 1.11 → 1.22 | 0 | 0 | 0 | 0 | 30 | 0 | 5 | 0 | 73 (89) |
| zoom-in-far · as built | 1.11 → 5.00 | 0 | 0 | 0 | 0 | 30 | 5 | 1 | 0 | 73 (104) |
| zoom-in-far · frames=1 | 1.11 → 5.00 | 0 | 0 | 0 | 0 | 57 | 5 | 1 | 0 | 73 (104) |
| zoom-out-far · as built | 5.00 → 1.11 | 0 | 0 | 0 | 0 | 17 | 5 | 5 | 0 | 104 (105) |
| zoom-out-far · frames=1 | 5.00 → 1.11 | 0 | 0 | 0 | 0 | 26 | 5 | 5 | 0 | 104 (105) |
| zoom-twice · as built | 1.11 → 1.73 | 0 | 0 | 0 | 0 | 13 | 0 | 9 | 1 | 73 (202) |
| zoom-twice · frames=1 | 1.11 → 1.73 | 0 | 0 | 0 | 0 | 24 | 0 | 9 | 1 | 73 (178) |
| ctrl-wheel · as built | 1.11 → 1.42 | 0 | 0 | 0 | 0 | 20 | 0 | 5 | 0 | 73 (140) |
| ctrl-wheel · frames=1 | 1.11 → 1.42 | 0 | 0 | 0 | 0 | 36 | 0 | 5 | 0 | 73 (120) |

Scenarios:

- pinch-out: a touch pinch out, 100 to 200 CSS pixels between the fingers, at fit-width.
- pinch-in-start: a touch pinch in, 300 to 80 CSS pixels, at the document's start.
- pinch-in-drag: a touch pinch in, 300 to 150, dragging 400 CSS pixels up, at scale 0.4.
- scale-up: setScale() to 1.75 times fit-width.
- scale-down: setScale() from 1.5 to 0.25.
- zoom-step: zoomBy(1.1) at fit-width.
- zoom-in-far: setScale() from fit-width to 5, where detail covers part of the page.
- zoom-out-far: setScale() from 5 back to "fit-width".
- zoom-twice: zoomBy(1.25) twice 30 ms apart at fit-width.
- ctrl-wheel: ctrl+wheel up by 50 at fit-width, which commits 150 ms after the event.

