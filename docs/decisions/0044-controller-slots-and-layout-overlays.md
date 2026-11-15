# 0044. Typed controller slots, shared action stores, layout-phase overlays, and warm named destinations

- Status: adopted
- Date: 2026-11-15

## Decision

After decisions 0041–0043 consolidated `ViewerStore`, moved `<PdfDocument>` and
`<PdfViewer>` onto layout-phase controller bindings, and deferred default
`ViewerController` allocation, five React-to-controller seams remained:

1. **Module-level `WeakMap` and `WeakSet` feature tables across controllers and
   sessions**:
   Fifteen module-level `WeakMap` and `WeakSet` tables in `document/`,
   `features/`, and `react/` keyed feature instances, listener sets, and brand
   tags off `ViewerController`, `PdfSessionController`, and `DocumentSession`
   because `document/`, `view/`, and `render/` must never import `features/` or
   `react/`. Meanwhile, `<PdfAnnotationEditor>` ran three separate
   `useLayoutEffect` hooks and compared label records via `Object.keys()` array
   allocations on every parent render, while `<PdfForms>`, `<PdfPermissions>`,
   `<PdfAutoLinks>`, and `<PdfAnnotationEditor>` lacked `memo` boundaries.
2. **Component-local `useState` in `useSave()` and `usePrint()`**:
   Unlike `useSearch()`, `useHistory()`, and `useAnnotations()`, `useSave()` and
   `usePrint()` kept `saving` and `printing` / `progress` in per-caller
   `useState` hooks. Multiple toolbar consumers on the same session or viewer did
   not share live saving or print-progress state, standalone `save()` /
   `download()` calls were invisible to `useSave()`, neither hook offered a
   selector overload, and unmounting one secondary `usePrint()` caller cancelled
   print preparation for every other caller.
3. **Passive `useSyncExternalStore` overlay activation and per-page overlay
   subscriptions**:
   `ViewerPages` (`useOverlayActivity`) and `PdfPageOverlay` subscribed to
   `OverlayStore` via `useSyncExternalStore`, whose internal effect attaches
   passively after paint, and each mounted `PdfPageOverlayLayer` ran two
   additional `useSyncExternalStore` hooks (`subscribeRenderers` and
   `subscribePortal`). Sibling `<PdfPageOverlay>` components mounted after
   `<PdfViewer>` missed first-paint portaling on warm mounts, and scrolling the
   mounted page window while `<PdfPageOverlay page={0}>` was active paid two
   store subscriptions per mounted page.
4. **Hard-coded drag suppression on `<PdfSelectionPopover>` and lost nested
   `<PdfOutline>` branch state**:
   `<PdfSelectionPopover>` kept its own `useSettledSelection` copy while public
   `useSelection()` callers anchoring external popovers could not opt into
   suppressing mid-drag `Range` measurements and React commits; and
   `<PdfOutline>` kept `expanded` in per-branch `useState`, losing nested
   collapsed/expanded choices whenever an ancestor branch collapsed and
   re-expanded.
5. **Async-only named and coordinate destination resolution on warm sessions**:
   `DocumentSession.initialView()` ignored string named destinations in
   `/OpenAction` (`typeof raw === "string"`), `resolveDestinationSync()` handled
   only coordinate-free or page-index numeric destinations without caching
   resolved named destinations or loaded `PDFPageProxy` viewports, and
   `preloadDocument(source)` did not warm URL `#nameddest=` / coordinate
   fragments or caller-supplied destinations ahead of `<PdfDocument>` mounting.

`docs/architecture.md` ("document/", "view/", "features/", and "React") resolves
all five while keeping core-to-feature imports strictly downward and preserving
zero dead chunks in `check:modules`:

