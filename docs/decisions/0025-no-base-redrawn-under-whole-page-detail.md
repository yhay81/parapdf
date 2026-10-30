# 0025. No base drawn again under a whole-page detail

- Status: adopted
- Date: 2026-10-29

## Decision

A page's base never shows under a detail of the whole page, so the planner
does not draw a stale base again (one at more than twice or less than half
the current base scale, or of an older content version) while a whole-page
detail covers the page. Before, zooming in within the detail budget or
changing what the pages draw (`invalidateDrawings()`, `invalidateContent()`:
editing annotations, setting form values, turning forms on or off) drew such
bases again, whole-page drawings that never showed.

- One exception stays: a base at more than twice the current base scale, as
  after zooming out, is still drawn again, smaller, to give back its pixels.
- A page keeps its older base under the detail. If the detail gives way, the
  base is drawn then, as any page's is.
- A base of no pixels (`maxBasePixels` 0) is no longer planned.

## Evidence

`commit-bench.ts`, zoom-in-whole (`setScale()` from 0.5 to 1.5 after a jump
to page 4, bill-hr815.pdf, 820×1000 at devicePixelRatio 2), against the
build without the change, three runs
([`commit-stale-base-chromium.md`](../../examples/prototype/results/commit-stale-base-chromium.md),
[`-webkit`](../../examples/prototype/results/commit-stale-base-webkit.md)):
base renders 5 → 0, detail renders 6 → 6, no blank frames, peak canvas memory
198 → 196 MiB. The other zoom scenarios drew the same. The machine was under
heavy load, so times are not the evidence; the drawing counts were the same
in every run of a build.

## Reopen if

A measurement shows the older base showing where the reader looks, or the
executor gets a way to give back a base's pixels without drawing one.
