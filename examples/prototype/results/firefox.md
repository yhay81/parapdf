# ParaPDF runtime prototype: scripted scroll, Firefox 157.0

- Run at: 2026-10-20T07:24:03.064Z
- Machine: darwin 27.0.0 arm64, Apple M2 Pro (12 logical cores); Firefox 157.0 (Playwright build, headless); power: AC; one-minute load average 8.8 at the start, 4.7 at the end; waited 2 times (1 min in all) for other Playwright browsers and repeated 1 job that another browser overlapped
- Idle baseline (calibrate.html, median of jobs): 4 ms timer late by 1.0 ms (median) / 1.0 ms (p95); animation frames every 16.7 ms.
- Method: 1280×900 viewport at devicePixelRatio 2, fit-width zoom, 4000 ms of scrolling at a constant speed in CSS pixels per second after the first page is painted, median of 2 runs.
- First paint: time from navigation start until page 1 shows pixels.
- Blank: share of the viewport covered by pages without pixels, averaged over frames; blank frames: frames where more than 1% was blank.
- Main thread: summed lateness of a 4 ms timer while scrolling, beyond 2 ms or the idle page's 95th percentile, whichever is larger, plus the raw p95 and maximum lateness.
- Dropped frames: animation frames longer than 1.5 idle frame intervals.
- Reproduce: `pnpm --filter @parapdf/prototype build && BROWSER=firefox pnpm --filter @parapdf/prototype bench`

## synthetic-text-1000.pdf, 900 CSS px per second

| Variant | First paint (ms) | Pages crossed | Blank (%) | Blank frames (%) | Main thread blocked (ms) | Lag p95 / max (ms) | Dropped frames | React commits | Renders base / detail / text / links / cancelled |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pdfjs | 467 | 2 | 0.0 | 0.0 | 72 | 1.8 / 16 | 1 / 240 | 4 | 0 / 2 / 2 / 2 / 0 |
| pdfjs-hwa | 260 | 2 | 0.0 | 0.0 | 49 | 1.3 / 14 | 0 / 241 | 4 | 0 / 2 / 2 / 2 / 0 |
| pdfjs-next | 328 | 2 | 0.0 | 0.0 | 17 | 1.0 / 8 | 0 / 241 | 4 | 0 / 2 / 2 / 2 / 0 |
| pdfjs-next-hwa | 341 | 2 | 0.0 | 0.0 | 23 | 1.1 / 11 | 0 / 241 | 4 | 0 / 2 / 2 / 2 / 0 |

## synthetic-text-1000.pdf, 3600 CSS px per second

| Variant | First paint (ms) | Pages crossed | Blank (%) | Blank frames (%) | Main thread blocked (ms) | Lag p95 / max (ms) | Dropped frames | React commits | Renders base / detail / text / links / cancelled |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pdfjs | 267 | 9 | 0.0 | 0.0 | 46 | 1.2 / 13 | 0 / 241 | 24 | 9 / 0 / 0 / 0 / 0 |
| pdfjs-hwa | 276 | 9 | 0.0 | 0.0 | 55 | 1.2 / 13 | 0 / 242 | 24 | 9 / 0 / 0 / 0 / 0 |
| pdfjs-next | 322 | 9 | 0.0 | 0.0 | 15 | 1.1 / 7 | 0 / 241 | 24 | 9 / 0 / 0 / 0 / 0 |
| pdfjs-next-hwa | 339 | 9 | 0.0 | 0.0 | 15 | 1.1 / 10 | 0 / 241 | 24 | 9 / 0 / 0 / 0 / 0 |

## bill-hr815.pdf, 900 CSS px per second

| Variant | First paint (ms) | Pages crossed | Blank (%) | Blank frames (%) | Main thread blocked (ms) | Lag p95 / max (ms) | Dropped frames | React commits | Renders base / detail / text / links / cancelled |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pdfjs | 209 | 2 | 0.0 | 0.0 | 32 | 1.2 / 16 | 0 / 241 | 4 | 0 / 2 / 2 / 2 / 0 |
| pdfjs-hwa | 215 | 2 | 0.0 | 0.0 | 31 | 1.1 / 15 | 1 / 241 | 4 | 0 / 2 / 2 / 2 / 0 |
| pdfjs-next | 281 | 2 | 0.0 | 0.0 | 61 | 1.1 / 20 | 0 / 241 | 4 | 0 / 2 / 2 / 2 / 0 |
| pdfjs-next-hwa | 272 | 2 | 0.0 | 0.0 | 84 | 1.4 / 17 | 0 / 241 | 4 | 0 / 2 / 2 / 2 / 0 |

## bill-hr815.pdf, 3600 CSS px per second

| Variant | First paint (ms) | Pages crossed | Blank (%) | Blank frames (%) | Main thread blocked (ms) | Lag p95 / max (ms) | Dropped frames | React commits | Renders base / detail / text / links / cancelled |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pdfjs | 226 | 7 | 0.0 | 0.0 | 44 | 1.3 / 17 | 0 / 241 | 20 | 7 / 0 / 0 / 0 / 0 |
| pdfjs-hwa | 224 | 7 | 0.0 | 0.0 | 47 | 1.2 / 15 | 0 / 241 | 20 | 8 / 0 / 0 / 0 / 0 |
| pdfjs-next | 267 | 7 | 0.0 | 0.0 | 20 | 1.4 / 10 | 0 / 240 | 20 | 7 / 0 / 0 / 0 / 0 |
| pdfjs-next-hwa | 279 | 7 | 0.0 | 0.0 | 25 | 1.1 / 11 | 0 / 242 | 20 | 8 / 0 / 0 / 0 / 0 |

