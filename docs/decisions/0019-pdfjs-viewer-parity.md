# 0019. What ParaPDF takes from pdf.js's viewer, and what it leaves

- Status: adopted
- Date: 2026-10-29

## Context

ParaPDF drives pdf.js through its core display API and uses none of the
viewer components of `pdfjs-dist/web/` (decision 0001), so what pdf.js's
own viewer does reaches ParaPDF only when ParaPDF builds it. The question
came up whether ParaPDF uses all that pdf.js offers and does more than
pdf.js's generic viewer, the one its online demo runs. ParaPDF at 361ede4
was compared with the pdfjs-dist it pins, 6.4.299 (its types and builds),
and with the generic viewer of pdf.js master at 157d30e (2026-10-17),
whose `web/app_options.js` says what each feature defaults to in the
viewer's release builds.

ParaPDF already does more than that viewer: several viewers of one
document, each with its own view; page order following `/Direction`, which
pdf.js's viewer never reads; signatures, comments on annotations, and
images' alternative text, which the generic viewer leaves off in its
releases; annotations exported and imported as data; form fields read and
set; permissions enforced; selections and overlays in PDF points; the whole
document's text; a view state that holds across screen sizes; pages that
come back without drawing again (decision 0004). pdf.js's viewer does
things ParaPDF does not, and 6.4.299 has APIs that neither uses yet.

## Decision

### Taken

`target.md` describes each. Every one is a feature or an addition to one
that exists; none changes what a frame of scrolling or zooming does.

- **Form scripts' document events**: `WillSave`, `DidSave`, `WillPrint`,
  `DidPrint`, and `WillClose`, which pdf.js's viewer sends
  (`PDFScriptingManager`). Documents use them to stamp a date on what
  prints or to reset fields; ParaPDF already runs the scripts in pdf.js's
  sandbox and has the hooks before saving and printing, and its README
  lists the events as not yet supported.
- **Links found in the text** (`autoLinks`, off by default): pdf.js's
  viewer finds URLs and e-mail addresses in the text by default
  (`enableAutoLinking`). Documents made from text often show addresses with
  no link annotation, and links are what ParaPDF is for. pdf.js gives the
  annotation layer `addLinkAnnotations()` for them, and the search feature
  already ports the normalization the finding runs on. The option keeps the
  module, and its work after each text layer, out of applications that do
  not want it.
- **Printing turns a page whose orientation differs from the first
  page's** to the sheet's, as pdf.js's viewer does by default
  (`enablePrintAutoRotate`). ParaPDF prints on sheets the size of the first
  page and scales the others to fit, so a landscape A4 page among portrait
  ones prints at 71%.
- **The "auto" zoom**, pdf.js's viewer's default: a portrait page's width,
  a landscape page whole, never above pdf.js's 125%, a scale of 5/3 in
  ParaPDF's CSS pixels per point. A fit mode fits again when the viewport
  resizes, which an application cannot do with a number, and the rule is a
  few pure lines in `zoom.ts`. The default stays "fit-width": the two
  differ only for landscape pages and in viewports wide enough to show a
  page above that cap.
- **The metadata pdf.js reads beside the information dictionary**: the
  server's file name (`Content-Disposition`), the file's length, whether it
  is linearized, and the fingerprint. pdf.js's document properties show the
  first three, its viewer names downloads after the server's file name and
  keeps each document's last view under its fingerprint, and ParaPDF
  already has them all from pdf.js (`getMetadata()` and the proxy's
  `fingerprints`) and drops them.
- **A URL's open parameters** (RFC 8118's `page`, `zoom`, and `nameddest`,
  as pdf.js's viewer reads them): browsers' viewers and pdf.js's open
  `manual.pdf#page=3` at page 3, and links into a document from elsewhere
  carry them. `search`, and the `pagemode` pdf.js's viewer reads beside
  them, address a find bar and sidebars, which are the application's.
- **Sources through `PDFDataRangeTransport`**: of the sources pdf.js's
  `getDocument()` takes, the one ParaPDF leaves out (`PdfjsDocumentOptions`
  omits `range`), and one an application cannot add, since the session
  creates the loading task. Documents an application fetches in ranges with
  code of its own, from a store of its own or with authentication that
  request headers cannot carry, need it.
- **Extracting pages** (`extractPages()`): saving or downloading the pages
  chosen, other documents' pages, and images as pages, with the form values
  and annotations saving keeps. It is a released API, and it extends saving
  without touching what viewers show.
- **The file's comments**, read across the pages in one call
  (`getAnnotationsByType()`), each with its page, rectangle, author, and
  date: reviewers' notes are part of reading a document. pdf.js's viewer
  lists comments only in its development builds.

### Left out

