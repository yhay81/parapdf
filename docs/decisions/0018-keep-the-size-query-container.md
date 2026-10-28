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

## Idea

Stop being a query container. The viewer writes the scroller's size into
`--parapdf-viewport-width` and `--parapdf-viewport-height` on the pages'
container as it attaches and on every resize, and the pages' positions read
those instead of `100cqw` and `100cqh`. A resize still moves pages without
a React render.

## Evidence

The branch against `main`, the same demo otherwise. Unit tests and the
scroll, rotation, options, viewers, pinch, links, and text checks passed in
Chromium.

Gecko profiles of the content process's main thread, Firefox 157 in
Playwright with `MOZ_PROFILER_STARTUP` (1 ms interval, CPU time per
sample), one job each of bill-hr815.pdf at 900 px/s, alternating three
times. CPU time in ms, `main` → branch:

| Work | Run 1 | Run 2 | Run 3 |
| --- | --- | --- | --- |
| Container Query Styles Update | 42 → 0 | 32 → 0 | 46 → 0 |
| Styles | 56 → 31 | 52 → 10 | 63 → 36 |
| `measureText` | 52 → 31 | 48 → 13 | 57 → 31 |
| Reflow | 41 → 23 | 30 → 10 | 44 → 22 |
| Paint | 114 → 158 | 47 → 98 | 102 → 266 |
| The whole main thread | 867 → 914 | 638 → 742 | 799 → 1076 |

The style work the container caused goes away, but painting grows by more,
mostly in building display lists, so the main thread works longer overall
in every run.

`scroll-bench.ts`, 5 runs, variants alternating job by job, AC power, with
`MAX_LOAD=6`
(`examples/prototype/results/viewport-size-vars-{firefox,chromium,webkit}.md`).
Median blocked time, `main` → branch:

| Browser | bill-hr815.pdf, 900 | bill-hr815.pdf, 3600 | 1000 pages, 900 | 1000 pages, 3600 |
| --- | --- | --- | --- | --- |
| Firefox 157 | 59 → 40 ms | 89 → 88 ms | 51 → 58 ms | 76 → 94 ms |
| Chromium 156 | 9 → 11 ms | 15 → 16 ms | 5 → 11 ms | 5 → 3 ms |
| WebKit 27.2 | 27 → 22 ms | 21 → 26 ms | 7 → 10 ms | 21 → 28 ms |

First paint did not change beyond the noise. No browser gains consistently.

## Decision

Keep the scroller a size query container. Firefox's text layers stay more
expensive in ParaPDF than in react-pdf (decision 0017 records the
comparison).

## Reopen if

Firefox paints the pages as cheaply without the container, or a way to
center pages costs neither the container's style work nor the extra
painting.
