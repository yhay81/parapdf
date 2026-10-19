# ParaPDF runtime prototype: main-thread cost, Chromium 156.0.8078.4

- Run at: 2026-10-19T09:43:27.146Z
- Code: 6317d3f, before this change
- Machine: darwin 27.0.0 arm64, Apple M2 Pro (12 logical cores); power: AC; one-minute load average 5.0 at the start, 5.3 at the end; waited 0 times (0 min in all) for other Playwright browsers or a load average above 8 and repeated 0 jobs one overlapped.
- Method: bill-hr815.pdf at 1 CSS px per point on a 1280×900 viewport at devicePixelRatio 1, once the first page is sharp and idle work is done. Zoom: one 2× step. Slow scroll: 1200 CSS px per second for 3 seconds. Both end once the visible pages are sharp again plus 1.5 seconds for idle work. Task, script, layout, and style time come from Chromium's Performance.getMetrics; the profile lists JavaScript self time by file and function from a CPU profile sampled every 0.2 ms. Median of 3 runs.
- Reproduce: `pnpm --filter @parapdf/prototype exec vite build --minify false && VARIANTS=pdfjs-hwa,pdfjs-next-hwa TEXT=1 DPR=1 START_SCALE=1 ZOOM=2 SPEED=1200 DURATION=3000 RUNS=3 node examples/prototype/scripts/main-thread-bench.ts`

| Scenario | Variant | Task (ms) | Script (ms) | Layout (ms) | Style (ms) | Renders: base / detail / text / text laid out again / links / cancelled |
|---|---|---:|---:|---:|---:|---:|
| zoom | pdfjs-hwa | 46 | 19 | 3 | 6 | 0 / 3 / 0 / 0 / 0 / 0 |
| zoom | pdfjs-next-hwa | 20 | 2 | 3 | 5 | 0 / 3 / 0 / 0 / 0 / 0 |
| slow scroll | pdfjs-hwa | 120 | 33 | 5 | 11 | 4 / 4 / 4 / 0 / 4 / 0 |
| slow scroll | pdfjs-next-hwa | 81 | 20 | 4 | 8 | 4 / 4 / 4 / 0 / 4 / 0 |

## zoom, pdfjs-hwa: JavaScript self time (ms)

| File › function | ms |
|---|---:|
| (browser) › drawImage | 10.3 |
| pdf.js › resetCtxToDefault | 4.9 |
| main.js › #onScroll | 3.4 |
| (browser) › (garbage collector) | 2.6 |
| (browser) › fillText | 2.1 |

## zoom, pdfjs-next-hwa: JavaScript self time (ms)

| File › function | ms |
|---|---:|
| main.js › #onScroll | 7.6 |
| (browser) › (garbage collector) | 2.5 |

## slow scroll, pdfjs-hwa: JavaScript self time (ms)

| File › function | ms |
|---|---:|
| main.js › #onScroll | 14.7 |
| (browser) › fillText | 7.6 |
| (browser) › (garbage collector) | 5.3 |
| (browser) › tick | 2.9 |
| (browser) › measureText | 1.9 |
| (browser) › requestAnimationFrame | 1.3 |
| main.js › (anonymous) | 1.3 |
| main.js › dispatchContinuousEvent | 1.2 |
| main.js › prepareFreshStack | 1.2 |
| pdf.js › showText | 1.2 |

## slow scroll, pdfjs-next-hwa: JavaScript self time (ms)

| File › function | ms |
|---|---:|
| main.js › #onScroll | 12.8 |
| (browser) › tick | 2.2 |
| (browser) › measureText | 1.8 |
| (browser) › (garbage collector) | 1.5 |
| (browser) › requestIdleCallback | 1.2 |
| main.js › (anonymous) | 1.2 |

