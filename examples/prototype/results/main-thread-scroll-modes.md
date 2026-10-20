# ParaPDF runtime prototype: main-thread cost, Chromium 156.0.8078.4

- Run at: 2026-10-20T07:09:08.394Z
- Code: 6d85eb8 (the scroll modes), measured before pdf.js shipped in the package (c9c156c): the demo created the engine itself from pdfjs-dist 6.4.299 with `createPdfjsEngine` and GPU-backed canvases (`pdfjs-hwa`).
- Machine: darwin 27.0.0 arm64, Apple M2 Pro (12 logical cores); power: AC; one-minute load average 5.6 at the start, 3.9 at the end; waited 0 times (0 min in all) for other Playwright browsers and repeated 0 jobs that another browser overlapped.
- Method: synthetic-text-1000.pdf at the fit-width zoom in vertical or horizontal scroll mode on a 1280×900 viewport at devicePixelRatio 2, once the first page is sharp and idle work is done. Zoom: 4 steps of 1.25× 600 ms apart. Slow scroll: 900 CSS px per second for 4 seconds, sideways in horizontal mode. Both end once the visible pages are sharp again plus 1.5 seconds for idle work. Task, script, layout, and style time come from Chromium's Performance.getMetrics; the profile lists JavaScript self time by file and function from a CPU profile sampled every 0.2 ms. Median of 3 runs.
- Reproduce: `pnpm --filter @parapdf/prototype exec vite build --minify false && SCENARIOS='zoom,slow scroll' VARIANTS=pdfjs-hwa TEXT=1 SCROLL=vertical,horizontal FILE=synthetic-text-1000.pdf RUNS=3 node examples/prototype/scripts/main-thread-bench.ts`

| Scenario | Variant | Task (ms) | Script (ms) | Layout (ms) | Style (ms) | Renders: base / detail / text / text laid out again / links / cancelled |
|---|---|---:|---:|---:|---:|---:|
| zoom | pdfjs-hwa, vertical | 72 | 21 | 1 | 2 | 3 / 6 / 0 / 1 / 0 / 0 |
| zoom | pdfjs-hwa, horizontal | 84 | 24 | 1 | 3 | 3 / 6 / 0 / 1 / 0 / 0 |
| slow scroll | pdfjs-hwa, vertical | 69 | 27 | 1 | 2 | 0 / 2 / 2 / 0 / 2 / 0 |
| slow scroll | pdfjs-hwa, horizontal | 74 | 29 | 1 | 2 | 0 / 2 / 2 / 0 / 2 / 0 |

## zoom, pdfjs-hwa, vertical: JavaScript self time (ms)

| File › function | ms |
|---|---:|
| (browser) › fillText | 10.0 |
| (browser) › (garbage collector) | 4.1 |
| pdf.js › resetCtxToDefault | 2.2 |
| pdf.js › showText | 1.5 |

## zoom, pdfjs-hwa, horizontal: JavaScript self time (ms)

| File › function | ms |
|---|---:|
| (browser) › fillText | 12.2 |
| (browser) › (garbage collector) | 4.8 |
| pdf.js › resetCtxToDefault | 2.4 |
| pdf.js › showText | 1.5 |

## slow scroll, pdfjs-hwa, vertical: JavaScript self time (ms)

| File › function | ms |
|---|---:|
| main.js › viewportOf | 4.0 |
| (browser) › tick | 3.4 |
| (browser) › (garbage collector) | 2.8 |
| (browser) › fillText | 2.4 |
| (browser) › requestAnimationFrame | 1.6 |
| main.js › (anonymous) | 1.5 |
| main.js › dispatchContinuousEvent | 1.3 |
| (browser) › requestIdleCallback | 1.2 |
| (browser) › fillRect | 1.0 |

## slow scroll, pdfjs-hwa, horizontal: JavaScript self time (ms)

| File › function | ms |
|---|---:|
| (browser) › (garbage collector) | 3.2 |
| main.js › viewportOf | 3.0 |
| (browser) › tick | 2.8 |
| (browser) › fillText | 2.4 |
| main.js › dispatchContinuousEvent | 2.2 |
| main.js › (anonymous) | 1.8 |
| (browser) › fillRect | 1.4 |

