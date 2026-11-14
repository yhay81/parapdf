# 0041. Warm-mount synchronous layout, controller-owned React synchronization, unified feature stores, and narrower Viewer

- Status: adopted
- Date: 2026-11-14

## Decision

Decisions 0035, 0038, 0039, and 0040 narrowed ParaPDF's public API to React,
yet several internal boundaries between `src/document/`, `src/view/`,
`src/features/`, and `src/react/` still behaved as if the controllers served
arbitrary non-React callers or passive post-paint mounts:

1. Mounting `<PdfDocument>`, `<PdfView>`, `useCreateViewer()`, and `<PdfViewer>`
   connected sessions, viewers, URL fragment listeners, and `viewer.open()` in
   passive `useEffect`, and `ViewerController.#start()` always awaited
   `Promise.all([pageSizes(), permissions(), direction()])` plus
   `initialViewOpening`. Even when `preloadDocument()` or another viewer had
   already resolved the session's metadata, mounting a `<PdfViewer>` painted an
   empty viewport first and laid out pages in microtasks after paint.
2. Each mounted `memo(PdfPage)` ran a `useLayoutEffect` solely to call
   `viewer.attachPage(index, host)` and its cleanup.
3. Search (`src/react/search.ts`), history (`src/react/history.ts`), and
   annotation editing (`src/react/annotations.ts`) wrapped feature stores in
   extra `Store` instances and `WeakMap` relays—three chained stores in the
   case of annotation editing (`annotationSlot` → `editingStore` →
   `annotationControlsStore`)—only to attach bound methods onto snapshots for
   `useStore`.
4. `<PdfViewer>` (`src/react/PdfViewer.tsx`) and `<PdfAnnotationEditor>`
   (`src/react/PdfAnnotationEditor.tsx`) tracked controlled-prop echo
   suppression, last-reported values, `useReducer` divergence reconciliation,
   settled `ViewState` timers, and `pagehide` flushing inside React components
   using ref bags.
5. Form-change subscriptions bridged `src/features/forms/` and
   `src/react/forms.ts` through redundant `WeakMap` listener registries and
   queried `session.formChange(id)` on every widget input even when no listener
   was registered; `PrintController` lived in `src/react/print.ts` despite
   owning no React primitives.
6. `PdfSessionController` (`src/document/pdf-session.ts`) kept `#beforeFirstHold`
   and an `#early` `Map` to buffer pre-mount `metadata()` / `outline()` /
   `pageCount()` promises before `PdfDocument`'s passive `useEffect` leased the
   session.
7. Public `export interface Viewer` (`src/view/viewer.ts`) and the package
   barrel (`src/index.ts`) still exposed internal benchmark/check probes
   (`stats`, `keptPixels`, `firstPaintAt`, `hasPixels`, `blankFraction`,
   `sharpness`, `RenderStats`) and low-level `position` / `restorePosition` /
   `ViewerPosition` alongside `viewState` / `setViewState`.

`docs/architecture.md` ("document/", "view/", "features/", and "React") tightens
all seven boundaries while keeping scrolling, zooming, and pixel rendering out
of React's hot path:

- **Warm-mount synchronous layout before first paint**:
  - `DocumentSession` (`src/document/session.ts`) exposes synchronous getters
    `knownPageSizes`, `knownPermissions`, `knownDirection`, `knownInitialView`,
    and `loadedLayers`, populated as their promises resolve, and
    `preloadDocument()` (`src/react/preload.ts`) warms `pageSizes()`,
    `permissions()`, `direction()`, and `initialView()` alongside opening the
    PDF.
  - `resolveDestinationSync()` (`src/pdfjs/destinations.ts`) resolves numeric
    `[pageIndex, ...]` destination arrays synchronously when page dimensions
    are already known, allowing `initialViewOpening` (`src/features/initial-view.ts`)
    to return a synchronous `InitialViewTarget` for `"fit-width"`,
    `"fit-page"`, numeric scales, `initialViewState`, cached document open
    actions, and numeric `#page=` / `#zoom=` URL fragments.
  - `<SessionLeaseMount>` (`src/react/PdfDocument.tsx`), `<PdfView>`,
    `useCreateViewer()`, `<ViewerViewport>`, `<ViewerControlSync>`, and a
    dedicated layout-phase `usePageWindow(viewer)` hook in `ViewerPages`
    (`src/react/PdfViewer.tsx`) connect and subscribe in `useLayoutEffect`.
    When a session's metadata and initial view are already warm,
    `ViewerController.#start()` computes layout, restores initial position,
    mounts `<PdfPage>` hosts, and plans first renders synchronously inside
    React's mount commit before the browser paints.
- **React 19 ref cleanup callbacks on `<PdfPage>`**: `memo(PdfPage)` attaches
  and detaches its `<section>` host via a memoized React 19 ref callback
  returning `viewer.attachPage(index, node)`'s cleanup while keeping
  `hostRef.current` populated for sibling `<PdfPageOverlaySlot>`.
