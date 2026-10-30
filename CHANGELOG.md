# Changelog

Changes to the `parapdf` package. It follows
[Semantic Versioning](https://semver.org/); until 1.0, a minor release may
change the API.

## Unreleased

- URL sources with explicit credentials now distinguish omitted headers,
  which inherit the configured headers, from empty headers, which replace them.

- A source may be `{ range }`, pdf.js's `PDFDataRangeTransport`, through
  which the application hands pdf.js the ranges it asks for, for documents
  it fetches with code of its own (#92). Like bytes, a transport is
  identified by itself; ParaPDF hands pdf.js a transport of its own that
  forwards to the application's, which stays usable and opens again.

- `save()` and `download()` take `pages`, the pages to save instead of the
  whole document, as pdf.js's `extractPages()` takes them: ranges of its
  pages, pages of other documents' bytes, and images as pages, with the
  values typed and the annotations created (#93). An entry without
  `document` is of the open document. **Breaking:** `download(viewer,
  filename)` is now `download(viewer, { filename })`.

- With `formScripts`, saving and printing, from a script or the
  application, run the document's `WillSave` and `DidSave`, or `WillPrint`
  and `DidPrint`, scripts around them, as pdf.js's viewer does: what
  `WillSave` changes is in the saved bytes, and what `WillPrint` changes
  prints (#86). The scripts hear `WillClose` when the document closes or
  the scripts are turned off.

- `useComments()` and `PdfSession.comments()` list the file's comments:
  its markup annotations that carry one (a note's text, another markup's
  popup note), read once across the pages with pdf.js's
  `getAnnotationsByType()`, each with its page, rectangle, kind, text,
  author, date, and the comment it answers (#94).
- ParaPDF is licensed under Apache-2.0 instead of MIT, aligning it with
  pdf.js. Previously released versions remain available under their original
  terms; pdf.js and its bundled third-party files retain their notices and
  licenses.

- Document screen reader verification with NVDA and Firefox on
  Windows, and the interactions that still need checking (#32).

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
- `configurePdfjs({ workerSrc })` without `assetBase` keeps the annotation
  icons the package ships. Until now they were transparent.
- A document that fails to open lets go of pdf.js's loading task. Until now
  the task stayed open with what pdf.js held for it.
- A URL source that leaves out `withCredentials` no longer shares a
  document with one that sets it to `false`: the first follows
  `configurePdfjs({ documentOptions })`, which may send credentials.
- A `PdfSession` that showed a password request as an error, without
  `passwordPrompt`, reads the document once it opens, as when the prompt
  shows again or another provider unlocks it. Until now what it read after
  the error settled empty.
- The zoom stays within `minScale` and `maxScale`: a document opening at a
  `scale` outside them, and a custom zoom kept while the document is built
  again or its viewport is away, are clamped, and a fitted zoom stays
  fitted when the limits change. Until now those went past the limits, and
  changing the limits made a fitted zoom custom.
- A document built again, or a viewport attached again, while the viewport
  is hidden keeps its fitted zoom. Until now it fitted the hidden
  viewport's zero width.
- `goToPage()` truncates a fractional index and does nothing for NaN.
  Until now either made the current page a number no page has.
- `Viewer.sourceName` is null for a `data:` or `blob:` URL source, whose
  path names no file. Until now it was the end of the data, or the blob's
  id. `Viewer.blankFraction()` is 0 for a viewport with no width or
  height, where it was NaN.
- Pages no longer draw again a base that never shows under a detail of
  the whole page, as after zooming in or after what the pages draw changes
  (decision 0025). With `maxBasePixels` 0, a page no longer draws its empty
  base again forever.
- A page's text, annotation, or annotation editor layer that fails to
  build is tried again when the page mounts again, and the annotation
  layers when what the pages show changes. Until now it was built again in
  the next idle periods, ahead of the layers still to build.
- Search matches a final sigma, `ς`, with `σ` and `Σ` when it ignores
  case, and a match ends after the combining marks of its last letter, as
  pdf.js's search does. `previous()` with no match selected goes to the
  last match. Until now it went to the one before it.
- A selection whose end falls past an empty text item, which pdf.js leaves
  out of the text layer, ends at the next run of text. Until now it could
  end at the empty item.
- Text read with `lineBreaks: "keep"` keeps a newline that ends the page's
  last item. Until now it was dropped with the line end after the item.
- `getFormFields()` reads what the document's scripts set on fields whose
  widgets were not built yet: a check box or radio button set to its export
  value reads checked, and a text field set to a number reads that number.
  A radio group whose selected button pdf.js left unstored, storing only
  the others as unchecked, keeps its value. Until now those read `"Off"`
  or the document's value.
- `setFormValues()` stores a single choice set to no option as an empty
  one, as pdf.js's widgets read it. Until now it stored null.
- A zoom mode, such as "fit-width", fits again as `minScale` or
  `maxScale` changes. Until now a fitted zoom that the old limits held
  back stayed there until the viewport resized.
- `setScale()`, `zoomBy()`, and `setRotation()` do nothing for NaN, nor
  `setRotation()` for a rotation that is not finite, and `show()` keeps
  the viewer's page and rotation for a NaN one. `revealRect()` truncates a
  fractional page index and does nothing for NaN. Until now these made the
  zoom, rotation, or current page NaN, or a fractional page.
- A destination whose page is not in the document resolves to null, as
  pdf.js's viewer ignores it, and an `XYZ` zoom that is not a positive
  finite number keeps the zoom, as 0 does. Until now the first resolved to
  a page index past the document, which `PdfInitialView.destination`
  carried, and the second to that zoom.
- What a `PdfSession` read while its password request showed as an error
  (`passwordPrompt={false}`), and settled empty, is read anew once the
  request is answered or shows as a request again, and `useOutline()` and
  the other hooks of the document's data render again to show it. The
  document is still read once. Until now those reads stayed empty after
  the document opened.
- A document whose viewers all left before it opened no longer publishes
  `"error"` as its opening stops. Until now it did.
- `back()` and `forward()` of the history feature keep its positions
  while the viewer has no viewport. Until now they dropped the entry they
  went to.
- `download()` takes an empty `filename` as none given, and names the file
  as the server, the URL, or `document.pdf` does. Until now the browser
  named it.
- The document's scripts tell the viewer of a field's change only when the
  field's value reads differently: a choice's options item by item, and a
  number as its text. Until now setting the same options again, or a
  number for the text that showed it, told the viewer of a change.
- An extension that `viewer.extend()` adds while a hook runs hears what
  `extend()` replays, and not that hook a second time. Until now one added
  while `ready` ran heard it twice.
- `configurePdfjs()` with the configuration it loaded with, its keys in
  another order, changes nothing and warns of nothing. Until now it warned
  that another configuration was ignored.
- A source whose `httpHeaders` are empty, which send none, is preloaded.
  Until now it was not.
- `PdfViewer` builds nothing again when a renderer option, such as
  `textLayer` or `maxBasePixels`, moves between left out and its default.
  Until now it drew its pages and built their layers again.
- `autoLinks` links a page whose text layer was built again while its links
  were found, and a page whose first text item is empty. Until now those
  pages had no links.
- A viewer hidden for a while, as in a hidden tab or `<Activity>`, keeps
  its pages' details and shows them again at once (decision 0026). Until
  now it gave them back as its viewport emptied, drew bases while hidden,
  and drew the details again once shown.
- A visible page keeps a detail that a zoom no longer plans until its
  base is drawn, when the detail is all it shows (decision 0026). Until now
  the page was blank until then, with budgets that leave a visible page no
  detail, such as a small `maxCanvasPixels`.
- What the document's scripts set on a field whose widgets are not built
  yet is stored apart for each widget. Until now the widgets shared what
  was stored, and the first one built changed it for the others: a radio
  group a script set read as none once its page was built. pdf.js's radio
  buttons still read such a value inverted, and check another button than
  the one set.

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

A rewrite with a new API; nothing of 0.4 is kept for compatibility (decision
0002). pdf.js is used directly, several viewers share one document session, a
pure planner decides what each page draws, the renderer owns the page DOM, and
features are modules that only applications using them load. The
[documentation](https://parapdf.yhay81.com) describes the API as it is now.

Releases 0.1.0 to 0.4.0 are no longer supported; their notes are in this file
at the tag
[`v0.4.0`](https://github.com/yhay81/parapdf/blob/v0.4.0/CHANGELOG.md).
