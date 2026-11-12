# ParaPDF runtime prototype: scripted scroll, WebKit 27.2

- Run at: 2026-11-12T14:14:35.656Z
- Machine: darwin 27.2.0 arm64, Apple M2 Pro (12 logical cores); WebKit 27.2 (Playwright build, headless); power: AC; one-minute load average 3.9 at the start, 3.2 at the end; waited once (1 min in all) for other Playwright browsers and repeated 0 jobs that another browser overlapped
- Idle baseline (calibrate.html, median of jobs): 4 ms timer late by 3.8 ms (median) / 5.6 ms (p95); animation frames every 13.9 ms.
- Method: 1280×900 viewport at devicePixelRatio 2, fit-width zoom, vertical scroll mode, 1500 ms of scrolling at a constant speed in CSS pixels per second after the first page is painted, sideways in horizontal mode and downward otherwise, median of 3 runs. Variants named "before" ran on 6.4.299, each in turn with its twin, job by job.
- First paint: time from navigation start until page 1 shows pixels.
- Blank: share of the viewport covered by pages without pixels, averaged over frames; blank frames: frames where more than 1% was blank.
- Main thread: summed lateness of a 4 ms timer while scrolling, beyond 2 ms or the idle page's 95th percentile, whichever is larger, plus the raw p95 and maximum lateness.
- Dropped frames: animation frames longer than 1.5 idle frame intervals.
- Canvas memory: the pixels of the canvases in the page and of those kept for pages that unmounted, at 4 bytes each, once the pages settled after scrolling.
- Versions: pdfjs-dist 6.5.438.
- React commits: commits of the viewer's React tree while scrolling, and per second. Store updates: how often the store published while scrolling, and how often that moved the mounted window and the current page, the changes that should make React commit.
- Reproduce: `pnpm --filter @parapdf/prototype build && BROWSER=webkit VARIANTS=pdfjs-hwa FILES=bill-hr815.pdf,patent-us223898.pdf SPEEDS=1800 RUNS=3 DURATION=1500 OUTPUT=release65-webkit pnpm --filter @parapdf/prototype bench`

## bill-hr815.pdf, 1800 CSS px per second

| Variant | First paint (ms) | Pages crossed | Blank (%) | Blank frames (%) | Main thread blocked (ms) | Lag p95 / max (ms) | Dropped frames | React commits (per s) | Store updates (window / current page) | Renders base / detail / text / links / cancelled | Canvas memory (MiB) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pdfjs-hwa | 175 | 1 | 0.0 | 0.0 | 32 | 6.2 / 13 | 1 / 109 | 2 (1.3) | 2 (1 / 1) | 0 / 1 / 1 / 1 / 0 | 147 |
| pdfjs-hwa, before | 167 | 1 | 0.0 | 0.0 | 33 | 5.9 / 17 | 1 / 109 | 2 (1.3) | 2 (1 / 1) | 0 / 1 / 1 / 1 / 0 | 147 |

## patent-us223898.pdf, 1800 CSS px per second

| Variant | First paint (ms) | Pages crossed | Blank (%) | Blank frames (%) | Main thread blocked (ms) | Lag p95 / max (ms) | Dropped frames | React commits (per s) | Store updates (window / current page) | Renders base / detail / text / links / cancelled | Canvas memory (MiB) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pdfjs-hwa | 214 | 1 | 0.0 | 0.0 | 15 | 6.0 / 10 | 1 / 109 | 2 (1.3) | 2 (1 / 1) | 0 / 1 / 1 / 1 / 0 | 144 |
| pdfjs-hwa, before | 218 | 1 | 0.0 | 0.0 | 10 | 5.9 / 10 | 1 / 109 | 2 (1.3) | 2 (1 / 1) | 0 / 1 / 1 / 1 / 0 | 144 |

