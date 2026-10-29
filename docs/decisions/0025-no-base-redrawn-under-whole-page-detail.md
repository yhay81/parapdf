# 0025. No base drawn again under a whole-page detail

- Status: adopted
- Date: 2026-10-29

## Context

`target.md` carries over "no base under a whole-page detail": a page's
base never shows under a detail of the whole page. The planner kept the
rule for a page without a base, and for one whose base is of an older
content version, but its last phase, which draws again a base drawn at
more than twice or less than half the current base scale, or of an older
content version, did not ask whether a whole-page detail covers the page.

A page gets a base under its whole-page detail when it came into view
while the view moved fast, as after a jump, and its detail followed once
scrolling settled. Zooming such a page in by more than twice its base's
scale while the whole page still fits the detail budget (16 MP), or
changing what the pages draw (`invalidateDrawings()` and
`invalidateContent()`, as editing the file's annotations, setting form
values, or turning forms on or off do), made that base stale, and the
planner drew it again under the new whole-page detail: a drawing of the
whole page, on the main thread with released pdf.js, that never showed.

## Decision

The last phase passes over a page that a whole-page detail covers, as the
others do. One exception stays: a base drawn at more than twice the
current base scale, as after zooming out, is still drawn again, smaller,
to give back its pixels; giving them back without a drawing would need an
action the executor does not have.

The same phase no longer plans a base of no pixels (`maxBasePixels` 0),
which was drawn again forever.

## Evidence

The build with the change against the same build without it, in the same
run, job by job, three runs of each, medians, in
`examples/prototype/results/`. The machine was compiling other projects:
the one-minute load average on 12 cores went from 17 to 48 during the
Chromium run of `commit-bench.ts`, from 44 to 75 during WebKit's, from 75
to 313 during Firefox's, and from 32 to 48 during `zoom-bench.ts`. The
times below are within the runs' spread and not the evidence; in Chromium
and WebKit, the drawings and the canvas memory were the same in every run
of a build.

`commit-bench.ts`, with a scenario added for this, zoom-in-whole:
setScale() from 0.5 to 1.5 after a jump to page 4 drew bases, where the
detail still covers each page (bill-hr815.pdf, 820×1000 at
devicePixelRatio 2, pdf.js drawing on the main thread;
`commit-stale-base-<browser>.md`). Before → after, the same in Chromium
and WebKit except where noted:

| Scenario | Base renders | Detail renders | Blank or down-to-base frames | Time to sharp, Chromium (ms) | Time to sharp, WebKit (ms) | Peak canvas MiB |
|---|---:|---:|---:|---:|---:|---:|
| zoom-in-whole | 5 → 0 | 6 → 6 | 0 → 0 | 17 → 13 | 10 → 12 | 198 → 196 |
| pinch-out | 0 → 0 | 5 → 5 | 0 → 0 | 20 → 19 | 20 → 17 | 216 → 216 |
| scale-down (1.5 to 0.25) | 3 → 3 (WebKit 2 → 2) | 6 → 6 | 0 → 0 | 13 → 13 | 10 → 12 | 86 → 86 |
| zoom-out-far (5 to fit-width) | 5 → 5 | 5 → 5 | 0 → 0 | 13 → 17 | 9 → 7 | 105 → 105 |

scale-down and zoom-out-far still draw the smaller bases that give back
the larger ones' pixels.

In Firefox the jump left the pages without bases (46.8 instead of 47.7
MiB of canvases before the zoom, the five bases' 0.9 MiB), so
zoom-in-whole drew no base in either build; under that run's load the
drawings counted within the window also varied between runs of one build
(scale-down before the change: 3, 3, and 1 bases), so it shows nothing
either way.

`zoom-bench.ts` (Chromium, bill-hr815.pdf zoomed from fit-width to 1.5
and 2.5 on the desktop, 1280×900 at devicePixelRatio 2, and phone,
390×844 at devicePixelRatio 3, viewports;
`zoom-stale-base-bill-hr815-chromium.md`), which now counts the base and
detail drawings until drawing stops after the pan, drew the same in every
case, with the same canvas memory: none of these zooms leaves a page a
stale base under a whole-page detail. Times to sharp were within the
spread (phone at 1.5: 43 against 41 ms; desktop at 2.5: 44 against 42).

## Consequences

- Zooming in within the whole-page budget, and every change of what the
  pages draw, no longer draw a base for each page that holds one under its
  whole-page detail.
- Such a page keeps its older base under the detail. If the detail gives
  way, as when zooming past its budget to a detail of part of the page,
  the base is drawn then, as any page's is: a base of an older content
  version before the detail, one of another scale last. Until it is, the
  area outside the partial detail, which covers the visible area, shows
  the older base.

## Reopen if

A measurement shows the older base showing where the reader looks, or the
executor gets a way to give back a base's pixels without drawing one.
