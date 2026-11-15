# ParaPDF's architecture

How the runtime in `packages/parapdf/src/` is built, and why. Where the code
and this file disagree, one of them is wrong: fix it, or ask.
`docs/decisions/` records the choices that matter for performance or
direction, with their evidence. The site's reference
(https://parapdf.yhay81.com/reference/components/) documents the API.

## Goals

- The fastest React PDF viewer on pdf.js, measured: pages flipped through
  quickly, and pages come back to show at once; scrolling and zooming never
  commit React state per frame; drawing leaves the main thread wherever
  pdf.js allows.
- A small core, with every feature a module that only applications using
  it load.
- Code tested where it decides: the planning of drawings, layout, geometry,
  and gestures' math run in Node; browsers check the integration.

## Non-goals

- Another engine than pdf.js, or an engine boundary (decision 0001).
- Compatibility: APIs change whenever that makes ParaPDF faster or simpler,
  with no deprecations or shims (decision 0002).
- Anything of a domain: scales, measurement, CAD layers.
- An application's own interface: toolbars, sidebars, a find bar, dialogs,
  a presentation mode, shortcuts beyond the viewport's keys, and their
  translations. ParaPDF matches pdf.js's viewer in what a document can do,
  not in its chrome; applications build theirs from the data and actions
  ParaPDF gives (decision 0019).

## Layers

Dependencies point down only. The core (`pdfjs/` to `render/`) imports no
feature, and React is used only in `react/`.

```
react/      PdfDocument, PdfView, PdfViewer, PdfForms, PdfAnnotationEditor,
            PdfAutoLinks, PdfPermissions, PdfThumbnails, PdfOutline, hooks, overlays
features/   search, history, initial view, permissions, forms,
            annotations, autoLinks, print, download, thumbnails, layers,
            attachments, selection, text
render/     planner (pure), renderer (page DOM, canvases, kept canvases),
            DOM layers (text, links and forms, editor, structure), selection tracker
view/       Viewer: layout, scrolling, zoom, gestures, keys, navigation, state, view snapshots
document/   DocumentSession, one per open document, shared through a registry
pdfjs/      loading pdf.js with its worker and files; drawing and layers with it
```

### pdfjs/

`loader.ts` loads pdf.js on first use and shares it, and its one worker,
with every viewer; `configurePdfjs()` takes one configuration (the same
again changes nothing; another is ignored with a warning), and
`parapdf/legacy` (`src/legacy.ts`, `legacy-files.ts`) gives pdf.js's legacy
build, whose worker only applications importing it emit. The rest is how
ParaPDF drives pdf.js, with pdf.js's own types and no interface between:
drawing a page or a region (`draw.ts`), the text layer and its language fix
(`text.ts`), destinations, the annotation layer and its link service,
optional content (`layers.ts`), the structure tree, form scripting's
sandbox (`scripting.ts`), and the annotation editor with the labels pdf.js
leaves to its viewer's localization (`editor*.ts`).

WebGPU rasterization of mesh shadings is opt-in through
`documentOptions.enableWebGPU` (decision 0029).

The package ships pdf.js's worker and the files it loads on demand.
`scripts/pdfjs-files.ts` copies them into `pdfjs/` and writes `files.ts`,
which references each with `new URL(…, import.meta.url)`, so bundlers emit
them with the application's assets. Bundlers give each file a URL of its
own, but the worker asks for CMaps, fonts, decoders, and ICC profiles as a
directory plus a name, so the worker's URL carries the files' URLs in its
fragment and `scripts/worker-prelude.js` routes the worker's requests to
them (pdf.js gets `parapdf:/` as the directory). The files' URLs end in
`?no-inline&url`, which keeps Vite and Rsbuild from inlining small files
into the bundle, and `shippedUrl()` strips it. Vite, webpack, Rsbuild, and
Next.js emit the files (`check:bundlers`); other bundlers take a copy of
`pdfjs/` and `configurePdfjs({ assetBase })`.

### document/

`DocumentSession` (`session.ts`) is one open document: pdf.js's
`PDFDocumentProxy` and pages, the pages' sizes (the first page's for all at
once, then the real ones in the background), and the document's data, each
read once: page labels, outline, metadata, attachments, comments,
permissions, the initial view, optional content, and the text read for
search and `getText()`. Resolved page sizes, permissions, direction, initial
view, page labels, and optional-content layers are also exposed synchronously (`knownPageSizes`,
`knownPermissions`, `knownDirection`, `knownInitialView`, `knownPageLabels`, `loadedLayers`) so a
viewer or thumbnail list joining a warm session renders without awaiting microtasks, and
the registry eagerly kicks off `pageSizes()` and `direction()` alongside `permissions()` when a
document opens (decisions 0041 and 0042).

