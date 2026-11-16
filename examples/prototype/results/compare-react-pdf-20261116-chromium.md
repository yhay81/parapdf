# ParaPDF runtime prototype: scripted scroll, Chromium 158.0.8127.18

Measured source: [`b1a6aa3aee58`](https://github.com/yhay81/parapdf/commit/b1a6aa3aee5874b70ef26cc4cab80359e68a41b5), ParaPDF 0.9.0. See [scope and limitations](compare-react-pdf-20261116.md).

- Diagnostic recording: enabled; no console, page-error, or failed-request events were recorded.
- Run at: 2026-11-16T06:08:57.910Z
- Machine: darwin 27.2.0 arm64, Apple M2 Pro (12 logical cores); Chromium 158.0.8127.18 (Playwright build, headless); power: AC; one-minute load average 2.1 at the start, 5.9 at the end; waited 0 times (0 min in all) for other Playwright browsers or a load average above 10 and repeated 0 jobs that another browser overlapped
- Idle baseline (calibrate.html, median of jobs): 4 ms timer late by 1.0 ms (median) / 1.4 ms (p95); animation frames every 16.7 ms.
- Method: 1280×900 viewport at devicePixelRatio 2, fit-width zoom, vertical scroll mode, 4000 ms of scrolling at a constant speed in CSS pixels per second after the first page is painted, sideways in horizontal mode and downward otherwise, median of 5 runs.
- First paint: time from navigation start until page 1 shows pixels, the median of the runs. Each run's is listed under its table: a page shows on an animation frame, so the median moves by a whole frame when one run in a few changes frames.
- Blank: share of the viewport covered by pages without pixels, averaged over frames; blank frames: frames where more than 1% was blank.
- Main thread: summed lateness of a 4 ms timer while scrolling, beyond 2 ms or the idle page's 95th percentile, whichever is larger, plus the raw p95 and maximum lateness.
- Dropped frames: animation frames longer than 1.5 idle frame intervals.
- Canvas memory: the pixels of the canvases in the page and of those kept for pages that unmounted, at 4 bytes each, after scrolling and waiting for visible pages to have pixels; this does not wait for full-resolution refinement or all DOM layers.
- Versions: pdfjs-dist 6.5.438; react-pdf 11.0.0 (on pdfjs-dist 6.3.289) and react-window 2.5.3, in compare.html, which sizes every page as the first.
- React commits: commits of the viewer's React tree while scrolling, and per second. Store updates: how often the store published while scrolling, and how often that moved the mounted window and the current page, the changes that should make React commit.
- Reproduce: `pnpm --filter @parapdf/prototype build && BROWSER=chromium DIAGNOSTICS=/tmp/parapdf-comparison-chromium VARIANTS=pdfjs-hwa,react-pdf-window TEXT=1 LINKS=1 SCROLL=vertical SCALE=fit-width FILES=synthetic-text-1000.pdf,bill-hr815.pdf SPEEDS=900,3600 RUNS=5 DURATION=4000 MAX_LOAD=10 OUTPUT=compare-react-pdf-20261116-chromium pnpm --filter @parapdf/prototype bench`

## synthetic-text-1000.pdf, 900 CSS px per second

| Variant | First paint (ms) | Pages crossed | Blank (%) | Blank frames (%) | Main thread blocked (ms) | Lag p95 / max (ms) | Dropped frames | React commits (per s) | Store updates (window / current page) | Renders base / detail / text / links / cancelled | Canvas memory (MiB) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pdfjs-hwa, vertical, fit-width | 180 | 2 | 0.0 | 0.0 | 10 | 1.5 / 8 | 0 / 241 | 4 (1.0) | 4 (2 / 2) | 0 / 2 / 2 / 2 / 0 | 156 |
| react-pdf-window, vertical, fit-width | 200 | 2 | 0.0 | 0.0 | 10 | 1.5 / 8 | 0 / 241 | 10 (2.5) | — (— / —) | 2 / 0 / 2 / 2 / 0 | 187 |

First paint of each run (ms):

- pdfjs-hwa, vertical, fit-width: 181, 180, 182, 160, 162
- react-pdf-window, vertical, fit-width: 202, 200, 200, 196, 178

## synthetic-text-1000.pdf, 3600 CSS px per second

| Variant | First paint (ms) | Pages crossed | Blank (%) | Blank frames (%) | Main thread blocked (ms) | Lag p95 / max (ms) | Dropped frames | React commits (per s) | Store updates (window / current page) | Renders base / detail / text / links / cancelled | Canvas memory (MiB) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pdfjs-hwa, vertical, fit-width | 162 | 9 | 0.0 | 0.0 | 51 | 1.5 / 12 | 0 / 241 | 25 (6.2) | 24 (15 / 9) | 9 / 0 / 0 / 0 / 0 | 111 |
| react-pdf-window, vertical, fit-width | 180 | 9 | 0.0 | 0.0 | 17 | 1.5 / 6 | 0 / 241 | 43 (10.7) | — (— / —) | 9 / 0 / 9 / 9 / 0 | 249 |

First paint of each run (ms):

- pdfjs-hwa, vertical, fit-width: 159, 162, 162, 159, 178
- react-pdf-window, vertical, fit-width: 229, 180, 179, 196, 180

## bill-hr815.pdf, 900 CSS px per second

| Variant | First paint (ms) | Pages crossed | Blank (%) | Blank frames (%) | Main thread blocked (ms) | Lag p95 / max (ms) | Dropped frames | React commits (per s) | Store updates (window / current page) | Renders base / detail / text / links / cancelled | Canvas memory (MiB) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pdfjs-hwa, vertical, fit-width | 141 | 2 | 0.0 | 0.0 | 11 | 1.5 / 7 | 0 / 241 | 4 (1.0) | 4 (2 / 2) | 0 / 2 / 2 / 2 / 0 | 183 |
| react-pdf-window, vertical, fit-width | 188 | 2 | 0.0 | 0.0 | 5 | 1.5 / 6 | 0 / 241 | 10 (2.5) | — (— / —) | 2 / 0 / 2 / 2 / 0 | 217 |

First paint of each run (ms):

- pdfjs-hwa, vertical, fit-width: 153, 138, 137, 160, 141
- react-pdf-window, vertical, fit-width: 184, 195, 210, 188, 183

## bill-hr815.pdf, 3600 CSS px per second

| Variant | First paint (ms) | Pages crossed | Blank (%) | Blank frames (%) | Main thread blocked (ms) | Lag p95 / max (ms) | Dropped frames | React commits (per s) | Store updates (window / current page) | Renders base / detail / text / links / cancelled | Canvas memory (MiB) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pdfjs-hwa, vertical, fit-width | 139 | 7 | 0.0 | 0.0 | 45 | 1.5 / 11 | 0 / 241 | 21 (5.2) | 20 (13 / 7) | 7 / 0 / 0 / 0 / 0 | 127 |
| react-pdf-window, vertical, fit-width | 193 | 7 | 0.0 | 0.0 | 38 | 1.5 / 9 | 0 / 241 | 46 (11.5) | — (— / —) | 7 / 0 / 8 / 8 / 0 | 289 |

First paint of each run (ms):

- pdfjs-hwa, vertical, fit-width: 139, 141, 138, 139, 139
- react-pdf-window, vertical, fit-width: 198, 183, 193, 193, 185
