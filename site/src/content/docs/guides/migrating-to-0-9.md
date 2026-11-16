---
title: Migrating to 0.9
description: Update a ParaPDF 0.8 application to the React-first 0.9 API.
---

Version 0.9 changes the public API. Update `parapdf` and follow the steps below;
React and React DOM 19.3 or later are required. The
[changelog](https://github.com/yhay81/parapdf/blob/main/CHANGELOG.md)
lists all removed exports and behavior changes.

## Share a viewer through context

`PdfDocument` supplies a default viewer to its controls and viewport.
`useViewer()` now reads that viewer; it does not create one.

```tsx
"use client";

import { PdfDocument, PdfViewer, useViewer, useViewState } from "parapdf";

function PageControls() {
  const viewer = useViewer();
  const { currentPage, pageCount } = useViewState();
  return (
    <button
      disabled={currentPage >= pageCount - 1}
      onClick={() => viewer.goToPage(currentPage + 1)}
    >
      Next page ({currentPage + 1} of {pageCount})
    </button>
  );
}

export function Reader() {
  return (
    <PdfDocument source="/document.pdf">
      <PageControls />
      <PdfViewer style={{ height: "80vh" }} />
    </PdfDocument>
  );
}
```

For independent panes, wrap each pane and its controls in `PdfView` under one
`PdfDocument`. Use `useCreateViewer()` when the handle must live above the
provider or be passed explicitly. `PdfViewer` and `PdfView` also accept a
React 19 `ref` to their viewer. `Viewer` and `PdfSession` are interfaces;
applications do not construct or manage their lifetimes directly.

## Mount the features you use

Replace `PdfViewer`'s feature flags with components:

```tsx
import {
  PdfAnnotationEditor,
  PdfAutoLinks,
  PdfForms,
  PdfPermissions,
  PdfViewer,
} from "parapdf";

<PdfViewer>
  <PdfForms scripts />
  <PdfAnnotationEditor />
  <PdfAutoLinks />
  <PdfPermissions />
</PdfViewer>;
```

| Previous prop | Component |
|---|---|
| `forms`, `formScripts` | `PdfForms`, with `scripts` when scripts are wanted |
| `annotationEditing`, `annotationLabels` | `PdfAnnotationEditor`, with `labels` |
| `autoLinks` | `PdfAutoLinks` |
| `enforcePermissions` | `PdfPermissions` |

The old permissions-state type `PdfPermissions` is now `DocumentPermissions`.
`useAnnotations()` always returns controls; check `state` and `styles` for
null until the editor is ready. Replace `useAnnotationEditing()` and imperative
feature attachment with these components and their hooks.

## Read state and call actions through hooks

| Previous call | Replacement |
|---|---|
| `useViewState(viewer, selector)` | `useViewState(selector, viewer)` |
| `useFormChange(viewer, listener)` | `useFormChange(listener, viewer)` |
| `viewer.store.get()` | `viewer.state` in event handlers; `useViewState()` in render |
| `session.state.get()` | `session.state` in event handlers; `useDocumentState()` in render |
| `session.outline()` and other document promise readers | `useOutline()`, `usePageLabels()`, `useMetadata()`, `useAttachments()`, `useComments()`, `useLayers()`, `useInitialView()` |
| `save(viewer, options)` | `useSave()`'s `save(options)` |
| `download(viewer, options)` | `useSave()`'s `download(options)` |
| `print(viewer, options)` | `usePrint()`'s `print(options)` |
| `permits(viewer, what)` | `usePermits(what, viewer)` |
| `getViewState(viewer)` / `setViewState(viewer, state)` | `viewer.viewState()` / `viewer.setViewState(state)` |

Viewer arguments are optional under `PdfDocument` or `PdfView`. Call hooks at
the top level of a component, then use their actions in event handlers:

```tsx
"use client";

import { usePermits, usePrint, useSave } from "parapdf";

function Actions() {
  const { download, saving } = useSave();
  const { print, printing } = usePrint();
  const canPrint = usePermits("print");
  return (
    <>
      <button disabled={saving} onClick={() => void download()}>
        Download
      </button>
      <button disabled={printing || !canPrint} onClick={() => void print()}>
        Print
      </button>
    </>
  );
}
```

`getText`, `getFormFields`, `setFormValues`, `setLayerVisible`,
`getAttachmentContent`, and `openAttachment` remain standalone functions, but
their first argument is the `PdfSession` returned by `useSession()`. Move
`PdfViewer.openAttachment` to `PdfDocument.onOpenAttachment`.

Use `PdfViewer.onViewStateChange` to save settled view changes. Internal stores,
renderer objects, extension hooks, and diagnostic metrics are no longer public;
see the [viewer reference](/reference/viewer/) for the supported handle.

## Update overlays and navigation

Replace `renderOverlay` with `PdfPageOverlays` for a render function over
mounted pages, or `PdfPageOverlay` for plain children on one page:

```tsx
import { PdfPageOverlay, PdfPageRect, PdfViewer } from "parapdf";

<PdfViewer>
  <PdfPageOverlay page={0}>
    <PdfPageRect x={40} y={60} width={180} height={24}>
      A note on the first page
    </PdfPageRect>
  </PdfPageOverlay>
</PdfViewer>;
```

Replace standalone `PdfThumbnail` with `PdfThumbnails`, using its `children`
render prop for custom item markup. The list virtualizes long documents, uses
PDF page labels, and follows the current page. `PdfOutline` provides a bookmark
tree. See [Thumbnails](/guides/thumbnails/) and [Navigation](/guides/navigation/).

## Check document lifetimes

`PdfDocument` starts loading during render, so Suspense above it and source
changes in transitions work. Data hooks return empty values while a password
prompt is open, then read again after it is answered.

React Activity hides preserve the view and edits. Hidden viewers temporarily
remove their annotations from the shared document, so another viewer's save or
print excludes those annotations until the original viewer is shown again.
If the URL returns a changed PDF or revision when reopened, the view and edits
start fresh.

`preloadDocument()` can warm a route's document before its provider mounts. For
ready documents, controls, overlays, and thumbnails settle before the first
paint. Scrolling and zoom previews still avoid per-frame React state updates.
