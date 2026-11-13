# ParaPDF runtime prototype: scripted scroll, Firefox 159.0

- Run at: 2026-11-13T12:40:57.935Z
- Machine: darwin 27.2.0 arm64, Apple M2 Pro (12 logical cores); Firefox 159.0 (Playwright build, headless); power: AC; one-minute load average 4.3 at the start, 3.9 at the end; waited once (2 min in all) for other Playwright browsers or a load average above 8 and repeated 0 jobs that another browser overlapped
- Idle baseline (calibrate.html, median of jobs): 4 ms timer late by 0.0 ms (median) / 0.1 ms (p95); animation frames every 16.7 ms.
- Method: 1280×900 viewport at devicePixelRatio 2, fit-width zoom, vertical scroll mode, 4000 ms of scrolling at a constant speed in CSS pixels per second after the first page is painted, sideways in horizontal mode and downward otherwise, median of 5 runs. Variants named "before" ran on document-actions-and-react-surface df30037, each in turn with its twin, job by job.
- First paint: time from navigation start until page 1 shows pixels, the median of the runs. Each run's is listed under its table: a page shows on an animation frame, so the median moves by a whole frame when one run in a few changes frames.
- Blank: share of the viewport covered by pages without pixels, averaged over frames; blank frames: frames where more than 1% was blank.
- Main thread: summed lateness of a 4 ms timer while scrolling, beyond 2 ms or the idle page's 95th percentile, whichever is larger, plus the raw p95 and maximum lateness.
- Dropped frames: animation frames longer than 1.5 idle frame intervals.
- Canvas memory: the pixels of the canvases in the page and of those kept for pages that unmounted, at 4 bytes each, once the pages settled after scrolling.
- Versions: pdfjs-dist 6.5.438.
- React commits: commits of the viewer's React tree while scrolling, and per second. Store updates: how often the store published while scrolling, and how often that moved the mounted window and the current page, the changes that should make React commit.
- Reproduce: `pnpm --filter @parapdf/prototype build && BROWSER=firefox VARIANTS=pdfjs-hwa FILES=synthetic-text-1000.pdf,bill-hr815.pdf SPEEDS=900,3600 RUNS=5 DURATION=4000 MAX_LOAD=8 OUTPUT=scroll-overlays-firefox pnpm --filter @parapdf/prototype bench`

## synthetic-text-1000.pdf, 900 CSS px per second

| Variant | First paint (ms) | Pages crossed | Blank (%) | Blank frames (%) | Main thread blocked (ms) | Lag p95 / max (ms) | Dropped frames | React commits (per s) | Store updates (window / current page) | Renders base / detail / text / links / cancelled | Canvas memory (MiB) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pdfjs-hwa | 260 | 2 | 0.0 | 0.0 | 8 | 0.1 / 6 | 0 / 241 | 4 (1.0) | 4 (2 / 2) | 0 / 2 / 2 / 2 / 0 | 156 |
| pdfjs-hwa, before | 259 | 2 | 0.0 | 0.0 | 10 | 0.1 / 7 | 0 / 241 | 4 (1.0) | 4 (2 / 2) | 0 / 2 / 2 / 2 / 0 | 156 |

First paint of each run (ms):

- pdfjs-hwa: 260, 262, 245, 266, 247
- pdfjs-hwa, before: 245, 265, 262, 259, 256

## synthetic-text-1000.pdf, 3600 CSS px per second

| Variant | First paint (ms) | Pages crossed | Blank (%) | Blank frames (%) | Main thread blocked (ms) | Lag p95 / max (ms) | Dropped frames | React commits (per s) | Store updates (window / current page) | Renders base / detail / text / links / cancelled | Canvas memory (MiB) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pdfjs-hwa | 262 | 9 | 0.0 | 0.0 | 22 | 0.2 / 6 | 0 / 240 | 25 (6.2) | 24 (15 / 9) | 9 / 0 / 0 / 0 / 0 | 111 |
| pdfjs-hwa, before | 256 | 9 | 0.0 | 0.0 | 19 | 0.1 / 6 | 0 / 242 | 24 (6.0) | 24 (15 / 9) | 9 / 0 / 0 / 0 / 0 | 111 |

First paint of each run (ms):

- pdfjs-hwa: 265, 253, 261, 264, 262
- pdfjs-hwa, before: 248, 250, 256, 262, 262

## bill-hr815.pdf, 900 CSS px per second

| Variant | First paint (ms) | Pages crossed | Blank (%) | Blank frames (%) | Main thread blocked (ms) | Lag p95 / max (ms) | Dropped frames | React commits (per s) | Store updates (window / current page) | Renders base / detail / text / links / cancelled | Canvas memory (MiB) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pdfjs-hwa | 208 | 2 | 0.0 | 0.0 | 14 | 0.1 / 7 | 0 / 241 | 4 (1.0) | 4 (2 / 2) | 0 / 2 / 2 / 2 / 0 | 183 |
| pdfjs-hwa, before | 205 | 2 | 0.0 | 0.0 | 13 | 0.1 / 7 | 0 / 241 | 4 (1.0) | 4 (2 / 2) | 0 / 2 / 2 / 2 / 0 | 183 |

First paint of each run (ms):

- pdfjs-hwa: 208, 256, 441, 196, 203
- pdfjs-hwa, before: 196, 229, 201, 208, 205

## bill-hr815.pdf, 3600 CSS px per second

| Variant | First paint (ms) | Pages crossed | Blank (%) | Blank frames (%) | Main thread blocked (ms) | Lag p95 / max (ms) | Dropped frames | React commits (per s) | Store updates (window / current page) | Renders base / detail / text / links / cancelled | Canvas memory (MiB) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pdfjs-hwa | 226 | 7 | 0.0 | 0.0 | 13 | 0.1 / 6 | 0 / 241 | 21 (5.2) | 20 (13 / 7) | 7 / 0 / 0 / 0 / 0 | 127 |
| pdfjs-hwa, before | 207 | 7 | 0.0 | 0.0 | 27 | 0.2 / 9 | 0 / 241 | 20 (5.0) | 20 (13 / 7) | 7 / 0 / 0 / 0 / 0 | 127 |

First paint of each run (ms):

- pdfjs-hwa: 229, 194, 227, 226, 213
- pdfjs-hwa, before: 205, 205, 222, 226, 207

