# 0026. A detail kept while hidden, and until a base replaces it

- Status: adopted
- Date: 2026-10-29

## Decision

Two ways the planner gave back a detail that was all a page showed are
closed:

- An unlimited `maxDetailViewports` (the default) sets no limit, also for an
  empty viewport. A viewer whose viewport is hidden (`display: none`, a
  hidden `<Activity>`, a closed `<details>`) keeps the whole-page details its
  budgets allow and shows them again at once, instead of drawing bases while
  hidden and details again once shown. A finite `maxDetailViewports` still
  allows an empty viewport no detail.
- A visible page whose only pixels are a detail no longer planned keeps it,
  scaled, until its base is drawn, so a zoom that leaves it no detail never
  shows it blank. Until then the kept detail may exceed the budgets, as a
  visible page's base may. The planner does not count such a detail as
  covering the page, so the base is drawn first.

The cost: a hidden viewer holds the canvases it showed. An application that
hides many viewers and wants their memory back unmounts them, or lowers
`maxDetailPixels`.

## Evidence

`check:options` hides a settled viewer of bill-hr815.pdf (1000×900,
devicePixelRatio 2) for a second and shows it again. Three runs of each
build in turn, the same drawings and memory in every run, in Chromium and
WebKit:

| Build | Canvas MiB shown / hidden | Drawn while hidden (base / detail) | Drawn once shown | Sharp once shown, Chromium / WebKit |
|---|---:|---:|---:|---:|
| before | 65.4 / 4.1 | 3 / 0 | 0 / 3 | 42 / 128 ms |
| after | 65.4 / 65.4 | 0 / 0 | 0 / 0 | 12 / 8 ms |

`commit-bench.ts` and `zoom-bench.ts` drew the same bases and details, with
the same canvas memory, in every scenario but WebKit's zoom-twice, whose
drawings vary between runs of either build
([`commit-kept-detail-chromium.md`](../../examples/prototype/results/commit-kept-detail-chromium.md),
[`-webkit`](../../examples/prototype/results/commit-kept-detail-webkit.md),
[`-firefox`](../../examples/prototype/results/commit-kept-detail-firefox.md),
[`zoom-kept-detail-bill-hr815-chromium.md`](../../examples/prototype/results/zoom-kept-detail-bill-hr815-chromium.md)).
The machine was loaded, so times are not the evidence.

No benchmark reaches the second case with the default budgets; the
planner's and renderer's unit tests cover it.

## Reopen if

Hidden viewers' canvases show up as memory pressure, as on phones with
several viewers mounted, or a kept detail, scaled, looks worse than a blank
page until the base arrives.
