# 0017. ParaPDF is measured against react-pdf

- Status: adopted
- Date: 2026-10-28

## Context

ParaPDF aims to be the fastest React PDF viewer, yet every benchmark so far
compared ParaPDF with itself or engines with each other. react-pdf is the
most used React PDF component, also built on pdf.js. A comparison measures
the complete viewer stacks: when pages draw, how much the main thread does
while scrolling, and how many canvases stay in memory. Their pdf.js versions
differ, so the results cannot isolate the viewer from the engine version.

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
not depend on them. The comparison supports vertical scrolling at fit-width;
the benchmark rejects other scroll modes or scales for these variants.

## Evidence

`scroll-bench.ts`, 3 runs, 900 and 3600 CSS px/s for 4 s, variants
following each other job by job; Chromium 156, macOS on an Apple M2 Pro on
AC power. These jobs use the headless Chromium preload fix in decision 0014.
The one-minute load average was 12.1 at the start and 4.1 at the end of the
110-page run, and 4.1 to 6.2 for the 1000-page run. The high starting load
and differences from the earlier run make timing conclusions provisional;
repeat under lower, stable load (`examples/prototype/results/compare-react-pdf-{110,1000}-chromium.md`).
Medians:

bill-hr815.pdf (110 pages):

| Speed | Variant | First paint | Blocked | Lag max | Dropped frames | Commits | Canvas memory |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 900 | ParaPDF | 159 ms | 16 ms | 9 ms | 0 / 241 | 4 | 183 MiB |
| 900 | react-pdf, every page | 294 ms | 230 ms | 104 ms | 3 / 237 | 1 | 3972 MiB |
| 900 | react-pdf, windowed | 191 ms | 8 ms | 7 ms | 0 / 241 | 10 | 217 MiB |
| 3600 | ParaPDF | 140 ms | 46 ms | 9 ms | 0 / 241 | 20 | 126 MiB |
| 3600 | react-pdf, every page | 286 ms | 311 ms | 105 ms | 3 / 235 | 0 | 3972 MiB |
| 3600 | react-pdf, windowed | 180 ms | 31 ms | 9 ms | 0 / 241 | 46 | 289 MiB |

synthetic-text-1000.pdf (1000 pages; windowed variants only):

| Speed | Variant | First paint | Blocked | Lag max | Dropped frames | Commits | Canvas memory |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 900 | ParaPDF | 231 ms | 6 ms | 5 ms | 0 / 241 | 4 | 156 MiB |
| 900 | react-pdf, windowed | 197 ms | 6 ms | 5 ms | 0 / 241 | 10 | 187 MiB |
| 3600 | ParaPDF | 162 ms | 45 ms | 10 ms | 0 / 241 | 24 | 111 MiB |
| 3600 | react-pdf, windowed | 179 ms | 12 ms | 5 ms | 0 / 241 | 45 | 249 MiB |

No variant left the visible pages blank in these runs. ParaPDF committed
React less often and used less canvas memory than the windowed comparison;
its first paint and main-thread blocked time were not consistently lower.
At 3600 px/s ParaPDF postponed text and link layers while react-pdf-window
built them, so their work during scrolling differs. An earlier run without
the headless preload fix did not draw the 1000-page document with every page
mounted within 120 s; that case was not rerun here.

