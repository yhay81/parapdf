# ParaPDF runtime prototype: main-thread cost, Chromium 156.0.8078.4

- Run at: 2026-10-29T08:03:16.993Z
- Code: autoLinks (#87)
- Machine: darwin 27.0.0 arm64, Apple M2 Pro (12 logical cores); power: AC; one-minute load average 5.1 at the start, 3.6 at the end; waited 0 times (0 min in all) for other Playwright browsers and repeated 0 jobs that another browser overlapped.
- Method: synthetic-addresses.pdf at the fit-width zoom on a 1280×900 viewport at devicePixelRatio 2, once the first page is sharp and idle work is done. Zoom: 4 steps of 1.25× 600 ms apart. Slow scroll: 900 CSS px per second for 4 seconds, sideways in horizontal mode. Both end once the visible pages are sharp again plus 1.5 seconds for idle work. Task, script, layout, and style time come from Chromium's Performance.getMetrics; the profile lists JavaScript self time by file and function from a CPU profile sampled every 0.2 ms. Median of 5 runs.
- Reproduce: `pnpm --filter @parapdf/prototype exec vite build --minify false && SCENARIOS='slow scroll' VARIANTS=pdfjs-hwa TEXT=1 FILE=synthetic-addresses.pdf RUNS=5 QUERIES='autoLinks=0;autoLinks=1' node examples/prototype/scripts/main-thread-bench.ts`

| Scenario | Variant | Task (ms) | Script (ms) | Layout (ms) | Style (ms) | Renders: base / detail / text / text laid out again / links / cancelled |
|---|---|---:|---:|---:|---:|---:|
| slow scroll | pdfjs-hwa, autoLinks=0 | 112 | 48 | 1 | 2 | 0 / 2 / 2 / 0 / 2 / 0 |
| slow scroll | pdfjs-hwa, autoLinks=1 | 118 | 47 | 1 | 2 | 0 / 2 / 2 / 0 / 2 / 0 |

## slow scroll, pdfjs-hwa, autoLinks=0: JavaScript self time (ms)

| File › function | ms |
|---|---:|
| zoom.js › C | 5.7 |
| (browser) › (garbage collector) | 4.4 |
| (browser) › tick | 4.0 |
| (browser) › fillText | 2.6 |
| PdfViewer.js › (anonymous) | 2.3 |
| jsx-runtime.js › i_ | 2.1 |
| PdfViewer.js › #me | 1.9 |
| PdfViewer.js › #de | 1.6 |
| (browser) › requestAnimationFrame | 1.6 |
| PdfViewer.js › Cn | 1.4 |
| (browser) › requestIdleCallback | 1.3 |
| PdfViewer.js › update | 1.1 |

## slow scroll, pdfjs-hwa, autoLinks=1: JavaScript self time (ms)

| File › function | ms |
|---|---:|
| (browser) › (garbage collector) | 5.5 |
| zoom.js › C | 5.2 |
| (browser) › tick | 2.7 |
| PdfViewer.js › (anonymous) | 2.6 |
| (browser) › requestIdleCallback | 1.9 |
| (browser) › fillText | 1.8 |
| jsx-runtime.js › i_ | 1.6 |
| PdfViewer.js › #me | 1.6 |
| PdfViewer.js › #de | 1.3 |
| PdfViewer.js › Tn | 1.3 |
| (browser) › requestAnimationFrame | 1.0 |

