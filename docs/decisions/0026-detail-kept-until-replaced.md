# 0026. A detail kept while hidden, and until a base replaces it

- Status: adopted
- Date: 2026-10-29

## Context

The tests of #110 found two ways the planner gave back a detail that was
all a page showed.

A viewer whose viewport is empty, as when it is hidden (`display: none`,
a hidden `<Activity>`, a closed `<details>`), still runs its renderer:
the viewport's ResizeObserver asks for an update. `detailBudget` took
`maxDetailViewports` viewports' worth of device pixels, and its default,
unlimited, times an empty viewport's none is NaN; so was the budget, and
no page had a detail planned. The renderer gave back every detail, drew a
base for each page while the viewer was hidden, and, once it showed again,
showed those bases until the details were drawn again.

A visible page drawn by a detail alone, as the quick whole-page detail
drawn first after opening or a jump, lost it as soon as a zoom left it no
detail: `staleDetail` gave back every detail no longer planned, and the
page was blank until its base was drawn, against "a visible page never
blank". With the default budgets a detail of part of the page is planned
where a whole-page one no longer fits, so this needs budgets that leave a
visible page no detail at all, as a `maxCanvasPixels` that the visible
pages' bases fill.

## Decision

- An unlimited `maxDetailViewports` sets no limit, also for an empty
  viewport: a hidden viewer keeps the whole-page details its budgets allow,
  and shows them again at once. A finite one still allows an empty
  viewport no detail.
- A visible page whose only pixels are a detail no longer planned keeps
  it until its base is drawn, then gives it back; one with a base, one
  that left the viewport, and one whose detail becomes its base (decision
  0012) give it back as before. The planner no longer counts such a
  detail as covering the page, so the base is drawn first.
- Until that base is drawn, the kept detail may exceed the budgets, as a
  visible page's base may (`target.md`, Testing).

## Evidence

The build with the change against the build of the commit before it, in
the same run, job by job, in Playwright's Chromium 156 and WebKit, on an
M2 Pro on AC power. Other sessions' builds loaded the machine: the times
below are within the runs' spread and not the evidence; the drawings and
the canvas memory are.

`check:options` gains a check: bill-hr815.pdf at 1000×900 and
devicePixelRatio 2 settles, its viewport is hidden for a second, and it
shows again. In Chromium the build before fails it: page 1 shows its
base, 488 device pixels wide instead of the detail's 1952, and the viewer
draws 3 bases while hidden and the 3 details again once shown. The build
after draws nothing.

The check's steps in an ad-hoc script, three runs of each build in turn,
with canvas memory counted as `commit-bench.ts` counts it; the drawings
and the memory were the same in every run of a build, in both browsers (the one-minute load average went
from 7 to 11 on 12 cores during Chromium's runs, and up to 83 during
WebKit's):

| Build | Canvas MiB shown | While hidden | Shown again | Drawn while hidden (base / detail) | Drawn once shown | Sharp once shown, Chromium (ms) | WebKit (ms) |
|---|---:|---:|---:|---:|---:|---:|---:|
| before | 65.4 | 4.1 | 69.5 | 3 / 0 | 0 / 3 | 42 (39–51) | 128 (109–134) |
| after | 65.4 | 65.4 | 65.4 | 0 / 0 | 0 / 0 | 12 (6–12) | 8 (8–8) |

What it costs: a hidden viewer holds the canvases it showed, 65 MiB here
instead of 4 MiB, within the same budgets as when it shows.

`commit-bench.ts` (bill-hr815.pdf, 820×1000 at devicePixelRatio 2, its 11
zoom commits; `commit-kept-detail-<browser>.md`): in Chromium every
scenario drew the same bases and details, with the same canvas memory,
before and peak, and no frames with a blank page or a page down to its
base; the load average went from 72 to 14 during the run. In WebKit
(load average 12 to 38) every scenario but one drew the same: in
zoom-twice, two zooms 30 ms apart, both builds drew 7 details with 2
cancelled in some runs and 9 with 1 in others, as the first zoom's
drawings finished before the second or not, so its medians differ by that
(9 → 7 details). Times to sharp moved both ways within the spread
(Chromium zoom-in-whole 14 → 8 ms, zoom-step 9 → 12).

`zoom-bench.ts` (bill-hr815.pdf zoomed from fit-width to 1.5, 2.5, 4, and 8
on the desktop and phone viewports; `zoom-kept-detail-bill-hr815-chromium.md`):
every case drew the same, with the same canvas memory; times within the
spread (load average 14 to 17).

No benchmark reaches the second case with the default budgets. The
planner's tests keep its invariants through a zoom that leaves a quick
detail no room (`maxCanvasPixels` 2 MP, `maxBasePixels` 1 MP), and the
renderer's tests that the page shows the detail until its base is drawn.

## Consequences

- A viewer hidden and shown again, as in tabs or `<Activity>`, shows its
  pages as they were, without drawing them again, and holds their canvases
  while hidden. An application that hides many viewers and wants their
  memory back unmounts them, or lowers `maxDetailPixels`.
- A page never goes blank because a zoom left it no detail; it shows the
  detail, scaled, until its base arrives.

## Reopen if

Hidden viewers' canvases show up as memory pressure, as on phones with
several viewers mounted, or a measurement shows a kept detail, scaled,
looking worse than a blank page until the base arrives.