- A source is a URL (with request headers and credentials), bytes, or a
  `PDFDataRangeTransport`. A URL is identified without its fragment, which
  says where to open.
- The registry (`registry.ts`) shares one session among every viewer of a
  source, keyed by the source. A session opens the first time a provider's
  render or a lease asks for it, and leases hold it: it closes one second
  after the last lease goes, so StrictMode and quick remounts open once,
  and, when no lease came to hold it (a render React never mounted), ten
  seconds after it came to rest, loaded or failed and with nothing being
  read. Its entry publishes the document state (`store.ts`) from the
  moment it starts to open: status (`"loading"`, `"password"`, `"ready"`,
  `"error"`), the error, why a password is asked for, progress (at most
  once a frame), and, once ready, the page count and permissions. It also
  keeps what was read of the document for every provider of the source,
  one promise for each thing read, which a render React suspended finds
  again when it renders anew (decision 0032). Reads in progress postpone the
  timeout for an unheld render. A new provider's first hold retries failed
  reads and publishes the new promises. The shared entry exposes its loaded
  proxy to every ready provider, including one that just joined.
- A session owns an `AbortController`: everything started for it (drawing,
  text, searches, background passes, the editor, form scripts) takes its
  signal, and closing aborts it all. No generation counters.
- Applications see a narrow `PdfSession` interface (`pdf-session.ts`), one per
  `PdfDocument`: its `source`, synchronous `state` (`DocumentState` snapshot),
  `submitPassword()`, pdf.js's `proxy` once ready, and its `signal`, while
  `react/` and `features/` resolve the backing `PdfSessionController` via
  `sessionControllerOf(session)` (decision 0039). `PdfSessionController` holds
  the reactive `stateStore` (`useDocumentState()`) and `read()`, whose promises
  for `useOutline()` and the other Suspense hooks settle empty when the read or
  the document fails and while the document waits for a password, to be read
  anew once it is answered. It opens, closes, and releases nothing itself:
  `PdfDocument` starts its session as it renders, and mounts a leaf
  `<SessionLeaseMount>` before its children so `session.connect()`, the lazy
  default viewer holder's `connect()`, password prompt, attachment handler, and
  URL fragment (`session.fragment`, `session.onFragmentChange()`) apply in
  `useLayoutEffect` before any child effect runs (decisions 0041 and 0043). It
  follows the registry's session its render started and then the one its
  provider holds, which is another once the first closed. `PdfDocument`'s
  `onOpenAttachment` sets how embedded files opened from the session are
  handled, while `PdfSessionController` stays free of DOM imports so
  tree-shaking drops unused document actions. `DocumentSession` also publishes
  content changes (`onContentChange`, `invalidateContent()`) when
  session-scoped mutations (`setFormValues()`, `setLayerVisible()`) update
  shared document state across viewers.

Viewers that edit annotations share the session's one annotation storage,
each with an editor of its own under ids unique to the session. Saving the
session and printing from any viewer include what every viewer created; a viewer
shows the annotations it created, not the others'. Editing also reaches the
file's own annotations of the kinds pdf.js's editor edits (text, ink,
highlights, unlocked images): while a tool is chosen they become editors,
and pages are drawn again without them; pdf.js then leaves what the storage
changed out of every viewer's drawings.

### view/

