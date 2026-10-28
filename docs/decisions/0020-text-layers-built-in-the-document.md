# 0020. Text layers are built in the document

- Status: rejected
- Date: 2026-10-29

## Context

At reading speed (900 CSS px/s), ParaPDF blocks Firefox's main thread longer
than react-pdf with react-window (decision 0017). Decision 0018 traced part
of the text layers' cost to the scroller being a size query container and
kept the container. This record tries to lower the text layers' cost
without touching the container.

pdf.js's `TextLayer` appends each run to its container and then measures the
next with `measureText`. In Firefox and WebKit each of those calls first
brings the document's style up to date, so every run restyles the runs
appended before it, inside the query container. Appending 200 runs to a
text layer and measuring each in turn, in the demo's page with bill-hr815.pdf
open (median of 5 loops, 1280×900 at devicePixelRatio 2):

| Where the runs go | Firefox 157 | WebKit 27.2 | Chromium 156 |
| --- | ---: | ---: | ---: |
| ParaPDF's text layer, as now | 23.3 ms | 9.5 ms | 1.1 ms |
| The same, without the query container | 5.3 ms | | 0.7 ms |
| A container out of the document | 1.2 ms | 1.5 ms | 0.6 ms |
| Out of the document, then put in the layer at once | 3.8 ms | 4.0 ms | 0.9 ms |
| react-pdf's text layer (compare.html) | 6.2 ms | | |

`contain: strict` on the text layer or on the page left Firefox's cost as it
was (21.2 and 22.0 ms), and `content-visibility: hidden` on the text layer
raised it (32.2 ms).

## Idea

Take the text layer's container out of the document while pdf.js fills it,
and put it back where it was once pdf.js has finished, before the structure
tree, which looks its runs up by id, labels them. A page that unmounted
meanwhile does not get it back. The runs are then measured without
restyling, and styled once as the layer goes back.

## Evidence

The experimental code was tested against `main` at 8f2ffb7, with the same demo
otherwise. Unit tests passed, and the text, scroll, and features checks
passed in Chromium and Firefox. In WebKit, features passed; text failed once
and then passed twice for each build; two "odd spreads" scroll checks failed
for both builds, run in Low Power Mode. The experimental source and its
builds are not retained in this record; reproducing the comparison requires
recreating the idea and building it and the baseline separately.

Counting `measureText` in a Firefox page during one 900 px/s job on
bill-hr815.pdf (3 jobs each, on AC power but with a one-minute load average
between 10 and 17): the 652 calls took 51 to 60 ms on `main` and 4 to 5 ms
with the layers built out of the document. A 4 ms timer in the same page
found 5 to 15 gaps longer than 8 ms while scrolling; 1 to 3 of them held text
layer measuring on `main`, together 17 to 32 ms. With text layers turned
off, 5 to 6 such gaps remained.

`scroll-bench.ts`, 5 runs, variants alternating job by job, AC power, with
`MAX_LOAD=8`
(`examples/prototype/results/detached-text-{firefox,chromium,webkit}.md`).
The one-minute load average stayed between 3.7 and 6.7 at the start and end
of each browser's run, which waited 2 to 7 times for other Playwright
browsers or the load and repeated 0 to 5 jobs that another browser
overlapped. Median blocked time, `main` → branch:

| Browser | bill-hr815.pdf, 900 | bill-hr815.pdf, 3600 | 1000 pages, 900 | 1000 pages, 3600 |
| --- | --- | --- | --- | --- |
| Firefox 157 | 35 → 33 ms | 73 → 45 ms | 46 → 54 ms | 69 → 52 ms |
| Chromium 156 | 40 → 45 ms | 7 → 8 ms | 24 → 20 ms | 19 → 21 ms |
| WebKit 27.2 | 26 → 21 ms | 22 → 21 ms | 10 → 5 ms | 5 → 6 ms |

Each 900 px/s job built two text layers while scrolling; the 3600 px/s jobs
built none on the 1000 pages and postponed them on bill-hr815.pdf, so
Firefox's lower medians there come from runs on `main` that blocked 145 to
270 ms, not from the text layers. Single runs of one build spread over 20 to
30 ms in Firefox and Chromium. First paint, blank area, dropped frames,
commits and canvas memory stayed within the same spread.

Building the layers out of the document removes most of the work they cost
Firefox, about 50 ms of main-thread time per job, but that work ran in many
short tasks, most of them under the 2 ms the blocked time ignores. The
longer tasks during reading-speed scrolling are mostly ones that build no
text layer, so blocked time did not move in any browser. Decision 0017 saw
the same for a whole layer built out of the document (71 against 72 ms, on
battery).

## Decision

Keep building text layers in the document. The change does not lower the
blocked time it was meant to lower, and CSS containment on the text layer
showed no effect either (Firefox, 4 runs each, one job each: 54 to 65 ms as
now, 40 to 74 ms with `contain: strict`, 44 to 72 ms with
`content-visibility: auto`).

## Reopen if

Text layers' main-thread time becomes the measure that matters, as when a
benchmark shows them delaying input or drawing, or a profile of reading-speed
scrolling in Firefox attributes its longest tasks to them.
