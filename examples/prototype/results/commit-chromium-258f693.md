# ParaPDF runtime prototype: zoom commits, Chromium 156.0.8078.4, 258f693, the canvas drawn in place

- Run at: 2026-10-20T08:16:01.656Z
- Machine: darwin 27.0.0 arm64, Apple M2 Pro (12 logical cores); Chromium 156.0.8078.4 (Playwright build, headless); power: AC
- One-minute load average: 7.2 at the start, 3.5 at the end, on 12 cores. The run waited 0 times (0 min in all) for other Playwright browsers and repeated 0 jobs that another browser overlapped.
- Method: bill-hr815.pdf in pdf.js drawing on the main thread, 820×1000 at devicePixelRatio 2, 3 runs of each scenario. A probe composites each visible page's canvases as the page shows them, hidden ones left out, after every frame's animation frame callbacks, at a quarter of its CSS size. Blank: none of the pixels the page shows in its visible part is darker than 250 where its settled drawing has ink. Down to its base: the page showed a detail canvas before the commit and shows none. Frames are summed over the runs; the longest is the most any page stayed so.
- A second pass without the probe, which reads canvases back from the GPU and delays frames: time to sharp is from the commit until the visible pages' sharpness reached 0.99 for good; renders count those completed from the commit until the visible pages had stayed sharp for half a second; canvas memory is width × height × 4 bytes of every canvas in the viewport, before the gesture and at its peak after the commit. Medians.
- Reproduce: `pnpm --filter @parapdf/prototype build && BROWSER=chromium node examples/prototype/scripts/commit-bench.ts`, with `DIST` pointing at the demo built from 258f693 in a directory of its own

| Scenario | Scale | Frames with a blank page | Longest blank (ms) | Frames with a page down to its base | Longest (ms) | Time to sharp (ms) | Base renders | Detail renders | Cancelled | Canvas MiB before (peak after) |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pinch-out | 1.11 → 1.90 | 3 | 33 | 0 | 0 | 40 | 2 | 5 | 0 | 75 (220) |
| pinch-in-start | 1.11 → 0.32 | 6 | 30 | 0 | 0 | 62 | 6 | 5 | 0 | 44 (46) |
| pinch-in-drag | 0.40 → 0.25 | 9 | 48 | 0 | 0 | 74 | 0 | 9 | 0 | 14 (12) |
| scale-up | 1.11 → 1.93 | 3 | 34 | 0 | 0 | 40 | 2 | 5 | 0 | 75 (230) |
| scale-down | 1.50 → 0.25 | 6 | 30 | 0 | 0 | 30 | 6 | 6 | 0 | 140 (63) |
| zoom-step | 1.11 → 1.22 | 3 | 30 | 0 | 0 | 39 | 1 | 5 | 0 | 75 (91) |
| zoom-in-far | 1.11 → 5.00 | 3 | 31 | 0 | 0 | 37 | 5 | 1 | 0 | 75 (104) |
| zoom-out-far | 5.00 → 1.11 | 0 | 0 | 0 | 0 | 17 | 5 | 5 | 0 | 104 (105) |
| zoom-twice | 1.11 → 1.73 | 3 | 30 | 0 | 0 | 44 | 1 | 6 | 2 | 75 (181) |
| ctrl-wheel | 1.11 → 1.42 | 3 | 29 | 0 | 0 | 44 | 1 | 5 | 0 | 75 (123) |

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