- **XFA forms**: decision 0015 proposes leaving them out. pdf.js supports
  them in part, drawing them as HTML instead of canvases, outside the
  renderer and what it measures.
- **A presentation mode**: it is the "page" scroll mode, "fit-page", and
  the Fullscreen API on the element the application chooses, with the
  controls it chooses. The README shows how instead.
- **The browser's history and the page's URL**: the application's router
  owns them. `getViewState()`, `initialViewState`, and the open parameters
  give it what to put there and what to open with.
- **Remembering each document's last view**: whether and where to keep it
  is the application's; the fingerprint now names the document to keep it
  under.
- **Selections drawn in the draw layer** (`enableSelectionRendering`): a
  look, not something a reader can do; the selection tracker and its
  browser fixes stay as ported.
- **What only Firefox's build turns on**: saving images by right-clicking
  them, caret browsing, alternative text guessed by a local model, and
  signature verification through NSS.
- **The viewer's interface and its translations**: a non-goal in
  `target.md`.

### Waiting

`target.md`'s open questions hold these:

- **WebGPU for mesh shadings** (`enableWebGPU`): on in pdf.js's current
  viewer but absent from 6.4.299's types, and a drawing path, so it is
  measured, with fidelity, before anything is decided.
- **Digital signatures** (`getSignatures()`, `getSignatureData()`): pdf.js
  verifies them only inside Firefox, and a signer's name shown unverified
  reads as a verified one.
- **Reordering, removing, and copying pages in a viewer**
  (`pagesMapper`), **and a comment tool of its own** (`COMMENT`): pdf.js's
  generic viewer leaves both off in its release builds.

## Evidence

pdf.js master 157d30e, `web/app_options.js`, defaults in the generic
viewer's release builds:

| Option | Default |
|---|---|
| `enableAutoLinking`, `enablePrintAutoRotate`, `enableXfa`, `enableWebGPU` | on |
| `enableScripting` | on, except in the Chrome extension |
| `enableSignatureEditor`, `enableHighlightFloatingButton`, `enableSplitMerge`, `enableMerge` | development and test builds only |
| `enableComment` | development builds only |
| `enableSignatureVerification` | Firefox, development, and test builds only |
| `imagesRightClickMinSize` | Firefox on the desktop only (-1 elsewhere) |
| `enableAltText`, `enablePermissions`, `supportsCaretBrowsingMode` | off |

pdfjs-dist 6.4.299: `PDFDocumentProxy` has `extractPages()`,
`getSignatures()`, `getSignatureData()`, and `getAnnotationsByType()`, whose
results carry their page index; `getDocument()` takes `pagesMapper` and
reads an `enableWebGPU` its types leave out; `AnnotationEditorType` has
`COMMENT`; `AnnotationLayer` has `addLinkAnnotations()`. In pdf.js's
viewer, `web/annotation_layer_builder.js` leaves out the links found that
intersect a link of the file, and nothing in `web/` calls
`getViewerPreferences()`.

ParaPDF at 361ede4: `PdfjsDocumentOptions` leaves out `range`, and a
`PdfSource` is a URL or bytes; the session's `metadata()` reads the
information dictionary and XMP alone; printing sizes every sheet after the
first page and turns none; `pdfjs/scripting.ts` sends `Open`, `PageOpen`,
and `PageClose`; `pdfjs/editor.ts` gives pdf.js's editor no comment
manager.

Nothing was measured: nothing taken changes how a viewer draws, scrolls,
or zooms. Links found in the text are measured when they are built (see
"Consequences"), and WebGPU, which would change drawing, waits for its
measurements.

## Consequences

- Each taken item is a change of its own, with its functional checks and
  its README section; the README's limitations lose the save and print
  scripts once they run.
- Links found in the text add elements to pages' annotation layers in idle
  time, so that change runs the scroll and main-thread benchmarks against
  the build before it, in the same run.
- Each adds an option, a value, a hook, or a field and removes none, so
  none would break the 1.x promise decision 0015 proposes, and none blocks
  1.0. Three change what an existing call does, which decision 0002 allows
  before 1.0: printing turns pages, `download()` takes the server's file
  name, and a new fragment of a URL source moves its viewers instead of
  opening the document again.
- With them, an application can do with ParaPDF what pdf.js's generic
  viewer does in its release builds, apart from XFA forms, WebGPU until it
  is measured, and how selections look; the rest of that viewer is its
  interface, which applications build from ParaPDF's API.

## Reopen if

- pdf.js's generic viewer turns page reordering, the comment tool, or
  signature verification on in its releases, or a verifier ParaPDF could
  ship appears.
- WebGPU's measurements are in.
- An application needs a presentation mode or the browser's history in a
  way it cannot build from ParaPDF's API.
