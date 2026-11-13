# ParaPDF runtime prototype: scripted scroll, WebKit 27.2

- Run at: 2026-11-12T23:34:54.067Z
- Machine: darwin 27.2.0 arm64, Apple M2 Pro (12 logical cores); WebKit 27.2 (Playwright build, headless); power: AC; one-minute load average 6.5 at the start, 4.9 at the end; waited 0 times (0 min in all) for other Playwright browsers and repeated 0 jobs that another browser overlapped
- Idle baseline (calibrate.html, median of jobs): 4 ms timer late by 3.9 ms (median) / 4.9 ms (p95); animation frames every 13.9 ms.
- Method: 1280×900 viewport at devicePixelRatio 2, fit-width zoom, vertical scroll mode, 2000 ms of scrolling at a constant speed in CSS pixels per second after the first page is painted, sideways in horizontal mode and downward otherwise, median of 5 runs. Variants named "before" ran on before lifetime review fixes, each in turn with its twin, job by job.
- First paint: time from navigation start until page 1 shows pixels, the median of the runs. Each run's is listed under its table: a page shows on an animation frame, so the median moves by a whole frame when one run in a few changes frames.
- Blank: share of the viewport covered by pages without pixels, averaged over frames; blank frames: frames where more than 1% was blank.
- Main thread: summed lateness of a 4 ms timer while scrolling, beyond 2 ms or the idle page's 95th percentile, whichever is larger, plus the raw p95 and maximum lateness.
- Dropped frames: animation frames longer than 1.5 idle frame intervals.
- Canvas memory: the pixels of the canvases in the page and of those kept for pages that unmounted, at 4 bytes each, once the pages settled after scrolling.
- Versions: pdfjs-dist 6.5.438.
- React commits: commits of the viewer's React tree while scrolling, and per second. Store updates: how often the store published while scrolling, and how often that moved the mounted window and the current page, the changes that should make React commit.
- Reproduce: `pnpm --filter @parapdf/prototype build && BROWSER=webkit VARIANTS=pdfjs-hwa FILES=bill-hr815.pdf SPEEDS=3600 RUNS=5 DURATION=2000 OUTPUT=lifetimes-review-webkit pnpm --filter @parapdf/prototype bench`

## bill-hr815.pdf, 3600 CSS px per second

| Variant | First paint (ms) | Pages crossed | Blank (%) | Blank frames (%) | Main thread blocked (ms) | Lag p95 / max (ms) | Dropped frames | React commits (per s) | Store updates (window / current page) | Renders base / detail / text / links / cancelled | Canvas memory (MiB) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pdfjs-hwa | 165 | 4 | 0.0 | 0.0 | 22 | 5.0 / 11 | 1 / 145 | 9 (4.5) | 9 (5 / 4) | 4 / 0 / 0 / 0 / 0 | 118 |
| pdfjs-hwa, before | 178 | 4 | 0.0 | 0.0 | 37 | 5.6 / 10 | 1 / 145 | 9 (4.5) | 9 (5 / 4) | 4 / 0 / 0 / 0 / 0 | 118 |

First paint of each run (ms):

- pdfjs-hwa: 165, 178, 156, 164, 166
- pdfjs-hwa, before: 171, 178, 171, 185, 184

