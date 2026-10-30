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
removed that work but made painting cost more, and no browser gained
consistently.

## Evidence

- Gecko profiles, bill-hr815.pdf at 900 CSS px/s, three alternating runs:
  container query styles update 32 to 46 ms → 0, but painting 47 to 114 →
  98 to 266 ms, and the whole main thread worked longer in every run.
- `scroll-bench.ts`, 5 runs, median blocked time, container → custom
  properties
  ([`viewport-size-vars-firefox.md`](../../examples/prototype/results/viewport-size-vars-firefox.md),
  [`-chromium`](../../examples/prototype/results/viewport-size-vars-chromium.md),
  [`-webkit`](../../examples/prototype/results/viewport-size-vars-webkit.md)):
  Firefox 59 → 40 ms on bill-hr815.pdf at 900 px/s but 51 → 58 and 76 → 94
  on the 1000-page document; Chromium and WebKit mixed within a few ms.

## Reopen if

Firefox paints the pages as cheaply without the container, or a way to
center pages costs neither the container's style work nor the extra
painting.