- **Single feature stores**:
  - `Search` (`src/features/search/index.ts`) and `History`
    (`src/features/history.ts`) own `Store<SearchControls>` and
    `Store<HistoryControls>` directly, binding controller methods once onto the
    published snapshot and eliminating `searchControlsStore`,
    `historyControlsStore`, and their `WeakMap`s.
  - `src/features/annotation-slot.ts` owns the per-viewer single
    `Store<AnnotationControls>` (`annotationSlotStore`) and `bindAnnotationTool`,
    and `attachAnnotationEditing` (`src/features/annotations.ts`) writes into
    that same store when `<PdfAnnotationEditor>` mounts, preserving lazy chunk
    splitting (`minimal.html` still loads zero annotation-editing modules).
- **Controller-owned React synchronization**:
  - `ViewerController.bindControls(onDiverge)` (`src/view/viewer.ts`) owns live
    `ViewerOptions` application, controlled `page` / `zoom` / `rotation` /
    `scrollMode` / `spreadMode` / `interactionMode` synchronization, echo
    suppression during `sync()`, divergence detection when internal gestures or
    clamping depart from controlled props, `onPageChange`, settled
    `onViewStateChange`, and `pagehide` / session-stop flushing.
  - `<PdfViewer>` splits into `<ViewerViewport>` (DOM scroller/content,
    `onPageClick`, `{children}`, `<ViewerPages>`) and a sibling `return null`
    leaf `<ViewerControlSync>` whose `useReducer` reconciliation re-renders
    only that leaf when an internal gesture diverges from a controlled prop.
  - `<PdfAnnotationEditor>` delegates controlled `tool` / `defaultTool` /
    `onToolChange` synchronization to `bindAnnotationTool` in `useLayoutEffect`.
- **Direct form-change and print controllers**: `src/features/forms/index.ts`
  owns per-viewer form-change listeners (`onViewerFormChange`,
  `hasViewerFormListeners`, `notifyViewerFormChange`) called directly from
  `src/features/forms/layers.ts`, skipping `session.formChange(id)` when no
  listener is attached; `PrintController` and `createPrintController` move to
  `src/features/print/index.ts`, leaving `src/react/print.ts` as `usePrint()`.
- **Layout-ordered session lease**: `<PdfDocument>` renders leaf
  `<SessionLeaseMount>` before `{children}` so `session.connect()` runs in
  `useLayoutEffect` ahead of child layout and passive effects, allowing
  `PdfSessionController` to drop `#beforeFirstHold`, `#earlyAnswer`, and
  `#early`.
- **Narrower public `Viewer` interface**: `stats()`, `keptPixels()`,
  `firstPaintAt()`, `hasPixels()`, `blankFraction()`, `sharpness()`,
  `position()`, `restorePosition()`, `RenderStats`, and `ViewerPosition` are
  removed from `export interface Viewer` and `src/index.ts` while remaining on
  `ViewerController` for internal runtime use, functional checks, and
  benchmarks (`src/internals.ts` in the prototype).

## Evidence

[`viewer.test.ts`](../../packages/parapdf/test/viewer.test.ts),
[`pdf-session.test.ts`](../../packages/parapdf/test/pdf-session.test.ts),
[`history.test.ts`](../../packages/parapdf/test/history.test.ts),
[`react-actions.test.ts`](../../packages/parapdf/test/react-actions.test.ts),
and [`react-features.test.ts`](../../packages/parapdf/test/react-features.test.ts)
cover warm-session synchronous `#start()` layout (including `#zoom=` fragments
and `initialViewState`), `ViewerController.bindControls` echo suppression and
clamped-zoom divergence, single-store search/history/annotation controls, and
`<SessionLeaseMount>` lifecycle ordering (1,058 unit tests passing across 119
suites). [`check-modules.ts`](../../examples/prototype/scripts/check-modules.ts)
confirms `minimal.html` still loads none of search, forms, annotation editing,
or print, and [`check-package.ts`](../../packages/parapdf/scripts/check-package.ts)
and `check:bundlers` pass across Vite, webpack, Rsbuild, and Next.js (Turbopack
and webpack).

[`check-document.ts`](../../examples/prototype/scripts/check-document.ts) adds a
same-commit `MutationObserver` check around `preloadDocument()` + `<PdfDocument>`
+ `<PdfViewer>`: at the end of React's mount commit task—strictly before the
first browser animation frame or paint—`viewer.store.get().layout` is non-null,
`.parapdf-viewport [data-page]` elements are mounted, and `.parapdf-canvas` is
already attached in Chromium 158.0.8127.18, WebKit 27.2, and Firefox 159.0.
During implementation, keeping `useSyncExternalStore` in `ViewerPages` missed
`<ViewerControlSync>`'s layout-phase `viewer.open(session)` store update because
React 19's `useSyncExternalStore` registers its subscription in passive
`useEffect` and runs its layout snapshot check on `<ViewerPages>` before its
sibling `<ViewerControlSync>` runs `useLayoutEffect`; replacing it with
layout-subscribed `usePageWindow(viewer)` made React flush `<PdfPage>` and
`<canvas>` synchronously in `SyncLane` before paint in all three browsers. All
functional checks (`document`, `lifecycle`, `options`, `viewers`, `text`,
`links`, `rotation`, `pinch`, `features`, `scroll`, `annotations`, `bundle`,
and site `check:demo` / `check:showcases`) pass in Chromium, WebKit, and
Firefox.

