# ParaPDF runtime prototype: main-thread cost, Chromium 156.0.8078.4

- Run at: 2026-10-20T07:12:41.448Z
- Code: 6d85eb8 (the scroll modes), measured before pdf.js shipped in the package (c9c156c): the demo created the engine itself from pdfjs-dist 6.4.299 with `createPdfjsEngine` and GPU-backed canvases (`pdfjs-hwa`).
- Machine: darwin 27.0.0 arm64, Apple M2 Pro (12 logical cores); power: AC; one-minute load average 2.4 at the start, 2.3 at the end; waited 0 times (0 min in all) for other Playwright browsers and repeated 0 jobs that another browser overlapped.
- Method: synthetic-text-1000.pdf at the fit-page zoom in vertical or horizontal scroll mode on a 1280×900 viewport at devicePixelRatio 2, once the first page is sharp and idle work is done. Zoom: 4 steps of 1.25× 600 ms apart. Slow scroll: 3600 CSS px per second for 4 seconds, sideways in horizontal mode. Both end once the visible pages are sharp again plus 1.5 seconds for idle work. Task, script, layout, and style time come from Chromium's Performance.getMetrics; the profile lists JavaScript self time by file and function from a CPU profile sampled every 0.2 ms. Median of 3 runs.
- Reproduce: `pnpm --filter @parapdf/prototype exec vite build --minify false && SCENARIOS='slow scroll' VARIANTS=pdfjs-hwa TEXT=1 SCROLL=vertical,horizontal FILE=synthetic-text-1000.pdf START_SCALE=fit-page SPEED=3600 RUNS=3 node examples/prototype/scripts/main-thread-bench.ts`

| Scenario | Variant | Task (ms) | Script (ms) | Layout (ms) | Style (ms) | Renders: base / detail / text / text laid out again / links / cancelled |
|---|---|---:|---:|---:|---:|---:|
| slow scroll | pdfjs-hwa, vertical | 187 | 76 | 5 | 7 | 16 / 6 / 6 / 0 / 6 / 0 |
| slow scroll | pdfjs-hwa, horizontal | 270 | 109 | 9 | 12 | 21 / 8 / 8 / 0 / 8 / 0 |

## slow scroll, pdfjs-hwa, vertical: JavaScript self time (ms)

| File › function | ms |
|---|---:|
| (browser) › fillText | 31.0 |
| (browser) › (garbage collector) | 7.2 |
| pdf.js › showText | 3.9 |
| main.js › viewportOf | 3.4 |
| main.js › sharpness | 2.4 |
| main.js › prepareFreshStack | 2.1 |
| main.js › (anonymous) | 1.6 |
| pdf.js › #onMessage | 1.6 |
| (browser) › tick | 1.3 |
| pdf.js › resetCtxToDefault | 1.3 |
| main.js › #next | 1.2 |
| main.js › setValueForStyle | 1.2 |

## slow scroll, pdfjs-hwa, horizontal: JavaScript self time (ms)

| File › function | ms |
|---|---:|
| (browser) › fillText | 47.6 |
| (browser) › (garbage collector) | 10.1 |
| main.js › viewportOf | 4.0 |
| pdf.js › showText | 3.6 |
| pdf.js › #onMessage | 3.5 |
| main.js › sharpness | 3.3 |
| (browser) › fillRect | 3.2 |
| pdf.js › resetCtxToDefault | 2.8 |
| main.js › prepareFreshStack | 2.7 |
| main.js › (anonymous) | 2.2 |
| pdf.js › setFont | 1.8 |
| pdf.js › executeOperatorList | 1.8 |

