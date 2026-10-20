# ParaPDF hybrid engine across browsers

Each browser's full report: [Chromium 156.0.8078.4](hybrid-chromium.md) (2026-10-18T23:45:49.640Z), [WebKit 27.2](hybrid-webkit.md) (2026-10-19T00:04:03.266Z), [Firefox 157.0](hybrid-firefox.md) (2026-10-19T06:45:26.327Z). Medians of 5 runs at each of 900 and 3600 px/s, pooled; Playwright's WebKit is not Safari.

## First paint (ms)

| File | Variant | Chromium 156.0.8078.4 | WebKit 27.2 | Firefox 157.0 |
|---|---|---:|---:|---:|
| bunka-kokugo-series-019-p4.pdf | pdfjs-next-hwa | 501 | 535 | 475 |
| bunka-kokugo-series-019-p4.pdf | hybrid-hwa | 403 | 411 | 414 |
| patent-us223898.pdf | pdfjs-next-hwa | 480 | 498 | 458 |
| patent-us223898.pdf | hybrid-hwa | 401 | 408 | 403 |
| wdl6812-manuscript.pdf | pdfjs-next-hwa | 442 | 477 | 440 |
| wdl6812-manuscript.pdf | hybrid-hwa | 418 | 425 | 428 |
| bill-hr815.pdf | pdfjs-next-hwa | 406 | 439 | 416 |
| bill-hr815.pdf | hybrid-hwa | 398 | 448 | 417 |

## Page 1 sharp (ms)

| File | Variant | Chromium 156.0.8078.4 | WebKit 27.2 | Firefox 157.0 |
|---|---|---:|---:|---:|
| bunka-kokugo-series-019-p4.pdf | pdfjs-next-hwa | 508 | 571 | 533 |
| bunka-kokugo-series-019-p4.pdf | hybrid-hwa | 461 | 469 | 494 |
| patent-us223898.pdf | pdfjs-next-hwa | 514 | 543 | 519 |
| patent-us223898.pdf | hybrid-hwa | 457 | 466 | 460 |
| wdl6812-manuscript.pdf | pdfjs-next-hwa | 457 | 523 | 514 |
| wdl6812-manuscript.pdf | hybrid-hwa | 504 | 514 | 531 |
| bill-hr815.pdf | pdfjs-next-hwa | 446 | 505 | 495 |
| bill-hr815.pdf | hybrid-hwa | 432 | 505 | 510 |

## Longest main-thread stall during startup (ms)

| File | Variant | Chromium 156.0.8078.4 | WebKit 27.2 | Firefox 157.0 |
|---|---|---:|---:|---:|
| bunka-kokugo-series-019-p4.pdf | pdfjs-next-hwa | 50.3 | 31.8 | 9.1 |
| bunka-kokugo-series-019-p4.pdf | hybrid-hwa | 6.5 | 13.9 | 12.8 |
| patent-us223898.pdf | pdfjs-next-hwa | 46.3 | 29.4 | 12.0 |
| patent-us223898.pdf | hybrid-hwa | 11.8 | 14.7 | 9.4 |
| wdl6812-manuscript.pdf | pdfjs-next-hwa | 14.9 | 16.1 | 9.1 |
| wdl6812-manuscript.pdf | hybrid-hwa | 7.5 | 14.2 | 9.0 |
| bill-hr815.pdf | pdfjs-next-hwa | 8.5 | 12.4 | 15.2 |
| bill-hr815.pdf | hybrid-hwa | 7.4 | 13.1 | 14.1 |

## Detail render per page, p50 (ms, engine)

| File | Variant | Chromium 156.0.8078.4 | WebKit 27.2 | Firefox 157.0 |
|---|---|---:|---:|---:|
| bunka-kokugo-series-019-p4.pdf | pdfjs-next-hwa | 13 (pdfjs) | 33 (pdfjs) | 48 (pdfjs) |
| bunka-kokugo-series-019-p4.pdf | hybrid-hwa | 58 (hayro) | 58 (hayro) | 81 (hayro) |
| patent-us223898.pdf | pdfjs-next-hwa | 13 (pdfjs) | 38 (pdfjs) | 63 (pdfjs) |
| patent-us223898.pdf | hybrid-hwa | 41 (hayro) | 34 (hayro) | 39 (hayro) |
| wdl6812-manuscript.pdf | pdfjs-next-hwa | 10 (pdfjs) | 49 (pdfjs) | 73 (pdfjs) |
| wdl6812-manuscript.pdf | hybrid-hwa | 87 (hayro) | 92 (hayro) | 103 (hayro) |
| bill-hr815.pdf | pdfjs-next-hwa | 20 (pdfjs) | 49 (pdfjs) | 56 (pdfjs) |
| bill-hr815.pdf | hybrid-hwa | 21 (pdfjs) | 51 (pdfjs) | 58 (pdfjs) |

## Base render per page, p50 (ms, engine)

