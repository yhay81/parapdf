# 0004. Pages keep their canvases when they unmount

- Status: adopted
- Date: 2026-10-24
- Implemented in M1

## Context

A page that left the mounted window (the visible pages and two overscan
pages each way) zeroed its canvases and released pdf.js's page data, so
going back to it, by a link's `back()`, by scrolling back, or by flipping
back, drew it again from nothing.

## Decision

A page that unmounts keeps its canvases as they are, up to `maxKeptPixels`
(by default six viewports' worth of device pixels; 0 keeps none). When the
page mounts again, they are drawn into its new canvases, one GPU copy each,
and it shows at once. Canvases mounted again as they are, as React's
StrictMode does when a page mounts, stay untouched. Over the budget, the least recently kept go, but only after the pages
mounting in the same React commit took theirs back: React unmounts pages
before it mounts others, and trimming at once let a jump away and back drop
the very pages it came back to. Within `maxCanvasPixels`, kept canvases
count as canvases and go before any page's.

Nothing is kept of a page whose form fields are shown as HTML: pdf.js draws
check boxes, radio buttons, and some fields into canvases of their own,
which only a render hands to the page's annotation layer. Nothing is kept
either while the viewer has no viewport, and what was kept goes when the
viewport goes: React runs the viewport's cleanup before its pages', so a
viewer hidden in `<Activity>` keeps nothing either.

## Evidence

The return benchmark (`examples/prototype/scripts/return-bench.ts`,
results in `examples/prototype/results/return-*.md`) ran M1's build at
820×1000, devicePixelRatio 2, and fit-width, with pdf.js drawing on the
main thread into GPU-backed canvases, three runs of each variant in turn
with the build before (e10dcc4); medians.

| Way back, sharp after (ms) | File | Chromium | WebKit | Firefox |
|---|---|---:|---:|---:|
| page 13 → page 1 | bill-hr815.pdf | 23 → 3 | 27 → 11 | 176 → 38 |
| page 13 → page 1 | synthetic-vector-pages.pdf | 167 → 5 | 172 → 3 | 168 → 19 |

- On the way back from page 13, nothing was drawn and no frame showed a
  blank page.
- Scrolling ten pages back at 3600 CSS px per second drew 3 bases instead
  of 7, and flipping eight pages back 50 ms apart drew 1 or 2 details
  instead of 6, with the same blank area on screen and a mean sharpness of
  0.59 instead of 0.51 while scrolling back over the vector pages: the
  default budget keeps the pages scrolled past rather than the sharp ones
  the scroll started from.
- Kept canvases held 58 to 65 MiB.
- Drawing kept canvases back is a copy on the main thread for each layer.
  Over the scroll back on bill-hr815.pdf, which drew five layers back,
  Chromium's main thread was blocked 60 instead of 21 ms (longest lag 17
  instead of 8) and WebKit's 41 instead of 23, without more dropped frames;
  Firefox's 52 instead of 59. On the vector pages: 1 instead of 3 in
  Chromium, 19 instead of 8 in WebKit, and 62 instead of 76 in Firefox.
  Flipping back over bill-hr815.pdf blocked Chromium 42 instead of 15 ms,
  while each page flipped back to got sharp within 2 ms of the build before
  at the median (11 instead of 13 ms in Chromium), and at most 3 ms later
  (24 instead of 21 in Firefox). The same run on a build that also kept parsed pages
  (`return-keep-parsed-*.md`, decision 0007) found 41 against 39 ms in
  Chromium and 39 against 17 in WebKit over that scroll back: Chromium's
  cost varies from run to run.
- Zoom commits (`commit-kept-*.md`, kept canvases counted in canvas
  memory) drew the same, with the same peak memory, and got sharp within
  the runs' spread, except a 10% zoom step in WebKit, 12 against 6 ms (runs
  16, 9, 12 against 6, 6, 6), during which no page unmounts or mounts
  again.
- Keeping the elements adds no work when pages unmount. Copies instead
  (`createImageBitmap()`) cost Firefox 2 to 4 ms per 3.6 MP 2D canvas
  (`bench/scripts/frame-ops.ts`); in the frame experiment (0005), keeping
  copies blocked Firefox's main thread 160 and 166 ms over a scroll back
  (bill-hr815.pdf, the vector pages; `return-frames-firefox.md`), against
  37 and 135 with frames alone and 48 and 70 drawing in place.

## Consequences

- The copies that draw kept canvases back are accepted: a few ms of main
  thread per layer, up to 39 ms more over a scroll back without dropped
  frames, against pages that show at once. M5 removes them: the renderer
  owns the page DOM, so a kept canvas moves into the page's new host
  without a copy.
- Open, with no decision yet: the default budget (more keeps more of a long
  scroll back, at more memory), and whether iOS Safari counts kept canvases
  toward its canvas memory cap (not verified; needs a device).

## Reopen if

Memory on phones shows a problem, or a budget measured on a long scroll
back pays for its memory.
