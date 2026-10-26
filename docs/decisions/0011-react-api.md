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

The scroll benchmark ran M6 (this branch) against main as M5 left it
(ff5cba1), in turn, job by job, on 2026-10-26: Apple M2 Pro, macOS 27.0.0,
AC power, Playwright's headless Chromium 156.0.8078.4, WebKit 27.2, and
Firefox 157.0; `synthetic-text-1000.pdf` and `bill-hr815.pdf` at 900 and
3600 CSS px/s, fit-width, four seconds per job, three runs per cell
(`examples/prototype/results/scroll-m6-<browser>.{json,md}`; the per-run
values in [`m6-runs.json`](../../examples/prototype/results/m6-runs.json)).
One-minute load averages were 4.3 to 5.4; no job waited for or overlapped
another Playwright browser.

- React committed exactly when the mounted window or the current page
  changed, in both builds and all three browsers: 4, 24, 4, and 20 commits
  over four seconds in the four cases, every run alike. The store published
  as often (2 + 2, 15 + 9, 2 + 2, 13 + 7 window and current-page changes).
- Every job had zero blank area. Dropped frames stayed at 0 or 1 of 240 to
  289 in both builds.
- Blocked main-thread time, M6 [min–max] against main, ms: Chromium
  2.9–19.3 against 2.1–35.9 over the four cells, WebKit 5.5–61.9 against
  3.9–56.0, Firefox 39.6–85.0 against 46.9–119.4. The ranges overlap in
  every cell but two, where M6 was lower: Chromium's `bill-hr815.pdf` at
  900 px/s (5.3–9.8 against 11.6–17.2) and Firefox's
  `synthetic-text-1000.pdf` at 900 px/s (39.6–45.0 against 48.3–56.5). A
  run of an earlier M6 build the same day, under a load average of 9.4,
  had Chromium's `bill-hr815.pdf` cell the other way round (18 against
  11 ms medians), so no speed change is claimed either way.
- First paint medians moved by −30 to +25 ms, within the runs' spread.

`check:options` covers live options (the text layer and the gap change
without reopening the document or leaving the page) and controlled view
state (a controlled rotation and zoom shown, returned to after a change not
taken up, kept after one taken up, and the callbacks hearing the viewer's
changes); `check:viewers` covers two viewers under one provider; every
functional check passes in Chromium with `ENGINE=pdfjs`.

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
