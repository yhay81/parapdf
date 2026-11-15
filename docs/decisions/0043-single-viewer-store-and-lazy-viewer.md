# 0043. Single key-filtered ViewerStore, lazy PdfDocument default viewer, and direct fragment synchronization

- Status: adopted
- Date: 2026-11-15

## Decision

After decisions 0041 and 0042 tightened `<PdfDocument>`, `<PdfViewer>`, page
overlays, and key-tracking `Store` notifications around React's layout phase,
four internal store and lifetime seams still duplicated state or work:

1. **Five stores per `ViewerController` and coarse hot/cold listener fan-out**:
   `ViewerStore` (`src/view/state.ts`) maintained four separate `Store`
   instances (`#all`, `#hot`, `#cold`, `#sizes`), and `ViewerController`
   (`src/view/viewer.ts`) maintained a fifth `Store` (`#externalLinks`). Every
   `ViewerController` allocated five `Store`s, ten `Set`s, and five snapshot
   objects; every `store.set()` allocated per-key slice objects (`{ [key]:
   full[key] }`) and up to four shallow snapshot copies and listener `Set`
   clones. Meanwhile, subscribers on `store.hot` or `store` still woke on
   unrelated updates within the same bucket: `usePageWindow`
   (`src/react/PdfViewer.tsx`) woke on `currentPage` and `zoomMode` changes,
   `PdfThumbnails` (`src/react/PdfThumbnails.tsx`), `#followFocus`
   (`src/view/viewer.ts`), and form scripting (`src/features/forms/scripts.ts`)
   woke on `[first, last]` mounted-window shifts, `annotations.ts`'s
   `followView` invoked `editor.setView` on every window shift, and
   `bindControls` ran controlled-prop synchronization on `[first, last]` and
   `layout` shifts.
2. **Eager default `ViewerController` allocation in `<PdfDocument>`**:
   `<PdfDocument>` (`src/react/PdfDocument.tsx`) eagerly constructed `new
   ViewerController()` in `useState` and ran `ownViewer.hold()` on mount even in
   document-only subtrees (`useSession()`, `useDocumentState()`, `useOutline()`,
   `getText()`, `save()`) and multi-pane `<PdfView>` trees that never read
   `<PdfDocument>`'s default viewer.
3. **Session `#fragment` `Store` and split `<ViewerControlSync>` session
   effects**:
   `PdfSessionController` (`src/document/pdf-session.ts`) wrapped its URL
   fragment string in a full `Store<{ fragment: string }>`, and
   `<ViewerControlSync>` (`src/react/PdfViewer.tsx`) ran two separate
   `[viewer, session]` `useLayoutEffect` hooks (`followFragments` and
   `viewer.open(session)`) while passing `fragment` in `<ViewerControlSync>`'s
   option-sync dependency array.
4. **Unfiltered `useSessionData` wakeups during streaming downloads**:
   `useSessionData` (`src/react/context.ts`, shared by `useOutline()`,
   `usePageLabels()`, `useMetadata()`, `useAttachments()`, `useComments()`,
   `useLayers()`, and `useInitialView()`) subscribed to `session.stateStore`
   without key filtering, waking React on 60 Hz `progress` updates while a PDF
   streamed even though `session.reads` changes only on `"status"`,
   `"passwordReason"`, or unkeyed session switches.

`docs/architecture.md` ("document/", "view/", and "React") consolidates all four
seams without changing any public API:

- **Single key-filtered `ViewerStore`**:
  - `Store<T>` (`src/document/store.ts`) adds `markChanged(key)` and exports a
    shared `subscribeKeys(store, keys, listener)` helper, and `src/react/context.ts`
    replaces `useSelected` with `useStoreKeys(store, keys, selector)` while
    teaching selector-mode `useStoreSlice` to skip `onStoreChange` when
    `store.get()` is `Object.is`-unchanged (such as `"externalLinks"` updates).
  - `ViewerStore` (`src/view/state.ts`) extends `Store<ViewerState>` directly as
    each viewer's sole store: it tracks derived unrotated `sizes` (marking
    `"sizes"` only when `layout?.sizes` changes) and `externalLinks`
    (`setExternalLinks()`, marking `"externalLinks"`), removing `HotViewState`,
    `ColdViewState`, `PageSizesState`, `store.hot`, `store.cold`, and
    `ViewerController.externalLinksStore`.
  - Internal subscribers listen only to the exact keys they act on:
    `usePageWindow` and `<PdfSelectionPopover>` subscribe to `["layout",
    "first", "last"]`; `PdfThumbnails` subscribes separately to `["sizes"]`,
    `["rotation"]`, and `["currentPage"]`; `PdfThumbnail` subscribes to
    `["sizes", "rotation"]`; `OutlineTree` subscribes to `["externalLinks"]`;
    `#followFocus` and `forms/scripts.ts` subscribe to `["currentPage"]`;
    `annotations.ts` subscribes to `["layout", "currentPage"]` and calls
    `editor.setView` only when `(scale, rotation)` changes; and `bindControls`
    subscribes to `["currentPage", "scale", "zoomMode", "rotation", "spread",
    "scrollMode", "tool"]`.
