# ParaPDF runtime prototype: scripted scroll, Chromium 159.0.8154.6

- Run at: 2026-11-20T03:51:56.662Z
- Machine: darwin 27.2.0 arm64, Apple M2 Pro (12 logical cores); Chromium 159.0.8154.6 (Playwright build, headless); power: AC; one-minute load average 6.4 at the start, 6.0 at the end; waited 0 times (0 min in all) for other Playwright browsers and repeated 0 jobs that another browser overlapped
- Idle baseline (calibrate.html, median of jobs): 4 ms timer late by 1.0 ms (median) / 1.4 ms (p95); animation frames every 16.7 ms.
- Method: 1280×900 viewport at devicePixelRatio 2, fit-width zoom, vertical scroll mode, 4000 ms of scrolling at a constant speed in CSS pixels per second after the first page is painted, sideways in horizontal mode and downward otherwise, median of 5 runs. Variants named "before" ran on 61725aa, each in turn with its twin, job by job.
- First paint: time from navigation start until page 1 shows pixels, the median of the runs. Each run's is listed under its table: a page shows on an animation frame, so the median moves by a whole frame when one run in a few changes frames.
- Blank: share of the viewport covered by pages without pixels, averaged over frames; blank frames: frames where more than 1% was blank.
- Main thread: summed lateness of a 4 ms timer while scrolling, beyond 2 ms or the idle page's 95th percentile, whichever is larger, plus the raw p95 and maximum lateness.
- Dropped frames: animation frames longer than 1.5 idle frame intervals.
- Canvas memory: the pixels of the canvases in the page and of those kept for pages that unmounted, at 4 bytes each, once the pages settled after scrolling.
- Versions: pdfjs-dist 6.5.438.
- React commits: commits of the viewer's React tree while scrolling, and per second. Store updates: how often the store published while scrolling, and how often that moved the mounted window and the current page, the changes that should make React commit.
- Reproduce: `DIST="$INTEGRATED_DIST" BEFORE="$BASELINE_DIST" BEFORE_LABEL=61725aa BROWSER=chromium VARIANTS=pdfjs-hwa FILES=synthetic-text-1000.pdf SPEEDS=3600 RUNS=5 OUTPUT=scroll-release-to-page-hosts-chromium pnpm --filter @parapdf/prototype bench`

## synthetic-text-1000.pdf, 3600 CSS px per second

| Variant | First paint (ms) | Pages crossed | Blank (%) | Blank frames (%) | Main thread blocked (ms) | Lag p95 / max (ms) | Dropped frames | React commits (per s) | Store updates (window / current page) | Renders base / detail / text / links / cancelled | Canvas memory (MiB) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pdfjs-hwa | 178 | 9 | 0.0 | 0.0 | 12 | 1.5 / 5 | 0 / 241 | 11 (2.7) | 24 (15 / 9) | 9 / 0 / 0 / 0 / 0 | 111 |
| pdfjs-hwa, before | 179 | 9 | 0.0 | 0.0 | 17 | 1.5 / 6 | 0 / 241 | 25 (6.2) | 24 (15 / 9) | 9 / 0 / 0 / 0 / 0 | 111 |

First paint of each run (ms):

- pdfjs-hwa: 178, 202, 164, 213, 161
- pdfjs-hwa, before: 183, 196, 179, 162, 163
