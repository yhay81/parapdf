# 0035. Document-owned actions and a React-only public surface

- Status: adopted
- Date: 2026-11-13

## Decision

Document-level operations (`save`, `download`, `getText`, `getFormFields`,
`setFormValues`, `setLayerVisible`, `getAttachmentContent`, and
`openAttachment`) previously took a `Viewer` and read `viewer.session` and
`viewer.sourceName`, even though all eight operate on the open document session
shared across viewers and should work inside `<PdfDocument>` before or without a
`<PdfViewer>` viewport. Embedded-file links also routed through `<PdfViewer>`'s
`openAttachment` option (`viewer.openFile()`), while the package root continued
to export low-level imperative feature plumbing (`searchOf`, `attachSearch`,
`historyOf`, `attachHistory`, `attachThumbnail`, `enforcePermissions`,
`useAnnotationEditing`, `getSelection`, `getViewState`, and `setViewState`)
alongside React hooks and components.

`docs/architecture.md`, "Document" and "React", moves document actions to
`PdfSession`, adds React hooks for saving and printing, and trims vanilla-only
plumbing from the public entry point:

- `save(session, options?)`, `download(session, options?)`,
  `getText(session, options?)`, `getFormFields(session)`,
  `setFormValues(session, values)`, `setLayerVisible(session, id, visible)`,
  `getAttachmentContent(session, id)`, and `openAttachment(session, attachment)`
  take `session: PdfSession` instead of `viewer: Viewer`. Keeping them as
  standalone functions rather than methods on `PdfSession` preserves
  `"sideEffects": false` tree-shaking so `<PdfDocument>` never pulls unused
  document features into the core bundle.
- `<PdfDocument onOpenAttachment?={handler}>` owns embedded-file opening across
  both `openAttachment(session, attachment)` and embedded-file link annotations
  in every viewer under that document; `openAttachment` on `ViewerOptions` /
  `<PdfViewer>`, `viewer.openFile()`, and `viewer.sourceName` are removed.
- `DocumentSession.invalidateContent()` notifies every attached viewer through
  `onContentChange` when `setLayerVisible` or `setFormValues` mutates shared
  document appearance, keeping multi-viewer sessions in sync even when mutated
  outside a single viewer.
- `useSave(session?)` returns `{ save, download, saving }` and `usePrint(viewer?)`
  returns `{ print, printing, progress, cancel }`, tracking in-flight state for
  React toolbars while keeping `save`, `download`, and `print` callable outside
  components.
- `useSearch` and `useHistory` use `useStoreSlice` (getter tracking by default
  or an optional `shallowEqual` selector) with referentially stable action
  methods per feature instance.
- `getViewState(viewer)` and `setViewState(viewer, view)` become
  `viewer.viewState()` and `viewer.setViewState(view)`, and `searchOf`,
  `attachSearch`, `Search`, `historyOf`, `attachHistory`, `History`,
  `HistoryState`, `attachThumbnail`, `enforcePermissions`,
  `useAnnotationEditing`, `AnnotationEditing`, `AnnotationEditingOptions`,
  `AnnotationEditingStore`, `FormLayers`, and `getSelection` are removed from
  `packages/parapdf/src/index.ts`.

## Evidence

[`react-actions.test.ts`](../../packages/parapdf/test/react-actions.test.ts)
covers session-backed document actions without a mounted `<PdfViewer>`,
multi-viewer `invalidateContent()` propagation, `<PdfDocument onOpenAttachment>`,
`useSave()`, `usePrint()` progress and cancellation, tracked `useSearch()` and
`useHistory()` subscriptions, `viewer.viewState()` / `viewer.setViewState()`,
and SSR behavior. [`check-package.ts`](../../packages/parapdf/scripts/check-package.ts)
verifies both the exported surface and the absence of removed vanilla exports in
the packed tarball, and [`check-modules.ts`](../../examples/prototype/scripts/check-modules.ts)
verifies that `minimal.html` still emits zero chunks for `search`, `forms`,
`annotations`, `print`, and `autoLinks`. Every functional check, `check:package`,
`check:modules`, and the site's `check:demo` pass with `ENGINE=pdfjs` in
Playwright's Chromium 158.0.8127.18, WebKit 27.2, and Firefox 159.0, and
`check:bundlers` passes across webpack, Rsbuild, and Next.js (Turbopack and
webpack) in Chromium.

`scroll-bench.ts` measured the demo built from this branch against
`declarative-feature-components` (`7752912`) in turn, job by job: 1280×900 at
`devicePixelRatio` 2, fit-width, four seconds of scrolling at 900 and 3600 CSS
pixels per second through `synthetic-text-1000.pdf` and `bill-hr815.pdf`, median
of five runs
([`scroll-document-actions-chromium.md`](../../examples/prototype/results/scroll-document-actions-chromium.md),
[`-webkit.md`](../../examples/prototype/results/scroll-document-actions-webkit.md),
[`-firefox.md`](../../examples/prototype/results/scroll-document-actions-firefox.md)).
In every browser and job, both builds have 0.0% blank area, drop 0 frames
(of 241 in Chromium and Firefox, 289 in WebKit), commit React the same number of
times (4 at 900 px/s, 24 and 20 at 3600 px/s), publish the same store updates,
and hold the same canvas memory (156, 111, 183, and 127 MiB). Main thread
blocked while scrolling, in ms, after and before:

| Job | Chromium | WebKit | Firefox |
|---|---:|---:|---:|
| synthetic-text-1000.pdf, 900 px/s | 1, 3 | 2, 1 | 10, 13 |
| synthetic-text-1000.pdf, 3600 px/s | 5, 6 | 2, 2 | 23, 20 |
| bill-hr815.pdf, 900 px/s | 5, 6 | 10, 8 | 17, 25 |
| bill-hr815.pdf, 3600 px/s | 4, 1 | 4, 1 | 15, 24 |

No timing difference beyond run-to-run variation is claimed.

## Reopen if

- A bundler fails to tree-shake standalone `PdfSession` functions (`save`,
  `getText`, `getFormFields`, etc.) when only `<PdfDocument>` is imported.
- Embedded-file opening needs per-viewport behavior within a single
  `<PdfDocument>` that a document-level `onOpenAttachment` handler cannot
  express.