- **Lazy `<PdfDocument>` default `ViewerController` (`LazyViewerHolder`)**:
  - `LazyViewerHolder` (`src/react/context.ts`) defers `new ViewerController()`
    until `useOptionalViewer()` resolves `<PdfDocument>`'s default viewer
    (skipping instantiation whenever an explicit `viewer` argument or enclosing
    `<PdfView>` is present). `<SessionLeaseMount>` calls `holder.connect()` in
    `useLayoutEffect`, holding an already-created viewer across `<Activity>`
    hide/show and `StrictMode` replay or acquiring `viewer.hold()` immediately
    if a child instantiates the default viewer while connected.
- **Direct session `#fragment` and filtered `useSessionData` reads**:
  - `PdfSessionController` stores `#fragment: string` (`get fragment()`,
    `setFragment()`, `onFragmentChange()`) with a single listener `Set`,
    removing `Store<{ fragment: string }>`; `<ViewerControlSync>` merges
    `followFragments(viewer, session)` and `viewer.open(session)` into one
    `[viewer, session]` `useLayoutEffect` and drops `fragment` from its
    option-sync dependency array.
  - `useSessionData` subscribes to `session.stateStore` via `useStoreKeys` on
    `["status", "passwordReason"]`, ignoring 60 Hz `progress` updates while
    still re-rendering on password transitions, ready/error states, and unkeyed
    session switches.

## Evidence

[`view-state.test.ts`](../../packages/parapdf/test/view-state.test.ts),
[`react-context-state.test.ts`](../../packages/parapdf/test/react-context-state.test.ts),
[`react-navigation.test.ts`](../../packages/parapdf/test/react-navigation.test.ts),
[`pdf-session.test.ts`](../../packages/parapdf/test/pdf-session.test.ts),
[`initial-view.test.ts`](../../packages/parapdf/test/initial-view.test.ts), and
[`viewer.test.ts`](../../packages/parapdf/test/viewer.test.ts) cover exact
key-filtered `ViewerStore` isolation across window shifts, `currentPage`,
`tool`, `rotation`, `sizes`, and `externalLinks`, atomic snapshot installation,
zero `ViewerController` allocation in document-only and explicit-viewer trees,
`LazyViewerHolder` `connect()` / disconnect lifecycle across `<Activity>`
hide/show, direct `PdfSessionController.fragment` updates, and `subscribeKeys`
filtering of streaming `progress` patches (1,067 unit tests passing across 120
suites). [`check-package.ts`](../../packages/parapdf/scripts/check-package.ts),
[`check-modules.ts`](../../examples/prototype/scripts/check-modules.ts), all 12
prototype functional checks in Chromium 158.0.8127.18, WebKit 27.2, and Firefox
159.0, `check:bundlers` across webpack, Rsbuild, and Next.js (Turbopack and
webpack), and site `check:demo`, `check:showcases`, and `.claude/launch.test.mjs`
all pass. Extending `Store<ViewerState>` directly instead of maintaining four
`Store` instances trims the core viewer chunk from 61.13 to 60.76 kB while
cutting four `Store`s, nine `Set`s, and four snapshot objects per
`ViewerController` and one `Store` per `PdfSessionController`.

