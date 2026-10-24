# 0008. A whole-page detail becomes the base when zooming past its budget

- Status: rejected, in the form measured
- Date: 2026-10-24

## Context

Zoomed in past the budget of a page's whole-page detail (16 MP), the
visible page gets a detail of part of it, pages outside the viewport get
none, and every mounted page draws a new base at the new zoom: all of the
page, on the main thread beside the visible detail. From fit-width to 5,
that was five base drawings (`commit-bench.ts`, zoom-in-far).

## Idea

The whole-page detail the page showed, scaled down to a base's resolution,
becomes its base instead: under the new partial detail once it is drawn,
and alone on pages outside the viewport. The scheduler copied it into the
base canvas with one `drawImage()` at the zoom's commit, for every mounted
page that lost its whole-page detail, and when the visible page's partial
detail replaced it.

## Evidence

The build with the copy against the same build without it (kept canvases
alone, decision 0004), measured in turn, job by job, three runs of each,
medians, in `examples/prototype/results/`: `zoom-demote-vs-kept-*.md`
(`zoom-bench.ts`) and `commit-demote-vs-kept-*.md` (`commit-bench.ts`'s
zoom scenarios on bill-hr815.pdf at 820×1000). Against the build before M1
(e10dcc4; `zoom-demote-*.md` and `commit-demote-*.md`), the wins were the
same, and the losses larger in Firefox: zooming out from 5 took 44 instead
of 24 ms, the pinch out 78 instead of 60, and `setScale()` up 86 instead of
64.

Wins:

- Zooming on a phone-sized viewport (390×844 at devicePixelRatio 3) got
  sharp sooner in every browser, with peak canvas memory 85 instead of
  95 MiB on bill-hr815.pdf and 71 instead of 79 on the vector page:

  | Sharp after (ms) | File | Chromium | WebKit | Firefox |
  |---|---|---:|---:|---:|
  | to 4× | bill-hr815.pdf | 43 → 20 | 119 → 67 | 220 → 68 |
  | to 8× | bill-hr815.pdf | 224 → 72 | 134 → 55 | 222 → 55 |
  | to 4× | synthetic-vector-200k.pdf | 29 → 13 | 47 → 29 | 367 → 184 |
  | to 8× | synthetic-vector-200k.pdf | 28 → 13 | 47 → 37 | 254 → 91 |

- From fit-width to 5, no base was drawn instead of five, and the page got
  sharp after 12 instead of 28 ms in Chromium (runs 12, 11, 13 against 23,
  28, 31) and 11 instead of 33 in WebKit; Firefox stayed within its spread
  (102 against 96). WebKit's commit scenarios ran once each: the machine
  went on battery power during that run, and the scripts stopped measuring.

Losses:

- Zooming on a desktop-sized viewport (1280×900 at devicePixelRatio 2) got
  slower in WebKit: 125 against 99 ms to 4× and 82 against 73 to 8× on
  bill-hr815.pdf, 58 against 51 and 49 against 45 on the vector page. The
  comparison with the build before M1 went the same way (136 against 131,
  91 against 82, 63 against 48, 50 against 50). Chromium and Firefox stayed
  within a few ms, except Firefox on the vector page: 256 against 245 to
  4×, and 123 against 156 to 8×.
- Canvas memory on the desktop viewport ended 6 MiB higher in every
  browser (88 against 82 MiB on bill-hr815.pdf, 72 against 66 on the vector
  page), with peaks up to 8 MiB higher: pages outside the viewport held the
  copied base at once, where the build without it had not drawn theirs yet.
- From 5 back to fit-width, Chromium got sharp after 20 instead of 11 ms
  (runs 13, 20, 21 against 6, 16, 11; against the build before M1, 19, 14,
  15 against 8, 13, 10).
- The first variant, copied at its own resolution instead of the base's:
  zooming from fit-width to 5 got sharp after 11 instead of 25 ms in
  Chromium, but peak canvas memory rose from 104 to 137 MiB, and zooming
  from 5 back to fit-width took 18 instead of 9 ms
  (`commit-demote-unscaled-chromium.md`; `zoom-demote-unscaled-chromium-*.md`
  for the zoom benchmark, where a desktop-sized viewport was mixed:
  bill-hr815.pdf at 8×, 46 against 27 ms).

## Why rejected

The criterion set before measuring, that no scenario gets slower beyond
the runs' spread and memory stays as before, does not hold: zooming on
desktop-sized viewports in WebKit, zooming out in Chromium, and memory on
desktop-sized viewports got worse, while phone-sized viewports gained the
most. The copies run on the main thread at the zoom's commit, before the
visible page's detail starts. On a phone a whole-page detail at fit-width
is small, about 1.6 MP, and the base drawn instead is a full drawing of the
page; on a desktop it is about 8 MP, and scaling it down cost WebKit more
than the base drawings it saved.

The code is kept in the tag `experiment/demote-whole-page-detail`.

## Reopen if

A variant keeps the gains on phone-sized viewports without the losses on
desktop-sized ones. Candidates: copying for pages outside the viewport at
the priority of the base drawings it replaces, after the visible page's
detail starts, rather than at the commit; or copying only whole-page details
below a size. Such a variant is a decision of its own, measured as this one
was: `zoom-bench.ts` and `commit-bench.ts` against the build before it, in
Chromium, WebKit, and Firefox.
