# ParaPDF runtime prototype: scripted scroll

- Run at: 2026-10-17T16:22:01.822Z
- Machine: darwin 27.0.0 arm64, Apple M2 Pro (12 logical cores); Chromium 156.0.8078.4 (headless, Metal GPU)
- Method: 1280×900 viewport at devicePixelRatio 2, fit-width zoom, 100 ms of constant-speed scrolling after the first page is painted, median of 5 runs. PDF preload: off.
- First paint: time from navigation start until page 1 shows pixels.
- Blank: share of the viewport covered by pages without pixels, averaged over frames; blank frames: frames where more than 1% was blank.
- Main thread: summed lateness beyond 2 ms of a 4 ms timer while scrolling, plus the raw p95 and maximum lateness.
- Reproduce: `pnpm --filter @parapdf/prototype build && pnpm --filter @parapdf/prototype bench`

## bill-hr815.pdf, 1 px per frame

| Variant | First paint (ms) | Pages crossed | Blank (%) | Blank frames (%) | Main thread blocked (ms) | Lag p95 / max (ms) | Dropped frames | React commits | Renders base / detail / cancelled |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pdfjs-hwa | 800 | 0 | 0.0 | 0.0 | 0 | 0.8 / 1 | 0 / 7 | 0 | 0 / 0 / 0 |
| pdfjs-next-hwa | 619 | 0 | 0.0 | 0.0 | 0 | 0.8 / 1 | 0 / 7 | 0 | 0 / 0 / 0 |

## synthetic-text-1000.pdf, 1 px per frame

| Variant | First paint (ms) | Pages crossed | Blank (%) | Blank frames (%) | Main thread blocked (ms) | Lag p95 / max (ms) | Dropped frames | React commits | Renders base / detail / cancelled |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pdfjs-hwa | 506 | 0 | 0.0 | 0.0 | 0 | 0.8 / 1 | 0 / 7 | 0 | 0 / 0 / 0 |
| pdfjs-next-hwa | 1495 | 0 | 0.0 | 0.0 | 0 | 0.9 / 1 | 0 / 7 | 0 | 0 / 0 / 0 |

