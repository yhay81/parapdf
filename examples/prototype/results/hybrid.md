# ParaPDF hybrid engine across browsers

Each browser's full report: [Chromium 156.0.8078.4](hybrid-chromium.md) (2026-10-18T23:45:49.640Z), [WebKit 27.2](hybrid-webkit.md) (2026-10-19T00:04:03.266Z), [Firefox 157.0](hybrid-firefox.md) (2026-10-19T05:39:39.346Z). Medians of 5 runs at each of 900 and 3600 px/s, pooled; Playwright's WebKit is not Safari.

Firefox ran at devicePixelRatio 1: Playwright's Firefox ignores `deviceScaleFactor` on cross-origin-isolated pages, so its canvases hold a quarter of the pixels of the other two browsers'. Compare Firefox's two variants with each other, not Firefox with the other browsers.

## First paint (ms)

| File | Variant | Chromium 156.0.8078.4 | WebKit 27.2 | Firefox 157.0 |
|---|---|---:|---:|---:|
| bunka-kokugo-series-019-p4.pdf | pdfjs-next-hwa | 501 | 535 | 486 |
| bunka-kokugo-series-019-p4.pdf | hybrid-hwa | 403 | 411 | 403 |
| patent-us223898.pdf | pdfjs-next-hwa | 480 | 498 | 468 |
| patent-us223898.pdf | hybrid-hwa | 401 | 408 | 407 |
| wdl6812-manuscript.pdf | pdfjs-next-hwa | 442 | 477 | 429 |
| wdl6812-manuscript.pdf | hybrid-hwa | 418 | 425 | 419 |
| bill-hr815.pdf | pdfjs-next-hwa | 406 | 439 | 417 |
| bill-hr815.pdf | hybrid-hwa | 398 | 448 | 416 |

## Page 1 sharp (ms)

| File | Variant | Chromium 156.0.8078.4 | WebKit 27.2 | Firefox 157.0 |
|---|---|---:|---:|---:|
| bunka-kokugo-series-019-p4.pdf | pdfjs-next-hwa | 508 | 571 | 516 |
| bunka-kokugo-series-019-p4.pdf | hybrid-hwa | 461 | 469 | 434 |
| patent-us223898.pdf | pdfjs-next-hwa | 514 | 543 | 487 |
| patent-us223898.pdf | hybrid-hwa | 457 | 466 | 449 |
| wdl6812-manuscript.pdf | pdfjs-next-hwa | 457 | 523 | 452 |
| wdl6812-manuscript.pdf | hybrid-hwa | 504 | 514 | 488 |
| bill-hr815.pdf | pdfjs-next-hwa | 446 | 505 | 456 |
| bill-hr815.pdf | hybrid-hwa | 432 | 505 | 458 |

## Longest main-thread stall during startup (ms)

| File | Variant | Chromium 156.0.8078.4 | WebKit 27.2 | Firefox 157.0 |
|---|---|---:|---:|---:|
| bunka-kokugo-series-019-p4.pdf | pdfjs-next-hwa | 50.3 | 31.8 | 9.8 |
| bunka-kokugo-series-019-p4.pdf | hybrid-hwa | 6.5 | 13.9 | 6.5 |
| patent-us223898.pdf | pdfjs-next-hwa | 46.3 | 29.4 | 10.3 |
| patent-us223898.pdf | hybrid-hwa | 11.8 | 14.7 | 8.2 |
| wdl6812-manuscript.pdf | pdfjs-next-hwa | 14.9 | 16.1 | 7.9 |
| wdl6812-manuscript.pdf | hybrid-hwa | 7.5 | 14.2 | 6.7 |
| bill-hr815.pdf | pdfjs-next-hwa | 8.5 | 12.4 | 6.6 |
| bill-hr815.pdf | hybrid-hwa | 7.4 | 13.1 | 7.4 |

## Detail render per page, p50 (ms, engine)

| File | Variant | Chromium 156.0.8078.4 | WebKit 27.2 | Firefox 157.0 |
|---|---|---:|---:|---:|
| bunka-kokugo-series-019-p4.pdf | pdfjs-next-hwa | 13 (pdfjs) | 33 (pdfjs) | 27 (pdfjs) |
| bunka-kokugo-series-019-p4.pdf | hybrid-hwa | 58 (hayro) | 58 (hayro) | 30 (hayro) |
| patent-us223898.pdf | pdfjs-next-hwa | 13 (pdfjs) | 38 (pdfjs) | 18 (pdfjs) |
| patent-us223898.pdf | hybrid-hwa | 41 (hayro) | 34 (hayro) | 31 (hayro) |
| wdl6812-manuscript.pdf | pdfjs-next-hwa | 10 (pdfjs) | 49 (pdfjs) | 21 (pdfjs) |
| wdl6812-manuscript.pdf | hybrid-hwa | 87 (hayro) | 92 (hayro) | 69 (hayro) |
| bill-hr815.pdf | pdfjs-next-hwa | 20 (pdfjs) | 49 (pdfjs) | 27 (pdfjs) |
| bill-hr815.pdf | hybrid-hwa | 21 (pdfjs) | 51 (pdfjs) | 26 (pdfjs) |

## Base render per page, p50 (ms, engine)