`scroll-bench.ts` measured main-viewport scrolling (with a static
`<PdfPageOverlay page={0}>` mounted in the demo) against decision 0042
(`76db1e9`) on AC power in turn, job by job: 1280×900 at `devicePixelRatio` 2,
fit-width, 4,000 ms of scrolling at 900 and 3,600 CSS pixels per second through
`synthetic-text-1000.pdf` and `bill-hr815.pdf`, median of 5 runs
([`scroll-single-store-chromium.md`](../../examples/prototype/results/scroll-single-store-chromium.md),
[`-webkit.md`](../../examples/prototype/results/scroll-single-store-webkit.md),
[`-firefox.md`](../../examples/prototype/results/scroll-single-store-firefox.md);
Playwright's headless WebKit is not Safari). Across all 12 browser-job pairs,
both builds record 0.0% blank area, 0.0% blank frames, identical React commits
(4 at 900 px/s; 25 and 21 at 3,600 px/s), identical store updates (4, 24, 4, and
20), identical render counts, and identical settled canvas memory (156, 111,
183, and 127 MiB). Dropped frames are 0 / 241 in Firefox, 0, 0, 2, and 0 / 289
in WebKit (identical to `before`), and 0, 0, 0, and 1 / 240 in Chromium
(identical to `before`). Main thread blocked while scrolling, in ms, after and
before (`76db1e9`):

| Job | Chromium 158.0.8127.18 | WebKit 27.2 (Playwright) | Firefox 159.0 |
|---|---:|---:|---:|
| synthetic-text-1000.pdf, 900 px/s | 15, 12 | 16, 16 | 50, 44 |
| synthetic-text-1000.pdf, 3600 px/s | 51, 44 | 26, 20 | 86, 87 |
| bill-hr815.pdf, 900 px/s | 14, 17 | 60, 68 | 66, 65 |
| bill-hr815.pdf, 3600 px/s | 35, 36 | 39, 45 | 81, 93 |

Main-thread blocked time is lower or tied on all three browsers on the
110-page real-world document `bill-hr815.pdf` at 3,600 px/s (Chromium 35 vs
36 ms, WebKit 39 vs 45 ms, Firefox 81 vs 93 ms) and in 7 of 12 browser-job
pairs overall (plus 1 ms on Firefox `bill-hr815.pdf` 900 px/s, 66 vs 65 ms),
and 3–7 ms higher on the remaining 4 `synthetic-text-1000.pdf` jobs within
run-to-run background variance (Lag p95 differs by at most 0.1 ms on 11 of 12
jobs and improves from 5.8 to 5.5 ms on WebKit `bill-hr815.pdf` 900 px/s;
cold-navigation first-paint run distributions overlap within one animation
frame across all 12 jobs, improving from 200 to 180 ms median on Chromium
`synthetic-text-1000.pdf` 900 px/s and shifting by one frame where 1–2 of 5
runs cross a vblank boundary).

`commit-bench.ts` measured 11 zoom-commit scenarios on `bill-hr815.pdf` against
decision 0042 (`76db1e9`) on AC power in turn, job by job: 820×1000 at
`devicePixelRatio` 2, 3 runs per scenario
([`commit-single-store-chromium.md`](../../examples/prototype/results/commit-single-store-chromium.md),
[`-webkit.md`](../../examples/prototype/results/commit-single-store-webkit.md),
[`-firefox.md`](../../examples/prototype/results/commit-single-store-firefox.md)).
Across all 33 browser-scenario pairs, both builds record 0 blank frames, 0
frames with a page down to its base, and identical render counts and canvas
memory on every scenario. Time-to-sharp medians are equal or lower in 7 of 11
scenarios in Chromium (`pinch-out` 19 vs 21, `scale-up` 20 vs 21, `scale-down`
14 vs 16, `zoom-step` 17 vs 18, `zoom-out-far` 18 vs 19, `zoom-twice` 19 vs
20 ms, tied on `pinch-in-drag` 4 ms; 1–3 ms higher within sub-frame variance on
`pinch-in-start` 5 vs 4, `zoom-in-far` 30 vs 29, `ctrl-wheel` 21 vs 20, and
`zoom-in-whole` 19 vs 16 ms), 8 of 11 in WebKit (`pinch-out` 21 vs 22,
`pinch-in-drag` 5 vs 6, `zoom-step` 15 vs 16 ms, tied on `pinch-in-start` 5,
`scale-up` 17, `scale-down` 15, `zoom-in-far` 52, and `zoom-in-whole` 11 ms;
1–2 ms higher on `zoom-twice` 16 vs 15, `zoom-out-far` 17 vs 15, and
`ctrl-wheel` 13 vs 11 ms), and 5 of 11 in Firefox (`pinch-in-start` 11 vs 12,
`scale-down` 38 vs 40, `zoom-in-far` 114 vs 118, `zoom-out-far` 33 vs 41, and
`zoom-in-whole` 46 vs 48 ms; 1–7 ms higher within half an animation frame on
`pinch-in-drag` 7 vs 6, `pinch-out` 78 vs 75, `zoom-step` 51 vs 48, `scale-up`
81 vs 76, `zoom-twice` 110 vs 105, and `ctrl-wheel` 77 vs 70 ms).

## Reopen if

- Profiling shows `Set.has` over `changedKeys` in a single `ViewerStore`
  dominating listener dispatch relative to pre-partitioned listener lists.