| File | Variant | Chromium 156.0.8078.4 | WebKit 27.2 | Firefox 157.0 |
|---|---|---:|---:|---:|
| bunka-kokugo-series-019-p4.pdf | pdfjs-next-hwa | 148 (pdfjs) | 176 (pdfjs) | 126 (pdfjs) |
| bunka-kokugo-series-019-p4.pdf | hybrid-hwa | 53 (hayro) | 48 (hayro) | 53 (hayro) |
| patent-us223898.pdf | pdfjs-next-hwa | 72 (pdfjs) | 121 (pdfjs) | 77 (pdfjs) |
| patent-us223898.pdf | hybrid-hwa | 50 (hayro) | 46 (hayro) | 47 (hayro) |
| wdl6812-manuscript.pdf | pdfjs-next-hwa | 96 (pdfjs) | 114 (pdfjs) | 82 (pdfjs) |
| wdl6812-manuscript.pdf | hybrid-hwa | 70 (hayro) | 65 (hayro) | 66 (hayro) |
| bill-hr815.pdf | pdfjs-next-hwa | 23 (pdfjs) | 44 (pdfjs) | 26 (pdfjs) |
| bill-hr815.pdf | hybrid-hwa | 26 (pdfjs) | 41 (pdfjs) | 23 (pdfjs) |

## WebAssembly memory: classifier / hayro (MiB)

| File | Variant | Chromium 156.0.8078.4 | WebKit 27.2 | Firefox 157.0 |
|---|---|---:|---:|---:|
| bunka-kokugo-series-019-p4.pdf | pdfjs-next-hwa | — | — | — |
| bunka-kokugo-series-019-p4.pdf | hybrid-hwa | 1.3 / 102.9 | 1.3 / 102.9 | 1.3 / 102.9 |
| patent-us223898.pdf | pdfjs-next-hwa | — | — | — |
| patent-us223898.pdf | hybrid-hwa | 1.6 / 83.9 | 1.6 / 83.9 | 1.6 / 83.9 |
| wdl6812-manuscript.pdf | pdfjs-next-hwa | — | — | — |
| wdl6812-manuscript.pdf | hybrid-hwa | 1.4 / 51.3 | 1.4 / 51.3 | 1.4 / 51.3 |
| bill-hr815.pdf | pdfjs-next-hwa | — | — | — |
| bill-hr815.pdf | hybrid-hwa | 1.7 / 0.0 | 1.7 / 0.0 | 1.7 / 0.0 |

## Main thread while scrolling at 900 px/s: blocked / longest stall (ms)

| File | Variant | Chromium 156.0.8078.4 | WebKit 27.2 | Firefox 157.0 |
|---|---|---:|---:|---:|
| bunka-kokugo-series-019-p4.pdf | pdfjs-next-hwa | 0 / 1.5 | 1 / 5.9 | 3 / 5.0 |
| bunka-kokugo-series-019-p4.pdf | hybrid-hwa | 0 / 1.5 | 1 / 6.0 | 4 / 4.4 |
| patent-us223898.pdf | pdfjs-next-hwa | 26 / 27.8 | 28 / 15.4 | 38 / 15.1 |
| patent-us223898.pdf | hybrid-hwa | 5 / 6.0 | 27 / 11.7 | 150 / 36.1 |
| wdl6812-manuscript.pdf | pdfjs-next-hwa | 0 / 1.5 | 3 / 6.0 | 6 / 6.1 |
| wdl6812-manuscript.pdf | hybrid-hwa | 0 / 1.5 | 1 / 6.0 | 36 / 12.6 |
| bill-hr815.pdf | pdfjs-next-hwa | 2 / 3.2 | 26 / 13.1 | 52 / 19.4 |
| bill-hr815.pdf | hybrid-hwa | 7 / 6.3 | 29 / 12.2 | 46 / 14.9 |

## Main thread while scrolling at 3600 px/s: blocked / longest stall (ms)

| File | Variant | Chromium 156.0.8078.4 | WebKit 27.2 | Firefox 157.0 |
|---|---|---:|---:|---:|
| bunka-kokugo-series-019-p4.pdf | pdfjs-next-hwa | 0 / 1.3 | 0 / 5.9 | 3 / 5.1 |
| bunka-kokugo-series-019-p4.pdf | hybrid-hwa | 0 / 1.4 | 0 / 5.8 | 4 / 5.5 |
| patent-us223898.pdf | pdfjs-next-hwa | 12 / 13.6 | 14 / 13.4 | 22 / 10.0 |
| patent-us223898.pdf | hybrid-hwa | 1 / 2.6 | 4 / 8.0 | 100 / 29.4 |
| wdl6812-manuscript.pdf | pdfjs-next-hwa | 0 / 1.4 | 0 / 5.0 | 9 / 10.5 |
| wdl6812-manuscript.pdf | hybrid-hwa | 0 / 1.5 | 0 / 5.0 | 29 / 11.2 |
| bill-hr815.pdf | pdfjs-next-hwa | 3 / 5.0 | 6 / 7.1 | 28 / 11.8 |
| bill-hr815.pdf | hybrid-hwa | 1 / 3.0 | 8 / 8.4 | 27 / 10.2 |

