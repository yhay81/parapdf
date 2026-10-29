# 0022. Keep runtime policies in the modules that own them

- Status: adopted
- Date: 2026-10-29

## Context

The target separates pure layout, zoom, and navigation rules from the
viewer that applies them. Some rules still lived in the viewer, and the
renderer mixed the lifetime and budget of kept canvases with drawing.
Editor types and labels lived beside its pdf.js integration, and the React
features module also owned the viewer's lifetime and a general store hook.

## Decision

- Put kept canvases in `render/kept-canvases.ts`. The renderer still
  decides which canvases a page keeps and mounts them again; the cache
  counts pixels, checks content and rotation, evicts, and releases them.
  Keep the budgets and deferred eviction of decision 0004, including the
  old budget check before creating an eviction iterator: a cache within
  its limit does no iteration and allocates no iterator.
- Put flip targets in `navigation.ts` and requested zoom in `zoom.ts`,
  covered by unit tests. Keep DOM writes in the viewer and preserve the
  order in which layout, geometry reads, scrolling, and state publication
  happen. Share its navigation application and relayout code.
- Share `clamp`, rotation normalization, the PDF-to-CSS scale, and the
  planner's scale comparison rather than keeping copies. Distinguish the
  page viewport and page sharpness from the viewer's.
- Separate the editor's types and labels from its integration. The label
  module declares `"use client"` because it reads and changes the DOM;
  importing the types loads no editor code.
- Put `useViewer` in `react/viewer.ts` and `useStore` with the other store
  bindings. Keep the viewer's hold/release and StrictMode behavior.

Rendering budgets and intended behavior stay the same. The per-page
diagnostic reachable through `viewer.renderer` is renamed from
`sharpness()` to `pageSharpness()`; this break is recorded in the changelog.
The viewport diagnostic is still `viewer.sharpness()`.

## Evidence

The pure rules have unit tests; 552 unit tests pass with the focus fixes
of decision 0021 included. The functional and module-loading checks cover
the integration, including the editor labels staying out of a minimal
viewer.

The scroll benchmark compared runtime 2bbaa4a with d89fddb, which already
has decision 0021's focus behavior, in turn, job by job. It used `FOCUS=1`,
three runs per file and speed, AC power, `MAX_LOAD=8`, an Apple M2 Pro,
macOS 27.0.0, and Chromium 156, WebKit 27.2, and Firefox 157. One-minute
load averages at the start and end ranged from 4.0 to 6.2. No job waited
for or overlapped another Playwright browser.

Reports and every job's samples are retained in
`examples/prototype/results/cohesion-follow-{chromium,webkit,firefox}.{md,json}`
and the corresponding `-runs.json` files. Median blocked main-thread time
over four seconds, before → after:

| Browser | bill-hr815.pdf, 900 px/s | bill-hr815.pdf, 3600 px/s | 1000 pages, 900 px/s | 1000 pages, 3600 px/s |
| --- | --- | --- | --- | --- |
| Chromium | 38 → 33 ms | 44 → 51 ms | 44 → 47 ms | 69 → 44 ms |
| WebKit | 43 → 57 ms | 97 → 95 ms | 19 → 18 ms | 20 → 11 ms |
| Firefox | 77 → 76 ms | 104 → 103 ms | 32 → 53 ms | 92 → 102 ms |

- Every job had zero blank area and zero blank frames. Canvas-memory
  medians matched in every pair; JavaScript heap was not measured.
- React-commit medians matched in every pair: 4 and 20 for the bill at
  the two speeds, except WebKit's fast case, 19 in both; 4 and 24 for the
  1000-page document. They follow mounted-window and current-page changes.
- Chromium and Firefox had zero median dropped frames. WebKit's medians
  matched at 9 in both slow cases, changed 34 → 35 in the fast bill case,
  and 14 → 13 in the fast 1000-page case.
- First-paint medians moved by −21 to +31 ms. Timing remains noisy even
  with load gating: the samples retain a 741 ms blocked-time outlier in
  Firefox's baseline slow bill case and 240 ms in the branch's fast one.
  These are sums over four seconds, not individual stall lengths.

An initial run at 45da2a0 is retained as `cohesion-initial-*`, with all its
samples too. It used the same paired method, AC power, and `MAX_LOAD=16`;
one Chromium job was repeated after another Playwright browser overlapped
it. Chromium's fast bill medians were 46 → 64 ms, and WebKit's fast
1000-page case had 13 → 36 dropped frames and 111 → 353 MiB of canvases.
Review then restored the cache budget's fast exit before the final run.
The iterator's effect on those timing differences was not isolated; the
final run establishes no speed improvement from it.

Accept these mixed measurements, including up to 21 ms more median blocked
time over four seconds, for keeping policies independently testable and
removing duplicated application code. The drawing policy, pixel budgets,
and React's frame behavior are preserved; the initial extraction's extra
iterator in the cache's common path is removed. A repeatable regression
beyond this variability reopens the decision.

To repeat, build the two runtimes into separate directories and run
`DIST=<after> BEFORE=<before> BEFORE_LABEL=d89fddb VARIANTS=pdfjs FOCUS=1
RUNS=3 MAX_LOAD=8 BROWSER=<browser> OUTPUT=cohesion-follow-<browser>`.

## Reopen if

Measurements show a repeatable cost from these module boundaries or shared
helpers, or a policy no longer belongs to the module that holds it.
