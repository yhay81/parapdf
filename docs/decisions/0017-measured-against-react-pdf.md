# 0017. ParaPDF is measured against react-pdf

- Status: proposed
- Date: 2026-10-28

## Context

ParaPDF aims to be the fastest React PDF viewer, yet every benchmark so far
compared ParaPDF with itself or engines with each other. react-pdf is the
most used React PDF component, built on the same pdf.js, so a comparison
with it isolates what the viewer adds: when pages draw, how much the main
thread does while scrolling, and how many canvases stay in memory.

## Decision

The demo gets `compare.html`, which shows a document with react-pdf, and
`scroll-bench.ts` measures it with the same job as ParaPDF's demo:

- `VARIANTS=react-pdf`: a `<Page>` for every page, as react-pdf's
  documentation shows.
- `VARIANTS=react-pdf-window`: only the rows react-window mounts (its
  default overscan), the usual way to show a long document with react-pdf.

Both fit pages to the width ParaPDF's "fit-width" gives them, with
ParaPDF's 12 px gap, and size every page as the first, which suits the
documents measured (every page the same size) and spares react-pdf reading
every page's size first. Blank area uses ParaPDF's definition: the visible
page area whose canvas has not drawn, over the viewport. The report adds
canvas memory for every variant: the canvases in the page and, for
ParaPDF, those it keeps for pages that unmounted, at 4 bytes a pixel.

react-pdf 11.0.0 (with its own pdfjs-dist 6.3.289) and react-window 2.5.1
are exact-pinned devDependencies of the demo; the published package does
not depend on them.

## Evidence

`scroll-bench.ts`, 3 runs, 900 and 3600 CSS px/s for 4 s, variants
following each other job by job; Chromium 156, macOS on an Apple M2 Pro on
AC power, one-minute load average 4 to 5. Medians
(`examples/prototype/results/compare-react-pdf-{110,1000}-chromium.md`):

bill-hr815.pdf (110 pages):

| Speed | Variant | First paint | Blocked | Lag max | Dropped frames | Commits | Canvas memory |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 900 | ParaPDF | 159 ms | 12 ms | 10 ms | 0 / 241 | 4 | 183 MiB |
| 900 | react-pdf, windowed | 216 ms | 11 ms | 8 ms | 0 / 241 | 10 | 217 MiB |
| 900 | react-pdf, every page | 342 ms | 495 ms | 181 ms | 5 / 219 | 3 | 3972 MiB |
| 3600 | ParaPDF | 161 ms | 28 ms | 10 ms | 0 / 241 | 20 | 127 MiB |
| 3600 | react-pdf, windowed | 185 ms | 53 ms | 11 ms | 0 / 241 | 45 | 289 MiB |
| 3600 | react-pdf, every page | 277 ms | 506 ms | 164 ms | 4 / 222 | 1 | 3972 MiB |

synthetic-text-1000.pdf (1000 pages; react-pdf with every page mounted did
not draw its first page within 120 s, so it is left out):

| Speed | Variant | First paint | Blocked | Lag max | Dropped frames | Commits | Canvas memory |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 900 | ParaPDF | 178 ms | 7 ms | 5 ms | 0 / 241 | 4 | 156 MiB |
| 900 | react-pdf, windowed | 193 ms | 7 ms | 7 ms | 0 / 241 | 10 | 187 MiB |
| 3600 | ParaPDF | 199 ms | 22 ms | 11 ms | 1 / 240 | 24 | 111 MiB |
| 3600 | react-pdf, windowed | 213 ms | 31 ms | 9 ms | 0 / 241 | 43 | 249 MiB |

No variant left the visible pages blank on this machine at these speeds.
ParaPDF paints first 14 to 57 ms sooner, blocks the main thread as much or
less, commits React less than half as often, and holds 16 to 56% less canvas
memory; react-pdf with every page mounted holds every page's canvas
(3972 MiB for 110 pages) and blocks the main thread ten to forty times
longer. Where ParaPDF loses: at 3600 px/s it built no text or link layers
while the pages flew past, which react-pdf-window did (8 to 9 of each), so
part of its smaller main-thread cost is work it postpones until scrolling
slows; and its maximum lag on the 1000-page document was 11 ms against 9 ms.

WebKit and Firefox are not measured yet: the machine went on battery power
before their runs, which the scripts refuse. This record stays proposed
until they run.

## Consequences

- Speed claims against other viewers point at these results, and change
  with them.
- `pnpm --filter @parapdf/prototype build` stages react-pdf's pdf.js files
  under `public/react-pdf/`.

## Reopen if

react-pdf or react-window releases change how they render or virtualize
pages, or a viewer with another approach becomes a common choice.
