# ParaPDF runtime prototype: scripted scroll, Firefox 157.0

- Run at: 2026-10-18T12:31:56.881Z
- Machine: darwin 27.0.0 arm64, Apple M2 Pro (12 logical cores); Firefox 157.0 (Playwright build, headless); power: AC
- Idle baseline (calibrate.html, median of jobs): 4 ms timer late by 2.0 ms (median) / 2.3 ms (p95); animation frames every 16.7 ms.
- Method: 1280×900 viewport at devicePixelRatio 2, fit-width zoom, 4000 ms of scrolling at a constant speed in CSS pixels per second after the first page is painted, median of 2 runs. PDF preload: on.
- First paint: time from navigation start until page 1 shows pixels.
- Blank: share of the viewport covered by pages without pixels, averaged over frames; blank frames: frames where more than 1% was blank.
- Main thread: summed lateness of a 4 ms timer while scrolling, beyond 2 ms or the idle page's 95th percentile, whichever is larger, plus the raw p95 and maximum lateness.
- Dropped frames: animation frames longer than 1.5 idle frame intervals.
- Reproduce: `pnpm --filter @parapdf/prototype build && BROWSER=firefox pnpm --filter @parapdf/prototype bench`

## synthetic-text-1000.pdf, 900 CSS px per second

| Variant | First paint (ms) | Pages crossed | Blank (%) | Blank frames (%) | Main thread blocked (ms) | Lag p95 / max (ms) | Dropped frames | React commits | Renders base / detail / text / links / cancelled |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pdfjs | 470 | 2 | 0.0 | 0.0 | 55 | 2.5 / 13 | 0 / 241 | 4 | 2 / 2 / 2 / 2 / 0 |
| pdfjs, no text | 478 | 2 | 0.0 | 0.0 | 63 | 2.5 / 12 | 0 / 241 | 4 | 2 / 2 / 0 / 2 / 0 |
| pdfjs-hwa | 479 | 2 | 0.0 | 0.0 | 56 | 2.6 / 13 | 0 / 241 | 4 | 2 / 2 / 2 / 2 / 0 |
| pdfjs-hwa, no text | 487 | 2 | 0.0 | 0.0 | 34 | 2.3 / 9 | 0 / 242 | 4 | 2 / 2 / 0 / 2 / 0 |
| pdfjs-next | 484 | 2 | 0.0 | 0.0 | 38 | 2.5 / 14 | 0 / 241 | 4 | 2 / 2 / 2 / 2 / 0 |
| pdfjs-next, no text | 488 | 2 | 0.0 | 0.0 | 51 | 2.5 / 14 | 0 / 241 | 4 | 2 / 2 / 0 / 2 / 0 |
| pdfjs-next-hwa | 475 | 2 | 0.0 | 0.0 | 47 | 2.4 / 9 | 0 / 241 | 4 | 2 / 2 / 2 / 2 / 0 |
| pdfjs-next-hwa, no text | 485 | 2 | 0.0 | 0.0 | 34 | 2.4 / 11 | 0 / 241 | 4 | 2 / 2 / 0 / 2 / 0 |

## synthetic-text-1000.pdf, 3600 CSS px per second

| Variant | First paint (ms) | Pages crossed | Blank (%) | Blank frames (%) | Main thread blocked (ms) | Lag p95 / max (ms) | Dropped frames | React commits | Renders base / detail / text / links / cancelled |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pdfjs | 460 | 9 | 0.0 | 0.0 | 91 | 2.9 / 11 | 0 / 241 | 24 | 9 / 0 / 0 / 0 / 0 |
| pdfjs, no text | 492 | 9 | 0.0 | 0.0 | 80 | 2.6 / 11 | 0 / 241 | 24 | 9 / 0 / 0 / 0 / 0 |
| pdfjs-hwa | 471 | 9 | 0.0 | 0.0 | 96 | 3.0 / 10 | 0 / 241 | 24 | 9 / 0 / 0 / 0 / 0 |
| pdfjs-hwa, no text | 487 | 9 | 0.0 | 0.0 | 96 | 2.7 / 11 | 0 / 241 | 24 | 9 / 0 / 0 / 0 / 0 |
| pdfjs-next | 471 | 9 | 0.0 | 0.0 | 50 | 2.5 / 10 | 0 / 241 | 24 | 9 / 0 / 0 / 0 / 0 |
| pdfjs-next, no text | 484 | 9 | 0.0 | 0.0 | 34 | 2.5 / 9 | 0 / 241 | 24 | 9 / 0 / 0 / 0 / 0 |
| pdfjs-next-hwa | 491 | 9 | 0.0 | 0.0 | 40 | 2.6 / 8 | 0 / 241 | 24 | 9 / 0 / 0 / 0 / 0 |
| pdfjs-next-hwa, no text | 472 | 9 | 0.0 | 0.0 | 41 | 2.2 / 9 | 0 / 241 | 24 | 9 / 0 / 0 / 0 / 0 |

