# 0006. pdf.js's partial rendering of regions

- Status: rejected
- Date: 2026-10-24

## Decision

A region of a page zoomed past its detail budget is drawn with every
operation of the page. pdf.js's `recordOperations` and `operationsFilter`,
which its viewer's detail view uses with `enableOptimizedPartialRendering`
(off by default), are not used: no page of the corpus has enough operations
for the filter to pay for its recording.

## Evidence

- On synthetic-vector-200k.pdf at 16 device pixels per point, a region of
  1.8% of the page kept 147 of 4,003 operations; drawing it was faster only
  in WebKit (6 to 15 ms instead of 12 to 21), and zooming to 4× and 8× was
  no faster in any browser.
- The recording costs every page's first whole-page drawing: in Chromium,
  over ten pages, the main thread was blocked 45 ms against 8 on
  synthetic-text-1000.pdf and 61 against 0 on patent-us223898.pdf
  ([`record-chromium.md`](../../bench/results/record-chromium.md),
  [`record-browsers.md`](../../bench/results/record-browsers.md)).

## Reopen if

A page with tens of thousands of operations, such as a map or a drawing,
draws its regions slowly. Then record only for pages zoomed past their
detail budget.
