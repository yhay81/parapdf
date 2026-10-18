# ParaPDF runtime prototype: scripted scroll across browsers

Each browser's full report: [Chromium 156.0.8078.4](chromium.md) (2026-10-18T12:18:06.229Z), [WebKit 27.2](webkit.md) (2026-10-18T12:25:05.036Z), [Firefox 157.0](firefox.md) (2026-10-18T12:31:56.881Z).

- Machine: darwin 27.0.0 arm64, Apple M2 Pro (12 logical cores)
- Browsers are Playwright's builds, headless. WebKit is not Safari and its results do not stand for Safari's.
- Chromium 156.0.8078.4: on an idle page a 4 ms timer fires 1.0 ms late (median) / 1.4 ms (p95); animation frames arrive every 16.7 ms.
- WebKit 27.2: on an idle page a 4 ms timer fires 4.0 ms late (median) / 5.6 ms (p95); animation frames arrive every 16.7 ms.
- Firefox 157.0: on an idle page a 4 ms timer fires 2.0 ms late (median) / 2.3 ms (p95); animation frames arrive every 16.7 ms.
- Method: the scroll benchmark's method in every browser, 4000 ms of scrolling, median of 2 runs. Main thread blocked counts timer lateness beyond 2 ms or the browser's idle 95th percentile, whichever is larger; compare it within a browser, and compare browsers by their longest stalls. Dropped frames are frames longer than 1.5 idle frame intervals.
- Cells: blank viewport (%) · main thread blocked (ms) · longest stall (ms) · dropped frames.

## synthetic-text-1000.pdf, 900 CSS px per second

| Variant | Chromium 156.0.8078.4 | WebKit 27.2 | Firefox 157.0 |
|---|---:|---:|---:|
| pdfjs | 0.0 · 50 · 27 · 0 | 0.0 · 10 · 9 · 7 | 0.0 · 55 · 13 · 0 |
| pdfjs, no text | 0.0 · 56 · 35 · 0 | 0.0 · 6 · 8 · 7 | 0.0 · 63 · 12 · 0 |
| pdfjs-hwa | 0.0 · 14 · 9 · 0 | 0.0 · 9 · 9 · 0 | 0.0 · 56 · 13 · 0 |
| pdfjs-hwa, no text | 0.0 · 23 · 11 · 0 | 0.0 · 5 · 7 · 0 | 0.0 · 34 · 9 · 0 |
| pdfjs-next | 0.0 · 21 · 13 · 0 | 0.0 · 8 · 8 · 7 | 0.0 · 38 · 14 · 0 |
| pdfjs-next, no text | 0.0 · 19 · 12 · 0 | 0.0 · 4 · 7 · 7 | 0.0 · 51 · 14 · 0 |
| pdfjs-next-hwa | 0.0 · 3 · 4 · 0 | 0.0 · 20 · 8 · 0 | 0.0 · 47 · 9 · 0 |
| pdfjs-next-hwa, no text | 0.0 · 2 · 4 · 1 | 0.0 · 10 · 9 · 0 | 0.0 · 34 · 11 · 0 |

## synthetic-text-1000.pdf, 3600 CSS px per second

| Variant | Chromium 156.0.8078.4 | WebKit 27.2 | Firefox 157.0 |
|---|---:|---:|---:|
| pdfjs | 0.0 · 54 · 10 · 0 | 0.0 · 20 · 9 · 10 | 0.0 · 91 · 11 · 0 |
| pdfjs, no text | 0.0 · 64 · 11 · 0 | 0.0 · 15 · 8 · 10 | 0.0 · 80 · 11 · 0 |
| pdfjs-hwa | 0.0 · 68 · 11 · 0 | 0.0 · 20 · 10 · 0 | 0.0 · 96 · 10 · 0 |
| pdfjs-hwa, no text | 0.0 · 53 · 11 · 0 | 0.0 · 10 · 10 · 0 | 0.0 · 97 · 11 · 0 |
| pdfjs-next | 0.0 · 7 · 4 · 0 | 0.0 · 8 · 8 · 9 | 0.0 · 50 · 10 · 0 |
| pdfjs-next, no text | 0.0 · 7 · 5 · 0 | 0.0 · 5 · 7 · 9 | 0.0 · 34 · 9 · 0 |
| pdfjs-next-hwa | 0.0 · 4 · 3 · 1 | 0.0 · 5 · 7 · 0 | 0.0 · 40 · 8 · 0 |
| pdfjs-next-hwa, no text | 0.0 · 2 · 3 · 0 | 0.0 · 6 · 8 · 0 | 0.0 · 41 · 9 · 0 |

## bill-hr815.pdf, 900 CSS px per second