- **Typed controller/session slots (`SlotKey<T>`) and private-field brand
  checks**:
  - `src/document/store.ts` exports `SlotKey<T>` and `createSlotKey<T>(name)`,
    and `DocumentSession`, `PdfSessionController`, and `ViewerController` each
    expose `slot(key, create)`, `peekSlot(key)`, and `clearSlot(key)` backed by
    a lazily allocated null-prototype `#slots` record on the instance itself,
    plus `PdfSessionController.is()` and `ViewerController.is()` (`#control in
    value` and `#shown in value`) and `PdfSession.close()` (`#close`). All 15
    module-level `WeakMap` and `WeakSet` tables keyed on controllers or sessions
    are removed (`features/search`, `features/history`, `features/initial-view`,
    `features/permissions`, `features/forms`, `features/forms/scripts`,
    `features/auto-links`, `features/thumbnails`, `features/annotation-slot`,
    `features/download`, `features/print`, and `react/overlays`).
  - `<PdfForms>`, `<PdfPermissions>`, `<PdfAutoLinks>`, and
    `<PdfAnnotationEditor>` are wrapped in `/*#__PURE__*/ memo(...)`, and
    `<PdfAnnotationEditor>` merges attachment, zero-allocation
    `sameAnnotationLabels`, and controlled/default tool synchronization into a
    single `useLayoutEffect` via `annotationSlot(viewer).bindControls()`.
- **Controller-owned `SaveSlot` and `PrintSlot` stores with selector overloads**:
  - `saveOf(session)` (`src/features/download.ts`) owns a per-session
    `Store<SaveControls>` tracking in-flight `save()` and `download()` calls
    (standalone or hook-driven) via a pending counter and referentially stable
    action methods.
  - `printOf(viewer)` (`src/features/print/index.ts`) owns a per-viewer
    `Store<PrintControls>` with referentially stable `print()` and `cancel()`,
    plus reference-counted `hold()` so `usePrint()` cancels active preparation
    only when the last mounted holder hides or unmounts.
  - `useSave()`, `usePrint()`, and `useAnnotations()` expose selector overloads
    (`useSave(selector, session?)`, `usePrint(selector, viewer?)`,
    `useAnnotations(selector, viewer?)`) via `useStoreSlice`, with the generic
    selector signature placed first so `ReturnType<typeof useSave>` continues to
    resolve to `SaveControls`.
- **Layout-phase `OverlayStore` synchronization with zero per-page
  subscriptions**:
  - `OverlayStore` (`src/react/overlays.ts`) publishes an `OverlayActivity`
    snapshot (`{ renderers, portalPages }`) that reuses `renderers` identity on
    portal-membership changes and `portalPages` `Set` identity on dynamic
    renderer updates.
  - `ViewerPages` subscribes in `useLayoutEffect` (`useOverlayActivity`) and
    passes `overlayRenderers` and `hasPortalOverlay` directly down to
    `memo(PdfPage)` and `PdfPageOverlayLayer`, removing `subscribeRenderers` and
    both `useSyncExternalStore` calls from `PdfPageOverlayLayer`.
  - `PdfPageOverlay` claims and subscribes to its target page's
    `.parapdf-overlay-layer` element in `useLayoutEffect`, flushing both child
    and sibling overlays synchronously before the first paint on warm mounts.
- **`SelectionOptions` (`settleDrag`) and preserved `<PdfOutline>` tree state**:
  - `useSelection(viewer?, options?)` and `useSelection(options)` accept
    `SelectionOptions` (`{ settleDrag?: boolean }`, defaulting to `false`),
    sharing one implementation with `<PdfSelectionPopover>` (`{ settleDrag: true }`)
    so external popover libraries can suppress mid-drag `Range` reads and React
    commits.
  - `OutlineTree` (`src/react/outline.ts`) lifts toggled nodes into a single
    `ReadonlySet<OutlineNode>` keyed on `(items, defaultExpanded)` and wraps
    `OutlineEntry` in `/*#__PURE__*/ memo(...)` (passing `EMPTY_TOGGLED` to leaf
    entries), preserving nested branch state across ancestor collapse/expand
    cycles while skipping leaf re-renders.
