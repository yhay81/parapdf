# 0045. Settled controlled ViewState, pre-divergence scroll restoration, static tracked proxies, and merged thumbnail subscriptions

- Status: adopted
- Date: 2026-11-15

## Decision

After decisions 0041–0044 tightened the React-only runtime, four remaining
seams between `ViewerController` and `react/` allocated unnecessary closures or
subscriptions or leaked transient unaccepted state on controlled viewers:

1. **Transient `onViewStateChange` emissions and scroll clamping drift on
   rejected controlled view mutations**:
   When `<PdfViewer>` controlled `zoom`, `rotation`, `spread`, or `scrollMode`
   and an imperative call or keyboard shortcut mutated that property,
   `ViewerController` applied the mutation synchronously and notified
   `onViewStateChange` before React committed `<ViewerControlSync>`'s
   `bindControls().sync()` reconciliation. Worse, when a controlled viewer was
   near a scroll boundary (such as `scrollTop === 0` at `zoom={1.5}`) and a
   zoom-out (`zoomBy(0.75)`) clamped `scrollTop` at `0`, the viewport center
   shifted downward in PDF points; reconciling `zoom` back to `1.5` around that
   shifted center left the viewer scrolled ~85–244 CSS pixels down the page and
   emitted two `onViewStateChange` snapshots (the rejected scale and the
   drifted revert). Conversely, following a PDF destination (`XYZ`) that changed
   both the page and a controlled zoom emitted an intermediate unaccepted scale
   before `<ViewerControlSync>` restored the controlled zoom.
2. **Per-snapshot closure and dummy-target allocations in `createTrackedSnapshot`**:
   Every `useStoreSlice()` snapshot evaluation across all seven state hooks
   (`useViewState`, `useDocumentState`, `useSearch`, `useHistory`,
   `useAnnotations`, `useSave`, `usePrint`) allocated a fresh `{}` proxy target,
   a fresh `ProxyHandler` object, and four fresh trap closures (`get`, `has`,
   `ownKeys`, `getOwnPropertyDescriptor`)—eight heap allocations per snapshot
   update.
3. **Separate `useSyncExternalStore` subscriptions per field in
   `<PdfThumbnails>` and `<PdfThumbnail>`, plus uncached `useStoreKeys` object
   selectors**:
   `<PdfThumbnails>` registered four separate `useStoreKeys(viewer.store, …)`
   subscriptions (`pageCount`, `rotation`, `sizes`, `currentPage`) and
   `<PdfThumbnail>` registered two (`rotation`, `sizes`), running multiple
   external-store checks per render because `useStoreKeys` compared snapshots
   with `Object.is` only rather than `shallowEqual`.
4. **Redundant `ViewerStore.#sizes` mirror field and unmemoized
   `<SessionLeaseMount>`**:
   `ViewerStore` duplicated `this.get().layout?.sizes` in a parallel `#sizes`
   field, and `<PdfDocument>` re-reconciled `<SessionLeaseMount>` on every
   parent re-render even when `session` was unchanged.

Adopt four changes:

- **Settled controlled `onViewStateChange` and pre-divergence scroll
  restoration (`src/view/viewer.ts`)**:
  - `ViewerController` tracks bound control leases (`#boundControls`), whether a
    controlled property has diverged (`#controlDiverged`), whether an explicit
    page/destination navigation occurred inside `batchView()` (`#navigated`),
    and the pre-divergence scroll and layout state (`#preDiverge:
    PreDivergeSnapshot | null`).
  - While `#controlDiverged && !#flushingView`, `#notifyViewState()` holds
    `onViewStateChange` emissions so unaccepted controlled values never escape;
    `flushViewState()` (`pagehide`, `#stop()`, viewport detach) sets
    `#flushingView` so genuine teardown flushes are never lost.
  - Inside `bindControls().sync()`, reconciling a diverged viewer clears
    `#controlDiverged` and marks `#viewDirty` when needed:
    - Rejected non-navigation mutations (for example `zoomBy(0.75)` when `zoom`
      is locked to `1.5` at `scrollTop === 0`) restore exact `scrollLeft`,
      `scrollTop`, and `currentPage` from `#preDiverge`, eliminating boundary
      scroll drift and emitting zero `onViewStateChange` snapshots when the
      settled `ViewState` matches `#lastEmittedView`.
    - Accepted controlled updates (`onZoomChange` updating `zoom`) keep zoom
      focal points and emit one settled `ViewState` snapshot once
      `<ViewerControlSync>` confirms the new prop.
    - Compound destination jumps (`goToDestination` changing page and zoom while
      `zoom` is controlled) preserve `#navigated` so the destination page and
      coordinates stay while the controlled zoom wins, emitting one settled
      `ViewState` snapshot.
