# 0006. pdf.js's partial rendering of regions

- Status: rejected
- Date: 2026-10-24

## Idea

pdf.js can record the box each drawing operation touches while it draws all
of a page (`recordOperations`), and then draw a region of the page with only
the operations that touch it (`operationsFilter`), as its viewer's detail
view does with `enableOptimizedPartialRendering` (off by default). ParaPDF
draws regions of pages zoomed past their detail budget with every
operation.

## Evidence

- On synthetic-vector-200k.pdf at 16 device pixels per point, a region of
  1.8% of the page kept 147 of the page's 4,003 operations. Drawing it took
  6 to 15 ms instead of 12 to 21 in WebKit, but 3 to 15 instead of 12 to 19
  in Chromium and 33 to 39 instead of 34 to 42 in Firefox, four drawings
  each.
- Zooming to 4× and 8× on desktop- and phone-sized viewports
  (`zoom-bench.ts`, one run in each browser) was no faster with it.
- The recording costs every page's first whole-page drawing. In Chromium,
  over ten pages (`bench/results/record-*.md`, the `-record` variants, three
  runs), the main thread was blocked 45 ms against 8 on
  synthetic-text-1000.pdf, 40 against 23 on usrguide.pdf, and 61 against 0
  on patent-us223898.pdf, and the first page committed up to 14 ms later.

## Why rejected

No page of the corpus has enough operations for the filter to pay for its
recording.

## Reopen if

A page with tens of thousands of operations, such as a map or a drawing,
draws its regions slowly. Then record only for pages zoomed past their
detail budget.