`ViewerController` (`viewer.ts`) is one viewport onto a session, with its own
position, zoom, rotation, spreads, scroll mode, direction, and tool; several
may show one session. Applications see the narrow `Viewer` interface (`state`
snapshot, `scroller`, `content`, `externalLinks`, and navigation/view methods),
while `react/` and `features/` resolve the backing `ViewerController` through
`controllerOf(viewer)` (decisions 0038 and 0041); internal positions
(`position()`, `restorePosition()`) and diagnostic measures (`stats`,
`keptPixels`, `firstPaintAt`, `hasPixels()`, `blankFraction()`, `sharpness()`)
stay on `ViewerController`. `ViewerController.bindControls()` owns live option
updates, controlled view prop synchronization without callback echoes,
divergence notification, and `pagehide` / session-stop `ViewState` flushing,
and `#start()` lays out warm sessions synchronously before `open()` returns.

- `layout.ts`: pure and immutable per zoom (typed arrays, rows, spreads,
  scroll modes, direction). `zoom.ts` and `navigation.ts` hold the pure
  rules of zoom modes ("fit-width", the default, "fit-page", and "auto",
  pdf.js's default) and of destinations and the current page.
- `scrolling.ts`, `gestures.ts`, and `input.ts`: scrolling, a zoom
  previewed with a CSS transform (notifying listeners through
  `viewer.onPreviewChange()`) and committed where it showed, touch,
  wheel, Safari's gesture events, swipes in "page" mode, the keys, and the
  hand tool. `viewer.pageHost(index)`, `viewer.selectionDragging`, and
  `viewer.onSelectionDragChange()` expose mounted page hosts and primary-button
  text-drag transitions to internal `features/` and `react/` callers without
  DOM queries.
- `state.ts`: the viewer's single key-filtered store (`ViewerStore`), view state
  only. Every `set()` reports the exact changed keys (`ViewerState` fields,
  unrotated page `"sizes"` when `layout?.sizes` changes, and `"externalLinks"`
  when the viewer's external link target changes), allocating nothing when
  values stay equal or no listener is attached; `react/`, `features/`, and
  controller bindings subscribe to exact keys via `subscribeKeys()` and
  `useStoreKeys()` so window shifts, page changes, zoom commits, and option
  changes wake only their own readers (decisions 0040, 0042, and 0043).
- `options.ts`: the viewer's options. Those the renderer is built with
  (layers, colors, budgets, concurrency) rebuild it as a detach and
  reattach would, keeping position and edits; the others apply at once.
- `view-state.ts`: plain serializable `ViewState` snapshots (`viewer.viewState()`,
  `viewer.setViewState()`, and `sameViewState()`), shared with
  `initialViewState` and `<PdfViewer onViewStateChange>`.
- `extensions.ts`: `viewer.extend()` on `ViewerController`, the hooks internal
  features attach with.
  `metrics.ts`: what the checks and benchmarks read. `files.ts`: bytes
  handed to the browser as a download. `signals.ts`: linked abort signals.
- Focus follows the page being read (decision 0021): pages are focusable
  but not in the tab order; focus on the viewport or a page moves to the
  current page when it changes, to a link's target page, and off a page
  that unmounts. Focus elsewhere, and during a text selection drag, stays.
- A number the viewer cannot use (NaN pages, scales, rotations) does
  nothing; destinations behave as in pdf.js's viewer.

A viewer has an `AbortController` of its own. Its viewport detaching
aborts its work (drawing, searches, printing, publishing) but keeps the
view and edits for reattachment; it lives as long as the `PdfDocument`,
`PdfView`, or `useCreateViewer()` that created it.

A viewer shows a session while the session's provider holds the document
and the viewer's owner holds the viewer (`viewer.hold()`). When either lets
go, the viewer lets go of the document: it stops its work, releases what
it drew, and tells its extensions (`closed(true)`). It keeps a weak reference
to the provider, the view position, history, finished search and annotation
edits. Edits leave the document's storage while hidden, including deletions
of original annotations. Saving and printing await restoration when shown.
On reopening, the viewer compares both pdf.js fingerprints, for the file
and its revision. A changed fingerprint or a different provider starts a
fresh view and clears the kept edits and search (`closed(false)`).
React destroys effects alike when it hides a tree
(`<Activity>`), runs them again (StrictMode), and unmounts, and says
nothing more of a tree it removes while hidden: the viewer keeps only what
the garbage collector takes with it (decision 0032).

### render/

- `planner.ts` is a pure function from the layout, viewport,
  devicePixelRatio, whether scrolling settled, the budgets, and what each
  page shows and draws now, to the drawings wanted, in order: a base at half
  a device pixel per CSS pixel within 2 MP; a detail at full resolution, of
  the whole page within 16 MP, else of the visible area within the budget;
  reduced resolution in quarter-octave steps within `maxCanvasPixels`;
  visible pages first; no base drawn again under a whole-page detail
  (decision 0025).
- `renderer.ts` carries out the plans: starts, cancels, and releases
  drawings, and keeps the canvases of pages that unmount within
  `maxKeptPixels` (`kept-canvases.ts`, decision 0004). A whole-page detail
  no larger than a base becomes the base when it gives way (decision 0012);
  a detail stays while the viewport is hidden and until a base replaces it
  (decision 0026).
- The renderer owns each page's DOM inside the host React places
  (`page.ts`, decision 0010): the canvases and the layer containers. A kept
  canvas moves into the page's next host without a copy.
- `dom-layers.ts` builds DOM layers one at a time, after scrolling
  settles, in idle time, never while a visible page waits for its first
  pixels: text, then links and forms, then the annotations being edited.
  A mounted tagged page gives its text and annotation DOM ids unique to its
  structure tree, so its accessibility relationships stay in that viewer.
  Text layers keep the zoom they were laid out at and follow later zooms
  with CSS. DOM layers scale their raw coordinates by the page's PDF
  user-space unit, which pdf.js includes in the canvas viewport (decision
  0030). Text layers are built per page (decision 0020).
- `selection.ts` keeps text selection drags in text layers across pages
  and gaps, with each browser's fixes; ported from pdf.js's
  `TextLayerBuilder` (`NOTICE.md`).
- Drawing uses the main thread by default. `configurePdfjs({ rendererSrc: true })`
  loads the packaged modern or legacy drawing worker on demand (decision 0028).
  A string supplies a custom worker URL.

### features/

A feature attaches to a `ViewerController` or a session through
`viewer.extend()` and `ViewerController`'s methods, keeps any state in a store
of its own, and detaching it undoes what it added. The core imports no feature.

- Forms (with `scripts`), annotation editing, auto-linked addresses,
  permission enforcement, search, print, and the other features are imported
  only by the components, hooks, or standalone functions that use them
  (`PdfForms`, `PdfAnnotationEditor`, `PdfAutoLinks`, `PdfPermissions`,
  `useSearch()`, `useSave()`, `usePrint()`, `save()`, `getText()`, and so on),
  so bundlers exclude unused features statically with zero dead feature chunks
  emitted on disk (decisions 0034 and 0035). Document-level operations (`save`,
  `download`, `getText`, `getFormFields`, `setFormValues`, `setLayerVisible`,
  `getAttachmentContent`, `openAttachment`) take `PdfSession` as standalone
  functions rather than methods on `PdfSession`, keeping `PdfDocument` free of
  optional feature code while working without a mounted `PdfViewer`. Vanilla-only
  plumbing (`searchOf`, `attachSearch`, `historyOf`, `attachHistory`,
  `attachThumbnail`, `enforcePermissions`, `annotationSlot`,
  `getSelection`, `getViewState`, `setViewState`) stays internal to the package
  (decisions 0035 and 0041). Each stateful feature owns its single reactive
  store or listener registry directly in `features/` (`Store<SearchControls>`,
  `Store<HistoryControls>`, `annotation-slot.ts`'s `Store<AnnotationControls>`
  and `bindAnnotationTool()`, `onViewerFormChange()`, and
  `createPrintController()`), so `react/` subscribes directly without wrapper
  stores or relay `WeakMap`s while keeping `annotations.ts`, `pdfjs/editor*.ts`,
  and `forms/layers.ts` in lazy chunks.
- Form scripts are off by default and load only for a document that has
  some: pdf.js's QuickJS sandbox, one per session, started after the first
  paint (decision 0016), sending pdf.js's viewer's document events around
  saving, printing, and closing.
- Links found in the text (`autoLinks`, decision 0024) are found as
  pdf.js's viewer finds them and added to the annotation layer.
- The initial view applies `/OpenAction`, `/PageLayout`, `/PageMode`, a
  URL's open parameters (`page`, `zoom`, `nameddest`; decision 0023), and
  `initialViewState`, once per document, resolving explicit numeric parameters
  and `initialViewState` synchronously (`resolveDestinationSync`) when warm.
- Download and save take the whole document or chosen pages, through
  pdf.js's `extractPages()`, with the form values and annotations.
- Search ports pdf.js's find normalization (`text-search.ts`), CJK
  included, and highlights matches with the CSS Custom Highlight API.
  It scans forward from the viewer's current page and wraps at the end.
  Each progress update puts both runs of matches in document order and
  preserves the selected match as earlier pages arrive (decision 0027).
- Selection (`selection.ts`) resolves text layers and mounted page hosts
  through `viewer.textLayers` (`TextLayerHandle.layer`) and `viewer.pageHost()`
  rather than `querySelectorAll`, and caches each text layer's node-to-item
  `Map` in a `WeakMap`. Thumbnails (`thumbnails/`) skip `scrollParent` walks
  and `IntersectionObserver`s when `virtualized: true` (`<PdfThumbnails>`),
  retain detached drawn canvases in a bounded LRU pixel pool (`maxKeptPixels`,
  8 MP default) restored synchronously on remount via `drawImage` (or zero-copy
  on `StrictMode` replay), and reset when `session.onContentChange` fires
  (decision 0042).

## React

`react/` is the only module that uses React, and every module that touches
the DOM declares `"use client"`.

- `PdfDocument` opens or joins a session as it renders, holds it in a first-child
  `<SessionLeaseMount>` `useLayoutEffect`, provides a lazy default `Viewer`
  (`LazyViewerHolder`, instantiating `ViewerController` only when `useViewer()`,
  `<PdfViewer>`, or another default-viewer hook reads it so document-only and
  `<PdfView>` trees allocate none) through `ViewerContext` (or provides the
  `viewer` prop given to it), and renders its children at once; nothing suspends
  before the first page draws (decision 0043). A source with another URL, headers,
  bytes, transport, or password opens another; a new fragment moves its viewers
  as a link would.
- `PdfView` provides an independent `Viewer` scope inside a `PdfDocument`
  so split panes compose the same controls, thumbnails, and `PdfViewer`
  without prop plumbing. `useViewer()` reads the nearest `ViewerContext`;
  `useCreateViewer()` creates a standalone `Viewer` for callers above
  `PdfDocument` or across panes (holding it in `useLayoutEffect`), and
  `PdfViewer` and `PdfView` forward a React 19 `ref` to their `Viewer`
  (decisions 0033 and 0041).
- The lifetimes are React's (decision 0032). A render may never mount, as
  under a Suspense boundary that waits or in a transition React abandons,
  so what a render needs of the document starts in the render and is kept
  in the registry, not in the component's state, which React drops with
  the render. Everything held is held by an effect and let go by its
  cleanup: the provider's lease, the viewer's hold (`PdfDocument`,
  `PdfView`, or `useCreateViewer()`), and the
  viewport. What the reader gets back after React hid a tree lives in the
  viewer, which the component's state keeps. During hydration,
  `useDocumentState()` uses the server's opening snapshot before reading
  the live state. Because `<SessionLeaseMount>` takes the provider's lease in
  `useLayoutEffect` before any child effect runs, a password submitted by a
  child's first effect answers the held session directly.
- `PdfViewer` is one viewport. View state (`zoom`, `rotation`, `spread`,
  `scrollMode`, `tool`) is controlled or uncontrolled; the current page is
  reported (`onPageChange`) and set with `viewer.goToPage()`; settled
  `ViewState` snapshots are reported (`onViewStateChange`) without initial echo
  or per-frame scroll emissions, flushing pending scrolls on `pagehide` and
  viewport detach (decision 0038). Every other
  prop is a live option: changing it needs no remount, and an option set to
  its default is the option left out. `<PdfViewer>` separates `<ViewerViewport>`
  (the scroll container, `{children}`, and `memo(ViewerPages)`) from a memoized
  sibling leaf `<ViewerControlSync>` (`return null`) that receives only option
  and control props and binds options, controlled props, fragment following, and
  `viewer.open(session)` in dependency-tracked `useLayoutEffect` hooks via
  `viewer.bindControls(reconcile)`: rejected controlled changes re-render only
  `<ViewerControlSync>`, parent renders that change only `children` or `style`
  skip `<ViewerControlSync>` entirely, `memo(ViewerPages)` subscribes to
  `viewer.store.subscribeKeys(["layout", "first", "last"])` in `useLayoutEffect`
  (`usePageWindow`) so warm sessions flush `<PdfPage>` hosts and canvases
  synchronously before the first browser paint, `<ViewerControlSync>` merges
  `followFragments(viewer, session)` and `viewer.open(session)` into a single
  `[viewer, session]` `useLayoutEffect`, static `.parapdf-pages` and
  `.parapdf-pages > section` styles live in `VIEWER_CSS`, and each
  `memo(PdfPage)` registers its `<section>` host with a React 19 ref cleanup
  callback rather than a per-page `useLayoutEffect` (decisions 0040, 0041, 0042,
  and 0043).
  `children` renders
  inside the viewport container so declarative feature components (`PdfForms`,
  `PdfAnnotationEditor`, `PdfAutoLinks`, `PdfPermissions`) mount synchronously
  with `useLayoutEffect` before the browser paints, without async layout
  deferrals. `PdfAnnotationEditor` renders its `<style
  precedence="parapdf">` directly, controls or initializes the active tool
  (`tool`, `defaultTool`, `onToolChange`) in `useLayoutEffect` via
  `bindAnnotationTool()`, and preserves kept snapshots when
  hidden with its viewport (`<Activity>` or unmounting `PdfViewer`) while
  detaching immediately when removed from an attached viewport (decisions
  0034 and 0041). Cleanup waits until the commit finishes so a sibling editor can
  mount after the viewport and reclaim its kept annotations. `useAnnotations()`
  subscribes directly to `annotationSlot(viewer)`'s `Store<AnnotationControls>`,
  whose action methods stay referentially stable.
  `PdfPageOverlay` (single-page, RSC-compatible plain `children`) and
  `PdfPageOverlays` (evaluated inside each page's `memo(PdfPage)` so mounted
  pages stay memoized as the window shifts) render into `<PdfPageOverlayLayer>`,
  placed directly as JSX at the end of `<section>` inside `memo(PdfPage)`:
  `PdfPageOverlays` renders inline without portaling, while `PdfPageOverlay`
  portals into the `.parapdf-overlay-layer` element published by a React 19 ref
  cleanup callback (`store.attachLayer`). When neither produces content for a
  page, `<PdfPageOverlayLayer>` returns `null` so zero `.parapdf-overlay-layer`
  nodes exist in the DOM, and `OverlayStore` tracks per-page overlay activity so
  pages without an active renderer or portal claim mount no
  `<PdfPageOverlayLayer>` at all; `PageContext` carries `{ pageIndex, size }` so
  `PdfPageRect` positions children with zero `viewer.store` subscriptions, and
  renderer identities stay unique across viewers (decisions 0036, 0040, and
  0042). `PdfViewer`'s `onPageClick` and
  `viewer.pointAt()` map client coordinates back to unturned PDF points
  (`PdfPageRect`'s coordinates) across rotations, zoom previews, and
  `/UserUnit` pages. `PdfSelectionPopover` portals floating selection UI to
  `document.body` outside page `contain: "strict"` clipping, suppresses range
  reads and React commits during primary-button selection drags
  (`useSettledSelection` over `viewer.onSelectionDragChange()`), commits once on
  release while keeping its DOM listeners, store subscription, and
  `ResizeObserver` attached across selection updates, and tracks scroll and zoom
  previews (`viewer.onPreviewChange()`) imperatively without per-frame React
  state commits or DOM `MutationObserver`s;
  `useSelection()` also provides a virtual `selection.anchor` for external
  popover libraries (short-circuiting unchanged single-range endpoints and
  skipping redundant state dispatches). `preloadDocument(source)` starts loading pdf.js,
  preloading `source`'s URL, and warming `source`'s initial page dimensions,
  permissions, direction, initial view, and page labels in the shared registry
  ahead of `PdfDocument` mounting so `PdfViewer` and `PdfThumbnails` render
  synchronously before the first paint.
- `PdfThumbnails` and `PdfThumbnail` draw the viewer's document at a lower
  priority, reading unrotated page dimensions via `useStoreKeys(viewer.store,
  ["sizes"], …)` so scrolling and zooming never wake them (decisions 0040 and
  0043). `PdfThumbnails` passes primitive page
  dimensions, `rotation`, and `virtualized` directly to a zero-subscription
  `ThumbnailCanvas` (attached via a React 19 ref cleanup callback and backed by
  `ThumbnailRenderer`'s bounded LRU kept-canvas pool) rather than subscribing
  per item (decision 0042), caches scroll-container geometry across scroll
  events so sidebar scrolling triggers zero `getComputedStyle` or
  `getBoundingClientRect` reflows, skips re-measuring uniform item chrome on
  window shifts, and virtualizes its `<ol>` window over a prefix-sum
  `Float64Array` of turned page heights (with `borderTop` / `borderBottom`
  transparent spacers preserving stylesheet padding and flex `rowGap`,
  `aria-setsize` / `aria-posinset` on mounted `<li>` items, non-suspending
  `pageLabels` resolution reading warm `knownPageLabels` synchronously from a
  single session-watch store, custom
  `children?: (item: ThumbnailItem) => ReactNode`,
  and `block: "nearest"` auto-scroll of `currentPage` even when unmounted).
  Active-page alignment follows measured item chrome, width, and rotation;
  failed label reads retain numeric labels.
  `PdfOutline` renders `<nav><ol>…</ol></nav>` over `useOutline()`, following
  the viewer's `"externalLinks"` key on `viewer.store` (`viewer.externalLinks`),
  providing expand/collapse controls for nested entries, and honoring optional
  `renderItem` customization (decisions 0037 and 0043). `PdfPageRect` places
  content in PDF points.
- `useViewState()`, `useDocumentState()`, `useSearch()`, `useHistory()`, and
  `useAnnotations()` read stores through `useSyncExternalStore`
  (`useStoreSlice`), and `useLayers()` subscribes directly to `LayerState`:
  `Store.update()` reports changed property keys to listeners so `useStoreSlice`
  skips waking React when an update touches only untracked keys (decision 0042);
  called without
  a selector, they track the fields read during rendering (dropping fields no
  longer read in inactive branches, while keeping a pre-render fallback set
  until the next render reads the proxy) so unread updates cause no re-render;
  called with a selector, they compare the selected value shallowly (`Object.is`,
  array elements, or own properties of plain objects) (decisions 0033 and 0035).
  `useSearch()` and `useHistory()` keep their action methods referentially
  stable per feature instance, and `useSave()` and `usePrint()` expose reactive
  saving and print-progress state with clean abort/unmount cancellation. They
  reconcile that state when React reconnects their effects after Activity hides. The
  document's data is read with `use()` under the application's Suspense
  boundaries (`useSessionData`, subscribing only to `["status", "passwordReason"]`
  on `session.stateStore` so streaming download `progress` updates never wake
  secondary data hooks).
- On the server the viewer renders an empty viewport, a URL source's
  preload goes into the head, and the data hooks throw through
  `use(browser())` so the nearest Suspense boundary renders its fallback
  (React 19.3). The browser preloads a source only outside WebKit, which
  would download it twice (decision 0014), and never one sent with headers.

## Testing

- Node unit tests (`packages/parapdf/test/`) for every pure module and the
  features' logic, with `fake-pdfjs.ts` and `fake-dom.ts`; the planner's
  invariants: a visible page never blank, budgets kept, no base drawn again
  under a whole-page detail.
- The Playwright functional checks (`check:*`) are the behavioral contract:
  changing an API on purpose changes them in the same change.
- A change that may affect speed or memory is benchmarked against the build
  before it, in the same run; a regression needs a decision accepting it.

## Open questions

- What 1.0 requires and what 1.x promises: decision 0015, proposed.