| File | Variant | Chromium 156.0.8078.4 | WebKit 27.2 | Firefox 157.0 |
|---|---|---:|---:|---:|
| bunka-kokugo-series-019-p4.pdf | pdfjs-next-hwa | 148 (pdfjs) | 176 (pdfjs) | 139 (pdfjs) |
| bunka-kokugo-series-019-p4.pdf | hybrid-hwa | 53 (hayro) | 48 (hayro) | 57 (hayro) |
| patent-us223898.pdf | pdfjs-next-hwa | 72 (pdfjs) | 121 (pdfjs) | 73 (pdfjs) |
| patent-us223898.pdf | hybrid-hwa | 50 (hayro) | 46 (hayro) | 54 (hayro) |
| wdl6812-manuscript.pdf | pdfjs-next-hwa | 96 (pdfjs) | 114 (pdfjs) | 81 (pdfjs) |
| wdl6812-manuscript.pdf | hybrid-hwa | 70 (hayro) | 65 (hayro) | 66 (hayro) |
| bill-hr815.pdf | pdfjs-next-hwa | 23 (pdfjs) | 44 (pdfjs) | 25 (pdfjs) |
| bill-hr815.pdf | hybrid-hwa | 26 (pdfjs) | 41 (pdfjs) | 23 (pdfjs) |

## WebAssembly memory: classifier / hayro (MiB)

| File | Variant | Chromium 156.0.8078.4 | WebKit 27.2 | Firefox 157.0 |
|---|---|---:|---:|---:|
| bunka-kokugo-series-019-p4.pdf | pdfjs-next-hwa | — | — | — |
| bunka-kokugo-series-019-p4.pdf | hybrid-hwa | 1.3 / 102.9 | 1.3 / 102.9 | 1.3 / 34.8 |
| patent-us223898.pdf | pdfjs-next-hwa | — | — | — |
| patent-us223898.pdf | hybrid-hwa | 1.6 / 83.9 | 1.6 / 83.9 | 1.6 / 27.2 |
| wdl6812-manuscript.pdf | pdfjs-next-hwa | — | — | — |
| wdl6812-manuscript.pdf | hybrid-hwa | 1.4 / 51.3 | 1.4 / 51.3 | 1.4 / 28.5 |
| bill-hr815.pdf | pdfjs-next-hwa | — | — | — |
| bill-hr815.pdf | hybrid-hwa | 1.7 / 0.0 | 1.7 / 0.0 | 1.7 / 0.0 |

## Main thread while scrolling at 900 px/s: blocked / longest stall (ms)

| File | Variant | Chromium 156.0.8078.4 | WebKit 27.2 | Firefox 157.0 |
|---|---|---:|---:|---:|
| bunka-kokugo-series-019-p4.pdf | pdfjs-next-hwa | 0 / 1.5 | 1 / 5.9 | 0 / 1.4 |
| bunka-kokugo-series-019-p4.pdf | hybrid-hwa | 0 / 1.5 | 1 / 6.0 | 0 / 2.2 |
| patent-us223898.pdf | pdfjs-next-hwa | 26 / 27.8 | 28 / 15.4 | 27 / 11.4 |
| patent-us223898.pdf | hybrid-hwa | 5 / 6.0 | 27 / 11.7 | 19 / 6.8 |
| wdl6812-manuscript.pdf | pdfjs-next-hwa | 0 / 1.5 | 3 / 6.0 | 5 / 6.9 |
| wdl6812-manuscript.pdf | hybrid-hwa | 0 / 1.5 | 1 / 6.0 | 3 / 3.0 |
| bill-hr815.pdf | pdfjs-next-hwa | 2 / 3.2 | 26 / 13.1 | 33 / 8.1 |
| bill-hr815.pdf | hybrid-hwa | 7 / 6.3 | 29 / 12.2 | 26 / 8.7 |

## Main thread while scrolling at 3600 px/s: blocked / longest stall (ms)

| File | Variant | Chromium 156.0.8078.4 | WebKit 27.2 | Firefox 157.0 |
|---|---|---:|---:|---:|
| bunka-kokugo-series-019-p4.pdf | pdfjs-next-hwa | 0 / 1.3 | 0 / 5.9 | 0 / 1.3 |
| bunka-kokugo-series-019-p4.pdf | hybrid-hwa | 0 / 1.4 | 0 / 5.8 | 0 / 1.1 |
| patent-us223898.pdf | pdfjs-next-hwa | 12 / 13.6 | 14 / 13.4 | 12 / 7.2 |
| patent-us223898.pdf | hybrid-hwa | 1 / 2.6 | 4 / 8.0 | 15 / 5.5 |
| wdl6812-manuscript.pdf | pdfjs-next-hwa | 0 / 1.4 | 0 / 5.0 | 2 / 4.4 |
| wdl6812-manuscript.pdf | hybrid-hwa | 0 / 1.5 | 0 / 5.0 | 6 / 4.7 |
| bill-hr815.pdf | pdfjs-next-hwa | 3 / 5.0 | 6 / 7.1 | 20 / 8.1 |
| bill-hr815.pdf | hybrid-hwa | 1 / 3.0 | 8 / 8.4 | 10 / 8.0 |

