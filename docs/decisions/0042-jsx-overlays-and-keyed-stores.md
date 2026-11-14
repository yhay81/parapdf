# 0042. JSX-direct page overlays, settled selection popovers, kept virtualized thumbnails, and key-filtered stores

- Status: adopted
- Date: 2026-11-14

## Decision

After decision 0041 coupled `<PdfDocument>`, `<PdfViewer>`, and feature stores
directly to React's layout phase, three groups of React-to-runtime boundaries
still carried imperative DOM glue, duplicate store subscriptions, per-drag or
per-scroll DOM layout churn, or leftover non-React plumbing:

1. **Imperative page overlay containers and per-rect store subscriptions**:
   `OverlayStore` (`src/react/overlays.ts`) imperatively created and removed
   `.parapdf-overlay-layer` `<div>` elements (`createOverlayLayer`,
   `applyLayerGeometry`, `#hosts`), tracked a sibling `<PdfPageOverlaySlot>`
   after `<section>` via `hostRef`, kept a `renderedLayer` ref workaround across
   StrictMode effect replay, portaled `<PdfPageOverlays>` into its own page
   through `createPortal`, and subscribed every mounted `<PdfPageRect>` to
   `viewer.store.sizes` via `useSyncExternalStore`.
2. **Unfiltered store wakeups, selection drag commits and DOM queries, and
   thumbnail scroll/remount overhead**:
   `Store` (`src/document/store.ts`) notified listeners without reporting which
   keys changed, so `useStoreSlice` (`src/react/context.ts`) woke React's
   `onStoreChange` and ran snapshot/selector checks even when an update touched
   only untracked keys. `getSelection` and `createSelectionAnchor`
   (`src/features/selection.ts`) queried `.parapdf-text-layer` and
   `section[data-page]` through `querySelectorAll` / `querySelector` and rebuilt
   node-to-item `Map`s on every call, while `<PdfSelectionPopover>`
   (`src/react/PdfSelectionPopover.tsx`) ran `useSelection()` per animation
   frame throughout pointer selection drags, tore down and re-attached seven DOM
   listeners, its store subscription, and its `ResizeObserver` on every
   `selection` update (resetting its local `dragging` flag mid-drag), and
   observed `.parapdf-pages` `style` via `MutationObserver`. `<PdfThumbnails>`
   (`src/react/PdfThumbnails.tsx`) and `<PdfThumbnail>`
   (`src/react/PdfThumbnail.tsx`) added `2 × N` `useSyncExternalStore`
   subscriptions (`viewer.store.sizes` and `viewer.store.cold`) across mounted
   items, walked `getComputedStyle` ancestors (`scrollParent`) and registered an
   `IntersectionObserver` per virtualized item while discarding drawn canvases
   on unmount, ran `findThumbnailScroller` / `getComputedStyle` /
   `getBoundingClientRect` on every sidebar scroll event, re-measured uniform
   item chrome on window shifts, committed a redundant mount pass when `bounds`
   transitioned from `null` to `initialWindow`, and flashed numeric page labels
   before `pageLabels()` microtasks settled even on preloaded sessions.
3. **Residual wrapper layers and static inline styles**:
   `openEntry` (`src/document/registry.ts`) waited until a viewer mounted to
   start `session.pageSizes()` and `session.direction()` and kept a dead
   `SessionListener` callback list on `acquireSession`; `useLayers()`
   (`src/react/data.ts`) wrapped `LayerState` in a second `LayerStore` /
   `WeakMap` / `AbortController`; `searchOf` and `historyOf` spread wrapper
   objects to intercept `detach()`; `<PdfPage>` reconciled six static inline CSS
   properties on every mounted `<section>`; and `<ViewerControlSync>`
   re-rendered and ran `binding.sync()` whenever `<PdfViewer>` re-rendered with
   new `children` or `style`.

`docs/architecture.md` ("document/", "view/", "features/", and "React") adopts
all three groups of simplifications and optimizations while keeping per-frame
scroll, zoom previews, `<canvas>` ownership (`src/render/page.ts`, decision
0010), and pure planning/layout math outside React state:

