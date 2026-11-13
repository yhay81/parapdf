# ParaPDF runtime prototype: scripted scroll, WebKit 27.2

- Run at: 2026-11-13T19:29:42.171Z
- Machine: darwin 27.2.0 arm64, Apple M2 Pro (12 logical cores); WebKit 27.2 (Playwright build, headless); power: AC; one-minute load average 3.0 at the start, 4.1 at the end; waited 0 times (0 min in all) for other Playwright browsers or a load average above 8 and repeated 0 jobs that another browser overlapped
- Idle baseline (calibrate.html, median of jobs): 4 ms timer late by 3.8 ms (median) / 5.6 ms (p95); animation frames every 13.9 ms.
- Method: 1280×900 viewport at devicePixelRatio 2, fit-width zoom, vertical scroll mode, 4000 ms of scrolling at a constant speed in CSS pixels per second after the first page is painted, sideways in horizontal mode and downward otherwise, median of 5 runs. Variants named "before" ran on main c1bd374, each in turn with its twin, job by job.
- First paint: time from navigation start until page 1 shows pixels, the median of the runs. Each run's is listed under its table: a page shows on an animation frame, so the median moves by a whole frame when one run in a few changes frames.
- Blank: share of the viewport covered by pages without pixels, averaged over frames; blank frames: frames where more than 1% was blank.
- Main thread: summed lateness of a 4 ms timer while scrolling, beyond 2 ms or the idle page's 95th percentile, whichever is larger, plus the raw p95 and maximum lateness.
- Dropped frames: animation frames longer than 1.5 idle frame intervals.
- Canvas memory: the pixels of the canvases in the page and of those kept for pages that unmounted, at 4 bytes each, once the pages settled after scrolling.
- Versions: pdfjs-dist 6.5.438.
- React commits: commits of the viewer's React tree while scrolling, and per second. Store updates: how often the store published while scrolling, and how often that moved the mounted window and the current page, the changes that should make React commit.
- Reproduce: `pnpm --filter @parapdf/prototype build && BROWSER=webkit VARIANTS=pdfjs-hwa FILES=synthetic-text-1000.pdf,bill-hr815.pdf SPEEDS=900,3600 RUNS=5 DURATION=4000 MAX_LOAD=8 OUTPUT=scroll-isolated-commits-webkit pnpm --filter @parapdf/prototype bench`

## synthetic-text-1000.pdf, 900 CSS px per second

| Variant | First paint (ms) | Pages crossed | Blank (%) | Blank frames (%) | Main thread blocked (ms) | Lag p95 / max (ms) | Dropped frames | React commits (per s) | Store updates (window / current page) | Renders base / detail / text / links / cancelled | Canvas memory (MiB) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pdfjs-hwa | 173 | 2 | 0.0 | 0.0 | 3 | 5.6 / 6 | 0 / 289 | 4 (1.0) | 4 (2 / 2) | 0 / 2 / 2 / 2 / 0 | 156 |
| pdfjs-hwa, before | 172 | 2 | 0.0 | 0.0 | 2 | 5.5 / 6 | 0 / 289 | 4 (1.0) | 4 (2 / 2) | 0 / 2 / 2 / 2 / 0 | 156 |

First paint of each run (ms):

- pdfjs-hwa: 172, 172, 181, 173, 174
- pdfjs-hwa, before: 180, 174, 172, 170, 170

## synthetic-text-1000.pdf, 3600 CSS px per second

| Variant | First paint (ms) | Pages crossed | Blank (%) | Blank frames (%) | Main thread blocked (ms) | Lag p95 / max (ms) | Dropped frames | React commits (per s) | Store updates (window / current page) | Renders base / detail / text / links / cancelled | Canvas memory (MiB) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pdfjs-hwa | 173 | 9 | 0.0 | 0.0 | 3 | 5.6 / 6 | 0 / 289 | 25 (6.2) | 24 (15 / 9) | 9 / 0 / 0 / 0 / 0 | 111 |
| pdfjs-hwa, before | 171 | 9 | 0.0 | 0.0 | 2 | 5.6 / 6 | 0 / 289 | 25 (6.2) | 24 (15 / 9) | 9 / 0 / 0 / 0 / 0 | 111 |

First paint of each run (ms):

- pdfjs-hwa: 182, 182, 171, 172, 173
- pdfjs-hwa, before: 169, 175, 174, 171, 169

## bill-hr815.pdf, 900 CSS px per second

| Variant | First paint (ms) | Pages crossed | Blank (%) | Blank frames (%) | Main thread blocked (ms) | Lag p95 / max (ms) | Dropped frames | React commits (per s) | Store updates (window / current page) | Renders base / detail / text / links / cancelled | Canvas memory (MiB) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pdfjs-hwa | 143 | 2 | 0.0 | 0.0 | 9 | 5.7 / 9 | 0 / 289 | 4 (1.0) | 4 (2 / 2) | 0 / 2 / 2 / 2 / 0 | 183 |
| pdfjs-hwa, before | 144 | 2 | 0.0 | 0.0 | 14 | 5.6 / 10 | 0 / 289 | 4 (1.0) | 4 (2 / 2) | 0 / 2 / 2 / 2 / 0 | 183 |

First paint of each run (ms):

- pdfjs-hwa: 145, 142, 141, 143, 143
- pdfjs-hwa, before: 157, 144, 157, 143, 143

## bill-hr815.pdf, 3600 CSS px per second

| Variant | First paint (ms) | Pages crossed | Blank (%) | Blank frames (%) | Main thread blocked (ms) | Lag p95 / max (ms) | Dropped frames | React commits (per s) | Store updates (window / current page) | Renders base / detail / text / links / cancelled | Canvas memory (MiB) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pdfjs-hwa | 144 | 7 | 0.0 | 0.0 | 4 | 5.7 / 6 | 0 / 289 | 21 (5.2) | 20 (13 / 7) | 8 / 0 / 0 / 0 / 0 | 127 |
| pdfjs-hwa, before | 145 | 7 | 0.0 | 0.0 | 11 | 5.7 / 7 | 0 / 289 | 21 (5.2) | 20 (13 / 7) | 8 / 0 / 0 / 0 / 0 | 127 |

First paint of each run (ms):

- pdfjs-hwa: 144, 143, 157, 144, 143
- pdfjs-hwa, before: 143, 145, 157, 158, 142

