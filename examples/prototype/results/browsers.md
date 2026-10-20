# ParaPDF runtime prototype: scripted scroll across browsers

Each browser's full report: [Chromium 156.0.8078.4](chromium.md) (2026-10-20T07:15:54.383Z), [WebKit 27.2](webkit.md) (2026-10-20T07:19:30.348Z), [Firefox 157.0](firefox.md) (2026-10-20T07:24:03.064Z).

- Machine: darwin 27.0.0 arm64, Apple M2 Pro (12 logical cores)
- Browsers are Playwright's builds, headless. WebKit is not Safari and its results do not stand for Safari's.
- Chromium 156.0.8078.4: on an idle page a 4 ms timer fires 0.5 ms late (median) / 1.1 ms (p95); animation frames arrive every 16.7 ms.
- WebKit 27.2: on an idle page a 4 ms timer fires 3.9 ms late (median) / 4.9 ms (p95); animation frames arrive every 13.9 ms.
- Firefox 157.0: on an idle page a 4 ms timer fires 1.0 ms late (median) / 1.0 ms (p95); animation frames arrive every 16.7 ms.
- Method: the scroll benchmark's method in every browser, 4000 ms of scrolling, median of 2 runs. Main thread blocked counts timer lateness beyond 2 ms or the browser's idle 95th percentile, whichever is larger; compare it within a browser, and compare browsers by their longest stalls. Dropped frames are frames longer than 1.5 idle frame intervals.
- Cells: blank viewport (%) · main thread blocked (ms) · longest stall (ms) · dropped frames.

## synthetic-text-1000.pdf, 900 CSS px per second

| Variant | Chromium 156.0.8078.4 | WebKit 27.2 | Firefox 157.0 |
|---|---:|---:|---:|
| pdfjs | 0.0 · 25 · 11 · 0 | 0.0 · 2 · 6 · 7 | 0.0 · 72 · 16 · 1 |
| pdfjs-hwa | 0.0 · 9 · 8 · 0 | 0.0 · 1 · 5 · 0 | 0.0 · 50 · 14 · 0 |
| pdfjs-next | 0.0 · 25 · 16 · 1 | 0.0 · 3 · 5 · 7 | 0.0 · 17 · 8 · 0 |
| pdfjs-next-hwa | 0.0 · 1 · 2 · 0 | 0.0 · 2 · 6 · 0 | 0.0 · 23 · 12 · 0 |

## synthetic-text-1000.pdf, 3600 CSS px per second

| Variant | Chromium 156.0.8078.4 | WebKit 27.2 | Firefox 157.0 |
|---|---:|---:|---:|
| pdfjs | 0.0 · 17 · 8 · 0 | 0.0 · 6 · 7 · 8 | 0.0 · 46 · 13 · 0 |
| pdfjs-hwa | 0.0 · 29 · 8 · 0 | 0.0 · 4 · 7 · 0 | 0.0 · 55 · 13 · 0 |
| pdfjs-next | 0.0 · 1 · 3 · 1 | 0.0 · 3 · 6 · 10 | 0.0 · 15 · 7 · 0 |
| pdfjs-next-hwa | 0.0 · 0 · 2 · 0 | 0.0 · 3 · 5 · 0 | 0.0 · 15 · 10 · 0 |

## bill-hr815.pdf, 900 CSS px per second

| Variant | Chromium 156.0.8078.4 | WebKit 27.2 | Firefox 157.0 |
|---|---:|---:|---:|
| pdfjs | 0.0 · 28 · 11 · 0 | 0.0 · 11 · 10 · 7 | 0.0 · 32 · 16 · 0 |
| pdfjs-hwa | 0.0 · 10 · 9 · 0 | 0.0 · 11 · 8 · 0 | 0.0 · 31 · 15 · 1 |
| pdfjs-next | 0.0 · 32 · 18 · 1 | 0.0 · 16 · 11 · 7 | 0.0 · 61 · 20 · 0 |
| pdfjs-next-hwa | 0.0 · 7 · 7 · 0 | 0.0 · 8 · 9 · 0 | 0.0 · 84 · 17 · 0 |

## bill-hr815.pdf, 3600 CSS px per second

| Variant | Chromium 156.0.8078.4 | WebKit 27.2 | Firefox 157.0 |
|---|---:|---:|---:|
| pdfjs | 0.0 · 10 · 5 · 0 | 0.0 · 2 · 5 · 10 | 0.0 · 44 · 17 · 0 |
| pdfjs-hwa | 0.0 · 9 · 6 · 1 | 0.0 · 7 · 8 · 0 | 0.0 · 47 · 15 · 0 |
| pdfjs-next | 0.0 · 3 · 4 · 0 | 0.0 · 8 · 8 · 12 | 0.0 · 21 · 10 · 0 |
| pdfjs-next-hwa | 0.0 · 2 · 3 · 0 | 0.0 · 2 · 6 · 0 | 0.0 · 25 · 11 · 0 |

## First paint (ms)

Time from navigation start until page 1 shows pixels, median over both scroll speeds' runs.

| File · variant | Chromium 156.0.8078.4 | WebKit 27.2 | Firefox 157.0 |
|---|---:|---:|---:|
| synthetic-text-1000.pdf · pdfjs | 174 | 185 | 367 |
| synthetic-text-1000.pdf · pdfjs-hwa | 180 | 237 | 268 |
| synthetic-text-1000.pdf · pdfjs-next | 257 | 315 | 325 |
| synthetic-text-1000.pdf · pdfjs-next-hwa | 243 | 256 | 340 |
| bill-hr815.pdf · pdfjs | 153 | 229 | 217 |
| bill-hr815.pdf · pdfjs-hwa | 142 | 171 | 219 |
| bill-hr815.pdf · pdfjs-next | 219 | 250 | 274 |
| bill-hr815.pdf · pdfjs-next-hwa | 204 | 241 | 276 |

## React commits while scrolling

Commits depend on the pages crossed, not on the browser; a browser that commits more is rendering React in the hot path.

| File · speed | Chromium 156.0.8078.4 | WebKit 27.2 | Firefox 157.0 |
|---|---:|---:|---:|
| synthetic-text-1000.pdf · 900 px/s (pdfjs) | 4 | 4 | 4 |
| synthetic-text-1000.pdf · 3600 px/s (pdfjs) | 24 | 24 | 24 |
| bill-hr815.pdf · 900 px/s (pdfjs) | 4 | 4 | 4 |
| bill-hr815.pdf · 3600 px/s (pdfjs) | 20 | 20 | 20 |

