# ParaPDF runtime prototype: zoom commits, Chromium 156.0.8078.4, 258f693, the canvas drawn in place

- Run at: 2026-10-20T08:36:03.122Z
- Machine: darwin 27.0.0 arm64, Apple M2 Pro (12 logical cores); Chromium 156.0.8078.4 (Playwright build, headless), CPU slowed down 4 times through the DevTools protocol; power: AC
- One-minute load average: 9.6 at the start, 4.8 at the end, on 12 cores. The run waited once (0 min in all) for other Playwright browsers and repeated 1 job that another browser overlapped.
- Method: bill-hr815.pdf in pdf.js drawing on the main thread, 820×1000 at devicePixelRatio 2, 3 runs of each scenario. A probe composites each visible page's canvases as the page shows them, hidden ones left out, after every frame's animation frame callbacks, at a quarter of its CSS size. Blank: none of the pixels the page shows in its visible part is darker than 250 where its settled drawing has ink. Down to its base: the page showed a detail canvas before the commit and shows none. Frames are summed over the runs; the longest is the most any page stayed so.
- A second pass without the probe, which reads canvases back from the GPU and delays frames: time to sharp is from the commit until the visible pages' sharpness reached 0.99 for good; renders count those completed from the commit until the visible pages had stayed sharp for half a second; canvas memory is width × height × 4 bytes of every canvas in the viewport, before the gesture and at its peak after the commit. Medians.
- Reproduce: `pnpm --filter @parapdf/prototype build && BROWSER=chromium THROTTLE=4 node examples/prototype/scripts/commit-bench.ts`, with `DIST` pointing at the demo built from 258f693 in a directory of its own

| Scenario | Scale | Frames with a blank page | Longest blank (ms) | Frames with a page down to its base | Longest (ms) | Time to sharp (ms) | Base renders | Detail renders | Cancelled | Canvas MiB before (peak after) |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pinch-out | 1.11 → 1.90 | 3 | 90 | 0 | 0 | 118 | 2 | 5 | 0 | 75 (220) |
| pinch-in-start | 1.11 → 0.32 | 6 | 61 | 0 | 0 | 173 | 6 | 5 | 0 | 44 (46) |
| pinch-in-drag | 0.40 → 0.25 | 9 | 75 | 0 | 0 | 111 | 0 | 9 | 0 | 14 (12) |
| scale-up | 1.11 → 1.93 | 3 | 103 | 0 | 0 | 115 | 2 | 5 | 0 | 75 (230) |
| scale-down | 1.50 → 0.25 | 6 | 75 | 0 | 0 | 76 | 6 | 6 | 0 | 140 (63) |
| zoom-step | 1.11 → 1.22 | 3 | 85 | 0 | 0 | 98 | 1 | 5 | 0 | 75 (91) |
| zoom-in-far | 1.11 → 5.00 | 3 | 119 | 0 | 0 | 106 | 5 | 1 | 0 | 75 (104) |
| zoom-out-far | 5.00 → 1.11 | 0 | 0 | 0 | 0 | 25 | 5 | 5 | 0 | 104 (105) |
| zoom-twice | 1.11 → 1.73 | 3 | 109 | 0 | 0 | 117 | 1 | 6 | 2 | 75 (181) |
| ctrl-wheel | 1.11 → 1.42 | 3 | 96 | 0 | 0 | 109 | 1 | 5 | 0 | 75 (123) |

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

