# ParaPDF runtime prototype: scripted scroll across browsers

Each browser's full report: [Chromium 156.0.8078.4](chromium.md) (2026-10-18T12:18:06.229Z), [WebKit 27.2](webkit.md) (2026-10-18T12:25:05.036Z), [Firefox 157.0](firefox.md) (2026-10-19T07:18:26.181Z).

- Machine: darwin 27.0.0 arm64, Apple M2 Pro (12 logical cores)
- Browsers are Playwright's builds, headless. WebKit is not Safari and its results do not stand for Safari's.
- Chromium 156.0.8078.4: on an idle page a 4 ms timer fires 1.0 ms late (median) / 1.4 ms (p95); animation frames arrive every 16.7 ms.
- WebKit 27.2: on an idle page a 4 ms timer fires 4.0 ms late (median) / 5.6 ms (p95); animation frames arrive every 16.7 ms.
- Firefox 157.0: on an idle page a 4 ms timer fires 1.0 ms late (median) / 1.1 ms (p95); animation frames arrive every 16.7 ms.
- Method: the scroll benchmark's method in every browser, 4000 ms of scrolling, median of 2 runs. Main thread blocked counts timer lateness beyond 2 ms or the browser's idle 95th percentile, whichever is larger; compare it within a browser, and compare browsers by their longest stalls. Dropped frames are frames longer than 1.5 idle frame intervals.
- Cells: blank viewport (%) · main thread blocked (ms) · longest stall (ms) · dropped frames.

## synthetic-text-1000.pdf, 900 CSS px per second

| Variant | Chromium 156.0.8078.4 | WebKit 27.2 | Firefox 157.0 |
|---|---:|---:|---:|
| pdfjs | 0.0 · 50 · 27 · 0 | 0.0 · 10 · 9 · 7 | 0.0 · 46 · 19 · 0 |
| pdfjs, no text | 0.0 · 56 · 35 · 0 | 0.0 · 6 · 8 · 7 | 0.0 · 57 · 11 · 0 |
| pdfjs-hwa | 0.0 · 14 · 9 · 0 | 0.0 · 9 · 9 · 0 | 0.0 · 89 · 16 · 0 |
| pdfjs-hwa, no text | 0.0 · 23 · 11 · 0 | 0.0 · 5 · 7 · 0 | 0.0 · 35 · 14 · 0 |
| pdfjs-next | 0.0 · 21 · 13 · 0 | 0.0 · 8 · 8 · 7 | 0.0 · 49 · 17 · 0 |
| pdfjs-next, no text | 0.0 · 19 · 12 · 0 | 0.0 · 4 · 7 · 7 | 0.0 · 35 · 16 · 0 |
| pdfjs-next-hwa | 0.0 · 3 · 4 · 0 | 0.0 · 20 · 8 · 0 | 0.0 · 41 · 15 · 0 |
| pdfjs-next-hwa, no text | 0.0 · 2 · 4 · 1 | 0.0 · 10 · 9 · 0 | 0.0 · 37 · 13 · 0 |

## synthetic-text-1000.pdf, 3600 CSS px per second

| Variant | Chromium 156.0.8078.4 | WebKit 27.2 | Firefox 157.0 |
|---|---:|---:|---:|
| pdfjs | 0.0 · 54 · 10 · 0 | 0.0 · 20 · 9 · 10 | 0.0 · 40 · 7 · 0 |
| pdfjs, no text | 0.0 · 64 · 11 · 0 | 0.0 · 15 · 8 · 10 | 0.0 · 89 · 21 · 1 |
| pdfjs-hwa | 0.0 · 68 · 11 · 0 | 0.0 · 20 · 10 · 0 | 0.0 · 29 · 8 · 0 |
| pdfjs-hwa, no text | 0.0 · 53 · 11 · 0 | 0.0 · 10 · 10 · 0 | 0.0 · 31 · 9 · 0 |
| pdfjs-next | 0.0 · 7 · 4 · 0 | 0.0 · 8 · 8 · 9 | 0.0 · 13 · 7 · 0 |
| pdfjs-next, no text | 0.0 · 7 · 5 · 0 | 0.0 · 5 · 7 · 9 | 0.0 · 16 · 8 · 0 |
| pdfjs-next-hwa | 0.0 · 4 · 3 · 1 | 0.0 · 5 · 7 · 0 | 0.0 · 24 · 10 · 0 |
| pdfjs-next-hwa, no text | 0.0 · 2 · 3 · 0 | 0.0 · 6 · 8 · 0 | 0.0 · 51 · 8 · 1 |

## bill-hr815.pdf, 900 CSS px per second