- **Warm named and coordinate destinations (`DocumentSession` +
  `preloadDocument`)**:
  - `DocumentSession` caches resolved named destinations (`knownDestination()`)
    and loaded `PDFPageProxy` instances (`knownPage()`), resolves string named
    destinations in `initialView()`'s `/OpenAction`, and passes both caches into
    `resolveDestinationSync()` (`src/pdfjs/destinations.ts`) so warm `XYZ`,
    `FitH`, `FitV`, `FitR`, and `#nameddest=` openings resolve synchronously
    without awaiting microtasks.
  - `preloadDocument(source, options?)` (`PreloadDocumentOptions`:
    `{ destinations?: readonly Destination[] }`) warms URL fragment destinations
    and caller-supplied destinations alongside `pageSizes()`, `permissions()`,
    `direction()`, `initialView()`, and `pageLabels()`.

## Evidence

[`react-overlays.test.ts`](../../packages/parapdf/test/react-overlays.test.ts),
[`react-actions.test.ts`](../../packages/parapdf/test/react-actions.test.ts),
[`react-features.test.ts`](../../packages/parapdf/test/react-features.test.ts),
[`react-context-state.test.ts`](../../packages/parapdf/test/react-context-state.test.ts),
[`initial-view.test.ts`](../../packages/parapdf/test/initial-view.test.ts), and
[`viewer.test.ts`](../../packages/parapdf/test/viewer.test.ts) cover
`OverlayActivity` reference stability across portal and renderer updates,
shared `SaveSlot` and reference-counted `PrintSlot` stores across multiple
callers and standalone `save()`, selector overloads on `useSave()`, `usePrint()`,
and `useAnnotations()`, `useSelection({ settleDrag: true })`, `sameAnnotationLabels`,
`/OpenAction` string named destinations, and synchronous warm `open()` layout
for `#nameddest=` and coordinate fragments warmed by `preloadDocument()` (1,071
unit tests passing across 120 suites).
[`check-package.ts`](../../packages/parapdf/scripts/check-package.ts),
[`check-modules.ts`](../../examples/prototype/scripts/check-modules.ts), all 12
prototype functional checks in Chromium 158.0.8127.18, WebKit 27.2, and Firefox
159.0 (extended in `check-lifecycle.ts`, `check-links.ts`, and
`check-document.ts` for before-paint child and sibling page overlays, shared
`useSave()` / `usePrint()` holder lifetimes, preserved nested `<PdfOutline>`
branch state, and before-first-frame `#nameddest=` layout after
`preloadDocument()`), `check:bundlers` across webpack, Rsbuild, and Next.js
(Turbopack and webpack), and site `check:demo`, `check:showcases`, and
`.claude/launch.test.mjs` all pass.