`scroll-bench.ts` measured main-viewport scrolling against `main` (`4cb2b16`) on
AC power in turn, job by job: 1280×900 at `devicePixelRatio` 2, fit-width,
4,000 ms of scrolling at 900 and 3,600 CSS pixels per second through
`synthetic-text-1000.pdf` and `bill-hr815.pdf`, median of 5 runs
([`scroll-tighten-react-chromium.md`](../../examples/prototype/results/scroll-tighten-react-chromium.md),
[`-webkit.md`](../../examples/prototype/results/scroll-tighten-react-webkit.md),
[`-firefox.md`](../../examples/prototype/results/scroll-tighten-react-firefox.md);
Playwright's headless WebKit is not Safari). Across every browser and job, both
builds record 0.0% blank area, identical React commits (4 at 900 px/s; 25 and
21 at 3,600 px/s), identical store updates (4, 24, 4, and 20), identical page
render counts, and identical settled canvas memory (156, 111, 183, and 127 MiB).
Dropped frames are 0 / 241 in Chromium and Firefox on every job, and in WebKit
0 vs 0 (`synthetic-text-1000.pdf` 900 px/s), 0 vs 1 (`synthetic-text-1000.pdf`
3,600 px/s), 2 vs 2 (`bill-hr815.pdf` 900 px/s), and 0 vs 2 (`bill-hr815.pdf`
3,600 px/s). Main thread blocked while scrolling, in ms, after and before:

| Job | Chromium 158.0.8127.18 | WebKit 27.2 (Playwright) | Firefox 159.0 |
|---|---:|---:|---:|
| synthetic-text-1000.pdf, 900 px/s | 16, 13 | 18, 15 | 63, 49 |
| synthetic-text-1000.pdf, 3600 px/s | 72, 72 | 23, 44 | 56, 92 |
| bill-hr815.pdf, 900 px/s | 14, 20 | 81, 71 | 75, 82 |
| bill-hr815.pdf, 3600 px/s | 56, 55 | 23, 39 | 80, 82 |

Cold-navigation first paint in `scroll-bench.ts` (which navigates straight to a
cold page rather than mounting a preloaded session) stays within a single
animation frame across run distributions in all three browsers.

`commit-bench.ts` measured 11 zoom-commit scenarios on `bill-hr815.pdf` against
`main` (`4cb2b16`) on AC power in turn, job by job: 820×1000 at
`devicePixelRatio` 2, 3 runs per scenario
([`commit-tighten-react-chromium.md`](../../examples/prototype/results/commit-tighten-react-chromium.md),
[`-webkit.md`](../../examples/prototype/results/commit-tighten-react-webkit.md),
[`-firefox.md`](../../examples/prototype/results/commit-tighten-react-firefox.md)).
Across all 33 browser-scenario pairs, both builds record 0 blank frames and 0
frames with a page down to its base. Render counts and canvas memory match
everywhere except WebKit `zoom-twice` (where `as built` cancelled one earlier
intermediate detail render: 7 detail / 2 cancelled / 191 MiB peak vs 9 / 1 /
201 MiB, both 15 ms time to sharp) and Firefox 3-run peak MiB medians in
`pinch-out` (216 vs 230 MiB) and `scale-up` (251 vs 237 MiB), where individual
runs take either value on both builds depending on gesture frame timing.
Time-to-sharp medians are equal or lower in 7 of 11 scenarios in Chromium (for
example `scale-up` 17 vs 20 ms, `zoom-out-far` 17 vs 19 ms, `zoom-in-whole` 18
vs 20 ms; higher within 3-run variance in `pinch-out` 20 vs 19 ms,
`pinch-in-drag` 5 vs 4 ms, `ctrl-wheel` 21 vs 20 ms, and `scale-down` 20 vs
15 ms), 8 of 11 in WebKit (`pinch-out` 21 vs 23 ms, `ctrl-wheel` 13 vs 14 ms;
1–2 ms higher in `scale-up` 16 vs 14 ms, `zoom-step` 15 vs 14 ms, and
`zoom-in-far` 47 vs 46 ms), and 7 of 11 in Firefox (`pinch-out` 67 vs 77 ms,
`pinch-in-start` 8 vs 11 ms, `scale-up` 75 vs 81 ms, `scale-down` 34 vs 38 ms,
`zoom-out-far` 42 vs 45 ms; higher within 3-run Firefox rasterization variance
in `zoom-step` 72 vs 54 ms, `zoom-in-far` 116 vs 92 ms, `zoom-twice` 60 vs
44 ms, and `ctrl-wheel` 69 vs 59 ms).

## Reopen if

- A named destination in a PDF's catalog needs to resolve synchronously on warm
  mount without first caching destination lookups during `preloadDocument()`.
- React adds a built-in layout-phase external store subscription hook that can
  replace `usePageWindow` without passive-effect subscription lag.
