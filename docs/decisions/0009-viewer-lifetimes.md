# 0009. Each viewport owns its viewer work

- Status: adopted
- Date: 2026-10-25

## Context

M2 made the document a shared session. M3 gives each viewport its own view
and lifetime, including when a viewport unmounts while its document
provider remains mounted. A viewport must be able to cancel its drawing
and feature work without cancelling another viewer of the session.

## Decision

- Move `Viewer`, layout, scrolling, and gestures into `src/view/`. Port
  layout and gesture algorithms unchanged; remove the old class name.
- Separate hot view snapshots (layout, mounted window, current page, scale,
  zoom mode) from cold snapshots (rotation, spread, scroll mode, tool).
  Install all affected snapshots before notifying their readers. Page
  layout subscribes only to hot state. The combined snapshot remains the
  feature/document facade until M4/M6.
- Link each viewer's work to both its viewport's abort signal and its
  document lease. Detaching aborts drawing, searches, printing, and
  background publication, and releases canvases. A mounted provider keeps
  its lease, view position, and edits; reattachment creates fresh viewer
  work and restores them. Closing the provider releases the lease; only
  the last lease closes the session, after the existing grace period.
- Demonstrate this with two providers of the same source in `?split=1`.
  They share a session already. Multiple viewers under one provider and
  the final public hooks remain M6; shared annotation editing remains M4.

## Evidence

Implementation: `af2967e`, compared with M2 `6dd7349`, on 2026-10-25.
Removing the unused old store afterwards changes no bundled runtime code.
The measurements used an Apple M2 Pro (12 logical cores), macOS 27.0.0,
AC power, and Playwright's headless Chromium 156.0.8078.4, WebKit 27.2,
and Firefox 157.0. Every pair ran in turn in the same browser run. No job
waited for or overlapped another Playwright browser.

The initial comparisons have three runs per case in each browser:

- `scroll-m3-<browser>.{json,md}`: two documents,
  `synthetic-text-1000.pdf` and `bill-hr815.pdf`, at 900 and 3600 CSS px/s,
  vertical scrolling at fit-width, four seconds per job. M3 ran first.
- `commit-m3-<browser>.{json,md}`: all ten zoom-commit scenarios on
  `bill-hr815.pdf`, with separate frame-coverage and timing passes. M2 ran
  first.
- `zoom-m3-<browser>.{json,md}`: zoom and pan at scales 4 and 8 on
  `bill-hr815.pdf`, desktop 1280×900 at DPR 2 and phone-sized 390×844 at
  DPR 3. M2 ran first.

The reports are in `examples/prototype/results/`. The raw per-job results
and environments, including the mapping of each report's labels to M2 and
M3, are preserved in
[`m3-runs.json`](../../examples/prototype/results/m3-runs.json), so the
ranges below can be checked after the ignored `results/raw/` is removed.
The results called `pdfjs-hwa` or `as built` are M3 in the initial reports,
but **M2 in the reversed reports**; their `before` variant is M3.

Every job completed without an error. Every scroll job had zero blank
area; every commit probe had zero blank or base-only frames; every zoom
and pan finished at full visible resolution. React committed exactly when
the mounted window or current page changed: 4, 24, 4, and 20 times over
four seconds in the four scroll cases, identically in both builds and all
three browsers. Scroll median blocked-time changes ranged from −12.5 to
+16.4 ms, and first-paint changes from −19.7 to +19.1 ms; the before/after
ranges overlap in every case.

Several initial zoom results had disjoint ranges. They were repeated
**five times with M3 first**, using `commit-m3-swapped-chromium`,
`commit-m3-swapped-webkit`, `commit-m3-swapped-firefox`,
`zoom-m3-swapped-chromium`, and `zoom-m3-swapped-firefox`. The reversed
commit runs cover `zoom-in-far` in Chromium, `zoom-in-far,zoom-twice` in
WebKit, and `scale-up,zoom-in-far` in Firefox. Reversed zoom covers scales
4 and 8 in Chromium and scale 8 in Firefox.

| Case | Unit | Initial medians, M2 → M3 | Reversed M2: median [min–max] | Reversed M3: median [min–max] |
|---|---|---:|---:|---:|
| Chromium commit, zoom-in-far | ms | 26.51 → 36.22 | 31.88 [23.11–35.30] | 40.31 [27.76–42.69] |
| WebKit commit, zoom-in-far | ms | 37.14 → 46.52 | 43.52 [34.70–49.72] | 39.58 [34.40–46.14] |
| Firefox commit, scale-up | ms | 59.66 → 77.52 | 62.08 [52.06–79.30] | 72.06 [56.34–79.48] |
| Firefox commit, scale-up peak | MiB | 237.43 → 251.93 | 237.43 [237.43–251.93] | 251.93 [237.43–251.93] |
| Chromium zoom, phone at 8 | ms | 73.81 → 238.15 | 222.42 [71.53–226.10] | 220.22 [72.08–237.98] |
| WebKit commit, zoom-twice peak | MiB | 192.34 → 202.27 | 202.27 [192.34–202.27] | 202.27 [192.34–202.27] |
| Firefox pan, desktop at 8 | ms | 60.40 → 61.80 | 61.48 [58.30–65.42] | 60.46 [56.96–64.08] |

