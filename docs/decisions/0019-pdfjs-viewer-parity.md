# 0019. What ParaPDF takes from pdf.js's viewer, and what it leaves

- Status: adopted
- Date: 2026-10-29

## Decision

ParaPDF uses none of pdf.js's viewer components (decision 0001), so what
pdf.js's generic viewer does reaches ParaPDF only when ParaPDF builds it.
Compared with that viewer's release builds (pdf.js master 157d30e,
`web/app_options.js`) and the APIs of the pinned pdfjs-dist 6.4.299:

### Taken

Each is a feature or an addition to one; none changes what a frame of
scrolling or zooming does (#97 tracks them).

- Form scripts' document events: `WillSave`, `DidSave`, `WillPrint`,
  `DidPrint`, and `WillClose`.
- Links found in the text, off by default (`autoLinks`, decision 0024).
- Printing turns a page whose orientation differs from the first page's to
  the sheet's (`enablePrintAutoRotate`).
- The "auto" zoom: a portrait page's width, a landscape page whole, never
  above pdf.js's 125%. The default stays "fit-width".
- The metadata pdf.js reads beside the information dictionary: the server's
  file name (`Content-Disposition`), the file's length, whether it is
  linearized, and the fingerprint.
- A URL's open parameters (`page`, `zoom`, `nameddest`; decision 0023).
- Sources through `PDFDataRangeTransport`.
- Extracting pages (`extractPages()`), with the form values and annotations
  saving keeps.
- The file's comments, read across the pages in one call
  (`getAnnotationsByType()`).

### Left out

- XFA forms (decision 0015).
- A presentation mode: it is the "page" scroll mode, "fit-page", and the
  Fullscreen API on the element the application chooses (#95).
- The browser's history, the page's URL, and remembering each document's
  last view: the application's; `getViewState()`, `initialViewState`, the
  open parameters, and the fingerprint give it what it needs.
- Selections drawn in the draw layer (`enableSelectionRendering`): a look,
  not something a reader can do.
- What only Firefox's build turns on: saving images by right-clicking,
  caret browsing, alternative text guessed by a local model, signature
  verification through NSS.
- The viewer's interface and its translations.

### Waiting

- WebGPU for mesh shadings (`enableWebGPU`): a drawing path, measured with
  fidelity before anything is decided (#96).
- Digital signatures (`getSignatures()`, `getSignatureData()`): pdf.js
  verifies them only inside Firefox, and a signer's name shown unverified
  reads as a verified one.
- Reordering, removing, and copying pages in a viewer (`pagesMapper`), and
  a comment tool of its own (`COMMENT`): the generic viewer leaves both off
  in its release builds.

## Evidence

Release-build defaults in `web/app_options.js`: `enableAutoLinking`,
`enablePrintAutoRotate`, `enableXfa`, `enableWebGPU` on;
`enableSignatureEditor`, `enableSplitMerge`, `enableMerge` development and
test builds only; `enableComment` development builds only;
`enableSignatureVerification` Firefox, development, and test builds only.
Nothing was measured here: what is taken does not change drawing, and what
would (WebGPU) waits for its measurements.

## Reopen if

- pdf.js's generic viewer turns page reordering, the comment tool, or
  signature verification on in its releases, or a verifier ParaPDF could
  ship appears.
- WebGPU's measurements are in.
- An application needs a presentation mode or the browser's history in a
  way it cannot build from ParaPDF's API.