- **JSX-direct `<PdfPageOverlayLayer>` and zero-subscription `<PdfPageRect>`**:
  - `memo(PdfPage)` (`src/react/PdfViewer.tsx`) renders `<PdfPageOverlayLayer>`
    directly as the trailing JSX child of `<section>` when `overlaysActive` is
    true (`src/render/page.ts` prepends canvases and inserts DOM layers before
    it, and `unmountPage` removes only renderer-owned nodes). When neither
    `<PdfPageOverlays>` nor `<PdfPageOverlay>` produces content for that page,
    `<PdfPageOverlayLayer>` returns `null` so zero `.parapdf-overlay-layer`
    nodes exist in the DOM.
  - `<PdfPageOverlays>` renders inline inside `<PdfPageOverlayLayer>` with zero
    `createPortal` calls, while `<PdfPageOverlay page={p}>` portals into the
    same `.parapdf-overlay-layer` element published by a React 19 ref cleanup
    callback (`store.attachLayer(index, layer, size)`), eliminating `#hosts`,
    `createOverlayLayer`, `applyLayerGeometry`, `hostRef`,
    `<PdfPageOverlaySlot>`, and `renderedLayer`.
  - `PageContext` (`src/react/context.ts`) carries `{ pageIndex, size }`, and
    `PdfPageRect` (consolidated into `src/react/overlays.ts`) reads `size`
    directly via `use(PageContext)` with zero `viewer.store` subscriptions.
- **Key-filtered `Store` notifications, settled `<PdfSelectionPopover>` drags,
  and kept virtualized `<PdfThumbnails>`**:
  - `Store.update(patch)` (`src/document/store.ts`) accumulates changed property
    keys (`StoreListener = (changedKeys?: ReadonlySet<PropertyKey>) => void`,
    allocating nothing when a store has no listeners) and forwards them through
    `ViewerStore` and `PdfSessionController`. `useStoreSlice` installs a stable
    per-hook key-filtered `subscribe` wrapper (guarded by `pendingNotify` across
    multi-update batches before `getSnapshot()`) that skips waking React when
    `changedKeys` is disjoint from `trackedKeys`.
  - `TextLayerHandle` (`src/pdfjs/text.ts`) exposes `readonly layer`, and
    `ViewerController` (`src/view/viewer.ts`) exposes internal `pageHost(index)`,
    `selectionDragging`, and `onSelectionDragChange()` (wired to
    `TextSelectionTracker.onDragChange` in `src/render/selection.ts`).
    `getSelection()` and `createSelectionAnchor()` (`src/features/selection.ts`)
    resolve mounted layers and page hosts in `O(1)` without `querySelectorAll`
    and cache each text layer's node-to-item `Map` in a `WeakMap`.
    `useViewerSelection` (`src/react/selection.ts`) short-circuits unchanged
    single-range `(startContainer, startOffset, endContainer, endOffset, layout)`
    endpoints and skips redundant `setSelection` dispatches; `<PdfSelectionPopover>`
    switches to `useSettledSelection` (clearing any open popover on press,
    committing zero times during primary-button drags, and committing once on
    release), splits listener setup (`[active, resolved]`) from in-place
    positioning so DOM listeners and `ResizeObserver` stay attached across
    selection updates, and subscribes to `viewer.onPreviewChange` instead of a
    `MutationObserver`.
  - `PdfThumbnail.tsx` exports an internal zero-subscription `ThumbnailCanvas`
    using a React 19 ref cleanup callback (`attachThumbnail`) keyed by primitive
    dimensions and `rotation`. When `virtualized: true` (`<PdfThumbnails>`),
    `ThumbnailRenderer` (`src/features/thumbnails/renderer.ts`) skips
    `scrollParent` walks and `IntersectionObserver`s, draws on attach, keeps
    detached drawn canvases in a bounded LRU pixel pool (`maxKeptPixels`, 8 MP
    default) restored synchronously on remount via `drawImage` (or zero-copy on
    `StrictMode` replay), and resets on `session.onContentChange` (`index.ts`).
    `<PdfThumbnails>` caches scroll-container geometry across scroll events
    (refreshed on mount, `ResizeObserver`, and layout/alignment passes) for
    zero-reflow `syncWindowFromScroll`, skips re-measuring uniform item chrome on
    window shifts, skips redundant mount `setBounds` commits when `bounds === null`
    already matches `initialWindow`, and reads warm `knownPageLabels`
    (`src/document/session.ts`, `src/react/preload.ts`) synchronously from a
    single session-watch store (`src/react/thumbnails.ts`).
