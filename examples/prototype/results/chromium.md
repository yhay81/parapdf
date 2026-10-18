# ParaPDF runtime prototype: scripted scroll, Chromium 156.0.8078.4

- Run at: 2026-10-18T12:18:06.229Z
- Machine: darwin 27.0.0 arm64, Apple M2 Pro (12 logical cores); Chromium 156.0.8078.4 (Playwright build, headless); power: AC
- Idle baseline (calibrate.html, median of jobs): 4 ms timer late by 1.0 ms (median) / 1.4 ms (p95); animation frames every 16.7 ms.
- Method: 1280×900 viewport at devicePixelRatio 2, fit-width zoom, 4000 ms of scrolling at a constant speed in CSS pixels per second after the first page is painted, median of 2 runs. PDF preload: on.
- First paint: time from navigation start until page 1 shows pixels.
- Blank: share of the viewport covered by pages without pixels, averaged over frames; blank frames: frames where more than 1% was blank.
- Main thread: summed lateness of a 4 ms timer while scrolling, beyond 2 ms or the idle page's 95th percentile, whichever is larger, plus the raw p95 and maximum lateness.
- Dropped frames: animation frames longer than 1.5 idle frame intervals.
- Reproduce: `pnpm --filter @parapdf/prototype build && BROWSER=chromium pnpm --filter @parapdf/prototype bench`

## synthetic-text-1000.pdf, 900 CSS px per second

| Variant | First paint (ms) | Pages crossed | Blank (%) | Blank frames (%) | Main thread blocked (ms) | Lag p95 / max (ms) | Dropped frames | React commits | Renders base / detail / text / links / cancelled |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pdfjs | 431 | 2 | 0.0 | 0.0 | 50 | 1.5 / 27 | 0 / 241 | 4 | 2 / 2 / 2 / 2 / 0 |
| pdfjs, no text | 420 | 2 | 0.0 | 0.0 | 55 | 1.5 / 35 | 0 / 241 | 4 | 2 / 2 / 0 / 2 / 0 |
| pdfjs-hwa | 438 | 2 | 0.0 | 0.0 | 14 | 1.5 / 9 | 0 / 241 | 4 | 2 / 2 / 2 / 2 / 0 |
| pdfjs-hwa, no text | 445 | 2 | 0.0 | 0.0 | 23 | 1.5 / 11 | 0 / 241 | 4 | 2 / 2 / 0 / 2 / 0 |
| pdfjs-next | 436 | 2 | 0.0 | 0.0 | 21 | 1.6 / 13 | 0 / 241 | 4 | 2 / 2 / 2 / 2 / 0 |
| pdfjs-next, no text | 444 | 2 | 0.0 | 0.0 | 19 | 1.5 / 12 | 0 / 241 | 4 | 2 / 2 / 0 / 2 / 0 |
| pdfjs-next-hwa | 433 | 2 | 0.0 | 0.0 | 3 | 1.5 / 4 | 0 / 241 | 4 | 2 / 2 / 2 / 2 / 0 |
| pdfjs-next-hwa, no text | 425 | 2 | 0.0 | 0.0 | 2 | 1.5 / 4 | 1 / 241 | 4 | 2 / 2 / 0 / 2 / 0 |

## synthetic-text-1000.pdf, 3600 CSS px per second

| Variant | First paint (ms) | Pages crossed | Blank (%) | Blank frames (%) | Main thread blocked (ms) | Lag p95 / max (ms) | Dropped frames | React commits | Renders base / detail / text / links / cancelled |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pdfjs | 438 | 9 | 0.0 | 0.0 | 54 | 1.7 / 10 | 0 / 241 | 24 | 9 / 0 / 0 / 0 / 0 |
| pdfjs, no text | 439 | 9 | 0.0 | 0.0 | 64 | 1.6 / 11 | 0 / 241 | 24 | 9 / 0 / 0 / 0 / 0 |
| pdfjs-hwa | 420 | 9 | 0.0 | 0.0 | 68 | 1.6 / 11 | 0 / 241 | 24 | 9 / 0 / 0 / 0 / 0 |
| pdfjs-hwa, no text | 428 | 9 | 0.0 | 0.0 | 53 | 1.7 / 11 | 0 / 241 | 24 | 9 / 0 / 0 / 0 / 0 |
| pdfjs-next | 426 | 9 | 0.0 | 0.0 | 7 | 1.6 / 4 | 0 / 241 | 24 | 9 / 0 / 0 / 0 / 0 |
| pdfjs-next, no text | 444 | 9 | 0.0 | 0.0 | 7 | 1.6 / 5 | 0 / 241 | 24 | 9 / 0 / 0 / 0 / 0 |
| pdfjs-next-hwa | 423 | 9 | 0.0 | 0.0 | 4 | 1.6 / 3 | 1 / 241 | 24 | 9 / 0 / 0 / 0 / 0 |
| pdfjs-next-hwa, no text | 434 | 9 | 0.0 | 0.0 | 2 | 1.5 / 3 | 0 / 241 | 24 | 9 / 0 / 0 / 0 / 0 |

