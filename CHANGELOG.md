# Changelog

Changes to the `parapdf` package. It follows
[Semantic Versioning](https://semver.org/); until 1.0, a minor release may
change the API.

## Unreleased

- `useComments()` and `PdfSession.comments()` list the file's comments:
  its markup annotations that carry one (a note's text, another markup's
  popup note), read once across the pages with pdf.js's
  `getAnnotationsByType()`, each with its page, rectangle, kind, text,
  author, date, and the comment it answers (#94).

- Printing turns a page whose orientation differs from the first page's to
  the sheet's, as pdf.js's viewer prints it, so that a landscape page among
  portrait ones fits a matching sheet without extra scaling (#88). Pages
  larger than the first page's sheet are still scaled to fit.
  **Breaking:** this is the new default of `print()`; `autoRotate: false`
  prints every page upright, as before.

- `useMetadata()` and `PdfSession.metadata()` also give what pdf.js reads
  about the file: `filename`, the name the server gives it
  (`Content-Disposition`); `length`, in bytes; `linearized` (Fast Web
  View); and `fingerprint`, which identifies the document for a view an
  application keeps (#90). **Breaking:** `download()` names the file as
  the server does when it sends a name, and after the URL only otherwise.

- `autoLinks`, a live option of `PdfViewer`, off by default: the URLs and
  e-mail addresses in the pages' text become links, found as pdf.js's
  viewer finds them, except where a link of the file already covers them
  (#87). They need the text and annotation layers and follow
  `externalLinks`; the option's code loads only when it is set. Features
  hear a page's annotation layer through the `annotationLayer` hook of
  `viewer.extend()`, and `viewer.annotationLayers` holds the mounted
  pages' layers.

- `"auto"` zoom beside `"fit-width"` and `"fit-page"`, wherever a zoom mode
  is taken or reported (`zoom`, `defaultZoom`, `onZoomChange`,
  `setScale()`, the view state's `zoomMode`, and `ViewState.scale`): it
  fits as pdf.js's viewer opens documents, the width of a portrait page
  and all of a landscape one, never above a scale of 5/3 (pdf.js's 125%),
  and fits again as the viewport resizes or the view turns (#89). The
  default stays `"fit-width"`. A form script's `zoomType = "auto"` now
  asks for it instead of `"fit-width"`. The `FitMode` type names the
  three.

- A URL source's fragment opens the document where it points, with the
  open parameters of RFC 8118 that pdf.js's viewer reads: `#page=3`,
  `#zoom=150,72,700` or `#zoom=FitH,700`, and `#nameddest=intro`. It wins
  over `initialView="document"`, `defaultPage`, and `defaultZoom`, and
  `initialViewState` wins over it (#91). **Breaking:** the fragment is no
  longer part of the source: a `PdfDocument` whose URL changes only in its
  fragment keeps the open document and moves its viewers there, as
  following a link does, instead of opening the document again.
  `PdfSession.source` is the URL without its fragment.
  Rapid changes cancel older unresolved destinations, and a change made
  while a viewport is hidden or rebuilding applies when it is ready.
  `viewer.goToDestination(dest, signal?)` also accepts an `AbortSignal` to
  cancel an unresolved navigation.

- Renamed the per-page diagnostic on `Viewer.renderer` from `sharpness()`
  to `pageSharpness()`, distinguishing it from the viewport's
  `Viewer.sharpness()`.

- Screen readers read on from the page shown (#32). Pages are focusable
  (`tabindex="-1"`) but not in the tab order. While the focus is on the
  viewport or a page, it moves to the current page when that changes;
  following a link moves it to the page the link goes to; and when the page
  holding it unmounts, it moves to the current page instead of the body. A
  comment's icon is named by the comment instead of its image's file name,
  and a field's tooltip (`/TU`) names its control instead of its section.

- `PdfViewer`'s new `formScripts` prop, with `forms`, runs the document's
  scripts in its form fields as pdf.js's viewer does: calculated fields,
  validation, formatting and keystroke rules, the actions of buttons, and
  the scripts of the document and its pages. They run in pdf.js's sandbox,
  QuickJS compiled to WebAssembly, which the package now ships and loads
  only for a document with scripts: 66 KB of sandbox and 475 KB of QuickJS
  (20 KB and 220 KB with gzip). The viewers of one document share its
  sandbox, and what the scripts change reaches `useFormChange()`.
  `setFormValues()` does not run them (#7).

- With `annotationEditing`, the annotation editing state has `selected`: the
  annotation selected when one alone is, with its `id`, `pageIndex`, `type`,
  `comment`, and, for an image, `altText`. `setComment()` sets or removes its
  comment, and `setAltText()` an image's alternative text and whether it is
  decorative, each as one undo step, in the application's own controls. The
  saved PDF has the comment as the annotation's popup note; `export()` and
  `import()` keep both. `SelectedAnnotation` and `AnnotationAltText` are
  exported (#5, #6).
- Headless Chromium preloads a URL source again: its user agent, with
  `HeadlessChrome/`, was taken for WebKit's (decision 0014), so pages
  rendered by Playwright, Puppeteer, or a prerenderer started the download
  only once pdf.js had loaded.

## 0.7.0 — 2026-10-27

- In WebKit and Firefox, a quick drag up from a page's text into the blank
  space of the page above selects the dragged lines, not all of that page,
  also when the browser reports the selection's change after the next
  pointer move, as Playwright's WebKit on Linux did.
- `maxKeptPixels` keeps twelve viewports' worth of device pixels by default
  instead of six. Scrolling back over ten or twenty pages now shows them
  sharp about a second sooner, without drawing them again, at up to twice
  the memory for kept canvases. In Firefox with GPU-backed canvases,
  scrolling forward fast blocks the main thread a little more (decision
  0004).
- Zooming in past a page's whole-page detail budget on phone-sized
  viewports gets sharp two to four times sooner: a whole-page detail no
  larger than a base becomes the page's base instead of a base drawn again
  (decision 0012).
- Pages run right to left for documents whose `/ViewerPreferences
  /Direction` is `R2L`, and with `PdfViewer`'s new `direction` prop set to
  `"rtl"`: the earlier page of a spread is on the right, rows run right to
  left, `"horizontal"` mode opens at its right end, and in `"page"` mode ←
  and a swipe to the right go forward. `direction="ltr"` keeps the old order
  for such documents. The view state has a `direction`, and `Direction` is
  exported (#9).
- With `annotationEditing`, the annotations a PDF already holds of the kinds
  the tools create (text, drawings, highlights, and images) become editable
  while a tool is chosen: they can be selected, moved, restyled, and
  deleted, and a double click on one with no tool chosen selects it. Saving
  and printing write the changes; `export()` includes the changed ones, and
  `import()` puts each back in place of the annotation it changed. Until now
  they stayed as the file draws them (#4).
- In WebKit, a drag selection that crosses from one page into the space
  above the next page's first line ends at the start of that page. Until now
  Playwright's WebKit on Linux selected all of the next page there.

## 0.6.0 — 2026-10-27

- ParaPDF needs React 19.3 or later (`react` and `react-dom` 19.3.0).
- On the server, `useOutline()`, `usePageLabels()`, `useMetadata()`,
  `useAttachments()`, `useLayers()`, `useFormFields()`, and
  `useInitialView()` opt out through React's `use(browser())`: the nearest
  Suspense boundary renders its fallback there, and what it holds in the
  browser, which reports no error. Until now they suspended on a read that
  never settles on the server, so a server render waited for good; a
  prerender ended with the process and wrote none of the pages after it.
- `Viewer.sourceName` is null once the viewer's document closes, as
  `session` is. Until now it kept the closed document's file name.
- `PdfDocument` no longer preloads a URL source whose own `httpHeaders` no
  preload can carry, and preloads one with `withCredentials` in the CORS mode
  pdf.js fetches it with. Until now the preload followed only
  `configurePdfjs({ documentOptions })`, so such a source downloaded twice or
  its preload failed.

## 0.5.0 — 2026-10-26

ParaPDF is rebuilt (`docs/rebuild/target.md`): pdf.js used directly, document
sessions that several viewers share, a pure planner that decides what each
page draws, a renderer that owns the page DOM, features as modules the viewer
does not import, and a new React API. Nothing of 0.x is kept for
compatibility (`docs/decisions/0002-no-compatibility.md`). The sections below,
one per milestone of the rebuild, list every break from 0.4.0.

### Rebuild M7: release (2026-10-26)

- The package's README, the documentation site, the root README,
  `CONTRIBUTING.md`, and `SECURITY.md` describe the rebuilt package.
- Only the latest release gets security fixes; 0.4.x and earlier no longer
  do.
- `initialViewOpening()` is no longer exported: `PdfViewer` makes the
  opening of `initialView` and `initialViewState`, which stays internal.

### Rebuild M6: React API (2026-10-26)

- `useViewer()` creates a viewer, one viewport's controller and state, for
  the life of the component that calls it; `<PdfViewer viewer={viewer}>`
  shows the nearest `PdfDocument`'s document with it, and replaces
  `PdfViewport`. Several viewers show one document under one `PdfDocument`.
  A viewer keeps its view and annotations while its `PdfViewer` unmounts,
  and closes the document once its owner unmounts. `usePdfViewer()` is gone:
  hooks and functions take the viewer they act through.
- `PdfDocument` takes `source`, `passwordPrompt`, and `children`; its
  `options` are gone. The viewer's options are `PdfViewer`'s props and stay
  live: changing `textLayer`, `forms`, `annotationEditing`, the budgets, or
  any other needs no remount, and keeps the position and the edits.
- View state is controlled or not: `zoom`, `rotation`, `spread`,
  `scrollMode`, and `tool` with their `on…Change` callbacks, or
  `defaultZoom` (for `initialScale`), `defaultRotation`, `defaultSpread`,
  `defaultScrollMode`, and `defaultTool` (for `initialTool`). The current
  page is reported by `onPageChange` and set by `goToPage()`; `defaultPage`
  replaces `initialPage`.
- The session publishes the document's state, apart from the viewers':
  `useDocumentState(selector)` reads status, error, password request,
  progress, page count, and permissions; `useSession()` gives the
  `PdfSession`, with `submitPassword()` (no longer the viewer's) and
  pdf.js's `proxy` (for `usePdfDocument()`). `useViewState(viewer,
  selector)` reads view state only, and replaces `usePdfState()`.
- Secondary data is read with React's `use()` under the application's
  Suspense boundaries: `useOutline()` (for `usePdfOutline()`),
  `usePageLabels()`, `useMetadata()`, `useAttachments()`, `useLayers()`,
  `useFormFields()`, and `useInitialView()`; the viewer state's fields for
  them are gone.
- The types `PdfSearch` and `PdfNavigation` are gone: `useSearch()`
  returns `SearchControls`, and `useHistory()` `HistoryControls`.
- Hooks lose their `Pdf` prefix and take the viewer: `useSearch(viewer)`,
  `useHistory(viewer)` (back and forward, for `usePdfNavigation()`, whose
  `goToPage()` and `goToDestination()` are the viewer's),
  `useAnnotations(viewer)`, `useAnnotationEditing(viewer)`,
  `useFormChange(viewer, listener)`, and `useSelection(viewer)`.
- `renderOverlay`'s content renders through a portal into a layer of the
  page's host, after the renderer's layers; `PdfPageRect` takes the page
  from the overlay and loses `pageIndex`.
- `PdfThumbnails` lists a viewer's pages as buttons with thumbnails;
  `PdfThumbnail` takes the viewer.
- Opening a viewer's document and releasing sessions are no longer public:
  `Viewer.open()` and `ViewerOptions` are gone.

### Rebuild M5: rendering (2026-10-26)

- What each page draws is decided by a planner, pure functions of the
  view, the budgets, and what pages show and draw (`src/render/planner.ts`),
  with the 0.x heuristics unchanged and unit tests of their invariants: a
  visible page never stays blank, the budgets hold except for visible
  bases, and no base is drawn under a whole-page detail.
- The renderer (`Renderer`, which replaces `RenderScheduler`) builds each
  page's canvases and the containers of its text, annotation, editor, and
  structure layers inside the page's host, before what React renders there.
  `Viewer.attachPage(index, host)` takes the host alone; `PdfViewport`'s
  pages render only the host and the overlay. The editor layer exists
  while an annotation editor is set.
- The canvases a page keeps when it unmounts move into its next host
  instead of being copied into new canvases: `drawKept()` and the loader's
  `contextOptions` are gone. Firefox comes back to pages sooner; the other
  measurements stay within their spread (decision 0010).
- A page's new canvases hold no pixels until drawn, where React's were
  300 × 150 and counted within `maxCanvasPixels`.
- `viewer.scheduler` is `viewer.renderer`; `SchedulerStats` is
  `RenderStats`, with the same counters (`kept` counts the layers shown
  again from kept canvases).

### Rebuild M4: features as modules (2026-10-26)

- The viewer keeps its core: layout, scrolling, zoom, navigation, and the
  viewport's lifetime. Its feature methods moved into `src/features/`, as
  functions that take the viewer, and features with state of their own:
  - Search: `attachSearch(viewer)`, or the viewer's own `searchOf(viewer)`,
    which `usePdfSearch()` shows, with `search()`, `next()`, `previous()`,
    `clear()`, and a `store`; the state's `search` is gone. Page indexes are
    read once per session for every viewer of it.
  - History: `attachHistory(viewer)` and `historyOf(viewer)`, which
    `usePdfNavigation()` shows; the state's `canGoBack` and `canGoForward`,
    and `back()` and `forward()`, moved there. Jumps are kept, and links'
    GoBack and GoForward actions followed, once the history is attached.
  - Annotation editing: the `annotationEditing` option of `PdfDocument`
    loads it; `usePdfAnnotations()` gives its tool, state, styles, and
    `setTool()`, `setStyle()`, `undo()`, `redo()`, `deleteSelected()`,
    `selectAll()`, `addImage()`, `addSignature()`, `export()`, and
    `import()`, which replace the viewer's `setAnnotationTool()` and the
    rest; `usePdfAnnotationEditing()` gives the feature itself.
  - Functions: `print()`, `save()`, `download()`, `getText()`,
    `getSelection()`, `getViewState()`, `setViewState()`,
    `getFormFields()`, `setFormValues()`, `setLayerVisible()`,
    `getAttachmentContent()`, `openAttachment()`, `enforcePermissions()`,
    and `permits()`.
- `PdfDocument` takes `PdfDocumentOptions`: `ViewerOptions` without
  `initialView`, `initialViewState`, `enforcePermissions`, `forms`,
  `annotationEditing`, and `annotationLabels`, which `PdfDocument` turns
  into features. Forms and annotation editing load only when set, before
  the first page is drawn; search, print, and the rest only when imported.
  `ViewerOptions.opening` replaces the first two for a `Viewer` made
  without `PdfDocument`. `usePdfFormChange()` replaces `onFormChange()`.
- Viewers that edit annotations share their document's session: each
  editor numbers its annotations in the document's sequence and removes
  only its own when it closes, and `save()` and `print()` from any viewer
  include every viewer's annotations, those of a hidden viewport too, and
  what is being typed in any of them. A viewer shows those it created.
- A viewport that reattaches returns to its position; the document's
  initial view and `initialViewState` apply only when the document opens.

### Rebuild M3: independent viewers (2026-10-25)

- `Viewer` replaces `PdfViewerRuntime`, and moves with layout, scrolling,
  and gestures to `src/view/`. A viewer owns exactly one viewport; separate
  viewers share a document session and keep their navigation, zoom,
  rotation, tool, mounted pages, and canvas budgets independent.
- View state publishes through separate `store.hot` and `store.cold`
  subscriptions. The combined `store` remains the feature/document facade
  during the migration; page layout subscribes only to hot state.
- Detaching a viewport aborts its drawing, searches, printing, and
  background publishing. Reattaching restores its view and annotations
  while a mounted document provider retains the session. Closing one
  provider leaves other viewers of the session working.

### Rebuild M2: pdf.js directly, and document sessions (2026-10-24)

- pdf.js is used directly (decision 0001): the engine boundary,
  `PdfEngine` and `PdfEngineDocument`, is gone, and so is the runtime's
  `engineName`. `DestinationRef` is now `Destination`, pdf.js's: a name or
  an explicit destination array. `goToDestination()` also takes the `null`
  of an outline entry without one, and resolves to false.
- A document is a session, shared by every viewer of its source as
  before, which reads the pages' sizes, their text, the permissions, the
  initial view, the outline, page labels, metadata, attachments, and the
  layers once for all of them; failed secondary-data and text reads are
  retried by the next caller. The state's `document` is the session; its `proxy` is
  pdf.js's document, which `usePdfDocument()` returns.
  Failed search-index reads are also forgotten, so retrying a search can
  recover without closing the session.
- Viewers of one document share which of its layers show: showing or
  hiding one in a viewer draws it so in all of them. A page stays parsed
  while any viewer of its document shows it.
- Closing a document stops everything its viewer started for it, drawing,
  searches, background work, the annotation editor, and printing, which
  then fails, through an abort signal instead of counters; the session
  stops its own work when it closes. Opening another document closes the
  open one.

### Rebuild M1: the measured work (2026-10-24)

- pdf.js is the only engine (decision 0001): `document` in the viewer's
  state holds pdf.js's `PDFDocumentProxy` as `proxy`, typed, instead of
  `native`.
- Pages that leave the mounted window keep their canvases, up to six
  viewports' worth of device pixels by default (`maxKeptPixels`; `0` keeps
  none), and a page the reader comes back to, by `back()`, by scrolling
  back, or by flipping back, shows its drawing at once instead of being
  drawn again (decision 0004). Within `maxCanvasPixels`, kept canvases
  count as canvases and go first. Pages whose form fields are shown as HTML
  keep nothing, and neither does a viewer without its viewport. `stats.kept`
  counts the layers drawn back, and the runtime's `keptPixels` the pixels
  kept.

### Since 0.4.0

- In `"page"` mode, a one-finger swipe turns the page on touch screens:
  to the left or up for the next page, to the right or down back. A zoomed
  page scrolls first and turns from its edge; short or slanted swipes,
  pinches, and annotation tools do not turn pages.
- `getViewState()` returns the view as a plain object (the page and point
  at the viewport's top-left corner, zoom, rotation, spread, and scroll
  mode), and `setViewState()` and the `initialViewState` option show it
  again, for reopening where the reader left off and for shared links.
- Links and the outline take the zoom their destination asks for, as in
  pdf.js: `XYZ` with a zoom factor, `Fit`, `FitH`, `FitV`, and `FitR`, whose
  rectangle fills the viewport. `destinationZoom: false` keeps the zoom, as
  before.
- `forward()` and `canGoForward` return to where `back()` left, and the
  `GoForward` action of a PDF's links calls it; `usePdfNavigation()` has
  both. `back()` and `forward()` also restore the zoom of the position they
  return to.
- `initialView: "document"` opens a document at its /OpenAction
  destination, with its zoom, and arranges its pages as its /PageLayout
  asks; options the application sets win. The state's `documentView`
  reports the destination, the layout, and the panel its /PageMode asks
  for.
- The state's `permissions` reports what an encrypted document permits.
  With `enforcePermissions: true`, the viewer follows it: without copying,
  text cannot be selected or copied; without printing, `print()` fails;
  without annotating, annotations cannot be created, and form fields need
  permission to fill forms.
- `getFormFields()` lists the document's form fields with their values,
  `setFormValues()` sets them by name, and `onFormChange()` and
  `usePdfFormChange()` hear each value the reader enters.
- Stop retrying a failed page render with the same parameters; another zoom,
  content change, or page remount can try again. A failed sharp render can
  still fall back to the page's base drawing, including after a layer
  change: the old detail stays until the new base is ready to replace it.
- Wait for image annotations and signatures to finish loading before
  `addImage()` and `addSignature()` report success, so they can be saved or
  exported immediately; an unreadable image returns `false`.
- Keep annotation tools in sync when an image fails to load, and cancel a
  pending image or signature insertion if the reader chooses another tool
  while it loads.
- Return `false` for empty or untraceable signatures without leaving an
  editor or undo step behind.
- Keep the reading position when the background page-size pass shrinks the
  layout, before the browser clamps the old scroll position.
- Preserve a pending password prompt when another viewer opens the same
  document or the viewer remounts before its document is released.
- Retry a shared document with a changed source password, including when
  its first password request has not arrived yet and with
  `passwordPrompt: false`.
- Stop an earlier print job when a new one replaces it, cancelling its
  active render and releasing its images and print styles.
- Preserve the specified coordinate of internal destinations on PDFs whose
  own rotation is 90 or 270 degrees, including `FitH`, `FitV`, and `XYZ`
  destinations with an unspecified coordinate.
- The README's links to the license and notices work on npm: they pointed at
  files the repository keeps only at the root.
- The documentation moves to https://parapdf.yhay81.com, guides with
  examples that run and a demo to open your own PDFs in; it is the
  package's homepage.
- Keep bundlers from inlining pdf.js's files as `data:` URLs, so
  applications need no `assetsInlineLimit` setting. Vite inlines files
  under 4 KB, which put 134 of the 168 CMaps and the 11 annotation icons
  into the bundle every viewer loads: in a Vite 8.3 build that configures
  nothing, the list of the files' URLs, split into a chunk of its own,
  weighed 146,001 bytes, 52,557 with gzip, and now weighs 17,793 and 3,143.
  Rsbuild 2 inlined the icons,
  and its main chunk drops from 116,969 to 111,403 bytes with gzip. webpack
  5 and Next.js 16 inlined nothing, and their URLs stay the same. The cost:
  a PDF that needs one of those 134 CMaps now waits for one more request,
  as it already did with webpack and Next.js.

## 0.4.0 — 2026-10-20

- Annotation editing, with `annotationEditing: true`, through pdf.js's
  editors: highlights of selected text and freehand, text, drawings, images
  (`addImage()`), and signatures typed, traced from an image, or drawn by the
  application (`addSignature()`). `setAnnotationTool()` chooses the tool and
  `setAnnotationStyle()` the colors, thicknesses, and font size;
  `undoAnnotation()`, `redoAnnotation()`, `deleteSelectedAnnotations()`, and
  `selectAllAnnotations()`; the state publishes `annotationTool`,
  `annotationState`, and `annotationStyles`. Pages build the layer of their
  annotations after the text layer, during idle periods, and pages that
  mount again show them without taking focus or adding undo steps. `save()`,
  `download()`, and `print()` include them; `exportAnnotations()` returns
  them as JSON-compatible data, and `importAnnotations()` adds them again,
  on pages that are not mounted too. `annotationLabels` names the editor's
  controls in the application's language. A viewer that edits annotations
  opens its own copy of the document.
- `getText()` reads the document's text from every page, mounted or not, as
  search reads it: whole, by pages, or between two points, such as a search
  match's or a selection's ends, with line breaks kept or joined as search
  joins them.
- `getSelection()` also returns where the selection starts and ends in the
  document's text (`start`, `end`), for `getText()`.

## 0.3.1 — 2026-10-20

- In `"page"` mode, a key pressed right after a flip flips from the row
  shown: it flipped from the current page, which follows the row a frame
  later, and so could show the same row again.
- In `"page"` mode, → and ↓ flip a row wider or taller than the viewport
  once it is scrolled to its edge where scrollbars take space, as in
  Chromium on Linux: the far edge was taken as the scroll size less the
  client size, which the stable scrollbar gutter puts 15 px past where the
  browser stops, so those keys never flipped.
- A thumbnail keeps one size whether it is copied from its page's drawing
  or drawn: a drawn one came out a pixel shorter, rounded down as pdf.js
  sizes a render where the copy rounded to the nearest pixel.

## 0.3.0 — 2026-10-20

pdf.js comes with ParaPDF: `<PdfDocument source="/manual.pdf">` is all an
application writes. ParaPDF also gains what other React PDF viewers offer and
it lacked: forms, printing, thumbnails, encrypted documents, scroll modes,
and the rest of a document viewer. This changes the API: code that passed an
engine, or switches over `status` or `zoomMode`, needs changes.

- ParaPDF depends on pdfjs-dist 6.4.299 exactly, no longer as a peer, and
  ships its worker and the files it loads on demand: CMaps, the Symbol and
  ZapfDingbats fonts, the JPEG 2000 and JBIG2 decoders, and the ICC profile
  and decoder for CMYK colors. Vite, webpack, Rsbuild, and Next.js copy them
  to the build output; esbuild, Bun, and Parcel need a copy and
  `configurePdfjs({ assetBase })`.
- `PdfDocument` no longer takes `engine`, and `createPdfjsEngine`, the
  engine types, `isRenderCancelled`, and `RenderCancelledError` are no longer
  exported. The first `PdfDocument` loads pdf.js; `configurePdfjs()` sets
  what `createPdfjsEngine` took (`enableHWA`, `documentOptions`, another
  build with `pdfjs` and `workerSrc`, `assetBase`, `rendererSrc`), and
  `preloadPdfjs()` loads pdf.js before it is needed.
- `PdfDocument` starts downloading its PDF while it renders, on the server
  too, with a preload that pdf.js's request takes over, and the shipped
  worker starts while pdf.js's module still loads. With 100 ms added to
  every request and 20 Mbit/s in Chromium, page 1 showed 115–129 ms sooner
  than with 0.2.0 set up as its README said, and within 3–16 ms of 0.2.0
  with pdf.js in the main bundle and a preload written by hand.
- `source` takes a URL as a string.
- pdf.js's legacy build comes with its own worker from the package:
  `configurePdfjs({ build: legacyBuild })`, with `legacyBuild` from the new
  `parapdf/legacy`, needs no `workerSrc`, `assetBase`, or copy of the files.
  Only builds that import `parapdf/legacy` emit its worker; they still emit
  the modern one too.
- `pdfjsVersion` is the version of pdf.js the package ships.
- `usePdfDocument()` returns pdf.js's `PDFDocumentProxy`, and
  `pdfjsDocumentOf()` is gone.
- Components that render `PdfDocument` need no browser-only wrapper such as
  `next/dynamic`: pdf.js loads only in the browser, and out of the bundle
  that renders the page.
- Form fields the reader can fill in, with `forms: true`, through pdf.js's
  annotation layer; `save()` returns the PDF with the values written in, and
  `download()` hands it to the browser.
- Comment popups show, styled as in pdf.js's viewer: they used to open as
  unstyled, transparent text. Comments without an appearance of their own
  show pdf.js's icons, which the package ships, or the ones under
  `configurePdfjs({ imageResourcesPath })` or `${assetBase}web/images/`:
  they used to request a file from the application's own origin.
- `print()` draws every page for printing, typed form values and the layers
  the viewer shows included, and opens the print dialog with only those
  pages.
- `PdfThumbnail`, drawn after the pages in view and from their drawing when
  the viewer has one; only thumbnails near view hold pixels.
- Encrypted documents: `status` is `"password"` until `submitPassword()`
  gets the right one, and `passwordReason` says whether the last one was
  wrong. They used to fail with `status` `"error"`: applications that show
  no password prompt pass `passwordPrompt: false` to keep that. Sources
  take a `password`, which `PdfDocument` tries again when it changes, and
  URL sources `httpHeaders` and `withCredentials`.
- Load progress (`progress`), page labels (`pageLabels`), metadata
  (`metadata`), and attachments (`attachments`, `getAttachmentContent()`,
  `openAttachment()`, and the `openAttachment` option, which also handles
  file attachment annotations).
- Layers: `layers` and `setLayerVisible()`, per viewer, which links that
  switch layers use too.
- Two-page spreads (`spread`, `setSpread()`), "fit-page" zoom, `resetScale()`,
  Ctrl or ⌘ with +, -, and 0 in the viewport, `initialPage`, and a hand tool
  (`tool`, `setTool()`, `initialTool`).
- Scroll modes, as in pdf.js (`scrollMode`, `setScrollMode()`): pages in a
  column (`"vertical"`, as before), in one row scrolled sideways
  (`"horizontal"`), in rows filling the viewport's width (`"wrapped"`), or
  one page or spread at a time (`"page"`). In `"page"` mode, `goToPage()`,
  links, search, and the keys that would scroll past the page's edge flip
  pages, and a zoomed page scrolls within itself. Spreads work in every mode.
- `nextPage()` and `previousPage()` go to the next or previous spread or
  row; links with the NextPage and PrevPage actions do the same.
- The current page stays current while all of it is in view, as in pdf.js,
  and `goToPage()`, links, `back()`, and search make the page they show
  current: at the start of a row of pages narrower than half the viewport,
  or of pages shorter than half of it, the page at the viewport's center was
  the second or third. Pages taller than the viewport, as at "fit-width",
  change pages at the center as before.
- Search options: `caseSensitive`, `entireWord`, and `matchDiacritics`.
- `getSelection()` and `usePdfSelection()`: the selected text and the
  rectangles it covers in PDF points, for highlights of your own.
- A tagged PDF's structure gives text layers their headings, lists, tables,
  and figures' alternative text for assistive technology, as in pdf.js's
  viewer.
- `pageColors` draws pages in two colors, for forced-colors mode.
- A canvas stays hidden while it is drawn again: with pdf.js's renderer
  worker (`rendererSrc`), a redraw used to show black until the worker's
  first frame arrived, over the low-resolution page or in its place.
- After a zoom, each page shows its old drawing, scaled, until the new one is
  complete, as pdf.js's own viewer does: `PdfViewport` gives each page a
  second sharp canvas to draw into. The sharp canvas used to be drawn again
  in place, and the page showed white while pdf.js drew it: for 80–175 ms
  after each zoom in Safari in the iPadOS simulator, and for a few frames
  after nine of ten kinds of zoom in Chromium, WebKit, and Firefox. Hidden
  while drawn, as the item above says, it left the page to its
  low-resolution canvas for as many frames, and for 100–130 ms in the
  simulator. Now neither shows. Zooms draw half as many low-resolution
  canvases, and the pages in view are sharp sooner: after 3–36 ms instead of
  11–173 in Chromium, 4–36 instead of 12–150 in WebKit, and 4–90 instead of
  29–102 in Firefox. But a zoom holds the old and the new sharp canvases
  while the new ones are drawn: up to 28 MiB more canvas memory at its peak.
  With `maxCanvasPixels`, a page whose new sharp canvas does not fit beside
  the old one shows its low-resolution canvas meanwhile, as before.
- In Chromium, pages no longer show black after the view turns until they
  are drawn again: Chromium paints a canvas with pdf.js's opaque context
  black over its whole box once its size is zero, and the canvases a page
  gives back are now hidden too.
- A two-finger drag only scrolls, however fast it moves and however the
  fingers sit. The distance between the touches was measured at each
  finger's move, against where the other finger had been a frame before,
  so a drag zoomed once one frame's movement changed it by 16 CSS pixels:
  with one finger above the other, at about one pixel per millisecond.
- `ViewerState.status` has the new value `"password"`, and `ZoomMode`
  `"fit-page"`. `Layout` describes rows: `rowTops`, `rowWidths`,
  `rowHeights`, `rowFirst`, `rowLast`, `offsets`, `spread`, `scrollMode`,
  and, in `"page"` mode, the row `shown`. In `"horizontal"` and `"page"`
  mode, `tops` are before a row is centered in the viewport's height.

## 0.2.0 — 2026-10-20

Canvas budgets that an embedding app can hold to: the sharp margin follows
the viewport, and the budget counts visible pages. Two behaviors change:
`maxCanvasPixels` now limits visible pages too, and pdf.js draws on
GPU-backed canvases unless `enableHWA` is `false`.

- The pages a zoom gesture's preview brings into view, by a two-finger drag
  or by zooming out, mount and draw before the gesture commits: a long
  two-finger drag at a low zoom showed a blank band below the mounted pages
  until the fingers lifted.
- `maxDetailViewports` caps one page's detail canvas at a multiple of the
  viewport's device pixels: the margin drawn sharp around the visible area
  then follows the viewport's size, small on a phone and large on a wide
  panel. `maxDetailPixels` still caps it.
- `maxCanvasPixels` counts visible pages too: their low-resolution canvases
  always stay, and each one's sharp canvas gets a share of what they leave,
  by visible area, losing its margin first and then resolution. Visible pages
  used to keep all the detail `maxDetailPixels` allowed, whatever the budget,
  and only pages outside the viewport gave pixels back.
- `createPdfjsEngine` asks pdf.js for GPU-backed canvases unless
  `enableHWA` is `false`. It used to leave pdf.js's default, CPU-backed
  canvases.
- A detail canvas without a margin around the visible area, which a
  `maxDetailPixels` below the viewport's device pixels leaves, is drawn once:
  it was drawn again about 60 times a second while the view stood still.

## 0.1.0 — 2026-10-20

The first release, from Phase 0 of the project: the API is experimental.

- `PdfDocument`, `PdfViewport`, and `PdfPageRect`, with the hooks
  `usePdfViewer`, `usePdfState`, `usePdfSearch`, `usePdfNavigation`,
  `usePdfOutline`, and `usePdfDocument`, on a pdf.js engine from
  `createPdfjsEngine`.
- Continuous scrolling over a window of mounted pages: React renders only
  when that window or the current page changes, never per frame.
- Two canvases per page, a low-resolution base first and full device
  resolution once scrolling settles; at high zoom, full resolution only
  around the visible area. `maxDetailPixels`, `maxBasePixels`, and
  `maxCanvasPixels` bound canvas memory.
- Zoom to 10 CSS pixels per point with `setScale` and `zoomBy`, "fit-width"
  that follows resizes and turns, Ctrl or ⌘ with the wheel, trackpad and
  touch pinches, and Safari's gesture events. Rotation in quarter turns.
- pdf.js text layers for selection, drags across and beside pages included,
  and for screen readers, in the PDF's language. Whole-document search with
  the normalization of pdf.js's find controller, painted with the CSS Custom
  Highlight API.
- Internal links, named actions, and the outline, with a back stack;
  external links open in a new tab or, with `externalLinks: "disabled"`,
  stay inert.
- Overlays placed in PDF points with `PdfPageRect`.
- Viewers of the same URL or bytes share one loaded document, which survives
  React's StrictMode and quick remounts.
- `"use client"` directives; the components render on the server.
- `pdfjsDocumentOf()` for pdf.js's own `PDFDocumentProxy`.

Not yet supported: form filling, tagged-PDF structure, optional content
toggles, attachments, per-document passwords, and drawing off the main thread
with released pdfjs-dist. Gestures were checked by hand in Safari in the
iPadOS simulator; Safari on macOS and real iOS and iPadOS devices are not
verified yet.
