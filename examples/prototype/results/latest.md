# ParaPDF runtime prototype: scripted scroll

- Run at: 2026-10-17T23:14:39.463Z
- Machine: darwin 27.0.0 arm64, Apple M2 Pro (12 logical cores); Chromium 156.0.8078.4 (headless, Metal GPU)
- Method: 1280×900 viewport at devicePixelRatio 2, fit-width zoom, 4000 ms of constant-speed scrolling after the first page is painted, median of 2 runs. PDF preload: on.
- First paint: time from navigation start until page 1 shows pixels.
- Blank: share of the viewport covered by pages without pixels, averaged over frames; blank frames: frames where more than 1% was blank.
- Main thread: summed lateness beyond 2 ms of a 4 ms timer while scrolling, plus the raw p95 and maximum lateness.
- Reproduce: `pnpm --filter @parapdf/prototype build && pnpm --filter @parapdf/prototype bench`

## synthetic-text-1000.pdf, 15 px per frame

| Variant | First paint (ms) | Pages crossed | Blank (%) | Blank frames (%) | Main thread blocked (ms) | Lag p95 / max (ms) | Dropped frames | React commits | Renders base / detail / text / cancelled |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pdfjs | 506 | 2 | 0.0 | 0.0 | 76 | 1.1 / 47 | 0 / 241 | 4 | 2 / 2 / 2 / 0 |
| pdfjs, no text | 462 | 2 | 0.0 | 0.0 | 36 | 1.2 / 20 | 0 / 241 | 4 | 2 / 2 / 0 / 0 |
| pdfjs-hwa | 489 | 2 | 0.0 | 0.0 | 6 | 1.1 / 6 | 0 / 241 | 4 | 2 / 2 / 2 / 0 |
| pdfjs-hwa, no text | 456 | 2 | 0.0 | 0.0 | 5 | 1.3 / 4 | 0 / 241 | 4 | 2 / 2 / 0 / 0 |
| pdfjs-next | 466 | 2 | 0.0 | 0.0 | 19 | 1.2 / 14 | 0 / 241 | 4 | 2 / 2 / 2 / 0 |
| pdfjs-next, no text | 467 | 2 | 0.0 | 0.0 | 21 | 1.0 / 13 | 0 / 241 | 4 | 2 / 2 / 0 / 0 |
| pdfjs-next-hwa | 480 | 2 | 0.0 | 0.0 | 0 | 1.1 / 2 | 0 / 241 | 4 | 2 / 2 / 2 / 0 |
| pdfjs-next-hwa, no text | 477 | 2 | 0.0 | 0.0 | 0 | 1.0 / 2 | 0 / 241 | 4 | 2 / 2 / 0 / 0 |

## synthetic-text-1000.pdf, 60 px per frame

| Variant | First paint (ms) | Pages crossed | Blank (%) | Blank frames (%) | Main thread blocked (ms) | Lag p95 / max (ms) | Dropped frames | React commits | Renders base / detail / text / cancelled |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pdfjs | 472 | 9 | 0.0 | 0.0 | 6 | 1.1 / 5 | 0 / 241 | 24 | 9 / 0 / 0 / 0 |
| pdfjs, no text | 486 | 9 | 0.0 | 0.0 | 3 | 1.1 / 3 | 0 / 241 | 24 | 9 / 0 / 0 / 0 |
| pdfjs-hwa | 471 | 9 | 0.0 | 0.0 | 7 | 1.1 / 5 | 0 / 241 | 24 | 9 / 0 / 0 / 0 |
| pdfjs-hwa, no text | 450 | 9 | 0.0 | 0.0 | 6 | 1.2 / 4 | 0 / 241 | 24 | 9 / 0 / 0 / 0 |
| pdfjs-next | 468 | 9 | 0.0 | 0.0 | 0 | 1.1 / 2 | 0 / 241 | 24 | 9 / 0 / 0 / 0 |
| pdfjs-next, no text | 458 | 9 | 0.0 | 0.0 | 0 | 1.1 / 2 | 0 / 241 | 24 | 9 / 0 / 0 / 0 |
| pdfjs-next-hwa | 454 | 9 | 0.0 | 0.0 | 0 | 1.1 / 2 | 0 / 241 | 24 | 9 / 0 / 0 / 0 |
| pdfjs-next-hwa, no text | 506 | 9 | 0.0 | 0.0 | 0 | 1.1 / 2 | 0 / 241 | 24 | 9 / 0 / 0 / 0 |