## bill-hr815.pdf, 900 CSS px per second

| Variant | First paint (ms) | Pages crossed | Blank (%) | Blank frames (%) | Main thread blocked (ms) | Lag p95 / max (ms) | Dropped frames | React commits | Renders base / detail / text / links / cancelled |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pdfjs | 422 | 2 | 0.0 | 0.0 | 71 | 1.5 / 35 | 1 / 241 | 4 | 2 / 2 / 2 / 2 / 0 |
| pdfjs, no text | 405 | 2 | 0.0 | 0.0 | 57 | 1.6 / 32 | 0 / 242 | 4 | 2 / 2 / 0 / 2 / 0 |
| pdfjs-hwa | 400 | 2 | 0.0 | 0.0 | 19 | 1.5 / 8 | 0 / 241 | 4 | 2 / 2 / 2 / 2 / 0 |
| pdfjs-hwa, no text | 407 | 2 | 0.0 | 0.0 | 12 | 1.5 / 8 | 0 / 241 | 4 | 2 / 2 / 0 / 2 / 0 |
| pdfjs-next | 429 | 2 | 0.0 | 0.0 | 44 | 1.6 / 17 | 0 / 241 | 4 | 2 / 2 / 2 / 2 / 0 |
| pdfjs-next, no text | 403 | 2 | 0.0 | 0.0 | 27 | 1.5 / 15 | 0 / 241 | 4 | 2 / 2 / 0 / 2 / 0 |
| pdfjs-next-hwa | 409 | 2 | 0.0 | 0.0 | 18 | 1.5 / 9 | 0 / 241 | 4 | 2 / 2 / 2 / 2 / 0 |
| pdfjs-next-hwa, no text | 418 | 2 | 0.0 | 0.0 | 1 | 1.4 / 3 | 1 / 241 | 4 | 2 / 2 / 0 / 2 / 0 |

## bill-hr815.pdf, 3600 CSS px per second

| Variant | First paint (ms) | Pages crossed | Blank (%) | Blank frames (%) | Main thread blocked (ms) | Lag p95 / max (ms) | Dropped frames | React commits | Renders base / detail / text / links / cancelled |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pdfjs | 417 | 7 | 0.0 | 0.0 | 65 | 1.7 / 10 | 0 / 241 | 20 | 8 / 0 / 0 / 0 / 0 |
| pdfjs, no text | 434 | 7 | 0.0 | 0.0 | 39 | 1.7 / 8 | 0 / 241 | 20 | 8 / 0 / 0 / 0 / 0 |
| pdfjs-hwa | 407 | 7 | 0.0 | 0.0 | 50 | 1.6 / 8 | 1 / 241 | 20 | 8 / 0 / 0 / 0 / 0 |
| pdfjs-hwa, no text | 424 | 7 | 0.0 | 0.0 | 39 | 1.7 / 9 | 0 / 241 | 20 | 8 / 0 / 0 / 0 / 0 |
| pdfjs-next | 415 | 7 | 0.0 | 0.0 | 13 | 1.6 / 6 | 0 / 241 | 20 | 8 / 0 / 0 / 0 / 0 |
| pdfjs-next, no text | 399 | 7 | 0.0 | 0.0 | 10 | 1.6 / 5 | 0 / 241 | 20 | 8 / 0 / 0 / 0 / 0 |
| pdfjs-next-hwa | 417 | 7 | 0.0 | 0.0 | 10 | 1.7 / 6 | 0 / 241 | 20 | 8 / 0 / 0 / 0 / 0 |
| pdfjs-next-hwa, no text | 414 | 7 | 0.0 | 0.0 | 4 | 1.6 / 4 | 1 / 241 | 20 | 8 / 0 / 0 / 0 / 0 |

