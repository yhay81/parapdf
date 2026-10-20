# ParaPDF runtime prototype: scripted scroll, Firefox 157.0

- Run at: 2026-10-20T07:07:43.992Z
- Code: 6d85eb8 (the scroll modes), measured before pdf.js shipped in the package (c9c156c): the demo created the engine itself from pdfjs-dist 6.4.299 with `createPdfjsEngine` and GPU-backed canvases (`pdfjs-hwa`).
- Machine: darwin 27.0.0 arm64, Apple M2 Pro (12 logical cores); Firefox 157.0 (Playwright build, headless); power: AC; one-minute load average 5.2 at the start, 5.6 at the end; waited 0 times (0 min in all) for other Playwright browsers and repeated 0 jobs that another browser overlapped
- Idle baseline (calibrate.html, median of jobs): 4 ms timer late by 1.0 ms (median) / 1.1 ms (p95); animation frames every 16.7 ms.
- Method: 1280×900 viewport at devicePixelRatio 2, fit-width zoom or fit-page zoom or 0.5 CSS px per point, vertical or horizontal or wrapped scroll mode, 4000 ms of scrolling at a constant speed in CSS pixels per second after the first page is painted, sideways in horizontal mode and downward otherwise, median of 3 runs. PDF preload: on.
- First paint: time from navigation start until page 1 shows pixels.
- Blank: share of the viewport covered by pages without pixels, averaged over frames; blank frames: frames where more than 1% was blank.
- Main thread: summed lateness of a 4 ms timer while scrolling, beyond 2 ms or the idle page's 95th percentile, whichever is larger, plus the raw p95 and maximum lateness.
- Dropped frames: animation frames longer than 1.5 idle frame intervals.
- React commits: commits of the viewer's React tree while scrolling, and per second. Store updates: how often the store published while scrolling, and how often that moved the mounted window and the current page, the changes that should make React commit.
- Reproduce: `pnpm --filter @parapdf/prototype build && BROWSER=firefox VARIANTS=pdfjs-hwa SCROLL=vertical,horizontal,wrapped SCALE=fit-width,fit-page,0.5 FILES=synthetic-text-1000.pdf RUNS=3 OUTPUT=scroll-modes-firefox pnpm --filter @parapdf/prototype bench`

## synthetic-text-1000.pdf, 900 CSS px per second

| Variant | First paint (ms) | Pages crossed | Blank (%) | Blank frames (%) | Main thread blocked (ms) | Lag p95 / max (ms) | Dropped frames | React commits (per s) | Store updates (window / current page) | Renders base / detail / text / links / cancelled |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pdfjs-hwa, vertical, fit-width | 477 | 2 | 0.0 | 0.0 | 57 | 1.1 / 20 | 0 / 241 | 4 (1.0) | 4 (2 / 2) | 0 / 2 / 2 / 2 / 0 |
| pdfjs-hwa, vertical, fit-page | 457 | 4 | 0.0 | 0.0 | 27 | 1.2 / 9 | 0 / 241 | 8 (2.0) | 8 (4 / 4) | 0 / 4 / 4 / 4 / 0 |
| pdfjs-hwa, vertical, scale 0.5 | 473 | 9 | 0.0 | 0.0 | 44 | 1.7 / 10 | 0 / 241 | 22 (5.5) | 22 (14 / 9) | 0 / 8 / 8 / 8 / 0 |
| pdfjs-hwa, horizontal, fit-width | 491 | 3 | 0.0 | 0.0 | 57 | 1.6 / 16 | 0 / 241 | 5 (1.2) | 5 (2 / 3) | 0 / 2 / 2 / 2 / 0 |
| pdfjs-hwa, horizontal, fit-page | 548 | 6 | 0.0 | 0.0 | 35 | 2.1 / 12 | 0 / 241 | 15 (3.7) | 15 (9 / 6) | 0 / 6 / 6 / 6 / 0 |
| pdfjs-hwa, horizontal, scale 0.5 | 458 | 12 | 0.0 | 0.0 | 83 | 1.9 / 12 | 0 / 241 | 17 (4.2) | 17 (14 / 6) | 0 / 12 / 12 / 12 / 0 |
| pdfjs-hwa, wrapped, fit-width | 490 | 2 | 0.0 | 0.0 | 37 | 1.1 / 16 | 0 / 241 | 4 (1.0) | 4 (2 / 2) | 0 / 2 / 2 / 2 / 0 |
| pdfjs-hwa, wrapped, fit-page | 492 | 4 | 0.0 | 0.0 | 39 | 1.2 / 13 | 0 / 241 | 8 (2.0) | 8 (4 / 4) | 0 / 4 / 4 / 4 / 0 |
| pdfjs-hwa, wrapped, scale 0.5 | 486 | 28 | 0.0 | 0.0 | 167 | 2.2 / 18 | 0 / 241 | 23 (5.7) | 23 (15 / 9) | 0 / 24 / 24 / 24 / 0 |

## synthetic-text-1000.pdf, 3600 CSS px per second

| Variant | First paint (ms) | Pages crossed | Blank (%) | Blank frames (%) | Main thread blocked (ms) | Lag p95 / max (ms) | Dropped frames | React commits (per s) | Store updates (window / current page) | Renders base / detail / text / links / cancelled |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pdfjs-hwa, vertical, fit-width | 492 | 9 | 0.0 | 0.0 | 85 | 1.5 / 19 | 0 / 241 | 24 (6.0) | 24 (15 / 9) | 9 / 0 / 0 / 0 / 0 |
| pdfjs-hwa, vertical, fit-page | 459 | 17 | 0.0 | 0.0 | 34 | 1.1 / 7 | 0 / 241 | 33 (8.2) | 33 (16 / 17) | 16 / 0 / 0 / 0 / 0 |
| pdfjs-hwa, vertical, scale 0.5 | 459 | 36 | 0.0 | 0.0 | 175 | 3.2 / 12 | 0 / 241 | 63 (15.7) | 63 (53 / 36) | 35 / 0 / 0 / 0 / 0 |
| pdfjs-hwa, horizontal, fit-width | 489 | 11 | 0.0 | 0.0 | 86 | 1.5 / 21 | 0 / 241 | 22 (5.5) | 22 (11 / 11) | 11 / 0 / 0 / 0 / 0 |
| pdfjs-hwa, horizontal, fit-page | 459 | 22 | 0.0 | 0.0 | 39 | 1.3 / 8 | 0 / 241 | 37 (9.2) | 37 (37 / 22) | 21 / 1 / 1 / 1 / 0 |
| pdfjs-hwa, horizontal, scale 0.5 | 459 | 46 | 0.0 | 0.0 | 174 | 3.7 / 11 | 0 / 241 | 52 (13.0) | 52 (48 / 23) | 45 / 1 / 1 / 1 / 0 |
| pdfjs-hwa, wrapped, fit-width | 475 | 9 | 0.0 | 0.0 | 62 | 1.2 / 20 | 0 / 241 | 24 (6.0) | 24 (15 / 9) | 9 / 0 / 0 / 0 / 0 |
| pdfjs-hwa, wrapped, fit-page | 461 | 17 | 0.0 | 0.0 | 42 | 1.1 / 10 | 0 / 241 | 33 (8.2) | 33 (16 / 17) | 16 / 0 / 0 / 0 / 0 |
| pdfjs-hwa, wrapped, scale 0.5 | 469 | 109 | 0.0 | 0.0 | 286 | 6.0 / 17 | 0 / 241 | 62 (15.5) | 62 (50 / 36) | 104 / 0 / 0 / 0 / 0 |