All these repeated ranges overlap. Chromium's phone zoom shows both a
roughly 70–90 ms group and a roughly 220–240 ms group in **both** builds.
Its initial scale-4 runs already showed the same two-group behavior in
both builds. The unchanged scroll-settle gate can defer detail drawing
after a programmatic zoom's scroll event; this is a plausible cause, not a
causal timing trace. The large initial median difference is not a stable
cost of M3 in this sample.

The WebKit transient canvas peaks switch between 192.34 and 202.27 MiB in
both builds when order is reversed. These correspond to 7 details with 2
cancellations or 9 details with 1 cancellation: how far the intermediate
zoom draws before the second zoom. Firefox's scale-up likewise reaches
both 237.43 and 251.93 MiB in both builds. Canvas-memory accounting includes
kept canvases and excludes pixels inside workers.

Smaller median costs remain: Chromium's reversed `zoom-in-far` is 8.43 ms
slower, and Firefox's reversed `scale-up` is 9.98 ms slower, within the
observed ranges. WebKit's reversed `zoom-in-far` is 3.94 ms faster. In the
initial desktop zoom measurements Chromium is 14.94 ms faster at scale 4
and 11.42 ms faster at scale 8; these are within the observed spread too.
This meets the milestone's criterion of no regression beyond the runs'
spread; it is **not evidence of a speed improvement or of exact equality**.

The `zoom-twice` harness schedules the second action after a Playwright
30 ms wait, so the actual browser-side interval can be longer. Its
`timeToSharp` starts at the first commit and samples animation frames; a
second transition between samples can be missed. Do not read that number
as latency from the final zoom. The separate coverage probe and canvas
peak remain the checks used here for that scenario.

To reproduce, build the prototype from each measured revision in separate
checkouts. In the M3 checkout, for each browser:

```sh
ENGINE=pdfjs BROWSER=chromium VARIANTS=pdfjs-hwa RUNS=3 \
  BEFORE=/path/to/m2/dist BEFORE_LABEL='M2 6dd7349' \
  FILES=synthetic-text-1000.pdf,bill-hr815.pdf SPEEDS=900,3600 DURATION=4000 \
  OUTPUT=scroll-m3-chromium node examples/prototype/scripts/scroll-bench.ts
ENGINE=pdfjs BROWSER=chromium RUNS=3 \
  BEFORE=/path/to/m2/dist BEFORE_LABEL='M2 6dd7349' LABEL='M3 af2967e' \
  OUTPUT=commit-m3-chromium node examples/prototype/scripts/commit-bench.ts
ENGINE=pdfjs BROWSER=chromium VARIANTS=pdfjs-hwa RUNS=3 \
  BEFORE=/path/to/m2/dist BEFORE_LABEL='M2 6dd7349' \
  OUTPUT=zoom-m3-chromium node examples/prototype/scripts/zoom-bench.ts
```

For the reversed runs, use `DIST=/path/to/m2/dist`,
`BEFORE=/path/to/m3/dist`, `BEFORE_LABEL='M3 af2967e'`, `LABEL='M2 6dd7349'`,
`RUNS=5`, and the `SCENARIOS` or `SCALES` listed above, with a distinct
`OUTPUT`. The one-minute load averages and all settings are in each report.


`check:viewers` passes in Chromium, WebKit, and Firefox, both in a
production build and under development StrictMode. It checks one document
open, independent scrolling, navigation, zoom, rotation, and tools;
viewport detach/reattach with the same session and restored view; closing
one viewer while the other searches and draws; and last-release cleanup.
The existing Chromium functional checks, lint, full workspace typechecks,
131 unit tests, and packed-package/SSR checks pass.

Independent review against the target and prior decisions found progress
publication after detach and a search started on a hidden viewport
remaining in the searching state. Both are fixed. The browser check
covers hidden search, and focused review probes verified progress
cancellation and that an old page cleanup cannot detach a new page host.

## Consequences

The renderer and feature methods remain in their current implementation
until M4/M5. This change does not promise a speed improvement or publish a
new package API. It makes the viewport lifetime explicit while preserving
the rendering strategy and the session registry's ownership.

## Reopen if

Measurements show a reproducible cost beyond run-to-run variation, or the
M4/M6 feature and React APIs need a different lifetime contract.