WebKit 27.2 and Firefox 157 (Playwright's builds, not Safari), the same
jobs with 5 runs, on AC power
(`examples/prototype/results/compare-react-pdf-{110,1000}-{webkit,firefox}.md`).
The one-minute load average was 3 to 5, except that it rose to 14.5 at the
end of Firefox's 1000-page run and started at 14.5 for WebKit's 110-page
run. Medians:

| Browser | File | Speed | Variant | First paint | Blocked | Lag max | Commits | Canvas memory |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| WebKit | bill-hr815.pdf | 900 | ParaPDF | 184 ms | 20 ms | 9 ms | 4 | 183 MiB |
| WebKit | bill-hr815.pdf | 900 | react-pdf, windowed | 272 ms | 20 ms | 11 ms | 10 | 217 MiB |
| WebKit | bill-hr815.pdf | 900 | react-pdf, every page | 1156 ms | 2752 ms | 158 ms | 1 | 3972 MiB |
| WebKit | bill-hr815.pdf | 3600 | ParaPDF | 172 ms | 18 ms | 10 ms | 20 | 127 MiB |
| WebKit | bill-hr815.pdf | 3600 | react-pdf, windowed | 278 ms | 122 ms | 18 ms | 46 | 289 MiB |
| WebKit | bill-hr815.pdf | 3600 | react-pdf, every page | 517 ms | 3255 ms | 186 ms | 0 | 3972 MiB |
| WebKit | synthetic-text-1000.pdf | 900 | ParaPDF | 191 ms | 4 ms | 7 ms | 4 | 156 MiB |
| WebKit | synthetic-text-1000.pdf | 900 | react-pdf, windowed | 207 ms | 10 ms | 6 ms | 10 | 187 MiB |
| WebKit | synthetic-text-1000.pdf | 3600 | ParaPDF | 212 ms | 15 ms | 9 ms | 24 | 111 MiB |
| WebKit | synthetic-text-1000.pdf | 3600 | react-pdf, windowed | 203 ms | 27 ms | 11 ms | 44 | 249 MiB |
| Firefox | bill-hr815.pdf | 900 | ParaPDF | 225 ms | 63 ms | 24 ms | 4 | 183 MiB |
| Firefox | bill-hr815.pdf | 900 | react-pdf, windowed | 317 ms | 44 ms | 14 ms | 10 | 217 MiB |
| Firefox | bill-hr815.pdf | 3600 | ParaPDF | 221 ms | 65 ms | 18 ms | 20 | 127 MiB |
| Firefox | bill-hr815.pdf | 3600 | react-pdf, windowed | 309 ms | 244 ms | 25 ms | 44 | 289 MiB |
| Firefox | synthetic-text-1000.pdf | 900 | ParaPDF | 267 ms | 45 ms | 19 ms | 4 | 156 MiB |
| Firefox | synthetic-text-1000.pdf | 900 | react-pdf, windowed | 322 ms | 40 ms | 12 ms | 10 | 187 MiB |
| Firefox | synthetic-text-1000.pdf | 3600 | ParaPDF | 286 ms | 99 ms | 27 ms | 24 | 111 MiB |
| Firefox | synthetic-text-1000.pdf | 3600 | react-pdf, windowed | 323 ms | 196 ms | 16 ms | 43 | 249 MiB |

react-pdf with every page mounted did not finish a single Firefox job on
bill-hr815.pdf within 120 s. Again no variant left visible pages blank.

In these WebKit and Firefox runs, ParaPDF paints first sooner in every job but one (WebKit, 1000 pages,
3600 px/s: 212 against 203 ms), commits React less than half as often, and
holds less canvas memory everywhere. In WebKit it blocks the main thread as
much or less. In Firefox it blocks less at 3600 px/s, where it postpones
layers, but more at 900 px/s, where both build the same two text and link
layers: 63 against 44 ms and 45 against 40 ms, with longer stalls (19 to
24 ms against 12 to 14 ms). Attributed on battery, that cost follows the
text layers: pdf.js measures each run with `measureText` after appending the
previous one to the page, and those calls took about twice as long in
ParaPDF's page as in react-pdf's (about 50 against 25 ms per job) although
the same calls replayed in an empty page took 1.5 ms. Building the layer
outside the document did not lower the blocked time (71 against 72 ms, 5
runs, on battery), so it is not adopted; the cause stays open.

## Consequences

- Speed claims against other viewers point at these results, and change
  with them. They do not support "faster in every browser": Firefox's text
  layers at reading speed cost ParaPDF more than react-pdf, and the updated
  Chromium timing results need a repeat under lower, stable load.
- `pnpm --filter @parapdf/prototype build` stages react-pdf's pdf.js files
  under `public/react-pdf/`.

## Reopen if

react-pdf or react-window releases change how they render or virtualize
pages, or a viewer with another approach becomes a common choice.
