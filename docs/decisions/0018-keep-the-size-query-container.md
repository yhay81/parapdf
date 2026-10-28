# 0018. The scroller stays a size query container

- Status: rejected
- Date: 2026-10-28

## Context

In Firefox at reading speed (900 CSS px/s), ParaPDF blocks the main thread
longer than react-pdf with react-window: 39 against 24 ms on bill-hr815.pdf
(`scroll-bench.ts`, 5 runs, AC power, load average 3;
`examples/prototype/results/firefox-layers-vs-react-pdf.md`, measured with
the react-pdf page of decision 0017). Turning layers off locates the difference: without text layers both block 18 ms, and the text
layer adds 21 ms to ParaPDF against 6 ms to react-pdf.

A Gecko profile of ParaPDF's page shows why. pdf.js's `TextLayer` appends
each run to the page and then measures the next with `measureText`, which
first brings the document's style up to date. ParaPDF's scroller is a size
query container (`containerType: "size"`), so pages can be centered with
`100cqw` and `100cqh` and a resize moves them without a React render. In
Firefox, every such update inside the container also runs a "Container
Query Styles Update" over it.

## Ideas

1. Stop being a query container. The viewer writes the scroller's size
   into `--parapdf-viewport-width` and `--parapdf-viewport-height` on the
   pages' container as it attaches and on every resize, and the pages'
   positions read those instead of `100cqw` and `100cqh`. A resize still
   moves pages without a React render.
2. Keep the container, and fill each text layer while it is out of the
   document: `buildTextLayer` removes the layer's container, awaits
   `TextLayer.render()`, and puts it back, so `measureText` has no
   document style to bring up to date.

## Evidence

Both against `main`, the same demo otherwise. With idea 1, unit tests and
the scroll, rotation, options, viewers, pinch, links, and text checks
passed in Chromium.

Gecko profiles of the content process's main thread, Firefox 157 in
Playwright with `MOZ_PROFILER_STARTUP` (1 ms interval, CPU time per
sample), one job of bill-hr815.pdf at 900 px/s per profile, five profiles
of each build alternating, with a one-minute load average below 5. Median
CPU time in ms, with the range for the noisy rows:

| Work | `main` | 1: no container | 2: detached text layers |
| --- | ---: | ---: | ---: |
| Container Query Styles Update | 43 | 0 | 8 |
| Styles | 59 | 17 | 14 |
| `measureText` | 52 | 20 | 4 |
| Display list building | 38 (19–90) | 41 (17–60) | 41 (20–53) |
| The whole main thread | 769 (729–927) | 725 (666–835) | 760 (604–871) |

Both ideas remove the style work the container caused, about 100 ms of
the job's CPU time, and change nothing else beyond the noise. An earlier
set of three profiles with a load average far higher seemed to show
painting growing without the container; five quieter profiles do not.

That saving does not show as consistently less blocked time.
`scroll-bench.ts`, variants alternating job by job, AC power. Idea 1, 5
runs with `MAX_LOAD=6`
(`examples/prototype/results/viewport-size-vars-{firefox,chromium,webkit}.md`),
median blocked time, `main` → idea 1:

| Browser | bill-hr815.pdf, 900 | bill-hr815.pdf, 3600 | 1000 pages, 900 | 1000 pages, 3600 |
| --- | --- | --- | --- | --- |
| Firefox 157 | 59 → 40 ms | 89 → 88 ms | 51 → 58 ms | 76 → 94 ms |
| Chromium 156 | 9 → 11 ms | 15 → 16 ms | 5 → 11 ms | 5 → 3 ms |
| WebKit 27.2 | 27 → 22 ms | 21 → 26 ms | 7 → 10 ms | 21 → 28 ms |

Idea 2, Firefox 157, 7 runs at 900 px/s with `MAX_LOAD=5`
(`examples/prototype/results/text-layer-detached-firefox.md`), `main` →
idea 2: bill-hr815.pdf 59 → 41 ms; synthetic-text-1000.pdf 33 → 63 ms,
whose runs spread from 23 to 285 ms.

Both gain on bill-hr815.pdf at reading speed, where the comparison with
react-pdf started, and lose or tie elsewhere. First paint did not change
beyond the noise.

## Decision

Keep the scroller a size query container and fill text layers in the
page, as now. The style work the container causes in Firefox is real and
either idea removes it, but at this run count neither shows less blocked
time in the measures this project ranks speed by, and both add code.
Firefox's text layers stay more expensive in ParaPDF than in react-pdf
(decision 0017).

## Reopen if

More runs, on a quieter machine or with another document, show either
idea blocking the main thread less in Firefox without costing Chromium or
WebKit; or pdf.js's `TextLayer` stops measuring in the live document.