- **Eager session warmup, direct `LayerState` subscriptions, CSS hoisting, and
  memoized `<ViewerControlSync>`**:
  - `openEntry` (`src/document/registry.ts`) eagerly starts
    `session.pageSizes()` and `session.direction()` alongside
    `session.permissions()` without blocking `status: "ready"` on `getPage(1)`,
    and `acquireSession` drops its unused `SessionListener` parameter.
  - `LayerState` (`src/pdfjs/layers.ts`) caches its `layers` snapshot and
    returns an unsubscribe function from `subscribe`, letting `useLayers()`
    call `useSyncExternalStore` directly without `LayerStore` or
    `AbortController`; `attachSearch` and `attachHistory` accept an optional
    `onDetach` callback so `searchOf` and `historyOf` allocate a single handle.
  - Static `.parapdf-pages` and `.parapdf-pages > section` declarations move to
    `VIEWER_CSS` (`src/react/styles.ts`), and `memo(ViewerControlSync)` receives
    only control/option props and runs `binding.sync()` inside a
    dependency-tracked `useLayoutEffect` (keyed by control props plus
    `reconcileCount` for rejected controlled changes).

## Evidence

[`react-overlays.test.ts`](../../packages/parapdf/test/react-overlays.test.ts),
[`get-selection.test.ts`](../../packages/parapdf/test/get-selection.test.ts),
[`react-context-state.test.ts`](../../packages/parapdf/test/react-context-state.test.ts),
[`react-navigation.test.ts`](../../packages/parapdf/test/react-navigation.test.ts),
and [`registry.test.ts`](../../packages/parapdf/test/registry.test.ts) cover
JSX-direct `<PdfPageOverlayLayer>` mounting and lazy `.parapdf-overlay-layer`
omission, zero-subscription `<PdfPageRect>` positioning from `PageContext`,
`O(1)` `viewer.textLayers` / `viewer.pageHost` selection resolution,
`<PdfSelectionPopover>` suppressing mid-drag commits until release,
`useStoreSlice` skipping React listener wakeups on untracked store patches while
preserving multi-update batch correctness, virtualized thumbnail kept-canvas
reuse across window shifts without re-rendering in pdf.js, synchronous
`knownPageLabels` reads without a `null` flash, and eager `knownPageSizes` /
`knownDirection` warmup in `openEntry` (1,065 unit tests passing across 120
suites). [`check-package.ts`](../../packages/parapdf/scripts/check-package.ts),
[`check-modules.ts`](../../examples/prototype/scripts/check-modules.ts), all 12
prototype functional checks in Chromium 158.0.8127.18, WebKit 27.2, and Firefox
159.0 (including `check-text.ts` verifying `commitsDelta === 1` and zero mid-drag
popover mounts across a 12-step pointer drag, and `check-features.ts` verifying
synchronous kept-canvas restoration on mount when scrolling back in a 1,000-page
thumbnail list), `check:bundlers` across webpack, Rsbuild, and Next.js
(Turbopack and webpack), and site `check:demo`, `check:showcases`, and
`.claude/launch.test.mjs` all pass. Consolidating `PdfPageRect` into
`src/react/overlays.ts` and removing the intermediate wrappers trims the viewer
React chunk from 34.03 to 33.85 kB (`pdf-session` 37.71 to 37.68 kB), while the
kept-canvas LRU pool, cached thumbnail scroll geometry, and settled selection
drag tracking add 1.22 kB gzipped across all chunks combined (74.87 to 76.09 kB
gzip).

