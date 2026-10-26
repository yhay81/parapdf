# 0011. The React API: viewers of their own, live options, the session's state

- Status: adopted
- Date: 2026-10-26
- Implemented in M6

## Context

Until M6, `PdfDocument` created one viewer and read its options once; a
second viewport of the same document needed a second provider, and every
viewer's store carried the document's state (status, progress, password
request, page count, permissions) and its secondary data (outline, labels,
metadata, attachments, layers) beside the view. Applications reached the
viewer through context, opened documents through it (`Viewer.open()`), and
answered passwords through it. `target.md` gives the shape of the final
API and left its names to M6.

## Decision

The names and the semantics are in `target.md`, "React API" and
"document/"; in short:

- `useViewer()` creates a viewer for the life of the calling component;
  `<PdfViewer viewer={viewer}>` shows the nearest `PdfDocument`'s session
  with it. The viewer keeps its view and edits while its `PdfViewer`
  unmounts (decision 0009), closes the document when the session closes or
  its owner unmounts, and is the argument of every hook and function that
  acts through a viewer. Several viewers share one provider.
- `PdfViewer`'s props are the viewer's options and stay live. Those the
  renderer is built with take the path of a viewport that detaches and
  attaches again, keeping the position and the edits; the others apply at
  once; the initial ones apply as the next document opens.
- View state (zoom, rotation, spread, scroll mode, tool) is controlled by
  a value and its change callback, or left to the viewer with a default.
  Callbacks are called from the viewer's own store subscription, and a
  controlled value the application did not take up is shown again after
  the render that change caused, so React commits only when the
  application sets state. The current page is reported, never controlled.
- The registry's entry of each source publishes the document's state in a
  store of its own from the moment it starts to open. `PdfDocument`
  creates a `PdfSession` as it renders, so its children read the session
  at once, and holds the registry's session for it while mounted. A
  `PdfSession` has no method that opens, closes, or releases anything.
- Secondary data reads with `use()`: the session's promises are read once
  and settle empty when the read or the document fails, so a panel shows
  nothing rather than throwing to an error boundary.
- Overlays render through a portal into a layer the page's host holds
  after the renderer's layers (decision 0010); React renders nothing else
  into the host.
- Hooks lose the `Pdf` prefix: the package's exports name them already.

## Evidence

EVIDENCE

## Consequences

- Every 0.x and M5 name of the React layer changed: `PdfViewport`,
  `usePdfViewer()`, `usePdfState()`, `usePdfNavigation()`, the `options`
  prop, `Viewer.open()`, `Viewer.submitPassword()`, and the document fields
  of the viewer's state are gone (`CHANGELOG.md`).
- The demo's split view is one provider with two viewers; closing both
  keeps the session until the provider unmounts.
- The functional checks read the document's state from `window.__session`;
  benchmarks read it from the session, or from the viewer in builds before
  M6, so that they still measure those builds.

## Reopen if

- An application needs a controlled current page with measurements
  showing it commits no React state while scrolling.
- Live renderer options measure costly enough to need finer updates than
  rebuilding the renderer.
