# 0010. The renderer owns each page's DOM, and kept canvases move

- Status: adopted
- Date: 2026-10-26
- Implemented in M5

## Context

Until M5, React rendered each page's canvases and layer containers, and the
scheduler drew into them. A page that came back after unmounting got new
canvases from React, so the canvases it kept (decision 0004) were drawn
into them: one copy on the main thread per layer, which decision 0004
measured at up to 60 ms of blocked main thread over a scroll back in
Chromium, and which `createImageBitmap()` copies made worse in Firefox.
`target.md` gives the page's DOM to the renderer and decides rendering in a
pure planner.

## Decision

- The planner (`src/render/planner.ts`) is pure functions of the view, the
  budgets, and what each page shows and draws. The 0.x heuristics moved
  into it unchanged; Node tests check its invariants over 300 generated
  views: a visible page never stays blank, the budgets hold except for
  visible bases, no base starts under a whole-page detail, and a drawing
  just started is never given back.
- The renderer (`src/render/renderer.ts`) builds each page's canvases (base,
  detail, spare) and its text, structure, annotation, and editor
  containers at the start of the host React places, before React's own
  children, and takes them out when the page unmounts.
- A page that unmounts keeps its canvases as before (decision 0004); when
  it mounts again, the same canvas elements move into its new host. No
  pixel is copied, and `drawKept()` is gone.
- New canvases start at 0 × 0 and hidden. React's started at 300 × 150 and
  counted 45,000 pixels each within `maxCanvasPixels` until first drawn.

## Evidence

The return, scroll, commit, and zoom benchmarks ran M5 against M4
(6325a81) in turn, job by job, in Chromium, WebKit, and Firefox, three
runs each (`examples/prototype/results/*-m5-*`); medians. The cells that
differed most were measured again, five runs in each order
(`*-m5-repeat-m5-*`, `*-m5-repeat-swapped-*`).

| Coming back to a page (ms), kept canvases | File | Chromium | WebKit | Firefox |
|---|---|---:|---:|---:|
| jump-back, sharp after | bill-hr815.pdf | 5 → 6 | 12 → 10 | 17 → 8 |
| jump-back, sharp after | synthetic-vector-pages.pdf | 4 → 4 | 7 → 9 | 12 → 9 |
| jump-back, main thread blocked | bill-hr815.pdf | 3 → 14 | 22 → 12 | 17 → 5 |
| flip-back, sharp after | bill-hr815.pdf | 11 → 9 | 13 → 12 | 8 → 9 |

- Firefox, where copies cost most, came back sharp sooner: in the repeats
  of flipping back over bill-hr815.pdf, 6 against 14 ms and, the other way
  round, 8 against 13.
- Chromium's jump-back blocked its main thread 14 against 3 ms in the
  first run, with nothing drawn and the same three layers shown again. In
  the repeats both builds blocked it 2 ms in one order and 4 in the other,
  and came back sharp after 3 ms.
- Scrolling drew the same layers, committed React as often (the mounted
  window and the current page), and left no blank area. Chromium's first
  paint of bill-hr815.pdf, about 160 against 140 ms in the first run, was
  138 against 138 and 139 against 139 in both orders of the repeats.
- Zoom commits drew the same, got sharp within the runs' spread, and held
  about 1 MiB less at their peaks, the canvases no longer 300 × 150 before
  their first drawing. The phone-sized zoom cases stay bimodal as in M3
  (about 45 or 220 ms to sharp, whichever build measures them).
- Blocked main thread over a scroll back moved by tens of milliseconds
  both ways, as in M3 and M4: in Firefox 43 against 36 ms in one order and
  47 against 55 in the other.

## Consequences

- React renders a page's host and the application's overlay only; what a
  page shows is the renderer's, which M6's overlays as portals build on.
- A canvas moved into a new host keeps its context, the one pdf.js created,
  so the loader no longer needs pdf.js's context options for copies.
- Reopen if a browser loses a canvas's pixels when it moves between
  parents, or if measurements show that moving costs more than copying.
