# ParaPDF runtime prototype: main-thread cost, Chromium 156.0.8078.4

- Run at: 2026-10-26T10:00:35.532Z
- Machine: darwin 27.0.0 arm64, Apple M2 Pro (12 logical cores); power: AC; one-minute load average 3.5 at the start, 3.2 at the end; waited 0 times (0 min in all) for other Playwright browsers and repeated 0 jobs that another browser overlapped.
- Method: bill-hr815.pdf at the fit-width zoom on a 1280×900 viewport at devicePixelRatio 2, once the first page is sharp and idle work is done. Zoom: 4 steps of 1.25× 600 ms apart. Slow scroll: 900 CSS px per second for 4 seconds, sideways in horizontal mode. Both end once the visible pages are sharp again plus 1.5 seconds for idle work. Task, script, layout, and style time come from Chromium's Performance.getMetrics; the profile lists JavaScript self time by file and function from a CPU profile sampled every 0.2 ms. Median of 3 runs.
- Reproduce: `pnpm --filter @parapdf/prototype exec vite build --minify false && VARIANTS=pdfjs-hwa node examples/prototype/scripts/main-thread-bench.ts`

| Scenario | Variant | Task (ms) | Script (ms) | Layout (ms) | Style (ms) | Renders: base / detail / text / text laid out again / links / cancelled |
|---|---|---:|---:|---:|---:|---:|
| zoom | pdfjs-hwa | 182 | 128 | 2 | 4 | 2 / 6 / 0 / 1 / 0 / 0 |
| zoom | pdfjs-hwa, no text | 181 | 143 | 2 | 2 | 2 / 6 / 0 / 0 / 0 / 0 |
| slow scroll | pdfjs-hwa | 111 | 37 | 3 | 6 | 0 / 2 / 2 / 0 / 2 / 0 |
| slow scroll | pdfjs-hwa, no text | 66 | 29 | 1 | 0 | 0 / 2 / 0 / 0 / 2 / 0 |

## zoom, pdfjs-hwa: JavaScript self time (ms)

| File › function | ms |
|---|---:|
| (browser) › drawImage | 97.5 |
| (browser) › fillText | 7.4 |
| (browser) › (garbage collector) | 4.3 |
| pdf.js › zn | 2.4 |
| pdf.js › Rn | 1.8 |
| (browser) › save | 1.5 |
| (browser) › measureText | 1.2 |
| pdf.js › showText | 1.0 |

## zoom, pdfjs-hwa, no text: JavaScript self time (ms)

| File › function | ms |
|---|---:|
| (browser) › drawImage | 116.5 |
| (browser) › fillText | 8.0 |
| (browser) › (garbage collector) | 4.1 |
| pdf.js › zn | 2.6 |
| pdf.js › Rn | 1.2 |
| pdf.js › #g | 1.2 |
| pdf.js › showText | 1.1 |
| pdf.js › Nn | 1.0 |
| (browser) › fillRect | 1.0 |

## slow scroll, pdfjs-hwa: JavaScript self time (ms)

| File › function | ms |
|---|---:|
| PdfViewer.js › Zn | 10.2 |
| (browser) › (garbage collector) | 4.7 |
| PdfViewer.js › Fn | 2.9 |
| (browser) › fillText | 2.7 |
| PdfViewer.js › i_ | 2.2 |
| PdfViewer.js › (anonymous) | 1.9 |
| PdfViewer.js › update | 1.5 |
| (browser) › tick | 1.3 |
| (browser) › requestAnimationFrame | 1.2 |
| (browser) › measureText | 1.2 |

## slow scroll, pdfjs-hwa, no text: JavaScript self time (ms)

| File › function | ms |
|---|---:|
| (browser) › (garbage collector) | 3.1 |
| PdfViewer.js › Zn | 1.9 |
| (browser) › fillText | 1.8 |
| (browser) › tick | 1.2 |
| PdfViewer.js › i_ | 1.2 |
| PdfViewer.js › Fn | 1.2 |

