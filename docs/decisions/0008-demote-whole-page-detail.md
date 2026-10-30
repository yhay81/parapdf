# 0008. Every whole-page detail becomes the base when zooming past its budget

- Status: rejected; decision 0012 adopted a narrower form
- Date: 2026-10-24

## Decision

When zooming past the budget of a page's whole-page detail (16 MP), the
detail is not copied into the base whatever its size. Copying every one,
scaled down with one `drawImage()` at the zoom's commit, made phone-sized
viewports sharp much sooner but desktop-sized ones slower and heavier:
scaling down a whole-page detail of about 8 MP cost WebKit more than the
base drawings it saved. Decision 0012 copies only details no larger than a
base.

## Evidence

The build with the copy against the same build without it, three runs,
medians
([`zoom-demote-vs-kept-webkit-bill-hr815.md`](../../examples/prototype/results/zoom-demote-vs-kept-webkit-bill-hr815.md),
[`commit-demote-vs-kept-chromium.md`](../../examples/prototype/results/commit-demote-vs-kept-chromium.md)):

- Phone-sized viewport (390×844 at devicePixelRatio 3), zoom to 4× on
  bill-hr815.pdf, sharp after: 43 → 20 ms in Chromium, 119 → 67 in WebKit,
  220 → 68 in Firefox.
- Desktop-sized viewport (1280×900 at devicePixelRatio 2), WebKit: 125
  against 99 ms to 4× on bill-hr815.pdf; canvas memory 6 MiB higher in
  every browser.
- From 5 back to fit-width, Chromium got sharp after 20 instead of 11 ms.

The code is kept in the tag `experiment/demote-whole-page-detail`.

## Reopen if

A variant keeps the gains on phone-sized viewports without the losses on
desktop-sized ones, measured with `zoom-bench.ts` and `commit-bench.ts`
against the build before it in Chromium, WebKit, and Firefox.
