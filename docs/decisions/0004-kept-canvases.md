# 0004. Pages keep their canvases when they unmount

- Status: adopted
- Date: 2026-10-24
- Implemented in M1; since M5 the kept canvases move into the page's new
  host instead of being copied into new ones (decision 0010); the default
  budget rose from six to twelve viewports on 2026-10-27 (see "Budget")

## Context

A page that left the mounted window (the visible pages and two overscan
pages each way) zeroed its canvases and released pdf.js's page data, so
going back to it, by a link's `back()`, by scrolling back, or by flipping
back, drew it again from nothing.

## Decision

A page that unmounts keeps its canvases as they are, up to `maxKeptPixels`
(by default twelve viewports' worth of device pixels; 0 keeps none). When the
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

## Budget

The default budget was left open, and six viewports first. On 2026-10-27
the return benchmark measured the budgets against each other
(`return-kept-budget-*.md`): the build of f397dfb at
820×1000, devicePixelRatio 2, and fit-width, with pdf.js drawing on the
main thread into GPU-backed canvases. Each run took the variants in turn,
three runs each; the results are medians. A new scenario,
long-scroll-back, scrolls 20 pages down and back up at 3600 CSS px per
second.

| Scroll back, sharp after (ms) · bases drawn | File | Budget | Chromium | WebKit | Firefox |
|---|---|---|---:|---:|---:|
| 10 pages | bill-hr815.pdf | 6 | 3673 · 3 | 3564 · 3 | 3649 · 3 |
| 10 pages | bill-hr815.pdf | 12 | 2632 · 0 | 2632 · 0 | 2621 · 0 |
| 10 pages | synthetic-vector-pages.pdf | 6 | 3134 · 3 | 3185 · 3 | 3137 · 3 |
| 10 pages | synthetic-vector-pages.pdf | 12 | 2015 · 0 | 2018 · 0 | 2000 · 0 |
| 20 pages | bill-hr815.pdf | 6 | 7007 · 13 | 6938 · 13 | 7001 · 13 |
| 20 pages | bill-hr815.pdf | 12 | 5982 · 0 | 5977 · 0 | 5970 · 0 |
| 20 pages | synthetic-vector-pages.pdf | 6 | 6067 · 12 | 6063 · 12 | 6070 · 12 |
| 20 pages | synthetic-vector-pages.pdf | 12 | 4915 · 0 | 4920 · 0 | 4904 · 0 |

- Twelve viewports kept every page of both scroll backs. They got sharp
  about a second sooner, drew no base again, and the mean sharpness while
  scrolling back rose from 0.51 to 0.59 to 0.70 to 0.78 over ten pages,
  and from 0.38 to 0.48 to 0.52 over twenty. Main thread blocked time was
  the same or lower: over twenty pages of the vector document in Firefox,
  17 ms instead of 63. No variant showed a blank frame.
- Twenty-four viewports measured the same as twelve: these ways back keep
  no more than twelve.
- Jumping back from page 13 and flipping back were as fast with six as with
  twelve: three pages, or six flips, fit in either.
- The cost is memory: kept canvases peaked at 116 to 139 MiB instead of 62
  to 72. Within `maxCanvasPixels` they still count as canvases and go
  before any page's, so they never keep a page from drawing.

Against the build before the change (687293f, six viewports), in the same
run, job by job:

- Scrolling forward (`scroll-bench.ts`, 1280×900 at devicePixelRatio 2,
  `scroll-kept12-*.md`) drew the same pages with no blank area in every
  browser. Main thread blocked time stayed within the runs' spread, except
  in Firefox with GPU-backed canvases, pdf.js's default, on
  synthetic-text-1000.pdf at 3600 CSS px per second: over ten runs
  (`scroll-kept12-fast-firefox.md`, `scroll-kept12-fast2-firefox.md`) the
  median was about 62 ms over four seconds instead of 44, and one run
  stalled for 1.7 s (one of the build before's, 135 ms). Without GPU-backed
  canvases, and on bill-hr815.pdf, Firefox stayed within the spread, and so
  did WebKit (`scroll-kept12-fast-webkit.md`).
- Zoom commits (`commit-bench.ts`, `commit-kept12-*.md`) drew the same
  bases and details, with times to sharp within the runs' spread.
- Nine viewports (`return-kept-budget9-*.md`, `scroll-kept9-fast-firefox.md`)
  kept the same Firefox loss, about 60 ms instead of 45, while scrolling
  back got sharp sooner only over ten pages of the vector document: the
  other ways back needed twelve.

The Firefox loss is accepted for what twelve viewports bring every browser
on the way back, which in Firefox includes less blocked time while
scrolling back (20 instead of 60 ms over ten pages of bill-hr815.pdf, 31
instead of 126 over twenty of the vector document).

## Consequences

- The copies that draw kept canvases back are accepted: a few ms of main
  thread per layer, up to 39 ms more over a scroll back without dropped
  frames, against pages that show at once. M5 removes them: the renderer
  owns the page DOM, so a kept canvas moves into the page's new host
  without a copy.
- Twelve viewports hold up to twice the memory of six: about 160 MiB at
  this viewport. In Firefox with GPU-backed canvases, scrolling forward
  fast blocks the main thread somewhat more (above). Open: whether iOS Safari counts kept canvases toward its
  canvas memory cap (not verified; needs a device).

## Reopen if

Memory on phones shows a problem, a way back the benchmark does not
cover needs more than twelve viewports, or the Firefox loss scrolling
forward grows or turns out to come from something a budget can avoid.
