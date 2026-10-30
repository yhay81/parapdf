# 0012. A whole-page detail no larger than a base becomes the base

- Status: adopted
- Date: 2026-10-27

## Decision

When a page's whole-page detail gives way, it becomes the page's base,
instead of a base drawn again, only when it holds no more pixels than a base
may (`maxBasePixels`, 2 MP). On a phone a whole-page detail at fit-width is
about that size (1.8 MP for a Letter page at 390×844 and devicePixelRatio
3); on a desktop it is more than four times that, and decision 0008 found
the copy a loss there.

The planner says which (`demotes`); the renderer copies it with one
`drawImage()` at the base's resolution, when the base is older or less
sharp:

- when a detail of part of the page replaces the whole-page one: the visible
  page keeps showing the whole-page detail, scaled, until the partial one is
  in, and draws no base;
- when a page leaves the viewport, or the zoom leaves it no detail.

## Evidence

Against the build without it, in turn, three runs, medians
([`zoom-demote-small-bill-hr815-chromium.md`](../../examples/prototype/results/zoom-demote-small-bill-hr815-chromium.md)
and the other `zoom-demote-small-*` and `commit-demote-small-*` files).
Zooming on a phone-sized viewport got sharp sooner in every browser and file:

| Sharp after (ms) | File | Chromium | WebKit | Firefox |
|---|---|---:|---:|---:|
| to 4× | bill-hr815.pdf | 191 → 41 | 145 → 69 | 231 → 67 |
| to 8× | bill-hr815.pdf | 223 → 72 | 157 → 55 | 257 → 84 |
| to 4× | synthetic-vector-200k.pdf | 29 → 12 | 57 → 38 | 355 → 203 |
| to 8× | synthetic-vector-200k.pdf | 27 → 11 | 80 → 52 | 252 → 108 |

Peak canvas memory on the phone fell (92 instead of 95 MiB, 71 instead of
79). Desktop-sized viewports and `commit-bench.ts`, where no copy is made,
stayed within the runs' spread.

## Reopen if

A desktop-sized viewport or another device shows a loss from the copy, or
the base's budget changes so that whole-page details on desktops fall within
it.
