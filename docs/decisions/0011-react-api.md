# 0011. The React API: viewers of their own, live options, the session's state

- Status: adopted
- Date: 2026-10-26

## Decision

`docs/architecture.md`, "React", has the names; in short:

- `useViewer()` creates a viewer for the life of the calling component;
  `<PdfViewer viewer={viewer}>` shows the nearest `PdfDocument`'s session
  with it. Several viewers share one provider. A viewer keeps its view and
  edits while its `PdfViewer` unmounts (decision 0009).
- `PdfViewer`'s props are the viewer's options and stay live. Those the
  renderer is built with rebuild it as a viewport that detaches and attaches
  again, keeping the position and edits; the others apply at once; the
  initial ones apply as the next document opens.
- View state (zoom, rotation, spread, scroll mode, tool) is controlled by a
  value and its change callback, or left to the viewer with a default. React
  commits only when the application sets state. The current page is
  reported, never controlled.
- The registry publishes each source's document state in a store of its own
  from the moment it starts to open. `PdfDocument` creates a `PdfSession`
  as it renders; a `PdfSession` has no method that opens, closes, or
  releases anything.
- Secondary data (outline, labels, metadata, attachments, layers) reads with
  `use()`; its promises settle empty when the read fails, so a panel shows
  nothing rather than throwing.
- Overlays render through a portal into a layer the page's host holds after
  the renderer's layers (decision 0010).

## Evidence

`scroll-bench.ts` against the build before, in turn, three runs per cell in
each browser
([`scroll-m6-chromium.md`](../../examples/prototype/results/scroll-m6-chromium.md),
[`-webkit`](../../examples/prototype/results/scroll-m6-webkit.md),
[`-firefox`](../../examples/prototype/results/scroll-m6-firefox.md);
per-run data in [`m6-runs.json`](../../examples/prototype/results/m6-runs.json)):
React committed exactly when the mounted window or the current page changed
(4, 24, 4, and 20 commits over four seconds), every job had zero blank area,
and blocked time stayed within the runs' spread. `check:options` and
`check:viewers` cover live options, controlled view state, and several
viewers under one provider.

## Reopen if

- An application needs a controlled current page, with measurements showing
  it commits no React state while scrolling.
- Live renderer options measure costly enough to need finer updates than
  rebuilding the renderer.
