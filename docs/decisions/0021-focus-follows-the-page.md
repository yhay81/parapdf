# 0021. Focus follows the page being read

- Status: adopted
- Date: 2026-10-29

## Context

VoiceOver in Safari on macOS reads from the first mounted page after the
view moves, stays at an internal link after following it, and loses the
keyboard focus when its page unmounts. The manual results and announcements
are in `examples/prototype/results/voiceover-safari-macos.md` (#32).

## Decision

- Make page hosts focusable, outside the tab order (`tabindex="-1"`).
  While the viewport or a page holds the focus, a current-page change
  schedules focus on that page after React mounts it. Focus never scrolls
  the view again.
- Internal destinations and named page actions move focus to their page.
  If the focused page unmounts, restore focus on the current page. Cancel
  pending work when the viewport detaches.
- Keep a text-selection drag and anything the reader focused meanwhile,
  including a field inside the viewer. The scheduled move remembers the
  element it came from; a move to the body is expected only when that
  element unmounted. Application controls keep their focus.
- Name comment icons by their contents, author, or kind, and move form
  tooltips from the surrounding section onto the control. These are names
  pdf.js leaves to its viewer's localization, which ParaPDF does not load.

The current-page listener returns immediately on other store updates;
scrolling still publishes no React state per frame.

## Evidence

The manual VoiceOver report records the original failures and repeats the
steps after the initial fixes. Automated review reproduced two remaining
failures before fixing them: pending page focus displaced a field chosen
meanwhile, and a `NextPage` link left focus behind. `check:document` and
`check:links` cover both, together with mouse and keyboard link activation,
focus restoration after unmount, and the annotation names. `check:text`
checks focus following and text-selection drags; `check:viewers` checks
independent viewports and their lifetimes.

`scroll-bench.ts` compared runtime d89fddb with `main` at 43ddb76, in
turn, job by job: three runs of each file and speed in Chromium 156,
WebKit 27.2, and Firefox 157 on an Apple M2 Pro, macOS 27.0.0, AC power.
`FOCUS=1`, added to the runner here, focuses the viewport before scrolling
and checks that it retains focus. Both builds therefore exercise the
focused reading path. The reports and all per-job samples are in
`examples/prototype/results/focus-follow-{chromium,webkit,firefox}.{md,json}`
and the corresponding `-runs.json` files.

The jobs used `MAX_LOAD=16` in Chromium and WebKit and 8 in Firefox.
One-minute load averages at the start and end ranged from 3.0 to 12.5;
WebKit and Firefox each waited once, together about four minutes. No job
overlapped another Playwright browser. An interrupted battery run and a
Firefox run interrupted by an external load spike above 140 were discarded.
The completed measurements below contain AC-powered jobs only.

Median blocked main-thread time over four seconds, before → after:

| Browser | bill-hr815.pdf, 900 px/s | bill-hr815.pdf, 3600 px/s | 1000 pages, 900 px/s | 1000 pages, 3600 px/s |
| --- | --- | --- | --- | --- |
| Chromium | 26 → 30 ms | 10 → 10 ms | 27 → 41 ms | 7 → 9 ms |
| WebKit | 13 → 21 ms | 7 → 9 ms | 4 → 9 ms | 13 → 4 ms |
| Firefox | 84 → 83 ms | 92 → 98 ms | 75 → 56 ms | 111 → 112 ms |

- Every job had zero blank area and zero blank frames.
- Median React commits were 4 and 20 for the bill at the two speeds, and
  4 and 24 for the 1000-page document, in both builds except WebKit's fast
  1000-page case, 23 → 24. They still follow mounted-window and current-page
  changes, not every animation frame.
- Canvas-memory medians matched except in that WebKit case, 232 → 111 MiB,
  with different drawings completed and kept; this is no change to a
  budget and no memory improvement is claimed. JavaScript heap was not
  measured.
- Chromium and Firefox had zero median dropped frames. WebKit's medians
  rose from 7 to 9 and 10 to 16 on the bill, and from 6 to 9 on the slow
  1000-page case; the fast case stayed at 11. The per-job samples retain
  those losses as well as the wins.
- First-paint medians changed by −54 to +34 ms; the individual runs'
  ranges overlapped in every cell. Blocked-time ranges overlap too: for
  Chromium's slow 1000-page case, 23–50 ms before and 21–50 after. These
  runs establish no speed improvement. WebKit's fast 1000-page jobs had
  maximum frame intervals up to 420 ms before and 482 ms after; these long
  stalls limit what the timing medians establish.

Accept the measured focused-scrolling cost for keeping the reader's place:
the largest increase between blocked-time medians is 14 ms over four
seconds, and focus changes once per current-page change while reading,
outside React's per-frame path. Fixing the reproduced screen-reader
failures makes this a deliberate correctness tradeoff.

To repeat, build the two runtimes into separate directories and run the
runner with `DIST=<after> BEFORE=<before> BEFORE_LABEL=43ddb76 VARIANTS=pdfjs
FOCUS=1 RUNS=3 MAX_LOAD=16 BROWSER=<browser> OUTPUT=focus-follow-<browser>`
(`MAX_LOAD=8` for Firefox).

## Consequences

A reader starts at the page shown rather than the first overscanned page.
Links still follow the page's text in reading order, and reading after a
link starts at its destination page's top. NVDA and VoiceOver on iOS still
need the checks tracked by #32; the macOS report does not verify them.

## Reopen if

Another screen reader or a document interaction loses its place with this
focus policy, or measurements show a repeatable regression.
