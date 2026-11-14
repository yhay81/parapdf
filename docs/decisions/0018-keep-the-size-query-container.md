# 0018. The scroller stops being a size query container

- Status: rejected
- Date: 2026-10-28

## Decision

The scroller stays a size query container (`containerType: "size"`), so
pages are centered with `100cqw` and `100cqh` and a resize moves them
without a React render. In Firefox every style update inside the container
also runs a container query styles update, which pdf.js's `TextLayer`
triggers by measuring each run with `measureText` after appending the
previous one. Writing the scroller's size into custom properties instead
removed that work without making painting cost more, but it adds code and
did not consistently lower blocked time in any browser: Firefox's
differences went both ways, and differences as large did not repeat from
one set of runs to the next.

## Evidence

- Gecko profiles of Firefox 157's content process, bill-hr815.pdf at 900
  CSS px/s, five per build, alternating, with the one-minute load average
  below 5. Median CPU time, with the range for the noisy rows, container →
  custom properties: container query styles update 43 → 0 ms, styles 59 →
  17, and `measureText` 52 → 20, while display list building, 38 (19 to
  90) → 41 (17 to 60), and the whole main thread, 769 (729 to 927) → 725
  (666 to 835), stayed within the profiles' spread. Three earlier profiles,
  under a far higher load, had shown painting growing without the
  container; the quieter five do not.
- `scroll-bench.ts`, 5 runs, median blocked time, container → custom
  properties
  ([`viewport-size-vars-firefox.md`](../../examples/prototype/results/viewport-size-vars-firefox.md),
  [`-chromium`](../../examples/prototype/results/viewport-size-vars-chromium.md),
  [`-webkit`](../../examples/prototype/results/viewport-size-vars-webkit.md)):
  Firefox 59 → 40 ms on bill-hr815.pdf at 900 px/s but 51 → 58 and 76 → 94
  on the 1000-page document; Chromium and WebKit mixed within a few ms.
- Differences of this size in Firefox did not repeat. `scroll-bench.ts`,
  median blocked time at 900 px/s, text layers filled in the page → out of
  it (decision 0020), which in the same set of profiles left 8 ms of
  container query styles update and 4 of `measureText`: 59 → 41 ms on
  bill-hr815.pdf and 33 → 63 on synthetic-text-1000.pdf, whose runs spread
  from 23 to 285 ms, in 7 runs
  ([`text-layer-detached-firefox.md`](../../examples/prototype/results/text-layer-detached-firefox.md)),
  then 54 → 53 and 43 → 34 in 11 more runs of the same builds
  ([`text-layer-detached-11-firefox.md`](../../examples/prototype/results/text-layer-detached-11-firefox.md)).

## Reopen if

More runs, on a quieter machine or with another document, show the
scroller without the container blocking the main thread less in Firefox
without costing Chromium or WebKit, or pdf.js's `TextLayer` stops
measuring in the live document.
