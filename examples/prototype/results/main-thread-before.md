# ParaPDF runtime prototype: main-thread cost, Chromium 156.0.8078.4

- Run at: 2026-10-19T09:39:11.898Z
- Code: 6317d3f, before this change
- Machine: darwin 27.0.0 arm64, Apple M2 Pro (12 logical cores); power: AC; one-minute load average 6.1 at the start, 6.3 at the end; waited 1 times (58 min in all) for other Playwright browsers or a load average above 8 and repeated 0 jobs one overlapped.
- Method: bill-hr815.pdf at the fit-width zoom on a 1280×900 viewport at devicePixelRatio 2, once the first page is sharp and idle work is done. Zoom: 4 steps of 1.25× 600 ms apart. Slow scroll: 900 CSS px per second for 4 seconds. Both end once the visible pages are sharp again plus 1.5 seconds for idle work. Task, script, layout, and style time come from Chromium's Performance.getMetrics; the profile lists JavaScript self time by file and function from a CPU profile sampled every 0.2 ms. Median of 3 runs.
- Reproduce: `pnpm --filter @parapdf/prototype exec vite build --minify false && VARIANTS=pdfjs-hwa,pdfjs-next-hwa TEXT=1 RUNS=3 node examples/prototype/scripts/main-thread-bench.ts`

| Scenario | Variant | Task (ms) | Script (ms) | Layout (ms) | Style (ms) | Renders: base / detail / text / text laid out again / links / cancelled |
|---|---|---:|---:|---:|---:|---:|
| zoom | pdfjs-hwa | 180 | 107 | 13 | 20 | 0 / 6 / 0 / 0 / 0 / 0 |
| zoom | pdfjs-next-hwa | 64 | 5 | 12 | 20 | 0 / 6 / 0 / 0 / 0 / 0 |
| slow scroll | pdfjs-hwa | 76 | 23 | 2 | 4 | 2 / 2 / 2 / 0 / 2 / 0 |
| slow scroll | pdfjs-next-hwa | 70 | 20 | 2 | 4 | 2 / 2 / 2 / 0 / 2 / 0 |

## zoom, pdfjs-hwa: JavaScript self time (ms)

| File › function | ms |
|---|---:|
| (browser) › drawImage | 86.7 |
| pdf.js › resetCtxToDefault | 19.7 |
| main.js › #onScroll | 13.8 |
| (browser) › (garbage collector) | 5.5 |
| (browser) › measureText | 4.5 |
| (browser) › fillText | 4.2 |

## zoom, pdfjs-next-hwa: JavaScript self time (ms)

| File › function | ms |
|---|---:|
| main.js › #onScroll | 32.5 |
| (browser) › (garbage collector) | 3.2 |
| main.js › setScale | 1.2 |

## slow scroll, pdfjs-hwa: JavaScript self time (ms)

| File › function | ms |
|---|---:|
| main.js › #onScroll | 7.3 |
| (browser) › fillText | 4.0 |
| (browser) › (garbage collector) | 2.2 |
| (browser) › tick | 1.8 |
| main.js › #update | 1.4 |
| main.js › dispatchContinuousEvent | 1.3 |
| (browser) › requestAnimationFrame | 1.2 |
| main.js › (anonymous) | 1.2 |

## slow scroll, pdfjs-next-hwa: JavaScript self time (ms)

| File › function | ms |
|---|---:|
| main.js › #onScroll | 7.3 |
| (browser) › (garbage collector) | 3.0 |
| main.js › dispatchContinuousEvent | 1.9 |
| (browser) › tick | 1.8 |
| main.js › (anonymous) | 1.5 |
| (browser) › requestIdleCallback | 1.2 |

