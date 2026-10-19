# ParaPDF runtime prototype: main-thread cost, Chromium 156.0.8078.4

- Run at: 2026-10-19T09:46:19.589Z
- Code: this change without skipping base renders
- Machine: darwin 27.0.0 arm64, Apple M2 Pro (12 logical cores); power: AC; one-minute load average 5.6 at the start, 6.8 at the end; waited 0 times (0 min in all) for other Playwright browsers or a load average above 8 and repeated 0 jobs one overlapped.
- Method: bill-hr815.pdf at 1 CSS px per point on a 1280×900 viewport at devicePixelRatio 1, once the first page is sharp and idle work is done. Zoom: one 2× step. Slow scroll: 1200 CSS px per second for 3 seconds. Both end once the visible pages are sharp again plus 1.5 seconds for idle work. Task, script, layout, and style time come from Chromium's Performance.getMetrics; the profile lists JavaScript self time by file and function from a CPU profile sampled every 0.2 ms. Median of 3 runs.
- Reproduce: `pnpm --filter @parapdf/prototype exec vite build --minify false && VARIANTS=pdfjs-hwa,pdfjs-next-hwa TEXT=1 DPR=1 START_SCALE=1 ZOOM=2 SPEED=1200 DURATION=3000 RUNS=3 node examples/prototype/scripts/main-thread-bench.ts`

| Scenario | Variant | Task (ms) | Script (ms) | Layout (ms) | Style (ms) | Renders: base / detail / text / text laid out again / links / cancelled |
|---|---|---:|---:|---:|---:|---:|
| zoom | pdfjs-hwa | 35 | 18 | 0 | 0 | 0 / 3 / 0 / 0 / 0 / 0 |
| zoom | pdfjs-next-hwa | 11 | 2 | 0 | 0 | 0 / 3 / 0 / 0 / 0 / 0 |
| slow scroll | pdfjs-hwa | 136 | 37 | 5 | 11 | 4 / 4 / 4 / 0 / 4 / 0 |
| slow scroll | pdfjs-next-hwa | 97 | 23 | 5 | 11 | 4 / 4 / 4 / 0 / 4 / 0 |

## zoom, pdfjs-hwa: JavaScript self time (ms)

| File › function | ms |
|---|---:|
| (browser) › drawImage | 11.6 |
| (browser) › (garbage collector) | 3.2 |
| (browser) › fillText | 2.5 |

## zoom, pdfjs-next-hwa: JavaScript self time (ms)

| File › function | ms |
|---|---:|
| (browser) › (garbage collector) | 2.1 |

## slow scroll, pdfjs-hwa: JavaScript self time (ms)

| File › function | ms |
|---|---:|
| main.js › #onScroll | 15.4 |
| (browser) › fillText | 9.4 |
| (browser) › (garbage collector) | 6.6 |
| (browser) › tick | 2.5 |
| (browser) › measureText | 2.5 |
| pdf.js › #appendText | 1.9 |
| main.js › dispatchContinuousEvent | 1.6 |
| main.js › #update | 1.2 |
| main.js › prepareFreshStack | 1.2 |

## slow scroll, pdfjs-next-hwa: JavaScript self time (ms)

| File › function | ms |
|---|---:|
| main.js › #onScroll | 16.7 |
| (browser) › measureText | 2.5 |
| pdf.js › #onMessage | 1.9 |
| main.js › (anonymous) | 1.8 |
| pdf.js › #appendText | 1.8 |
| (browser) › (garbage collector) | 1.6 |
| (browser) › tick | 1.5 |