| Variant | Chromium 156.0.8078.4 | WebKit 27.2 | Firefox 157.0 |
|---|---:|---:|---:|
| pdfjs | 0.0 · 71 · 35 · 1 | 0.0 · 29 · 12 · 7 | 0.0 · 60 · 21 · 1 |
| pdfjs, no text | 0.0 · 58 · 32 · 0 | 0.0 · 5 · 8 · 7 | 0.0 · 27 · 12 · 0 |
| pdfjs-hwa | 0.0 · 19 · 8 · 0 | 0.0 · 38 · 11 · 0 | 0.0 · 113 · 37 · 1 |
| pdfjs-hwa, no text | 0.0 · 12 · 8 · 0 | 0.0 · 5 · 6 · 0 | 0.0 · 41 · 12 · 0 |
| pdfjs-next | 0.0 · 44 · 17 · 0 | 0.0 · 30 · 11 · 7 | 0.0 · 109 · 20 · 0 |
| pdfjs-next, no text | 0.0 · 27 · 15 · 0 | 0.0 · 8 · 6 · 7 | 0.0 · 39 · 14 · 0 |
| pdfjs-next-hwa | 0.0 · 18 · 9 · 0 | 0.0 · 40 · 14 · 1 | 0.0 · 49 · 16 · 0 |
| pdfjs-next-hwa, no text | 0.0 · 1 · 3 · 1 | 0.0 · 9 · 7 · 0 | 0.0 · 43 · 13 · 0 |

## bill-hr815.pdf, 3600 CSS px per second

| Variant | Chromium 156.0.8078.4 | WebKit 27.2 | Firefox 157.0 |
|---|---:|---:|---:|
| pdfjs | 0.0 · 65 · 10 · 0 | 0.0 · 15 · 9 · 12 | 0.0 · 44 · 19 · 0 |
| pdfjs, no text | 0.0 · 39 · 8 · 0 | 0.0 · 4 · 7 · 10 | 0.0 · 19 · 12 · 0 |
| pdfjs-hwa | 0.0 · 50 · 8 · 1 | 0.0 · 26 · 11 · 0 | 0.0 · 34 · 11 · 0 |
| pdfjs-hwa, no text | 0.0 · 39 · 9 · 0 | 0.0 · 19 · 8 · 0 | 0.0 · 57 · 12 · 1 |
| pdfjs-next | 0.0 · 13 · 6 · 0 | 0.0 · 10 · 12 · 11 | 0.0 · 152 · 84 · 1 |
| pdfjs-next, no text | 0.0 · 10 · 5 · 0 | 0.0 · 4 · 6 · 12 | 0.0 · 48 · 12 · 1 |
| pdfjs-next-hwa | 0.0 · 10 · 6 · 0 | 0.0 · 29 · 12 · 1 | 0.0 · 30 · 12 · 0 |
| pdfjs-next-hwa, no text | 0.0 · 5 · 4 · 1 | 0.0 · 10 · 7 · 0 | 0.0 · 277 · 31 · 7 |

## First paint (ms)

Time from navigation start until page 1 shows pixels, median over both scroll speeds' runs.

| File · variant | Chromium 156.0.8078.4 | WebKit 27.2 | Firefox 157.0 |
|---|---:|---:|---:|
| synthetic-text-1000.pdf · pdfjs | 434 | 453 | 489 |
| synthetic-text-1000.pdf · pdfjs, no text | 429 | 454 | 466 |
| synthetic-text-1000.pdf · pdfjs-hwa | 429 | 456 | 476 |
| synthetic-text-1000.pdf · pdfjs-hwa, no text | 437 | 439 | 464 |
| synthetic-text-1000.pdf · pdfjs-next | 431 | 451 | 468 |
| synthetic-text-1000.pdf · pdfjs-next, no text | 444 | 461 | 469 |
| synthetic-text-1000.pdf · pdfjs-next-hwa | 428 | 463 | 468 |
| synthetic-text-1000.pdf · pdfjs-next-hwa, no text | 430 | 447 | 494 |
| bill-hr815.pdf · pdfjs | 420 | 444 | 418 |
| bill-hr815.pdf · pdfjs, no text | 419 | 435 | 433 |
| bill-hr815.pdf · pdfjs-hwa | 404 | 422 | 427 |
| bill-hr815.pdf · pdfjs-hwa, no text | 415 | 408 | 414 |
| bill-hr815.pdf · pdfjs-next | 422 | 446 | 429 |
| bill-hr815.pdf · pdfjs-next, no text | 401 | 432 | 416 |
| bill-hr815.pdf · pdfjs-next-hwa | 413 | 445 | 429 |
| bill-hr815.pdf · pdfjs-next-hwa, no text | 416 | 439 | 411 |

## React commits while scrolling

Commits depend on the pages crossed, not on the browser; a browser that commits more is rendering React in the hot path.

| File · speed | Chromium 156.0.8078.4 | WebKit 27.2 | Firefox 157.0 |
|---|---:|---:|---:|
| synthetic-text-1000.pdf · 900 px/s (pdfjs) | 4 | 4 | 4 |
| synthetic-text-1000.pdf · 3600 px/s (pdfjs) | 24 | 24 | 24 |
| bill-hr815.pdf · 900 px/s (pdfjs) | 4 | 4 | 4 |
| bill-hr815.pdf · 3600 px/s (pdfjs) | 20 | 20 | 20 |

