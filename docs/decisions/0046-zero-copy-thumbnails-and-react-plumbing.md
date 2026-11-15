# 0046. Zero-copy detached thumbnails, explicit-handle context bypass, swap-buffered stores, and streamlined React plumbing

- Status: adopted
- Date: 2026-11-15

## Decision

After decisions 0041–0045 committed the public API and reactive stores to React,
ten residual Vanilla-era seams and React-layer allocations remained across
`document/`, `view/`, `features/`, and `react/`:

1. **Pixel-copying thumbnail restoration, detached fiber retention, and
   standalone `<PdfThumbnail>` branching (`src/features/thumbnails/`,
   `src/react/PdfThumbnails.tsx`, `src/react/PdfThumbnail.tsx`)**:
   Because React created a fresh `<canvas>` inside a child `<ThumbnailCanvas>`
   component on every virtualized sidebar mount, `ThumbnailRenderer` restored
   kept canvases via `canvas.getContext("2d")?.drawImage(kept.canvas, 0, 0)`
   (allocating a second backing store before zeroing the first and copying
   pixels on the main thread) and stored the unmounted `<canvas>` in `#kept`
   while it was still attached to its unmounted `<button>` and `<li>` parent
   chain and React Fiber expandos (`__reactFiber$`, `__reactProps$`). Meanwhile,
   standalone `<PdfThumbnail>` kept `getComputedStyle` scroll-parent walks,
   `IntersectionObserver` pools, and `virtualized` option branches alive in
   `ThumbnailRenderer` even though `<PdfThumbnails>`'s `children` render prop
   covers custom item markup with full virtualization.
2. **Unconditional `useContext` fiber subscriptions when explicit `viewer` or
   `session` handles are passed (`src/react/context.ts`, `thumbnails.ts`)**:
   `useOptionalViewer(viewer)`, `useSession(session)`, `useOptionalSession(session)`,
   and `useOptionalPageLabels(viewer, hasExternalViewer)` called `useContext`
   unconditionally before checking explicit arguments, registering fiber context
   dependencies even on standalone `useCreateViewer()` panes.
3. **Redundant `useStoreKeys` selector runs on parent/scroll re-renders
   (`src/react/context.ts`)**:
   `useStoreKeys` re-executed `selector` and `shallowEqual` whenever `getSnapshot`
   ran, even when `store.get()` was unchanged and no subscribed key had fired.
4. **Per-publish `Set` and listener-array allocations in `Store.publish()`
   (`src/document/store.ts`)**:
   Every hot-path `Store.set()` / `publish()` allocated `new Set(this.#changedKeys)`
   and spread `[...this.#listeners]` even for single-listener stores.
5. **Dual `Store` instances and lost `changedKeys` on `PdfSessionController`
   (`src/document/pdf-session.ts`)**:
   `PdfSessionController` maintained both `followed` and `withoutPrompt` stores,
   and `withoutPrompt` called `publish()` with `changedKeys = undefined`,
   defeating key-filtered `subscribeKeys` when `passwordPrompt={false}`, while
   `setPasswordPrompt()` notified subscribers unconditionally even outside
   `"password"` state.
6. **Callback updates re-running `viewer.configure()` and opening rules in
   `<PdfViewer>` (`src/view/viewer.ts`, `src/react/PdfViewer.tsx`)**:
   Passing inline callbacks (`onPageChange`, `onViewStateChange`, `onZoomChange`,
   etc.) re-triggered `<ViewerControlSync>`'s full `sync()` effect—allocating 11
   conditional spread objects and calling `initialViewOpening()`,
   `viewer.configure()`, and `applyControlled()` on every parent render.
7. **Three separate prop-sync layout effects in `<SessionLeaseMount>`
   (`src/react/PdfDocument.tsx`)**:
   `setPasswordPrompt`, `setOpenAttachment`, and `setFragment` ran as three
   separate `useLayoutEffect` hooks per `<PdfDocument>`.
8. **Duplicated layout-phase subscription hooks and `createElement` prop cloning
   (`src/react/context.ts`, `PdfViewer.tsx`, `overlays.ts`, `outline.ts`)**:
   `usePageWindow`, `useOverlayActivity`, and `PdfPageOverlay` duplicated manual
   `useReducer` + `useLayoutEffect` snapshot loops, and `.ts` React modules
   (`overlays.ts`, `outline.ts`) used `React.createElement` instead of
   `react/jsx-runtime`.