- **Zero-closure `TRACKED_PROXY_HANDLER` (`src/react/context.ts`)**:
  - `createTrackedSnapshot()` passes `snapshot` itself as the `Proxy` target to
    a single module-level `TRACKED_PROXY_HANDLER` (`get`, `has`, `ownKeys`,
    `getOwnPropertyDescriptor`, `getPrototypeOf`), storing per-instance metadata
    via `Object.defineProperty(snapshot, TRACKED_META, { value: { raw, read } })`
    (non-enumerable Symbols are omitted by `Reflect.ownKeys` and hidden from
    `in` / `getOwnPropertyDescriptor` traps unless equal to `TRACKED_RAW`).
    Per-snapshot heap allocations drop from eight (including four closures) to
    three small objects with zero closure allocations.
- **Shallow-cached `useStoreKeys` and single-subscription thumbnails
  (`src/react/context.ts`, `PdfThumbnails.tsx`, `PdfThumbnail.tsx`)**:
  - `useStoreKeys()` caches selected snapshots with `shallowEqual` (`clientCacheRef`
    / `serverCacheRef`) so multi-field selectors stay referentially stable.
  - `<PdfThumbnails>` collapses its four `viewer.store` subscriptions into a
    single `useStoreKeys(viewer.store, THUMBNAIL_VIEWER_KEYS, selectThumbnailViewerState)`
    call, and `<PdfThumbnail>` collapses its two subscriptions into one
    (`THUMBNAIL_KEYS`).
- **Derived `ViewerStore.sizes` and memoized `<SessionLeaseMount>`
  (`src/view/state.ts`, `src/react/PdfDocument.tsx`)**:
  - `ViewerStore.sizes` reads `this.get().layout?.sizes` directly while `set()`
    compares `prevSizes` (`prev.layout?.sizes`) against `this.sizes` before
    reporting `"sizes"` changed.
  - `SessionLeaseMount` is wrapped in `/*#__PURE__*/ memo(...)` so parent
    re-renders of `<PdfDocument>` with an unchanged `PdfSessionController` skip
    reconciling it.

## Evidence

[`viewer.test.ts`](../../packages/parapdf/test/viewer.test.ts) and
[`react-context-state.test.ts`](../../packages/parapdf/test/react-context-state.test.ts)
cover zero `onViewStateChange` emissions and zero scroll drift on rejected
controlled zoom near scroll boundaries, single settled `onViewStateChange`
emission on accepted controlled updates and compound `XYZ` destination jumps
under controlled zoom, and `TRACKED_PROXY_HANDLER` non-leakage across `in`,
`Object.keys()`, object spread, `Object.getPrototypeOf()`, and null-prototype
snapshots (1,071 unit tests passing across 120 suites).
[`check-package.ts`](../../packages/parapdf/scripts/check-package.ts),
[`check-modules.ts`](../../examples/prototype/scripts/check-modules.ts), all 12
prototype functional checks in Chromium 158.0.8127.18, WebKit 27.2, and Firefox
159.0 (extended in `check-options.ts` to verify that `zoomBy(0.75)` on a
controlled `zoom={1.5}` viewer at `scrollTop === 0` keeps `scale === 1.5`,
`scrollTop === 0`, and zero `onViewStateChange` calls), `check:bundlers` across
webpack, Rsbuild, and Next.js (Turbopack and webpack), and site `check:demo`,
`check:showcases`, and `.claude/launch.test.mjs` all pass.

