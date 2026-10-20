# ParaPDF runtime prototype: scripted scroll, WebKit 27.2

- Run at: 2026-10-20T07:01:47.002Z
- Code: 6d85eb8 (the scroll modes), measured before pdf.js shipped in the package (c9c156c): the demo created the engine itself from pdfjs-dist 6.4.299 with `createPdfjsEngine` and GPU-backed canvases (`pdfjs-hwa`).
- Machine: darwin 27.0.0 arm64, Apple M2 Pro (12 logical cores); WebKit 27.2 (Playwright build, headless); power: AC; one-minute load average 5.5 at the start, 5.5 at the end; waited 4 times (17 min in all) for other Playwright browsers and repeated 6 jobs that another browser overlapped
- Idle baseline (calibrate.html, median of jobs): 4 ms timer late by 3.9 ms (median) / 4.9 ms (p95); animation frames every 13.9 ms.
- Method: 1280×900 viewport at devicePixelRatio 2, fit-width zoom or fit-page zoom or 0.5 CSS px per point, vertical or horizontal or wrapped scroll mode, 4000 ms of scrolling at a constant speed in CSS pixels per second after the first page is painted, sideways in horizontal mode and downward otherwise, median of 3 runs. PDF preload: on.
- First paint: time from navigation start until page 1 shows pixels.
- Blank: share of the viewport covered by pages without pixels, averaged over frames; blank frames: frames where more than 1% was blank.
- Main thread: summed lateness of a 4 ms timer while scrolling, beyond 2 ms or the idle page's 95th percentile, whichever is larger, plus the raw p95 and maximum lateness.
- Dropped frames: animation frames longer than 1.5 idle frame intervals.
- React commits: commits of the viewer's React tree while scrolling, and per second. Store updates: how often the store published while scrolling, and how often that moved the mounted window and the current page, the changes that should make React commit.
- Reproduce: `pnpm --filter @parapdf/prototype build && BROWSER=webkit VARIANTS=pdfjs-hwa SCROLL=vertical,horizontal,wrapped SCALE=fit-width,fit-page,0.5 FILES=synthetic-text-1000.pdf RUNS=3 OUTPUT=scroll-modes-webkit pnpm --filter @parapdf/prototype bench`

## synthetic-text-1000.pdf, 900 CSS px per second

| Variant | First paint (ms) | Pages crossed | Blank (%) | Blank frames (%) | Main thread blocked (ms) | Lag p95 / max (ms) | Dropped frames | React commits (per s) | Store updates (window / current page) | Renders base / detail / text / links / cancelled |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pdfjs-hwa, vertical, fit-width | 419 | 2 | 0.0 | 0.0 | 4 | 4.9 / 6 | 0 / 289 | 4 (1.0) | 4 (2 / 2) | 0 / 2 / 2 / 2 / 0 |
| pdfjs-hwa, vertical, fit-page | 422 | 4 | 0.0 | 0.0 | 3 | 4.9 / 6 | 0 / 289 | 8 (2.0) | 8 (4 / 4) | 0 / 4 / 4 / 4 / 0 |
| pdfjs-hwa, vertical, scale 0.5 | 434 | 9 | 0.0 | 0.0 | 6 | 4.9 / 6 | 0 / 289 | 23 (5.7) | 23 (14 / 9) | 0 / 8 / 8 / 8 / 0 |
| pdfjs-hwa, horizontal, fit-width | 487 | 3 | 0.0 | 0.0 | 1 | 4.8 / 5 | 0 / 289 | 5 (1.2) | 5 (2 / 3) | 0 / 2 / 2 / 2 / 0 |
| pdfjs-hwa, horizontal, fit-page | 432 | 6 | 0.0 | 0.0 | 7 | 4.9 / 6 | 0 / 289 | 15 (3.7) | 15 (9 / 6) | 0 / 6 / 6 / 6 / 0 |
| pdfjs-hwa, horizontal, scale 0.5 | 446 | 12 | 0.0 | 0.0 | 38 | 4.9 / 12 | 1 / 289 | 17 (4.2) | 17 (15 / 6) | 0 / 12 / 12 / 12 / 0 |
| pdfjs-hwa, wrapped, fit-width | 434 | 2 | 0.0 | 0.0 | 2 | 4.8 / 5 | 0 / 289 | 4 (1.0) | 4 (2 / 2) | 0 / 2 / 2 / 2 / 0 |
| pdfjs-hwa, wrapped, fit-page | 449 | 4 | 0.0 | 0.0 | 8 | 4.9 / 7 | 0 / 289 | 8 (2.0) | 8 (4 / 4) | 0 / 4 / 4 / 4 / 0 |
| pdfjs-hwa, wrapped, scale 0.5 | 445 | 28 | 0.0 | 0.0 | 113 | 6.3 / 15 | 1 / 289 | 24 (6.0) | 24 (15 / 9) | 0 / 24 / 24 / 24 / 0 |

## synthetic-text-1000.pdf, 3600 CSS px per second

| Variant | First paint (ms) | Pages crossed | Blank (%) | Blank frames (%) | Main thread blocked (ms) | Lag p95 / max (ms) | Dropped frames | React commits (per s) | Store updates (window / current page) | Renders base / detail / text / links / cancelled |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pdfjs-hwa, vertical, fit-width | 432 | 9 | 0.0 | 0.0 | 4 | 4.8 / 7 | 0 / 289 | 24 (6.0) | 24 (15 / 9) | 9 / 0 / 0 / 0 / 0 |
| pdfjs-hwa, vertical, fit-page | 460 | 17 | 0.0 | 0.0 | 3 | 4.9 / 6 | 0 / 289 | 33 (8.2) | 33 (16 / 17) | 16 / 0 / 0 / 0 / 0 |
| pdfjs-hwa, vertical, scale 0.5 | 482 | 36 | 0.0 | 0.0 | 22 | 4.9 / 9 | 0 / 289 | 67 (16.7) | 67 (55 / 36) | 35 / 0 / 0 / 0 / 0 |
| pdfjs-hwa, horizontal, fit-width | 432 | 11 | 0.0 | 0.0 | 4 | 4.8 / 6 | 0 / 289 | 22 (5.5) | 22 (11 / 11) | 11 / 0 / 0 / 0 / 0 |
| pdfjs-hwa, horizontal, fit-page | 432 | 22 | 0.0 | 0.0 | 7 | 4.9 / 7 | 0 / 289 | 42 (10.5) | 42 (41 / 22) | 21 / 1 / 1 / 0 / 0 |
| pdfjs-hwa, horizontal, scale 0.5 | 423 | 46 | 0.0 | 0.0 | 11 | 4.9 / 7 | 0 / 289 | 52 (13.0) | 52 (49 / 23) | 45 / 1 / 1 / 0 / 0 |
| pdfjs-hwa, wrapped, fit-width | 445 | 9 | 0.0 | 0.0 | 15 | 4.9 / 8 | 0 / 289 | 24 (6.0) | 24 (15 / 9) | 9 / 0 / 0 / 0 / 0 |
| pdfjs-hwa, wrapped, fit-page | 454 | 17 | 0.0 | 0.0 | 15 | 4.9 / 9 | 0 / 289 | 33 (8.2) | 33 (16 / 17) | 16 / 0 / 0 / 0 / 0 |
| pdfjs-hwa, wrapped, scale 0.5 | 447 | 109 | 0.0 | 0.0 | 57 | 5.0 / 13 | 0 / 289 | 67 (16.7) | 67 (56 / 36) | 105 / 0 / 0 / 0 / 0 |

