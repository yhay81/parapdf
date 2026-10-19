# ParaPDF runtime prototype: scripted scroll, Firefox 157.0

- Run at: 2026-10-19T07:18:26.181Z
- Machine: darwin 27.0.0 arm64, Apple M2 Pro (12 logical cores); Firefox 157.0 (Playwright build, headless); power: AC
- Idle baseline (calibrate.html, median of jobs): 4 ms timer late by 1.0 ms (median) / 1.1 ms (p95); animation frames every 16.7 ms.
- Method: 1280×900 viewport at devicePixelRatio 2, fit-width zoom, 4000 ms of scrolling at a constant speed in CSS pixels per second after the first page is painted, median of 2 runs. PDF preload: on.
- First paint: time from navigation start until page 1 shows pixels.
- Blank: share of the viewport covered by pages without pixels, averaged over frames; blank frames: frames where more than 1% was blank.
- Main thread: summed lateness of a 4 ms timer while scrolling, beyond 2 ms or the idle page's 95th percentile, whichever is larger, plus the raw p95 and maximum lateness.
- Dropped frames: animation frames longer than 1.5 idle frame intervals.
- Reproduce: `pnpm --filter @parapdf/prototype build && BROWSER=firefox pnpm --filter @parapdf/prototype bench`

## synthetic-text-1000.pdf, 900 CSS px per second

| Variant | First paint (ms) | Pages crossed | Blank (%) | Blank frames (%) | Main thread blocked (ms) | Lag p95 / max (ms) | Dropped frames | React commits | Renders base / detail / text / links / cancelled |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pdfjs | 468 | 2 | 0.0 | 0.0 | 46 | 1.1 / 19 | 0 / 241 | 4 | 2 / 2 / 2 / 2 / 0 |
| pdfjs, no text | 458 | 2 | 0.0 | 0.0 | 57 | 1.2 / 10 | 0 / 241 | 4 | 2 / 2 / 0 / 2 / 0 |
| pdfjs-hwa | 485 | 2 | 0.0 | 0.0 | 89 | 1.8 / 16 | 0 / 241 | 4 | 2 / 2 / 2 / 2 / 0 |
| pdfjs-hwa, no text | 464 | 2 | 0.0 | 0.0 | 34 | 1.1 / 14 | 0 / 241 | 4 | 2 / 2 / 0 / 2 / 0 |
| pdfjs-next | 460 | 2 | 0.0 | 0.0 | 49 | 1.1 / 17 | 0 / 242 | 4 | 2 / 2 / 2 / 2 / 0 |
| pdfjs-next, no text | 461 | 2 | 0.0 | 0.0 | 35 | 1.1 / 16 | 0 / 241 | 4 | 2 / 2 / 0 / 2 / 0 |
| pdfjs-next-hwa | 461 | 2 | 0.0 | 0.0 | 41 | 1.1 / 15 | 0 / 241 | 4 | 2 / 2 / 2 / 2 / 0 |
| pdfjs-next-hwa, no text | 459 | 2 | 0.0 | 0.0 | 37 | 1.2 / 13 | 0 / 241 | 4 | 2 / 2 / 0 / 2 / 0 |

## synthetic-text-1000.pdf, 3600 CSS px per second

| Variant | First paint (ms) | Pages crossed | Blank (%) | Blank frames (%) | Main thread blocked (ms) | Lag p95 / max (ms) | Dropped frames | React commits | Renders base / detail / text / links / cancelled |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pdfjs | 510 | 9 | 0.0 | 0.0 | 40 | 1.3 / 7 | 0 / 241 | 24 | 9 / 0 / 0 / 0 / 0 |
| pdfjs, no text | 475 | 9 | 0.0 | 0.0 | 89 | 1.5 / 21 | 1 / 240 | 24 | 9 / 0 / 0 / 0 / 0 |
| pdfjs-hwa | 466 | 9 | 0.0 | 0.0 | 29 | 1.1 / 8 | 0 / 241 | 24 | 9 / 0 / 0 / 0 / 0 |
| pdfjs-hwa, no text | 463 | 9 | 0.0 | 0.0 | 31 | 1.1 / 9 | 0 / 241 | 24 | 9 / 0 / 0 / 0 / 0 |
| pdfjs-next | 475 | 9 | 0.0 | 0.0 | 13 | 1.1 / 7 | 0 / 241 | 24 | 9 / 0 / 0 / 0 / 0 |
| pdfjs-next, no text | 476 | 9 | 0.0 | 0.0 | 16 | 1.0 / 8 | 0 / 242 | 24 | 9 / 0 / 0 / 0 / 0 |
| pdfjs-next-hwa | 474 | 9 | 0.0 | 0.0 | 24 | 1.1 / 10 | 0 / 242 | 24 | 9 / 0 / 0 / 0 / 0 |
| pdfjs-next-hwa, no text | 529 | 9 | 0.0 | 0.0 | 51 | 1.7 / 8 | 1 / 240 | 24 | 9 / 0 / 0 / 0 / 0 |

