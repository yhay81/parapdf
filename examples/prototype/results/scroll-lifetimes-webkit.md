# ParaPDF runtime prototype: scripted scroll, WebKit 27.2

- Run at: 2026-11-12T18:08:39.588Z
- Machine: darwin 27.2.0 arm64, Apple M2 Pro (12 logical cores); WebKit 27.2 (Playwright build, headless); power: AC; one-minute load average 8.5 at the start, 3.0 at the end; waited 0 times (0 min in all) for other Playwright browsers and repeated 0 jobs that another browser overlapped
- Idle baseline (calibrate.html, median of jobs): 4 ms timer late by 3.8 ms (median) / 5.7 ms (p95); animation frames every 13.9 ms.
- Method: 1280×900 viewport at devicePixelRatio 2, fit-width zoom, vertical scroll mode, 4000 ms of scrolling at a constant speed in CSS pixels per second after the first page is painted, sideways in horizontal mode and downward otherwise, median of 5 runs. Variants named "before" ran on main ce61e6e, each in turn with its twin, job by job.
- First paint: time from navigation start until page 1 shows pixels.
- Blank: share of the viewport covered by pages without pixels, averaged over frames; blank frames: frames where more than 1% was blank.
- Main thread: summed lateness of a 4 ms timer while scrolling, beyond 2 ms or the idle page's 95th percentile, whichever is larger, plus the raw p95 and maximum lateness.
- Dropped frames: animation frames longer than 1.5 idle frame intervals.
- Canvas memory: the pixels of the canvases in the page and of those kept for pages that unmounted, at 4 bytes each, once the pages settled after scrolling.
- Versions: pdfjs-dist 6.5.438.
- React commits: commits of the viewer's React tree while scrolling, and per second. Store updates: how often the store published while scrolling, and how often that moved the mounted window and the current page, the changes that should make React commit.
- Reproduce: `pnpm --filter @parapdf/prototype build && BROWSER=webkit VARIANTS=pdfjs-hwa FILES=synthetic-text-1000.pdf,bill-hr815.pdf SPEEDS=900,3600 RUNS=5 DURATION=4000 OUTPUT=scroll-lifetimes-webkit pnpm --filter @parapdf/prototype bench`

## synthetic-text-1000.pdf, 900 CSS px per second

| Variant | First paint (ms) | Pages crossed | Blank (%) | Blank frames (%) | Main thread blocked (ms) | Lag p95 / max (ms) | Dropped frames | React commits (per s) | Store updates (window / current page) | Renders base / detail / text / links / cancelled | Canvas memory (MiB) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pdfjs-hwa | 202 | 2 | 0.0 | 0.0 | 14 | 5.7 / 10 | 0 / 289 | 4 (1.0) | 4 (2 / 2) | 0 / 2 / 2 / 2 / 0 | 156 |
| pdfjs-hwa, before | 202 | 2 | 0.0 | 0.0 | 15 | 5.7 / 11 | 0 / 289 | 4 (1.0) | 4 (2 / 2) | 0 / 2 / 2 / 2 / 0 | 156 |

## synthetic-text-1000.pdf, 3600 CSS px per second

| Variant | First paint (ms) | Pages crossed | Blank (%) | Blank frames (%) | Main thread blocked (ms) | Lag p95 / max (ms) | Dropped frames | React commits (per s) | Store updates (window / current page) | Renders base / detail / text / links / cancelled | Canvas memory (MiB) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pdfjs-hwa | 203 | 9 | 0.0 | 0.0 | 23 | 5.8 / 9 | 3 / 288 | 24 (6.0) | 24 (15 / 9) | 9 / 0 / 0 / 0 / 0 | 111 |
| pdfjs-hwa, before | 203 | 9 | 0.0 | 0.0 | 22 | 5.8 / 10 | 1 / 289 | 24 (6.0) | 24 (15 / 9) | 9 / 0 / 0 / 0 / 0 | 111 |

## bill-hr815.pdf, 900 CSS px per second

| Variant | First paint (ms) | Pages crossed | Blank (%) | Blank frames (%) | Main thread blocked (ms) | Lag p95 / max (ms) | Dropped frames | React commits (per s) | Store updates (window / current page) | Renders base / detail / text / links / cancelled | Canvas memory (MiB) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pdfjs-hwa | 178 | 2 | 0.0 | 0.0 | 48 | 5.9 / 16 | 2 / 289 | 4 (1.0) | 4 (2 / 2) | 0 / 2 / 2 / 2 / 0 | 183 |
| pdfjs-hwa, before | 175 | 2 | 0.0 | 0.0 | 47 | 6.0 / 14 | 2 / 289 | 4 (1.0) | 4 (2 / 2) | 0 / 2 / 2 / 2 / 0 | 183 |

## bill-hr815.pdf, 3600 CSS px per second

| Variant | First paint (ms) | Pages crossed | Blank (%) | Blank frames (%) | Main thread blocked (ms) | Lag p95 / max (ms) | Dropped frames | React commits (per s) | Store updates (window / current page) | Renders base / detail / text / links / cancelled | Canvas memory (MiB) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pdfjs-hwa | 178 | 7 | 0.0 | 0.0 | 37 | 5.8 / 14 | 2 / 289 | 20 (5.0) | 20 (13 / 7) | 8 / 0 / 0 / 0 / 0 | 127 |
| pdfjs-hwa, before | 168 | 7 | 0.0 | 0.0 | 46 | 5.9 / 13 | 2 / 289 | 20 (5.0) | 20 (13 / 7) | 8 / 0 / 0 / 0 / 0 | 127 |