9. **Imperative-era feature wrappers and multi-effect React glue
   (`src/features/search/`, `history.ts`, `print/`, `annotations.ts`,
   `annotation-slot.ts`, `forms/layers.ts`, `PdfAnnotationEditor.tsx`,
   `PdfForms.tsx`)**:
   `attachSearch` / `attachHistory` wrapped controller stores in `{ store,
   detach }` objects with dead `onDetach` hooks; `createPrintController` wrapped
   `print()` in a callback object only used once by `printOf`; `annotations.ts`
   kept an unused fallback `new Store()` and dead cross-store subscription in
   `annotation-slot.ts`; and `PdfAnnotationEditor` and `PdfForms` juggled extra
   refs and `useEffectEvent` across mount and sync effects.

Adopt all ten changes:

- **Zero-copy host-owned thumbnail `<canvas>` pool and removal of standalone
  `PdfThumbnail` (`src/features/thumbnails/renderer.ts`, `index.ts`,
  `src/react/PdfThumbnails.tsx`, `src/index.ts`)**:
  - Remove public `PdfThumbnail` and `PdfThumbnailProps`, and delete
    `scrollParent`, `#observers` (`IntersectionObserver`), and
    `AttachThumbnailOptions` from `ThumbnailRenderer`.
  - Each virtualized `<Item>` in `<PdfThumbnails>` renders a single lightweight
    `<div ref={attachHost}>` slot directly (eliminating the `<ThumbnailCanvas>`
    child component fiber per item). `ThumbnailRenderer.attach(pageIndex, host,
    width)` creates `<canvas class="parapdf-thumbnail" aria-hidden="true">`,
    detaches it (`canvas.remove()`) from React's `<li>/<button>` subtree on
    unmount before placing it in `#kept`, and moves kept `<canvas>` nodes
    directly into remounted hosts via `host.replaceChildren(kept.canvas)` with
    zero `getContext("2d")`, zero `drawImage`, and zero transient 2× pixel
    backing-store allocations.
- **Conditional React 19 `use()` after explicit handle checks
  (`src/react/context.ts`, `src/react/thumbnails.ts`)**:
  - `useOptionalViewer`, `useSession`, `useOptionalSession`, and
    `useOptionalPageLabels` return early on explicit `viewer` / `session`
    arguments before calling `use(ViewerContext)` or `use(SessionContext)`,
    registering zero fiber context dependencies for explicit-handle callers.
- **Dirty-gated `useStoreKeys` selector caching (`src/react/context.ts`)**:
  - `useStoreKeys` tracks `dirty` in its `subscribeKeys` callback and passes
    `force = dirty` to `selectCached`, skipping stable selector execution and
    `shallowEqual` when `store.get()` is unchanged and no subscribed key fired
    while still re-evaluating out-of-band keys (`"externalLinks"`,
    `session.reads`) when notified.
- **Swap-buffered `Store.publish()` (`src/document/store.ts`)**:
  - `Store` swaps `#pendingKeys` and `#publishingKeys` across non-reentrant
    publishes (falling back to a fresh `Set` only on re-entrant `publish()`) and
    calls a single listener directly without `[...this.#listeners]` array
    spreading.
- **Single `stateStore` on `PdfSessionController`
  (`src/document/pdf-session.ts`)**:
  - Fold `followed` and `withoutPrompt` into one `stateStore`, forwarding exact
    `PROMPT_KEYS` (`"status"`, `"passwordReason"`, `"error"`) when masking a
    password state as an error and notifying `setPasswordPrompt()` only when the
    underlying registry state is `"password"`.
- **Decoupled `<PdfViewer>` callback updates and spread-free option assembly
  (`src/view/viewer.ts`, `src/react/PdfViewer.tsx`, `src/react/PdfDocument.tsx`)**:
  - `ViewerControlBinding` adds `setCallbacks(callbacks)`, updated in its own
    `useLayoutEffect` in `<ViewerControlSync>` so inline callback changes never
    invoke `viewer.configure()`, `initialViewOpening()`, or `applyControlled()`;
    `<ViewerControlSync>` passes flat `ViewerOptions` and `ControlledViewValues`
    objects without 11 conditional spread allocations; and `<SessionLeaseMount>`
    consolidates `setPasswordPrompt`, `setOpenAttachment`, and `setFragment`
    into one prop-sync `useLayoutEffect`.