`scroll-bench.ts` measured main-viewport scrolling (with a static
`<PdfPageOverlay page={0}>` mounted in the demo) against decision 0041
(`13850bb`) on AC power in turn, job by job: 1280×900 at `devicePixelRatio` 2,
fit-width, 4,000 ms of scrolling at 900 and 3,600 CSS pixels per second through
`synthetic-text-1000.pdf` and `bill-hr815.pdf`, median of 5 runs
([`scroll-jsx-overlays-chromium.md`](../../examples/prototype/results/scroll-jsx-overlays-chromium.md),
[`-webkit.md`](../../examples/prototype/results/scroll-jsx-overlays-webkit.md),
[`-firefox.md`](../../examples/prototype/results/scroll-jsx-overlays-firefox.md);
Playwright's headless WebKit is not Safari). Across all 12 browser-job pairs,
both builds record 0.0% blank area, 0.0% blank frames, identical React commits
(4 at 900 px/s; 25 and 21 at 3,600 px/s), identical store updates (4, 24, 4, and
20), and identical settled canvas memory (156, 111, 183, and 127 MiB). Dropped
frames are 0 / 241 in Chromium and Firefox on every job, and identical in WebKit
(0, 0, 3, and 1 / 289). Main thread blocked while scrolling, in ms, after and
before (`13850bb`):

| Job | Chromium 158.0.8127.18 | WebKit 27.2 (Playwright) | Firefox 159.0 |
|---|---:|---:|---:|
| synthetic-text-1000.pdf, 900 px/s | 13, 17 | 12, 12 | 58, 62 |
| synthetic-text-1000.pdf, 3600 px/s | 77, 66 | 17, 18 | 107, 109 |
| bill-hr815.pdf, 900 px/s | 20, 17 | 48, 53 | 63, 75 |
| bill-hr815.pdf, 3600 px/s | 50, 51 | 27, 20 | 102, 91 |

Main-thread blocked time is lower or tied in 8 of 12 browser-job pairs (Chromium
13 vs 17 and 50 vs 51 ms; WebKit 12 vs 12, 17 vs 18, and 48 vs 53 ms; Firefox 58
vs 62, 107 vs 109, and 63 vs 75 ms), and 3–11 ms higher on the remaining 4 jobs
within run-to-run background variance (Lag p95 differs by at most 0.1 ms on all
12 jobs, and cold-navigation first-paint run distributions stay within one
animation frame across all three browsers, improving from 196 to 182 ms median on
Chromium `synthetic-text-1000.pdf` 3,600 px/s and 179 to 163 ms on WebKit
`bill-hr815.pdf` 900 px/s).

`commit-bench.ts` measured 11 zoom-commit scenarios on `bill-hr815.pdf` against
decision 0041 (`13850bb`) on AC power in turn, job by job: 820×1000 at
`devicePixelRatio` 2, 3 runs per scenario
([`commit-jsx-overlays-chromium.md`](../../examples/prototype/results/commit-jsx-overlays-chromium.md),
[`-webkit.md`](../../examples/prototype/results/commit-jsx-overlays-webkit.md),
[`-firefox.md`](../../examples/prototype/results/commit-jsx-overlays-firefox.md)).
Across all 33 browser-scenario pairs, both builds record 0 blank frames and 0
frames with a page down to its base, with identical render counts and canvas
memory everywhere except Firefox `zoom-twice` (6 detail / 2 cancelled vs 7 / 2,
both 191 MiB peak). Time-to-sharp medians are equal or lower in 10 of 11
scenarios in Chromium (`pinch-out` 19 vs 20, `zoom-step` 22 vs 26,
`zoom-in-far` 37 vs 40, `zoom-out-far` 17 vs 18, `zoom-in-whole` 17 vs 19,
`zoom-twice` 16 vs 18 ms, tied on 4 scenarios; 3 ms higher only on `scale-down`
16 vs 13 ms), 7 of 11 in Firefox (`pinch-out` 75 vs 76, `scale-up` 71 vs 72,
`scale-down` 37 vs 39, `zoom-step` 62 vs 66, `zoom-in-far` 109 vs 116 ms, tied
on `pinch-in-start` 12 and `pinch-in-drag` 7 ms; higher within 3-run variance on
`zoom-out-far` 39 vs 38, `zoom-in-whole` 42 vs 38, `ctrl-wheel` 73 vs 67, and
bimodal double-zoom cancellation on `zoom-twice` 101 vs 50 ms), and 6 of 11 in
WebKit (`zoom-in-far` 40 vs 55, `ctrl-wheel` 9 vs 13, `zoom-step` 15 vs 16 ms,
tied on `pinch-out` 23, `pinch-in-start` 5, and `pinch-in-drag` 6 ms; 3–6 ms
higher within half an animation frame on `scale-up` 15 vs 11, `scale-down` 16 vs
12, `zoom-out-far` 16 vs 10, `zoom-in-whole` 11 vs 8, and `zoom-twice` 15 vs
10 ms).

## Reopen if

- A consumer needs a selector-based store subscription (`useSelected`) to skip
  invoking its selector function on arbitrary object-graph mutations where key
  filtering at the top level of the store state does not narrow the change.
