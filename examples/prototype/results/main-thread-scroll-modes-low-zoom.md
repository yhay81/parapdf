# ParaPDF runtime prototype: main-thread cost, Chromium 156.0.8078.4

- Run at: 2026-10-20T07:11:41.627Z
- Code: 6d85eb8 (the scroll modes), measured before pdf.js shipped in the package (c9c156c): the demo created the engine itself from pdfjs-dist 6.4.299 with `createPdfjsEngine` and GPU-backed canvases (`pdfjs-hwa`).
- Machine: darwin 27.0.0 arm64, Apple M2 Pro (12 logical cores); power: AC; one-minute load average 3.9 at the start, 2.3 at the end; waited 0 times (0 min in all) for other Playwright browsers and repeated 0 jobs that another browser overlapped.
- Method: synthetic-text-1000.pdf at 0.5 CSS px per point in vertical or horizontal or wrapped scroll mode on a 1280×900 viewport at devicePixelRatio 2, once the first page is sharp and idle work is done. Zoom: 4 steps of 1.25× 600 ms apart. Slow scroll: 900 CSS px per second for 4 seconds, sideways in horizontal mode. Both end once the visible pages are sharp again plus 1.5 seconds for idle work. Task, script, layout, and style time come from Chromium's Performance.getMetrics; the profile lists JavaScript self time by file and function from a CPU profile sampled every 0.2 ms. Median of 3 runs.
- Reproduce: `pnpm --filter @parapdf/prototype exec vite build --minify false && SCENARIOS='zoom,slow scroll' VARIANTS=pdfjs-hwa TEXT=1 SCROLL=vertical,horizontal,wrapped FILE=synthetic-text-1000.pdf START_SCALE=0.5 RUNS=3 node examples/prototype/scripts/main-thread-bench.ts`

| Scenario | Variant | Task (ms) | Script (ms) | Layout (ms) | Style (ms) | Renders: base / detail / text / text laid out again / links / cancelled |
|---|---|---:|---:|---:|---:|---:|
| zoom | pdfjs-hwa, vertical | 124 | 48 | 1 | 2 | 3 / 16 / 0 / 0 / 0 / 0 |
| zoom | pdfjs-hwa, horizontal | 130 | 46 | 1 | 2 | 4 / 23 / 0 / 0 / 0 / 0 |
| zoom | pdfjs-hwa, wrapped | 183 | 63 | 2 | 4 | 5 / 31 / 0 / 2 / 0 / 0 |
| slow scroll | pdfjs-hwa, vertical | 147 | 52 | 6 | 10 | 0 / 8 / 8 / 0 / 8 / 0 |
| slow scroll | pdfjs-hwa, horizontal | 150 | 50 | 6 | 11 | 0 / 12 / 12 / 0 / 12 / 0 |
| slow scroll | pdfjs-hwa, wrapped | 292 | 84 | 12 | 22 | 0 / 24 / 24 / 0 / 24 / 0 |

## zoom, pdfjs-hwa, vertical: JavaScript self time (ms)

| File › function | ms |
|---|---:|
| (browser) › fillText | 30.7 |
| (browser) › (garbage collector) | 6.4 |
| pdf.js › resetCtxToDefault | 3.1 |
| pdf.js › showText | 3.1 |
| pdf.js › executeOperatorList | 1.7 |
| main.js › (anonymous) | 1.2 |

## zoom, pdfjs-hwa, horizontal: JavaScript self time (ms)

| File › function | ms |
|---|---:|
| (browser) › fillText | 31.1 |
| (browser) › (garbage collector) | 7.5 |
| pdf.js › showText | 3.4 |
| pdf.js › resetCtxToDefault | 3.4 |
| pdf.js › executeOperatorList | 2.0 |
| main.js › (anonymous) | 1.6 |

## zoom, pdfjs-hwa, wrapped: JavaScript self time (ms)

| File › function | ms |
|---|---:|
| (browser) › fillText | 43.9 |
| (browser) › (garbage collector) | 11.0 |
| pdf.js › showText | 4.9 |
| pdf.js › resetCtxToDefault | 4.5 |
| pdf.js › setFont | 3.7 |
| pdf.js › executeOperatorList | 1.8 |
| (browser) › save | 1.8 |
| (browser) › fillRect | 1.3 |

## slow scroll, pdfjs-hwa, vertical: JavaScript self time (ms)

| File › function | ms |
|---|---:|
| (browser) › fillText | 14.4 |
| main.js › viewportOf | 13.2 |
| (browser) › (garbage collector) | 5.9 |
| pdf.js › #onMessage | 2.2 |
| main.js › prepareFreshStack | 2.1 |
| pdf.js › showText | 1.9 |
| main.js › (anonymous) | 1.9 |
| main.js › dispatchContinuousEvent | 1.6 |
| pdf.js › #appendText | 1.5 |
| (browser) › measureText | 1.2 |

## slow scroll, pdfjs-hwa, horizontal: JavaScript self time (ms)

| File › function | ms |
|---|---:|
| main.js › viewportOf | 13.7 |
| (browser) › fillText | 13.7 |
| (browser) › (garbage collector) | 8.1 |
| (browser) › tick | 2.8 |
| (browser) › measureText | 2.2 |
| pdf.js › showText | 1.8 |
| pdf.js › #onMessage | 1.6 |
| main.js › (anonymous) | 1.6 |
| (browser) › requestAnimationFrame | 1.5 |
| pdf.js › #appendText | 1.2 |
| main.js › dispatchContinuousEvent | 1.2 |
| main.js › prepareFreshStack | 1.2 |

## slow scroll, pdfjs-hwa, wrapped: JavaScript self time (ms)

| File › function | ms |
|---|---:|
| (browser) › fillText | 30.2 |
| main.js › viewportOf | 29.9 |
| (browser) › (garbage collector) | 17.7 |
| pdf.js › #onMessage | 5.6 |
| pdf.js › showText | 3.7 |
| main.js › (anonymous) | 3.3 |
| (browser) › measureText | 3.1 |
| main.js › prepareFreshStack | 2.4 |
| pdf.js › #appendText | 2.2 |
| (browser) › tick | 2.1 |
| pdf.js › executeOperatorList | 1.8 |
| (browser) › replaceChildren | 1.8 |