## bill-hr815.pdf, 15 px per frame

| Variant | First paint (ms) | Pages crossed | Blank (%) | Blank frames (%) | Main thread blocked (ms) | Lag p95 / max (ms) | Dropped frames | React commits | Renders base / detail / text / cancelled |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pdfjs | 577 | 2 | 0.0 | 0.0 | 42 | 1.2 / 24 | 0 / 241 | 4 | 2 / 2 / 2 / 0 |
| pdfjs, no text | 430 | 2 | 0.0 | 0.0 | 57 | 1.1 / 42 | 1 / 239 | 4 | 2 / 2 / 0 / 0 |
| pdfjs-hwa | 450 | 2 | 0.0 | 0.0 | 11 | 1.3 / 9 | 0 / 241 | 4 | 2 / 2 / 2 / 0 |
| pdfjs-hwa, no text | 448 | 2 | 0.0 | 0.0 | 2 | 1.1 / 3 | 0 / 241 | 4 | 2 / 2 / 0 / 0 |
| pdfjs-next | 464 | 2 | 0.0 | 0.0 | 63 | 1.3 / 40 | 1 / 239 | 4 | 2 / 2 / 2 / 0 |
| pdfjs-next, no text | 425 | 2 | 0.0 | 0.0 | 13 | 1.2 / 7 | 0 / 241 | 4 | 2 / 2 / 0 / 0 |
| pdfjs-next-hwa | 430 | 2 | 0.0 | 0.0 | 1 | 1.1 / 3 | 0 / 241 | 4 | 2 / 2 / 2 / 0 |
| pdfjs-next-hwa, no text | 434 | 2 | 0.0 | 0.0 | 0 | 1.2 / 2 | 0 / 241 | 4 | 2 / 2 / 0 / 0 |

## bill-hr815.pdf, 60 px per frame

| Variant | First paint (ms) | Pages crossed | Blank (%) | Blank frames (%) | Main thread blocked (ms) | Lag p95 / max (ms) | Dropped frames | React commits | Renders base / detail / text / cancelled |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pdfjs | 460 | 7 | 0.0 | 0.0 | 5 | 1.1 / 4 | 0 / 241 | 20 | 8 / 0 / 0 / 0 |
| pdfjs, no text | 440 | 7 | 0.0 | 0.0 | 4 | 1.2 / 4 | 0 / 241 | 20 | 8 / 0 / 0 / 0 |
| pdfjs-hwa | 428 | 7 | 0.0 | 0.0 | 4 | 1.2 / 3 | 0 / 241 | 20 | 8 / 0 / 0 / 0 |
| pdfjs-hwa, no text | 427 | 7 | 0.0 | 0.0 | 3 | 1.1 / 3 | 0 / 241 | 20 | 8 / 0 / 0 / 0 |
| pdfjs-next | 435 | 7 | 0.0 | 0.0 | 0 | 1.1 / 2 | 0 / 241 | 20 | 8 / 0 / 0 / 0 |
| pdfjs-next, no text | 423 | 7 | 0.0 | 0.0 | 0 | 1.1 / 2 | 0 / 241 | 20 | 8 / 0 / 0 / 0 |
| pdfjs-next-hwa | 426 | 7 | 0.0 | 0.0 | 0 | 1.0 / 1 | 0 / 241 | 20 | 8 / 0 / 0 / 0 |
| pdfjs-next-hwa, no text | 440 | 7 | 0.0 | 0.0 | 0 | 1.2 / 2 | 0 / 241 | 20 | 8 / 0 / 0 / 0 |

