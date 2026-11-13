# 0038. Narrow React-only Viewer interface and settled onViewStateChange

- Status: adopted
- Date: 2026-11-14

## Decision

`Viewer` was previously exported as a concrete, constructible class (`new Viewer()`)
whose public surface exposed vanilla store subscriptions (`viewer.store`),
internal extension hooks (`viewer.extend`, `ViewerExtension`, `Opening`),
renderer and DOM-layer maps (`viewer.renderer`, `viewer.textLayers`,
`viewer.annotationLayers`), session plumbing (`viewer.session`,
`viewer.pdfSession`, `viewer.permissions`, `viewer.layers`, `viewer.workSignal`,
`viewer.signal`), and imperative feature mutators (`viewer.setFormLayers`,
`viewer.setFormScripting`, `viewer.setAnnotationEditor`, `viewer.claimPointer`,
`viewer.invalidateContent`, `viewer.invalidateDrawings`, `viewer.defer`).
Meanwhile, `viewer.ts` used seven `static {}` friend-function trampolines to keep
React lifecycle methods off the class's public type, and persisting a reader's
scroll position (`initialViewState`) still required manually wiring
`viewer.store.subscribe()` plus `window` `pagehide` listeners — which also missed
intra-page scrolls where neither `currentPage` nor the mounted window changed.

`docs/architecture.md`, "View" and "React", splits the public handle from the
internal controller and adds settled view-state persistence to `<PdfViewer>`:

- `Viewer` (`src/view/viewer.ts`) is now a narrow TypeScript `interface`
  exported with `export type { Viewer }`, exposing `readonly state: ViewerState`
  for synchronous reads in event handlers, `scroller`, `content`,
  `externalLinks`, navigation/view methods (`goToPage`, `nextPage`,
  `previousPage`, `zoomBy`, `setScale`, `resetScale`, `rotate`, `setRotation`,
  `setSpread`, `setScrollMode`, `setTool`, `goToDestination`, `show`,
  `viewState`, `setViewState`, `revealRect`, `pointAt`, `position`,
  `restorePosition`), and diagnostic metrics (`stats`, `keptPixels`,
  `firstPaintAt`, `hasPixels`, `blankFraction`, `sharpness`). `ViewerExtension`
  and `Opening` are removed from `packages/parapdf/src/index.ts`.
- Internal `ViewerController` implements `Viewer`, registers instances in a
  module-private `WeakSet`, and exposes `controllerOf(viewer)` plus direct
  internal methods (`open`, `hold`, `configure`, `attachViewport`, `attachPage`,
  `pointerClaimed`, `externalLinksStore`, `onViewStateChange`,
  `flushViewState`, `batchView`), replacing all seven `static {}` friend
  trampolines. `ViewerContext` and `PageContext` carry `ViewerController`, while
  public functions and hooks (`print`, `permits`, `useOptionalViewer`) resolve
  `controllerOf(viewer)`.
- `<PdfViewer onViewStateChange?: (viewState: ViewState) => void>` reports
  settled `ViewState` snapshots (`sameViewState` deduplicated): it seeds the
  initial view on document load without echoing `onViewStateChange`, coalesces
  compound synchronous updates (`setViewState`, `configure` + controlled props)
  via `batchView()`, waits for `SETTLE_DELAY` (`150 ms`) after intra-page or
  cross-page scrolls without per-frame emissions or zoom-preview emissions,
  ignores collapsed `0×0` (`display: none`) scrollers, and flushes pending
  scrolls on `window` `pagehide` and before `<PdfViewer>` detaches on unmount.

## Evidence

[`viewer.test.ts`](../../packages/parapdf/test/viewer.test.ts) and
[`react-context-state.test.ts`](../../packages/parapdf/test/react-context-state.test.ts)
cover `viewer.state`, `controllerOf()` brand validation, `onViewStateChange`
silence on `initialViewState` open, `batchView()` coalescing and `sameViewState`
deduplication, zero emissions across active scroll frames followed by a single
settled emission after `SETTLE_DELAY`, `flushViewState()` on `pagehide` and
viewport detach, and collapsed `0×0` scroller protection.
[`check-package.ts`](../../packages/parapdf/scripts/check-package.ts) verifies
`@ts-expect-error` rejection of `viewer.store`, `viewer.extend`,
`viewer.renderer`, and `viewer.session` against packed declarations and confirms
that `"Viewer"`, `"ViewerExtension"`, and `"Opening"` are absent from runtime
value exports; [`check-options.ts`](../../examples/prototype/scripts/check-options.ts)
verifies `<PdfViewer onViewStateChange>` across initial open, programmatic jumps,
active and settled scrolls, `pagehide`, and unmount in Chromium 158.0.8127.18,
WebKit 27.2, and Firefox 159.0, alongside all other functional checks,
`check:modules`, `check:bundlers`, and the site's `check:demo` and
`check:showcases`.

## Reopen if

- An embedding React application needs a capability currently restricted to
  `ViewerController` that cannot be expressed cleanly through declarative
  components or React hooks.

