# ParaPDF runtime prototype: scripted scroll

- Run at: 2026-10-17T16:25:53.854Z
- Machine: darwin 27.0.0 arm64, Apple M2 Pro (12 logical cores); Chromium 156.0.8078.4 (headless, Metal GPU)
- Method: 1280×900 viewport at devicePixelRatio 2, fit-width zoom, 4000 ms of constant-speed scrolling after the first page is painted, median of 2 runs. PDF preload: on.
- First paint: time from navigation start until page 1 shows pixels.
- Blank: share of the viewport covered by pages without pixels, averaged over frames; blank frames: frames where more than 1% was blank.
- Main thread: summed lateness beyond 2 ms of a 4 ms timer while scrolling, plus the raw p95 and maximum lateness.
- Reproduce: `pnpm --filter @parapdf/prototype build && pnpm --filter @parapdf/prototype bench`

## synthetic-text-1000.pdf, 15 px per frame

| Variant | First paint (ms) | Pages crossed | Blank (%) | Blank frames (%) | Main thread blocked (ms) | Lag p95 / max (ms) | Dropped frames | React commits | Renders base / detail / cancelled |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pdfjs | 498 | 2 | 0.0 | 0.0 | 64 | 1.1 / 40 | 0 / 241 | 4 | 2 / 2 / 0 |
| pdfjs-hwa | 485 | 2 | 0.0 | 0.0 | 6 | 1.1 / 6 | 0 / 241 | 4 | 2 / 2 / 0 |
| pdfjs-next | 566 | 2 | 0.0 | 0.0 | 18 | 1.1 / 14 | 0 / 241 | 4 | 2 / 2 / 0 |
| pdfjs-next-hwa | 495 | 2 | 0.0 | 0.0 | 0 | 1.1 / 2 | 0 / 241 | 4 | 2 / 2 / 0 |

## synthetic-text-1000.pdf, 60 px per frame

| Variant | First paint (ms) | Pages crossed | Blank (%) | Blank frames (%) | Main thread blocked (ms) | Lag p95 / max (ms) | Dropped frames | React commits | Renders base / detail / cancelled |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pdfjs | 488 | 9 | 0.0 | 0.0 | 5 | 1.2 / 5 | 0 / 241 | 24 | 9 / 0 / 0 |
| pdfjs-hwa | 722 | 9 | 0.0 | 0.0 | 3 | 1.1 / 3 | 0 / 241 | 24 | 9 / 0 / 0 |
| pdfjs-next | 519 | 9 | 0.0 | 0.0 | 0 | 1.1 / 2 | 0 / 241 | 24 | 9 / 0 / 0 |
| pdfjs-next-hwa | 497 | 9 | 0.0 | 0.0 | 0 | 1.1 / 1 | 0 / 241 | 24 | 9 / 0 / 0 |

## bill-hr815.pdf, 15 px per frame

| Variant | First paint (ms) | Pages crossed | Blank (%) | Blank frames (%) | Main thread blocked (ms) | Lag p95 / max (ms) | Dropped frames | React commits | Renders base / detail / cancelled |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pdfjs | 467 | 2 | 0.0 | 0.0 | 91 | 1.1 / 58 | 1 / 240 | 4 | 2 / 2 / 0 |
| pdfjs-hwa | 701 | 2 | 0.0 | 0.0 | 8 | 1.2 / 6 | 0 / 241 | 4 | 2 / 2 / 0 |
| pdfjs-next | 673 | 2 | 0.0 | 0.0 | 39 | 1.2 / 23 | 0 / 241 | 4 | 2 / 2 / 0 |
| pdfjs-next-hwa | 1501 | 2 | 0.0 | 0.0 | 2 | 1.1 / 3 | 0 / 241 | 4 | 2 / 2 / 0 |

## bill-hr815.pdf, 60 px per frame

| Variant | First paint (ms) | Pages crossed | Blank (%) | Blank frames (%) | Main thread blocked (ms) | Lag p95 / max (ms) | Dropped frames | React commits | Renders base / detail / cancelled |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pdfjs | 1096 | 7 | 0.0 | 0.0 | 19 | 1.2 / 8 | 0 / 241 | 20 | 8 / 0 / 0 |
| pdfjs-hwa | 1200 | 7 | 0.0 | 0.0 | 4 | 1.1 / 4 | 0 / 241 | 20 | 8 / 0 / 0 |
| pdfjs-next | 619 | 7 | 0.0 | 0.0 | 0 | 1.1 / 2 | 0 / 241 | 20 | 8 / 0 / 0 |
| pdfjs-next-hwa | 474 | 7 | 0.0 | 0.0 | 0 | 1.1 / 2 | 0 / 241 | 20 | 8 / 0 / 0 |