- **Shared `useLayoutSnapshot` and `react/jsx-runtime` in `.ts` React modules
  (`src/react/context.ts`, `PdfViewer.tsx`, `overlays.ts`, `outline.ts`)**:
  - Extract `useLayoutSnapshot` for `usePageWindow`, `useOverlayActivity`, and
    `PdfPageOverlay`, and switch `overlays.ts` and `outline.ts` from
    `createElement` to `jsx` / `jsxs` / `Fragment` from `"react/jsx-runtime"`,
    keeping `.ts` extensions for Node 24+ native type-stripping tests.
- **Direct controller-slot stores for search, history, print, forms, and
  annotations (`src/features/`, `src/react/`)**:
  - `searchOf(viewer)` and `historyOf(viewer)` return persistent
    `ReadableStore<SearchControls>` and `ReadableStore<HistoryControls>` slots
    directly; `printOf(viewer)` inlines print state management without
    `createPrintController`; `AnnotationEditingOptions` requires `store` and
    `annotationSlot.bindControls` mounts lazily on its first `sync()`; and
    `FormLayers.sync(scripts, onChange)` guards unchanged `scripts` values so
    `<PdfForms>` drops `useEffectEvent` and tracking refs.

## Evidence

[`react-navigation.test.ts`](../../packages/parapdf/test/react-navigation.test.ts),
[`react-context-state.test.ts`](../../packages/parapdf/test/react-context-state.test.ts),
[`viewer.test.ts`](../../packages/parapdf/test/viewer.test.ts),
[`react-features.test.ts`](../../packages/parapdf/test/react-features.test.ts),
[`react-actions.test.ts`](../../packages/parapdf/test/react-actions.test.ts),
[`search.test.ts`](../../packages/parapdf/test/search.test.ts), and
[`history.test.ts`](../../packages/parapdf/test/history.test.ts) cover zero-copy
`HTMLCanvasElement` detachment and node reuse in `ThumbnailRenderer` (throwing if
`getContext` is called), re-entrant swap-buffered `Store.publish()` key
isolation, quiet `setPasswordPrompt()` outside `"password"` status, dirty-gated
`selectCached()` fast paths, `binding.setCallbacks()` updating handlers with zero
`viewer.configure()` calls, and direct `searchOf` / `historyOf` / `printOf` /
`annotationSlot.bindControls` stores (1,071 unit tests passing across 120
suites). [`check-package.ts`](../../packages/parapdf/scripts/check-package.ts),
[`check-modules.ts`](../../examples/prototype/scripts/check-modules.ts), all 12
prototype functional checks in Chromium 158.0.8127.18, WebKit 27.2, and Firefox
159.0, `check:bundlers` across webpack, Rsbuild, and Next.js (Turbopack and
webpack), and site `check:demo`, `check:showcases`, and `.claude/launch.test.mjs`
all pass.