`scroll-bench.ts` measured main-viewport scrolling against decision 0044
(`5c55aca`) on AC power in turn, job by job: 1280×900 at `devicePixelRatio` 2,
fit-width, 4,000 ms of scrolling at 900 and 3,600 CSS pixels per second through
`synthetic-text-1000.pdf` and `bill-hr815.pdf`, median of 5 runs
([`scroll-settled-controls-chromium.md`](../../examples/prototype/results/scroll-settled-controls-chromium.md),
[`-webkit.md`](../../examples/prototype/results/scroll-settled-controls-webkit.md),
[`-firefox.md`](../../examples/prototype/results/scroll-settled-controls-firefox.md);
Playwright's headless WebKit is not Safari). Across all 12 browser-job pairs,
both builds record 0.0% blank area, 0.0% blank frames, identical React commits
(4 at 900 px/s; 25 and 21 at 3,600 px/s), identical store updates (4, 24, 4, and
20), identical render counts, and identical settled canvas memory (156, 111,
183, and 127 MiB). Dropped frames are 0 / 289 across all 4 WebKit jobs, 0 / 241
across all 4 Firefox jobs (vs 1 / 240 before on `synthetic-text-1000.pdf` at
900 px/s), and 0, 0, 0, and 1 / 240 in Chromium (vs 0, 0, 0, and 0 / 241
before). Main thread blocked while scrolling, in ms, after and before
(`5c55aca`):

| Job | Chromium 158.0.8127.18 | WebKit 27.2 (Playwright) | Firefox 159.0 |
|---|---:|---:|---:|
| synthetic-text-1000.pdf, 900 px/s | 9, 11 | 9, 6 | 29, 65 |
| synthetic-text-1000.pdf, 3600 px/s | 71, 75 | 11, 17 | 84, 78 |
| bill-hr815.pdf, 900 px/s | 18, 17 | 18, 24 | 24, 42 |
| bill-hr815.pdf, 3600 px/s | 10, 16 | 9, 5 | 90, 78 |

Main-thread blocked time is lower in 7 of 12 browser-job pairs: 3 of 4 Chromium
jobs (9 vs 11, 71 vs 75, and 10 vs 16 ms, with +1 ms at 18 vs 17 ms on
`bill-hr815.pdf` at 900 px/s), 2 of 4 WebKit jobs (11 vs 17 and 18 vs 24 ms,
with single-digit 9 vs 6 and 9 vs 5 ms on the other two), and both 900 px/s
Firefox jobs (29 vs 65 ms with max lag 10 vs 24 ms, and 24 vs 42 ms with max lag
8 vs 11 ms), while the two 3,600 px/s Firefox jobs sit within 6–12 ms
run-to-run variance (84 vs 78 ms with Lag p95 improving from 0.6 to 0.5 ms and
max lag tied at 11 ms, and 90 vs 78 ms). First-paint run distributions overlap
within one animation frame across all 12 jobs.

`commit-bench.ts` measured 11 zoom-commit scenarios on `bill-hr815.pdf` against
decision 0044 (`5c55aca`) on AC power in turn, job by job: 820×1000 at
`devicePixelRatio` 2, 3 runs per scenario
([`commit-settled-controls-chromium.md`](../../examples/prototype/results/commit-settled-controls-chromium.md),
[`-webkit.md`](../../examples/prototype/results/commit-settled-controls-webkit.md),
[`-firefox.md`](../../examples/prototype/results/commit-settled-controls-firefox.md)).
Across all 33 browser-scenario pairs, both builds record 0 blank frames and 0
frames with a page down to its base. Time-to-sharp medians are equal or lower in
9 of 11 scenarios in Chromium (`pinch-out` 18 vs 19, `scale-up` 17 vs 20,
`zoom-step` 14 vs 17, `zoom-out-far` 13 vs 16, `zoom-in-whole` 18 vs 20,
`ctrl-wheel` 21 vs 22 ms, and tied on `pinch-in-start` 4, `pinch-in-drag` 4, and
`zoom-twice` 21 ms with peak canvas memory 191 vs 201 MiB; +3–6 ms within
sub-frame variance on `scale-down` 15 vs 12 and `zoom-in-far` 40 vs 34 ms),
equal or lower in 8 of 11 scenarios in WebKit (`pinch-in-start` 5 vs 7,
`scale-down` 13 vs 16, `zoom-in-far` 49 vs 54, `zoom-out-far` 9 vs 17 ms, and
tied on `pinch-in-drag` 6, `scale-up` 10, `zoom-in-whole` 12, and `zoom-twice`
16 ms; +1–3 ms within sub-frame variance on `pinch-out` 24 vs 22, `zoom-step`
17 vs 16, and `ctrl-wheel` 17 vs 14 ms), and equal or lower in 6 of 11 scenarios
in Firefox (`pinch-out` 67 vs 75, `zoom-step` 46 vs 64, `zoom-out-far` 38 vs 42,
`ctrl-wheel` 68 vs 73 ms, and tied on `pinch-in-start` 12 and `zoom-in-far`
113 ms; +1–6 ms within sub-frame variance on `pinch-in-drag` 7 vs 6, `scale-up`
80 vs 78, `scale-down` 39 vs 37, and `zoom-in-whole` 46 vs 40 ms, plus bimodal
two-step cancellation timing on `zoom-twice` 103 vs 59 ms—matching decision
0044's 103 vs 106 ms when the first 30 ms step cancels).

## Reopen if

- A future store exposes frozen snapshot objects (`Object.isFrozen(snapshot)`),
  requiring `createTrackedSnapshot()` to fall back to a shallow clone before
  attaching `TRACKED_META`.

