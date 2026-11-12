# ParaPDF runtime prototype: scripted scroll, WebKit 27.2

- Run at: 2026-11-12T19:24:14.717Z
- Machine: darwin 27.2.0 arm64, Apple M2 Pro (12 logical cores); WebKit 27.2 (Playwright build, headless); power: AC; one-minute load average 3.9 at the start, 4.3 at the end; waited 0 times (0 min in all) for other Playwright browsers and repeated 0 jobs that another browser overlapped
- Idle baseline (calibrate.html, median of jobs): 4 ms timer late by 3.8 ms (median) / 5.7 ms (p95); animation frames every 13.9 ms.
- Method: 1280×900 viewport at devicePixelRatio 2, fit-width zoom, vertical scroll mode, 200 ms of scrolling at a constant speed in CSS pixels per second after the first page is painted, sideways in horizontal mode and downward otherwise, median of 30 runs. Variants named "before" ran on main ce61e6e, each in turn with its twin, job by job.
- First paint: time from navigation start until page 1 shows pixels, the median of the runs. Each run's is listed under its table: a page shows on an animation frame, so the median moves by a whole frame when one run in a few changes frames.
- Blank: share of the viewport covered by pages without pixels, averaged over frames; blank frames: frames where more than 1% was blank.
- Main thread: summed lateness of a 4 ms timer while scrolling, beyond 2 ms or the idle page's 95th percentile, whichever is larger, plus the raw p95 and maximum lateness.
- Dropped frames: animation frames longer than 1.5 idle frame intervals.
- Canvas memory: the pixels of the canvases in the page and of those kept for pages that unmounted, at 4 bytes each, once the pages settled after scrolling.
- Versions: pdfjs-dist 6.5.438.
- React commits: commits of the viewer's React tree while scrolling, and per second. Store updates: how often the store published while scrolling, and how often that moved the mounted window and the current page, the changes that should make React commit.
- Reproduce: `pnpm --filter @parapdf/prototype build && BROWSER=webkit VARIANTS=pdfjs-hwa FILES=bill-hr815.pdf SPEEDS=900 RUNS=30 DURATION=200 OUTPUT=first-paint-lifetimes-webkit pnpm --filter @parapdf/prototype bench`

## bill-hr815.pdf, 900 CSS px per second

| Variant | First paint (ms) | Pages crossed | Blank (%) | Blank frames (%) | Main thread blocked (ms) | Lag p95 / max (ms) | Dropped frames | React commits (per s) | Store updates (window / current page) | Renders base / detail / text / links / cancelled | Canvas memory (MiB) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pdfjs-hwa | 174 | 0 | 0.0 | 0.0 | 0 | 5.5 / 6 | 0 / 15 | 0 (0.0) | 0 (0 / 0) | 0 / 0 / 0 / 0 / 0 | 111 |
| pdfjs-hwa, before | 176 | 0 | 0.0 | 0.0 | 1 | 5.6 / 6 | 0 / 15 | 0 (0.0) | 0 (0 / 0) | 0 / 0 / 0 / 0 / 0 | 111 |

First paint of each run (ms):

- pdfjs-hwa: 180, 181, 179, 166, 179, 167, 167, 177, 181, 176, 157, 178, 180, 177, 171, 169, 214, 167, 166, 164, 168, 177, 163, 167, 177, 178, 178, 166, 168, 167
- pdfjs-hwa, before: 194, 175, 181, 165, 166, 176, 180, 168, 165, 176, 179, 178, 184, 175, 178, 178, 198, 176, 176, 151, 164, 165, 183, 167, 181, 162, 179, 166, 178, 166