| Variant | Chromium 156.0.8078.4 | WebKit 27.2 | Firefox 157.0 |
|---|---:|---:|---:|
| pdfjs | 0.0 · 71 · 35 · 1 | 0.0 · 29 · 12 · 7 | 0.0 · 68 · 12 · 0 |
| pdfjs, no text | 0.0 · 58 · 32 · 0 | 0.0 · 5 · 8 · 7 | 0.0 · 55 · 12 · 0 |
| pdfjs-hwa | 0.0 · 19 · 8 · 0 | 0.0 · 38 · 11 · 0 | 0.0 · 50 · 11 · 0 |
| pdfjs-hwa, no text | 0.0 · 12 · 8 · 0 | 0.0 · 5 · 6 · 0 | 0.0 · 69 · 11 · 0 |
| pdfjs-next | 0.0 · 44 · 17 · 0 | 0.0 · 30 · 11 · 7 | 0.0 · 36 · 8 · 0 |
| pdfjs-next, no text | 0.0 · 27 · 15 · 0 | 0.0 · 8 · 6 · 7 | 0.0 · 25 · 7 · 0 |
| pdfjs-next-hwa | 0.0 · 18 · 9 · 0 | 0.0 · 40 · 14 · 1 | 0.0 · 51 · 11 · 0 |
| pdfjs-next-hwa, no text | 0.0 · 1 · 3 · 1 | 0.0 · 9 · 7 · 0 | 0.0 · 31 · 8 · 0 |

## bill-hr815.pdf, 3600 CSS px per second

| Variant | Chromium 156.0.8078.4 | WebKit 27.2 | Firefox 157.0 |
|---|---:|---:|---:|
| pdfjs | 0.0 · 65 · 10 · 0 | 0.0 · 15 · 9 · 12 | 0.0 · 77 · 9 · 0 |
| pdfjs, no text | 0.0 · 39 · 8 · 0 | 0.0 · 4 · 7 · 10 | 0.0 · 77 · 11 · 0 |
| pdfjs-hwa | 0.0 · 50 · 8 · 1 | 0.0 · 26 · 11 · 0 | 0.0 · 73 · 10 · 0 |
| pdfjs-hwa, no text | 0.0 · 39 · 9 · 0 | 0.0 · 19 · 8 · 0 | 0.0 · 79 · 11 · 0 |
| pdfjs-next | 0.0 · 13 · 6 · 0 | 0.0 · 10 · 12 · 11 | 0.0 · 61 · 8 · 0 |
| pdfjs-next, no text | 0.0 · 10 · 5 · 0 | 0.0 · 4 · 6 · 12 | 0.0 · 46 · 7 · 0 |
| pdfjs-next-hwa | 0.0 · 10 · 6 · 0 | 0.0 · 29 · 12 · 1 | 0.0 · 45 · 9 · 0 |
| pdfjs-next-hwa, no text | 0.0 · 5 · 4 · 1 | 0.0 · 10 · 7 · 0 | 0.0 · 50 · 9 · 0 |

## First paint (ms)

Time from navigation start until page 1 shows pixels, median over both scroll speeds' runs.

| File · variant | Chromium 156.0.8078.4 | WebKit 27.2 | Firefox 157.0 |
|---|---:|---:|---:|
| synthetic-text-1000.pdf · pdfjs | 434 | 453 | 465 |
| synthetic-text-1000.pdf · pdfjs, no text | 429 | 454 | 485 |
| synthetic-text-1000.pdf · pdfjs-hwa | 429 | 456 | 475 |
| synthetic-text-1000.pdf · pdfjs-hwa, no text | 437 | 439 | 487 |
| synthetic-text-1000.pdf · pdfjs-next | 431 | 451 | 477 |
| synthetic-text-1000.pdf · pdfjs-next, no text | 444 | 461 | 486 |
| synthetic-text-1000.pdf · pdfjs-next-hwa | 428 | 463 | 483 |
| synthetic-text-1000.pdf · pdfjs-next-hwa, no text | 430 | 447 | 478 |
| bill-hr815.pdf · pdfjs | 420 | 444 | 429 |
| bill-hr815.pdf · pdfjs, no text | 419 | 435 | 432 |
| bill-hr815.pdf · pdfjs-hwa | 404 | 422 | 441 |
| bill-hr815.pdf · pdfjs-hwa, no text | 415 | 408 | 422 |
| bill-hr815.pdf · pdfjs-next | 422 | 446 | 431 |
| bill-hr815.pdf · pdfjs-next, no text | 401 | 432 | 430 |
| bill-hr815.pdf · pdfjs-next-hwa | 413 | 445 | 435 |
| bill-hr815.pdf · pdfjs-next-hwa, no text | 416 | 439 | 425 |

## React commits while scrolling

Commits depend on the pages crossed, not on the browser; a browser that commits more is rendering React in the hot path.

| File · speed | Chromium 156.0.8078.4 | WebKit 27.2 | Firefox 157.0 |
|---|---:|---:|---:|
| synthetic-text-1000.pdf · 900 px/s (pdfjs) | 4 | 4 | 4 |
| synthetic-text-1000.pdf · 3600 px/s (pdfjs) | 24 | 24 | 24 |
| bill-hr815.pdf · 900 px/s (pdfjs) | 4 | 4 | 4 |
| bill-hr815.pdf · 3600 px/s (pdfjs) | 20 | 20 | 20 |

