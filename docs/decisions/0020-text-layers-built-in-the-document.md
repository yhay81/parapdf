# 0020. Text layers are built out of the document

- Status: rejected
- Date: 2026-10-29

## Decision

Text layers are built in the document. Taking a text layer's container out
of the document while pdf.js fills it, and putting it back before the
structure tree labels its runs, removes most of the `measureText` restyling
it costs Firefox and WebKit, but that work runs in many short tasks under
the 2 ms that blocked time ignores, so blocked time did not move in any
browser. CSS containment on the text layer showed no effect either.

## Evidence

- Appending 200 runs and measuring each, in the demo's page: Firefox 23.3 ms
  in ParaPDF's text layer, 1.2 ms in a container out of the document;
  WebKit 9.5 and 1.5; Chromium 1.1 and 0.6.
- In a Firefox job on bill-hr815.pdf at 900 CSS px/s, the 652
  `measureText` calls took 51 to 60 ms in the document and 4 to 5 out of it.
- `scroll-bench.ts`, 5 runs, median blocked time stayed within the runs'
  spread in every browser and case
  ([`detached-text-firefox.md`](../../examples/prototype/results/detached-text-firefox.md),
  [`-chromium`](../../examples/prototype/results/detached-text-chromium.md),
  [`-webkit`](../../examples/prototype/results/detached-text-webkit.md)).

## Reopen if

Text layers' main-thread time becomes the measure that matters, as when a
benchmark shows them delaying input or drawing, or a profile of
reading-speed scrolling in Firefox attributes its longest tasks to them.