`scroll-bench.ts` measured main-viewport scrolling (with `<PdfPageOverlay
page={0}>` mounted in the demo) against decision 0043 (`c2a80e6`) on AC power in
turn, job by job: 1280×900 at `devicePixelRatio` 2, fit-width, 4,000 ms of
scrolling at 900 and 3,600 CSS pixels per second through
`synthetic-text-1000.pdf` and `bill-hr815.pdf`, median of 5 runs
([`scroll-controller-slots-chromium.md`](../../examples/prototype/results/scroll-controller-slots-chromium.md),
[`-webkit.md`](../../examples/prototype/results/scroll-controller-slots-webkit.md),
[`-firefox.md`](../../examples/prototype/results/scroll-controller-slots-firefox.md);
Playwright's headless WebKit is not Safari). Across all 12 browser-job pairs,
both builds record 0.0% blank area, 0.0% blank frames, identical React commits
(4 at 900 px/s; 25 and 21 at 3,600 px/s), identical store updates (4, 24, 4, and
20), identical render counts, and identical settled canvas memory (156, 111,
183, and 127 MiB). Dropped frames are 0 / 241 in Firefox, 0, 0, 2, and 0 / 289
in WebKit (identical to `before`), and 0, 0, 0, and 1 / 240 in Chromium
(identical to `before`). Main thread blocked while scrolling, in ms, after and
before (`c2a80e6`):

| Job | Chromium 158.0.8127.18 | WebKit 27.2 (Playwright) | Firefox 159.0 |
|---|---:|---:|---:|
| synthetic-text-1000.pdf, 900 px/s | 12, 14 | 9, 18 | 54, 55 |
| synthetic-text-1000.pdf, 3600 px/s | 77, 77 | 27, 27 | 108, 101 |
| bill-hr815.pdf, 900 px/s | 18, 17 | 61, 65 | 59, 61 |
| bill-hr815.pdf, 3600 px/s | 52, 56 | 34, 39 | 99, 93 |

Main-thread blocked time is lower or tied in 9 of 12 browser-job pairs: on all 4
WebKit jobs (9 vs 18, 27 vs 27, 61 vs 65, and 34 vs 39 ms), 3 of 4 Chromium jobs
(12 vs 14, 77 vs 77, and 52 vs 56 ms, plus 1 ms at 900 px/s on `bill-hr815.pdf`,
18 vs 17 ms), and both 900 px/s Firefox jobs (54 vs 55 and 59 vs 61 ms), while
the two 3,600 px/s Firefox jobs sit within 6–7 ms run-to-run variance (Lag p95
tied at 0.8 ms on `bill-hr815.pdf` and 0.9 vs 0.8 ms on
`synthetic-text-1000.pdf`, with max lag improving from 14 to 12 and 14 to
13 ms). First-paint run distributions overlap within one animation frame across
all 12 jobs.

`commit-bench.ts` measured 11 zoom-commit scenarios on `bill-hr815.pdf` against
decision 0043 (`c2a80e6`) on AC power in turn, job by job: 820×1000 at
`devicePixelRatio` 2, 3 runs per scenario
([`commit-controller-slots-chromium.md`](../../examples/prototype/results/commit-controller-slots-chromium.md),
[`-webkit.md`](../../examples/prototype/results/commit-controller-slots-webkit.md),
[`-firefox.md`](../../examples/prototype/results/commit-controller-slots-firefox.md)).
Across all 33 browser-scenario pairs, both builds record 0 blank frames and 0
frames with a page down to its base. Time-to-sharp medians are equal or lower in
9 of 11 scenarios in Chromium (`scale-up` 21 vs 22, `scale-down` 13 vs 15,
`zoom-in-far` 37 vs 39, `zoom-out-far` 13 vs 16, `zoom-twice` 18 vs 20,
`ctrl-wheel` 20 vs 22 ms, and tied on `pinch-in-start` 5, `pinch-in-drag` 4, and
`zoom-step` 16 ms; 1–2 ms higher within sub-frame variance on `pinch-out` 20 vs
19 and `zoom-in-whole` 19 vs 17 ms), tied on 4 scenarios and within 1–2 ms
sub-frame variance on the remaining 7 in WebKit (`pinch-out` 21, `pinch-in-start`
5, `pinch-in-drag` 5, `scale-down` 16 ms tied; `scale-up` 16 vs 15, `zoom-step`
16 vs 14, `zoom-in-far` 51 vs 50, `zoom-out-far` 17 vs 16, `zoom-in-whole` 12 vs
11, `zoom-twice` 15 vs 14, and `ctrl-wheel` 14 vs 13 ms), and equal or lower in
7 of 11 scenarios in Firefox (`pinch-out` 74 vs 78, `scale-up` 76 vs 78 with
peak canvas memory 237 vs 251 MiB, `zoom-in-far` 108 vs 110, `zoom-in-whole` 39
vs 44, `zoom-twice` 103 vs 106 ms, and tied on `pinch-in-start` 12 and
`scale-down` 37 ms; 1–2 ms higher on `pinch-in-drag` 8 vs 7, `zoom-step` 66 vs
64, and `zoom-out-far` 41 vs 40 ms, and 8 ms on `ctrl-wheel` 79 vs 71 ms within
half an animation frame).

## Reopen if

- A document with thousands of expanded outline branches shows parent toggles
  spending measurable time re-rendering non-leaf sibling branches, warranting
  per-branch toggled-descendant counts.
