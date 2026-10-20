# ParaPDF runtime prototype: GPU-backed canvases, WebKit 27.2

- Run at: 2026-10-20T00:56:34.472Z
- Machine: darwin 27.0.0 arm64, Apple M2 Pro (12 logical cores); WebKit 27.2 (Playwright build); power: AC
- One-minute load average: 1.8 at the start, 3.8 at the end, on 12 cores. The run waited 0 times (0 min in all) for other Playwright browsers and repeated 0 jobs that another browser overlapped.
- Method: each job launches its own browser and opens the file at fit width in a 1280×900 viewport at devicePixelRatio 2. Once the first page is sharp and a second has passed, it scrolls at 900 CSS pixels per second for 3 seconds, zooms to 3 CSS pixels per point, and pans four times by 60% of the viewport, waiting each time until the view is sharp (at most 8 seconds). `-cpu` variants pass `hwa=0` (enableHWA false), `-hwa` ones `hwa=1`. Median of 3 runs, variants in rotating order.
- Blocked: summed lateness of a 4 ms timer chain beyond the idle page's 95th percentile (at least 2 ms), from the start of the scroll to the end of the last pan. Dropped: animation frames longer than 25 ms.
- Footprint: the macOS physical footprint (`footprint`) of every process of the job's browser, which includes the IOSurfaces that GPU-backed canvases live in: after opening, at the end, and the sum of each process's own peak during the job, less what Playwright processes left before the job. Canvases: width × height × 4 bytes of every canvas in the document at the end.
- Reproduce: `pnpm --filter @parapdf/bench corpus && pnpm --filter @parapdf/prototype build && BROWSER=webkit node examples/prototype/scripts/hwa-bench.ts`

| File | Variant | Sharp (ms) | Blocked (ms) | Longest lag (ms) | Dropped frames | Footprint open / end / peaks (MiB) | Canvases (MiB) |
|---|---|---:|---:|---:|---:|---:|---:|
| bill-hr815.pdf | pdfjs-cpu | 850 | 50 | 15 | 19 | 346 / 366 / 553 | 74 |
| bill-hr815.pdf | pdfjs-hwa | 698 | 92 | 17 | 1 | 400 / 386 / 521 | 74 |
| bill-hr815.pdf | pdfjs-next-cpu | 703 | 57 | 18 | 20 | 506 / 457 / 776 | 74 |
| bill-hr815.pdf | pdfjs-next-hwa | 707 | 72 | 21 | 2 | 475 / 549 / 814 | 74 |
| synthetic-vector-200k.pdf | pdfjs-cpu | 729 | 80 | 20 | 18 | 328 / 397 / 489 | 59 |
| synthetic-vector-200k.pdf | pdfjs-hwa | 621 | 21 | 10 | 1 | 434 / 472 / 616 | 59 |
| synthetic-vector-200k.pdf | pdfjs-next-cpu | 746 | 8 | 5 | 8 | 418 / 561 / 721 | 59 |
| synthetic-vector-200k.pdf | pdfjs-next-hwa | 649 | 18 | 5 | 1 | 467 / 670 / 843 | 59 |