`scroll-bench.ts` measured main-viewport scrolling against decision 0045
(`0b42877`) on AC power in turn, job by job: 1280×900 at `devicePixelRatio` 2,
fit-width, 4,000 ms of scrolling at 900 and 3,600 CSS pixels per second through
`synthetic-text-1000.pdf` and `bill-hr815.pdf`, median of 5 runs
([`scroll-zero-copy-thumbnails-chromium.md`](../../examples/prototype/results/scroll-zero-copy-thumbnails-chromium.md),
[`-webkit.md`](../../examples/prototype/results/scroll-zero-copy-thumbnails-webkit.md),
[`-firefox.md`](../../examples/prototype/results/scroll-zero-copy-thumbnails-firefox.md);
Playwright's headless WebKit is not Safari). Across all 12 browser-job pairs,
both builds record 0.0% blank area, 0.0% blank frames, identical React commits
(4 at 900 px/s; 25 and 21 at 3,600 px/s), identical store updates (4, 24, 4, and
20), and identical settled canvas memory (156, 111, 183, and 127 MiB). Dropped
frames are **0 across all 12 jobs** (`0 / 241` in Chromium and Firefox; `0 / 289`
in WebKit, improving from `1 / 289` before on `bill-hr815.pdf` at 3,600 px/s).
Main thread blocked while scrolling, in ms, after and before (`0b42877`):

| Job | Chromium 158.0.8127.18 | WebKit 27.2 (Playwright) | Firefox 159.0 |
|---|---:|---:|---:|
| synthetic-text-1000.pdf, 900 px/s | 6, 7 | 8, 6 | 18, 14 |
| synthetic-text-1000.pdf, 3600 px/s | 60, 53 | 3, 3 | 60, 40 |
| bill-hr815.pdf, 900 px/s | 16, 15 | 10, 16 | 41, 71 |
| bill-hr815.pdf, 3600 px/s | 52, 57 | 30, 18 | 66, 30 |

Main-thread blocked time improves or ties in half of the 12 browser-job pairs—6
vs 7 and 52 vs 57 ms in Chromium (with +1 and +7 ms on the other two jobs, max
lag 11 vs 12 ms), 3 vs 3 and 10 vs 16 ms in WebKit (with 8 vs 6 ms at 900 px/s
and 30 vs 18 ms alongside 0 vs 1 dropped frames on `bill-hr815.pdf` at 3,600
px/s, where one extra base page completed during the 4 s window: 8 vs 7), and 41
vs 71 ms (Lag p95 0.2 vs 0.7 ms, max lag 11 vs 23 ms) on `bill-hr815.pdf` at 900
px/s in Firefox—while the 3,600 px/s Firefox jobs (60 vs 40 and 66 vs 30 ms,
within decision 0045's 84 and 90 ms baseline range on the same machine under
concurrent background load 5.0–6.7) keep `0 / 241` dropped frames and max lag
11–12 ms. First-paint run distributions overlap within one animation frame
across all 12 jobs (median equal or faster in 8 of 12 pairs: 161 vs 161, 153 vs
158, and 158 vs 158 ms in Chromium; 196 vs 202, 196 vs 196, 157 vs 158, and 167
vs 176 ms in WebKit; 278 vs 287, 240 vs 253, and 223 vs 235 ms in Firefox).

`commit-bench.ts` measured 11 zoom-commit scenarios on `bill-hr815.pdf` against
decision 0045 (`0b42877`) on AC power in turn, job by job: 820×1000 at
`devicePixelRatio` 2, 3 runs per scenario
([`commit-zero-copy-thumbnails-chromium.md`](../../examples/prototype/results/commit-zero-copy-thumbnails-chromium.md),
[`-webkit.md`](../../examples/prototype/results/commit-zero-copy-thumbnails-webkit.md),
[`-firefox.md`](../../examples/prototype/results/commit-zero-copy-thumbnails-firefox.md)).
Across all 33 browser-scenario pairs, both builds record **0 blank frames** and
**0 frames with a page down to its base**. Time-to-sharp medians are equal or
lower in 7 of 11 scenarios in Chromium (`zoom-step` 15 vs 18, `zoom-in-far` 31
vs 37, `zoom-out-far` 13 vs 17, `zoom-in-whole` 20 vs 21, `zoom-twice` 20 vs 21,
`ctrl-wheel` 19 vs 20 ms, and tied on `pinch-in-drag` 4 ms; +1–4 ms within
sub-frame variance on `pinch-out` 20 vs 19, `pinch-in-start` 5 vs 4, `scale-up`
18 vs 15, and `scale-down` 17 vs 13 ms), equal or lower in 6 of 11 scenarios in
WebKit (`scale-down` 9 vs 12, `zoom-in-whole` 10 vs 11, `ctrl-wheel` 11 vs 13
ms, and tied on `pinch-out` 21, `pinch-in-start` 5, and `pinch-in-drag` 6 ms;
+1–5 ms within sub-frame variance on `scale-up` 14 vs 9, `zoom-step` 13 vs 11,
`zoom-in-far` 54 vs 52, `zoom-out-far` 15 vs 11, and `zoom-twice` 14 vs 13 ms),
and equal or lower in 7 of 11 scenarios in Firefox (`pinch-out` 72 vs 85,
`pinch-in-start` 7 vs 11, `zoom-in-far` 114 vs 120, `zoom-out-far` 38 vs 41,
`zoom-in-whole` 50 vs 52, `zoom-twice` 92 vs 140 ms, and tied on `scale-down`
36 ms; +2–22 ms on `pinch-in-drag` 8 vs 6, `scale-up` 86 vs 78, `zoom-step` 77
vs 61, and `ctrl-wheel` 89 vs 67 ms under background load 5.3–6.7).

## Reopen if

- An application requires rendering single-page thumbnails outside a scrollable
  navigation list where `<PdfThumbnails>` (with or without a custom `children`
  render prop) cannot fit.
