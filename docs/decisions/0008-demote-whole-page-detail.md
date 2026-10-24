# 0008. A whole-page detail becomes the base when zooming past its budget

- Status: pending
- Date: 2026-10-24
- Being measured on branch `claude/frame-bench`

## Context

Zoomed in past the budget of a page's whole-page detail (16 MP), the
visible page gets a detail of part of it, pages outside the viewport get
none, and every mounted page draws a new base at the new zoom: all of the
page, on the main thread beside the visible detail. From fit-width to 5,
that was five base drawings (`commit-bench.ts`, zoom-in-far).

## Idea

The whole-page detail the page showed, scaled down to a base's resolution,
becomes its base instead: under the new partial detail once it is drawn,
and alone on pages outside the viewport.

## Evidence so far

- Copied at its own resolution, the first variant: zooming from fit-width
  to 5 got sharp after 11 instead of 25 ms in Chromium, with no base drawn
  instead of five, but peak canvas memory rose from 104 to 137 MiB, and
  zooming from 5 back to fit-width took 18 instead of 9 ms
  (`examples/prototype/results/commit-demote-unscaled-chromium.md`).
  Zooming to 4× and 8× on a phone-sized viewport got sharp after 12 to 13
  instead of 28 ms on synthetic-vector-200k.pdf in Chromium, and, in a
  single run in Firefox, after 54 to 70 instead of 220 ms on bill-hr815.pdf
  and 85 to 169 instead of 253 to 337 on the vector page; on a
  desktop-sized viewport the results were mixed (bill-hr815.pdf at 8×: 46
  against 27 ms in Chromium) (`zoom-demote-unscaled-*.md`).
- Scaled down to the base's resolution, which keeps memory as before: being
  measured in Chromium, Firefox, and WebKit (`zoom-bench.ts` on
  bill-hr815.pdf and synthetic-vector-200k.pdf, and `commit-bench.ts`'s
  zoom scenarios, against the build before).

## Decide when

Those results are in: adopt the scaled variant if no scenario gets slower
beyond the runs' spread and memory stays as before.
