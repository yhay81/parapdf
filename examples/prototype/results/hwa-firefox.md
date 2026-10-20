# ParaPDF runtime prototype: GPU-backed canvases, Firefox 157.0

- Run at: 2026-10-20T01:01:14.949Z
- Machine: darwin 27.0.0 arm64, Apple M2 Pro (12 logical cores); Firefox 157.0 (Playwright build); power: AC
- One-minute load average: 3.7 at the start, 3.9 at the end, on 12 cores. The run waited 0 times (0 min in all) for other Playwright browsers and repeated 0 jobs that another browser overlapped.
- Method: each job launches its own browser and opens the file at fit width in a 1280×900 viewport at devicePixelRatio 2. Once the first page is sharp and a second has passed, it scrolls at 900 CSS pixels per second for 3 seconds, zooms to 3 CSS pixels per point, and pans four times by 60% of the viewport, waiting each time until the view is sharp (at most 8 seconds). `-cpu` variants pass `hwa=0` (enableHWA false), `-hwa` ones `hwa=1`. Median of 3 runs, variants in rotating order.
- Blocked: summed lateness of a 4 ms timer chain beyond the idle page's 95th percentile (at least 2 ms), from the start of the scroll to the end of the last pan. Dropped: animation frames longer than 25 ms.
- Footprint: the macOS physical footprint (`footprint`) of every process of the job's browser, which includes the IOSurfaces that GPU-backed canvases live in: after opening, at the end, and the sum of each process's own peak during the job, less what Playwright processes left before the job. Canvases: width × height × 4 bytes of every canvas in the document at the end.
- Reproduce: `pnpm --filter @parapdf/bench corpus && pnpm --filter @parapdf/prototype build && BROWSER=firefox node examples/prototype/scripts/hwa-bench.ts`

| File | Variant | Sharp (ms) | Blocked (ms) | Longest lag (ms) | Dropped frames | Footprint open / end / peaks (MiB) | Canvases (MiB) |
|---|---|---:|---:|---:|---:|---:|---:|
| bill-hr815.pdf | pdfjs-cpu | 497 | 184 | 24 | 0 | 766 / 738 / 864 | 74 |
| bill-hr815.pdf | pdfjs-hwa | 481 | 163 | 26 | 1 | 750 / 733 / 856 | 74 |
| bill-hr815.pdf | pdfjs-next-cpu | 508 | 107 | 17 | 0 | 655 / 741 / 827 | 74 |
| bill-hr815.pdf | pdfjs-next-hwa | 491 | 143 | 21 | 0 | 655 / 740 / 828 | 74 |
| synthetic-vector-200k.pdf | pdfjs-cpu | 522 | 1191 | 33 | 1 | 680 / 919 / 1011 | 59 |
| synthetic-vector-200k.pdf | pdfjs-hwa | 515 | 1154 | 34 | 0 | 682 / 922 / 1014 | 59 |
| synthetic-vector-200k.pdf | pdfjs-next-cpu | 535 | 100 | 18 | 0 | 569 / 652 / 805 | 59 |
| synthetic-vector-200k.pdf | pdfjs-next-hwa | 510 | 128 | 18 | 0 | 572 / 654 / 806 | 59 |
