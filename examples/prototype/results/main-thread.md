# ParaPDF runtime prototype: main-thread cost, Chromium 156.0.8078.4

- Run at: 2026-10-19T09:40:36.663Z
- Code: this change
- Machine: darwin 27.0.0 arm64, Apple M2 Pro (12 logical cores); power: AC; one-minute load average 6.3 at the start, 5.0 at the end; waited 0 times (0 min in all) for other Playwright browsers or a load average above 8 and repeated 0 jobs one overlapped.
- Method: bill-hr815.pdf at the fit-width zoom on a 1280×900 viewport at devicePixelRatio 2, once the first page is sharp and idle work is done. Zoom: 4 steps of 1.25× 600 ms apart. Slow scroll: 900 CSS px per second for 4 seconds. Both end once the visible pages are sharp again plus 1.5 seconds for idle work. Task, script, layout, and style time come from Chromium's Performance.getMetrics; the profile lists JavaScript self time by file and function from a CPU profile sampled every 0.2 ms. Median of 3 runs.
- Reproduce: `pnpm --filter @parapdf/prototype exec vite build --minify false && VARIANTS=pdfjs-hwa,pdfjs-next-hwa TEXT=1 RUNS=3 node examples/prototype/scripts/main-thread-bench.ts`

| Scenario | Variant | Task (ms) | Script (ms) | Layout (ms) | Style (ms) | Renders: base / detail / text / text laid out again / links / cancelled |
|---|---|---:|---:|---:|---:|---:|
| zoom | pdfjs-hwa | 155 | 111 | 2 | 2 | 2 / 6 / 0 / 1 / 0 / 0 |
| zoom | pdfjs-next-hwa | 35 | 5 | 2 | 3 | 2 / 6 / 0 / 1 / 0 / 0 |
| slow scroll | pdfjs-hwa | 68 | 21 | 2 | 4 | 0 / 2 / 2 / 0 / 2 / 0 |
| slow scroll | pdfjs-next-hwa | 80 | 27 | 2 | 4 | 0 / 2 / 2 / 0 / 2 / 0 |

## zoom, pdfjs-hwa: JavaScript self time (ms)

| File › function | ms |
|---|---:|
| (browser) › drawImage | 91.1 |
| (browser) › fillText | 5.7 |
| (browser) › (garbage collector) | 5.0 |
| pdf.js › resetCtxToDefault | 1.5 |
| (browser) › measureText | 1.2 |
| pdf.js › showText | 1.2 |

## zoom, pdfjs-next-hwa: JavaScript self time (ms)

| File › function | ms |
|---|---:|
| main.js › #onScroll | 1.9 |
| (browser) › (garbage collector) | 1.6 |

## slow scroll, pdfjs-hwa: JavaScript self time (ms)

| File › function | ms |
|---|---:|
| main.js › #onScroll | 6.8 |
| (browser) › (garbage collector) | 3.3 |
| main.js › dispatchContinuousEvent | 2.2 |
| (browser) › tick | 1.9 |
| (browser) › fillText | 1.5 |
| (browser) › requestAnimationFrame | 1.3 |
| main.js › #update | 1.2 |

## slow scroll, pdfjs-next-hwa: JavaScript self time (ms)

| File › function | ms |
|---|---:|
| main.js › #onScroll | 9.2 |
| (browser) › tick | 2.9 |
| (browser) › (garbage collector) | 2.2 |
| main.js › (anonymous) | 2.0 |
| main.js › #update | 2.0 |
| (browser) › requestAnimationFrame | 1.3 |
| (browser) › requestIdleCallback | 1.3 |
| main.js › dispatchContinuousEvent | 1.2 |
| main.js › prepareFreshStack | 1.0 |

