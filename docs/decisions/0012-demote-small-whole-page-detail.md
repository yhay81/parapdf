# 0012. A whole-page detail no larger than a base becomes the base

- Status: adopted
- Date: 2026-10-27

## Context

Decision 0008 copied a page's whole-page detail into its base when zooming
past the detail's budget, instead of drawing a base again. It made zooming
on phone-sized viewports sharp much sooner, but was rejected for its losses
on desktop-sized ones: scaling down a whole-page detail of about 8 MP cost
WebKit more than the base drawings it saved, and the copies held memory.
It named a candidate: copying only whole-page details below a size.

## Decision

A whole-page detail becomes the page's base only when it holds no more
pixels than a base may (`maxBasePixels`, 2 MP): on a phone a whole-page
detail at fit-width is about that size (1.8 MP for a Letter page at
390×844 and devicePixelRatio 3), on a desktop more than four times that.
The planner says which (`demotes`); the renderer copies it with one
`drawImage()`, scaled to the base's resolution, when the base is older or
less sharp, in two places:

- When a detail of part of the page, drawn into the spare, replaces the
  whole-page one: the visible page draws no base after the zoom, and keeps
  showing the whole-page detail, scaled by CSS, until the partial one is in.
- When a page leaves the viewport, or the zoom leaves it no detail: the
  copy becomes its base before the detail is given back.

Larger whole-page details give way to a base drawn again, as before.

## Evidence

The build with the copy against `main` (c7205d4) in the same run, job by
job, three runs of each, medians, in `examples/prototype/results/`:
`zoom-demote-small-<file>-<browser>.md` (`zoom-bench.ts`, pdfjs-hwa,
bill-hr815.pdf and synthetic-vector-200k.pdf) and
`commit-demote-small-<browser>.md` (`commit-bench.ts`). Load average 3.4
to 6.6 on 12 cores during these runs.

Zooming on a phone-sized viewport (390×844 at devicePixelRatio 3) got sharp
sooner in every browser and file:

| Sharp after (ms) | File | Chromium | WebKit | Firefox |
|---|---|---:|---:|---:|
| to 4× | bill-hr815.pdf | 191 → 41 | 145 → 69 | 231 → 67 |
| to 8× | bill-hr815.pdf | 223 → 72 | 157 → 55 | 257 → 84 |
| to 4× | synthetic-vector-200k.pdf | 29 → 12 | 57 → 38 | 355 → 203 |
| to 8× | synthetic-vector-200k.pdf | 27 → 11 | 80 → 52 | 252 → 108 |

- Peak canvas memory on the phone fell: 92 instead of 95 MiB on
  bill-hr815.pdf and 71 instead of 79 on the vector page. At the end of the
  zoom the vector page held 71 instead of 72 MiB; bill-hr815.pdf held 92
  instead of 88 (and 85 to 92 instead of 81 to 88 after the pan), with the
  copies kept as bases where `main` had let the details go.
- Panning at that zoom on the phone stayed within 3 ms (12 to 16 ms in
  every case).
- Desktop-sized viewports (1280×900 at devicePixelRatio 2), where no copy
  is made, stayed within the runs' spread: for example 66 against 78 ms to
  4× on bill-hr815.pdf in Chromium, 102 against 127 in WebKit, 99 against
  102 in Firefox; the canvas memory was the same.
- `commit-bench.ts` (820×1000 at devicePixelRatio 2, where no copy is made
  either) drew the same bases and details in every scenario, with times to
  sharp within the runs' spread: zoom-in-far 23 against 36 ms in Chromium,
  58 against 48 in WebKit, 105 against 105 in Firefox; zoom-out-far 11
  against 8, 7 against 7, and 33 against 38.

## Consequences

- On phones, zooming in past the whole-page detail's budget draws no base
  for the visible page and none for the pages around it: the whole-page
  details they showed become their bases.
- The copy runs on the main thread at the zoom's commit for the pages that
  lose their detail, one `drawImage()` of at most 2 MP each.
- Pages outside the viewport keep a base after such a zoom, which can hold
  a few MiB more than `main` held at rest, within the peak it reached.

## Reopen if

A desktop-sized viewport or another device shows a loss from the copy, or
the base's budget changes so that whole-page details on desktops fall
within it.
