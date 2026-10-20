# ParaPDF runtime prototype: GPU-backed canvases, Chromium 156.0.8078.4

- Run at: 2026-10-20T00:52:08.456Z
- Machine: darwin 27.0.0 arm64, Apple M2 Pro (12 logical cores); Chromium 156.0.8078.4 (Playwright build); power: AC
- One-minute load average: 2.8 at the start, 1.8 at the end, on 12 cores. The run waited 0 times (0 min in all) for other Playwright browsers and repeated 0 jobs that another browser overlapped.
- Method: each job launches its own browser and opens the file at fit width in a 1280×900 viewport at devicePixelRatio 2. Once the first page is sharp and a second has passed, it scrolls at 900 CSS pixels per second for 3 seconds, zooms to 3 CSS pixels per point, and pans four times by 60% of the viewport, waiting each time until the view is sharp (at most 8 seconds). `-cpu` variants pass `hwa=0` (enableHWA false), `-hwa` ones `hwa=1`. Median of 3 runs, variants in rotating order.
- Blocked: summed lateness of a 4 ms timer chain beyond the idle page's 95th percentile (at least 2 ms), from the start of the scroll to the end of the last pan. Dropped: animation frames longer than 25 ms.
- Footprint: the macOS physical footprint (`footprint`) of every process of the job's browser, which includes the IOSurfaces that GPU-backed canvases live in: after opening, at the end, and the sum of each process's own peak during the job, less what Playwright processes left before the job. Canvases: width × height × 4 bytes of every canvas in the document at the end.
- Reproduce: `pnpm --filter @parapdf/bench corpus && pnpm --filter @parapdf/prototype build && BROWSER=chromium node examples/prototype/scripts/hwa-bench.ts`

| File | Variant | Sharp (ms) | Blocked (ms) | Longest lag (ms) | Dropped frames | Footprint open / end / peaks (MiB) | Canvases (MiB) |
|---|---|---:|---:|---:|---:|---:|---:|
| bill-hr815.pdf | pdfjs-cpu | 520 | 209 | 44 | 1 | 474 / 490 / 588 | 74 |
| bill-hr815.pdf | pdfjs-hwa | 479 | 33 | 12 | 0 | 460 / 462 / 498 | 74 |
| bill-hr815.pdf | pdfjs-next-cpu | 525 | 93 | 25 | 0 | 411 / 516 / 623 | 74 |
| bill-hr815.pdf | pdfjs-next-hwa | 485 | 7 | 6 | 0 | 450 / 474 / 534 | 74 |
| synthetic-vector-200k.pdf | pdfjs-cpu | 514 | 1207 | 284 | 6 | 267 / 347 / 434 | 59 |
| synthetic-vector-200k.pdf | pdfjs-hwa | 482 | 6 | 6 | 0 | 273 / 369 / 450 | 59 |
| synthetic-vector-200k.pdf | pdfjs-next-cpu | 536 | 64 | 19 | 0 | 249 / 327 / 417 | 59 |
| synthetic-vector-200k.pdf | pdfjs-next-hwa | 499 | 1 | 2 | 0 | 251 / 337 / 495 | 59 |
