# 0016. Form scripts start after the first paint

- Status: adopted
- Date: 2026-10-28

## Context

`formScripts` (issue #7) runs a document's JavaScript in pdf.js's QuickJS
sandbox. Starting it reads every field, the calculation order, and the
document's actions from pdf.js's worker, and loads the sandbox (66 KB) and
QuickJS (475 KB, a WebAssembly module). Started as the document opens, it
competes with the first page for the worker, the network, and the main
thread.

## Decision

A viewer's form layers start the scripts once the document's pages first
show pixels: `ViewerExtension.painted()`, which the viewer calls once each
time it shows a document. A document without scripts loads none of it, as
before. The document's Open script and the fields it fills come after the
first page instead of with it.

## Evidence

`examples/prototype/scripts/scroll-bench.ts` with
`QUERY='forms=1&scripts=1'` (added for this), `VARIANTS=pdfjs-hwa`,
`SPEEDS=3600`, 5 runs, the variants following each other job by job;
macOS on an Apple M2 Pro on AC power, with a one-minute load average of 6
to 11 from other work. f1040.pdf (2 pages, has scripts) and
synthetic-scripts.pdf.

Starting after the first paint, against starting as the document opens
(`examples/prototype/results/form-scripts-deferred-chromium.md`), median
first paint, Chromium 156:

| File | As it opens | After the first paint |
| --- | ---: | ---: |
| f1040.pdf | 228 ms | 214 ms (4 of 5 jobs faster) |
| synthetic-scripts.pdf | 139 ms | 126 ms (mixed, within the noise) |

With scripts on, against `main` without them (forms only; `main` ignores
`scripts=1`), f1040.pdf
(`examples/prototype/results/form-scripts-vs-main-{chromium,webkit}.md`):

| Browser | `main`, forms | Scripts on | Blocked time, `main` → scripts |
| --- | ---: | ---: | --: |
| Chromium 156 | 195 ms | 203 ms | 0 → 0 ms |
| WebKit 27.2 | 225 ms | 229 ms | 22 → 19 ms |
| Firefox 157 | 317 ms | 297 ms | 15 → 16 ms |

The Firefox comparison (`examples/prototype/results/form-scripts-vs-main-firefox.md`)
used the same five-run method, on AC power. Its one-minute load average was
21 to 27, so it does not establish a speed win; it found no clear regression.
Its before build includes #75, and its after build includes the fix for
enabling forms after the first paint. The two-page file does not exercise
long-document scrolling.

Before the change, the same comparison in Chromium gave 230 → 263 ms. With
`formScripts` off, the branch and `main` did not differ (f1040.pdf, 3
runs: 194 to 218 ms both). Scrolling, blank area, and dropped frames do not
change: f1040.pdf crosses one page, so the scroll measures say little
here.

## Consequences

- A script that changes how the first page looks (a field the Open script
  fills, a field it hides) takes effect a moment after the page shows;
  pdf.js's own viewer starts them as the document loads.
- The scripts of a viewer that never paints (no viewport attached) do not
  start until it does.

## Reopen if

A document's Open script needs to run before the first paint, or a pdf.js
release lets the sandbox start without reading every field first.
