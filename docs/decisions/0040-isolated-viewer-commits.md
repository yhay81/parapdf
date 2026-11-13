# 0040. Isolated PdfViewer page-window commits, per-page overlay activation, and cold page-size store

- Status: adopted
- Date: 2026-11-14

## Decision

Three React subscriptions inside `<PdfViewer>` and `<PdfThumbnails>` previously
performed work on scroll-window shifts, zoom commits, or idle page mounts that
did not depend on hot viewport state:

1. `ViewerViewport` (`packages/parapdf/src/react/PdfViewer.tsx`) subscribed
   directly to `viewer.store.hot` (`layout`, `first`, `last`). Every mounted
   page-window shift or zoom commit therefore re-rendered `ViewerViewport`,
   rebuilt its `ViewerOptions` object, reconciled `<PdfViewer>`'s `{children}`
   subtree, and re-ran the `viewer.configure()` and controlled-prop
   `useLayoutEffect` inside `viewer.batchView()`.
2. Every mounted `memo(PdfPage)` called `usePageOverlay(viewer, index, hostRef)`
   unconditionally, subscribing each page to `OverlayStore` via
   `useSyncExternalStore` and running a `registerHost` `useLayoutEffect` even
   when no `<PdfPageOverlay>` or `<PdfPageOverlays>` targeted that page.
3. `<PdfThumbnails>` and standalone `<PdfThumbnail>` read `state.layout?.sizes`
   from `viewer.store.hot`, waking every mounted thumbnail selector on every
   zoom commit, window shift, and `currentPage` change even though unrotated PDF
   page dimensions only change on document open, non-uniform page measurement,
   and close.

`docs/architecture.md`, "view/" and "React", isolates all three paths:

- `<PdfViewer>` delegates `viewer.store.hot` (`{ layout, first, last }`) and
  `useOverlayActivity(viewer)` to a child `memo(ViewerPages)`. `ViewerViewport`
  no longer subscribes to `viewer.store.hot`, so scrolling across page windows
  or committing a zoom leaves option construction, `{children}` reconciliation,
  and `viewer.configure()` / controlled-prop layout effects untouched.
- `OverlayStore` (`packages/parapdf/src/react/overlays.ts`) tracks per-page
  `OverlayActivity` (`{ allPages: boolean; portalPages: ReadonlySet<number> }`,
  defaulting to a shared `INACTIVE_OVERLAYS` singleton) and exposes
  `subscribeActive()` / `getActivity()`. `memo(PdfPage)` mounts
  `<PdfPageOverlaySlot>` only when `allPages || portalPages.has(index)` is true
  for that page: viewers without overlays skip per-page overlay subscriptions
  and host effects completely, single-page `<PdfPageOverlay page={p}>` activates
  only page `p` while leaving all other pages inert, and `<PdfPageOverlays>`
  activates `allPages` without notifying `subscribeActive` when its render
  callback updates. `<PdfPageOverlaySlot>` renders as a sibling *after*
  `<section ref={hostRef} />` inside `<>...</>` so React attaches `hostRef` on
  `<section>` before running `<PdfPageOverlaySlot>`'s `useLayoutEffect` outside
  `StrictMode`.
- `ViewerStore` (`packages/parapdf/src/view/state.ts`) adds
  `sizes: ReadableStore<PageSizesState>`, updated atomically inside
  `ViewerStore.set()` only when `"layout" in full` and `full.layout?.sizes`
  changes by `Object.is`. Because `ViewerController` reuses the same
  `this.#sizes` array reference across zoom, scroll, rotation, spread, and
  scroll-mode relayouts, `viewer.store.sizes` publishes only on document open,
  non-uniform `#measurePages`, and document close. `<PdfThumbnails>` and
  `<PdfThumbnail>` read page dimensions from `viewer.store.sizes`, removing all
  `viewer.store.hot` subscriptions from `<PdfThumbnail>` and leaving
  `<PdfThumbnails>` subscribed to `viewer.store.hot` solely for `currentPage`.

## Evidence

[`react-overlays.test.ts`](../../packages/parapdf/test/react-overlays.test.ts)
and [`react-navigation.test.ts`](../../packages/parapdf/test/react-navigation.test.ts)
cover `OverlayStore` `INACTIVE_OVERLAYS` transitions, per-page `portalPages`
scoping, `allPages` render-callback stability, and `ViewerStore.sizes` silence
across zoom, window, and `currentPage` updates while publishing on open,
non-uniform measurement, and close.
[`check-lifecycle.ts`](../../examples/prototype/scripts/check-lifecycle.ts)
([`lifecycle-overlays.tsx`](../../examples/prototype/scripts/lifecycle-overlays.tsx))
verifies in Chromium 158.0.8127.18, WebKit 27.2, and Firefox 159.0 that:

- With no overlays mounted, `OverlayStore.isActive()` stays `false` and zero
  `hasHost()` entries or `.parapdf-overlay-layer` elements exist.