## bill-hr815.pdf, 900 CSS px per second

| Variant | First paint (ms) | Pages crossed | Blank (%) | Blank frames (%) | Main thread blocked (ms) | Lag p95 / max (ms) | Dropped frames | React commits | Renders base / detail / text / links / cancelled |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pdfjs | 427 | 2 | 0.0 | 0.0 | 60 | 1.1 / 21 | 1 / 241 | 4 | 2 / 2 / 2 / 2 / 0 |
| pdfjs, no text | 417 | 2 | 0.0 | 0.0 | 27 | 1.1 / 12 | 0 / 241 | 4 | 2 / 2 / 0 / 2 / 0 |
| pdfjs-hwa | 425 | 2 | 0.0 | 0.0 | 113 | 1.3 / 37 | 1 / 241 | 4 | 2 / 2 / 2 / 2 / 0 |
| pdfjs-hwa, no text | 409 | 2 | 0.0 | 0.0 | 41 | 1.1 / 12 | 0 / 241 | 4 | 2 / 2 / 0 / 2 / 0 |
| pdfjs-next | 431 | 2 | 0.0 | 0.0 | 109 | 1.6 / 20 | 0 / 241 | 4 | 2 / 2 / 2 / 2 / 0 |
| pdfjs-next, no text | 420 | 2 | 0.0 | 0.0 | 39 | 1.1 / 14 | 0 / 241 | 4 | 2 / 2 / 0 / 2 / 0 |
| pdfjs-next-hwa | 414 | 2 | 0.0 | 0.0 | 49 | 1.1 / 16 | 0 / 242 | 4 | 2 / 2 / 2 / 2 / 0 |
| pdfjs-next-hwa, no text | 413 | 2 | 0.0 | 0.0 | 43 | 1.1 / 13 | 0 / 241 | 4 | 2 / 2 / 0 / 2 / 0 |

## bill-hr815.pdf, 3600 CSS px per second

| Variant | First paint (ms) | Pages crossed | Blank (%) | Blank frames (%) | Main thread blocked (ms) | Lag p95 / max (ms) | Dropped frames | React commits | Renders base / detail / text / links / cancelled |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pdfjs | 409 | 7 | 0.0 | 0.0 | 44 | 1.1 / 19 | 0 / 241 | 20 | 7 / 0 / 0 / 0 / 0 |
| pdfjs, no text | 448 | 7 | 0.0 | 0.0 | 19 | 1.1 / 11 | 0 / 241 | 20 | 7 / 0 / 0 / 0 / 0 |
| pdfjs-hwa | 429 | 7 | 0.0 | 0.0 | 34 | 1.1 / 11 | 0 / 241 | 20 | 7 / 0 / 0 / 0 / 0 |
| pdfjs-hwa, no text | 419 | 7 | 0.0 | 0.0 | 57 | 1.5 / 12 | 1 / 240 | 20 | 7 / 0 / 0 / 0 / 0 |
| pdfjs-next | 426 | 7 | 0.0 | 0.0 | 151 | 1.2 / 84 | 1 / 236 | 20 | 8 / 0 / 0 / 0 / 0 |
| pdfjs-next, no text | 411 | 7 | 0.0 | 0.0 | 48 | 1.2 / 12 | 1 / 241 | 20 | 8 / 0 / 0 / 0 / 0 |
| pdfjs-next-hwa | 444 | 7 | 0.0 | 0.0 | 30 | 1.1 / 12 | 0 / 241 | 20 | 7 / 0 / 0 / 0 / 0 |
| pdfjs-next-hwa, no text | 409 | 7 | 0.0 | 0.0 | 277 | 3.0 / 31 | 7 / 225 | 20 | 8 / 1 / 0 / 0 / 0 |