## bill-hr815.pdf, 900 CSS px per second

| Variant | First paint (ms) | Pages crossed | Blank (%) | Blank frames (%) | Main thread blocked (ms) | Lag p95 / max (ms) | Dropped frames | React commits | Renders base / detail / text / links / cancelled |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pdfjs | 426 | 2 | 0.0 | 0.0 | 68 | 2.6 / 12 | 0 / 241 | 4 | 2 / 2 / 2 / 2 / 0 |
| pdfjs, no text | 432 | 2 | 0.0 | 0.0 | 55 | 2.4 / 12 | 0 / 241 | 4 | 2 / 2 / 0 / 2 / 0 |
| pdfjs-hwa | 449 | 2 | 0.0 | 0.0 | 50 | 2.3 / 11 | 0 / 242 | 4 | 2 / 2 / 2 / 2 / 0 |
| pdfjs-hwa, no text | 424 | 2 | 0.0 | 0.0 | 69 | 2.6 / 11 | 0 / 241 | 4 | 2 / 2 / 0 / 2 / 0 |
| pdfjs-next | 432 | 2 | 0.0 | 0.0 | 36 | 2.3 / 8 | 0 / 241 | 4 | 2 / 2 / 2 / 2 / 0 |
| pdfjs-next, no text | 436 | 2 | 0.0 | 0.0 | 25 | 2.4 / 7 | 0 / 241 | 4 | 2 / 2 / 0 / 2 / 0 |
| pdfjs-next-hwa | 425 | 2 | 0.0 | 0.0 | 51 | 2.6 / 11 | 0 / 241 | 4 | 2 / 2 / 2 / 2 / 0 |
| pdfjs-next-hwa, no text | 430 | 2 | 0.0 | 0.0 | 31 | 2.3 / 8 | 0 / 242 | 4 | 2 / 2 / 0 / 2 / 0 |

## bill-hr815.pdf, 3600 CSS px per second

| Variant | First paint (ms) | Pages crossed | Blank (%) | Blank frames (%) | Main thread blocked (ms) | Lag p95 / max (ms) | Dropped frames | React commits | Renders base / detail / text / links / cancelled |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pdfjs | 431 | 7 | 0.0 | 0.0 | 77 | 2.6 / 9 | 0 / 241 | 20 | 8 / 0 / 0 / 0 / 0 |
| pdfjs, no text | 432 | 7 | 0.0 | 0.0 | 77 | 2.3 / 11 | 0 / 241 | 20 | 8 / 0 / 0 / 0 / 0 |
| pdfjs-hwa | 433 | 7 | 0.0 | 0.0 | 73 | 2.4 / 10 | 0 / 242 | 20 | 8 / 0 / 0 / 0 / 0 |
| pdfjs-hwa, no text | 419 | 7 | 0.0 | 0.0 | 79 | 2.6 / 11 | 0 / 241 | 20 | 7 / 0 / 0 / 0 / 0 |
| pdfjs-next | 431 | 7 | 0.0 | 0.0 | 61 | 2.6 / 8 | 0 / 242 | 20 | 8 / 0 / 0 / 0 / 0 |
| pdfjs-next, no text | 423 | 7 | 0.0 | 0.0 | 46 | 2.5 / 7 | 0 / 242 | 20 | 8 / 0 / 0 / 0 / 0 |
| pdfjs-next-hwa | 445 | 7 | 0.0 | 0.0 | 45 | 2.3 / 9 | 0 / 241 | 20 | 7 / 0 / 0 / 0 / 0 |
| pdfjs-next-hwa, no text | 420 | 7 | 0.0 | 0.0 | 50 | 2.4 / 9 | 0 / 241 | 20 | 7 / 0 / 0 / 0 / 0 |