- Scrolling across page windows (`viewer.goToPage(12)` on a 20-page document)
  updates the mounted window while `<PdfViewer>`'s `{children}` render count
  stays at `1`.
- Mounting `<PdfPageOverlay page={11}>` registers a host and creates
  `.parapdf-overlay-layer` only on page 11 while mounted neighbor page 12 keeps
  `hasHost(12) === false`.
- Outside `StrictMode`, scrolling to newly mounted pages while
  `<PdfPageOverlays>` is active attaches `hostRef` before
  `<PdfPageOverlaySlot>`'s `useLayoutEffect` runs (caught during implementation
  when `<PdfPageOverlaySlot>` was initially nested inside `<section ref={hostRef}>`,
  where React's post-order `commitLayoutEffects` ran the child's layout effect
  before attaching the parent's `ref` in production builds).
- Unmounting overlays removes all `.parapdf-overlay-layer` nodes and returns
  `OverlayStore` to `INACTIVE_OVERLAYS`, including across `StrictMode` replay
  and `<Activity>` hide/show.

`scroll-bench.ts` measured main-viewport scrolling against `main` (`c1bd374`) on
AC power in turn, job by job: 1280×900 at `devicePixelRatio` 2, fit-width,
4,000 ms of scrolling at 900 and 3,600 CSS pixels per second through
`synthetic-text-1000.pdf` and `bill-hr815.pdf`, median of 5 runs
([`scroll-isolated-commits-chromium.md`](../../examples/prototype/results/scroll-isolated-commits-chromium.md),
[`-webkit.md`](../../examples/prototype/results/scroll-isolated-commits-webkit.md),
[`-firefox.md`](../../examples/prototype/results/scroll-isolated-commits-firefox.md);
Playwright's headless WebKit is not Safari). In every browser and job, both
builds record 0.0% blank area, 0 dropped frames, identical React commits (4 at
900 px/s; 25 and 21 at 3,600 px/s), identical store updates (4, 24, 4, and 20),
and identical settled canvas memory (156, 111, 183, and 127 MiB). Main thread
blocked while scrolling, in ms, after and before:

| Job | Chromium 158.0.8127.18 | WebKit 27.2 (Playwright) | Firefox 159.0 |
|---|---:|---:|---:|
| synthetic-text-1000.pdf, 900 px/s | 3, 3 | 3, 2 | 12, 8 |
| synthetic-text-1000.pdf, 3600 px/s | 9, 8 | 3, 2 | 13, 15 |
| bill-hr815.pdf, 900 px/s | 9, 9 | 9, 14 | 6, 9 |
| bill-hr815.pdf, 3600 px/s | 6, 7 | 4, 11 | 11, 11 |

`commit-bench.ts` measured 11 zoom-commit scenarios on `bill-hr815.pdf` against
`main` (`c1bd374`) on AC power in turn, job by job: 820×1000 at
`devicePixelRatio` 2, 3 runs per scenario
([`commit-isolated-commits-chromium.md`](../../examples/prototype/results/commit-isolated-commits-chromium.md),
[`-webkit.md`](../../examples/prototype/results/commit-isolated-commits-webkit.md),
[`-firefox.md`](../../examples/prototype/results/commit-isolated-commits-firefox.md)).
Both builds record 0 blank frames, 0 frames down to base, and identical
base/detail/cancelled render counts across all 33 browser-scenario pairs, and
identical canvas memory everywhere except Firefox `ctrl-wheel` peak median (226
vs 212 MiB across 3 runs, where individual runs reach 226 MiB on both builds
depending on wheel delta timing). Time-to-sharp medians are equal or lower in 9
of 11 scenarios per browser (for example Chromium `scale-down` 9 vs 18 ms and
`zoom-in-whole` 8 vs 10 ms; Firefox `pinch-out` 52 vs 56 ms, `zoom-in-far` 84 vs
88 ms, and `ctrl-wheel` 45 vs 48 ms), and higher within 3-run variance in
Chromium `zoom-in-far` (35 vs 23 ms) and `zoom-twice` (11 vs 10 ms), WebKit
`scale-down` (12 vs 10 ms) and `zoom-in-whole` (8 vs 7 ms), and Firefox
`zoom-step` (39 vs 35 ms) and `zoom-twice` (41 vs 40 ms).

Because ParaPDF already kept React out of per-frame scroll and gesture paths and
the prototype's `<PdfViewer>` mounts lightweight children, canvas rasterization
dominates both benchmarks; no macro frame-rate or rasterization speedup is
claimed over run-to-run variation. The win is structural: `<PdfViewer>` option
effects and `{children}` subtrees no longer re-run on page-window or zoom
commits, un-targeted pages allocate zero overlay subscriptions or host effects,
and thumbnails no longer wake on hot viewport updates.

## Reopen if

- A future `<PdfViewer>` option depends directly on hot viewport state rather
  than applying through `ViewerController`.
