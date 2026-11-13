# 0033. Viewer context, React 19 refs, and tracked state hooks

- Status: adopted
- Date: 2026-11-13

## Decision

Decision 0011 required every application to create a `Viewer` with `useViewer()`
above `<PdfViewer viewer={viewer}>` and thread that handle through props or an
application-defined React context to toolbars, sidebars, search boxes, and
page indicators. Every selector passed to `useViewState` or `useDocumentState`
also compared by `Object.is`, so returning an object or tuple re-rendered on
every cold store notification unless split across separate hook calls, and a
page indicator (`currentPage / pageCount`) subscribed to both stores.

`docs/architecture.md`, "React", updates the React binding surface:

- `<PdfDocument source viewer?>` creates and holds a default `Viewer` and
  provides it through `ViewerContext` unless `viewer` is passed from above.
  `<PdfView viewer? ref?>` scopes a subtree to another `Viewer` (created by
  `<PdfView>` or passed in), so split views under one `<PdfDocument>` compose
  declaratively without custom contexts.
- `useViewer()` reads the nearest `ViewerContext` and throws outside
  `<PdfDocument>` or `<PdfView>`. `useCreateViewer()` creates and holds a
  standalone `Viewer` when a component above `<PdfDocument>` owns the handle
  or keeps one viewer across conditional providers.
- `<PdfViewer>` and `<PdfView>` accept React 19 `ref` props (`Ref<Viewer>`) as
  plain props without `forwardRef`.
- Every viewer-bound component and hook (`PdfViewer`, `PdfThumbnails`,
  `PdfThumbnail`, `useViewState`, `useSearch`, `useHistory`, `useAnnotations`,
  `useSelection`, `useFormChange`) defaults to the context viewer and accepts
  an optional `viewer` override; `useFormChange(listener, viewer?)` takes the
  listener first.
- Cold `ViewerState` includes `pageCount` (`0` while closed, set with
  `openPages` and reset on `closeDocument`), so controls that display the
  current page and page count read a single store.
- `useViewState` and `useDocumentState` accept either a selector compared by
  `shallowEqual` or no selector at all. With no selector, the hook returns a
  `Proxy`-backed snapshot that records the properties read during render and
  re-renders only when one of those properties changes (`Object.is`). Each
  snapshot owns its own tracked key set so fields left unread after a branch
  change (such as `progress` once `status` reaches `"ready"`) stop triggering
  commits, while a fallback key set from the previous snapshot guards store
  notifications that arrive before React renders the new proxy.

Scrolling and zooming remain outside React: hot scroll position and live zoom
frames still never publish to the cold store.

## Evidence

[`react-context-state.test.ts`](../../packages/parapdf/test/react-context-state.test.ts)
covers context resolution, `<PdfView>` scoping, `useCreateViewer()` lifetime,
React 19 function and object refs on `<PdfViewer>` and `<PdfView>`,
`shallowEqual` object/tuple selectors, and `Proxy`-tracked snapshots across
conditional branches, concurrent pre-render store updates, and React Compiler
memoization blocks. Every functional check, `check:package` (including SSR and
`bundler`/`nodenext` type declarations), `check:modules`, and the site's
`check:demo` pass with `ENGINE=pdfjs` in Playwright's Chromium 158.0.8127.18,
WebKit 27.2, and Firefox 159.0, and `check:bundlers` passes in Chromium.

`scroll-bench.ts` measured the demo built from this branch against `main`
(`b279827`) in turn, job by job: 1280×900 at `devicePixelRatio` 2, fit-width,
four seconds of scrolling at 900 and 3600 CSS pixels per second through
`synthetic-text-1000.pdf` and `bill-hr815.pdf`, median of five runs
([`scroll-viewer-context-chromium.md`](../../examples/prototype/results/scroll-viewer-context-chromium.md),
[`-webkit.md`](../../examples/prototype/results/scroll-viewer-context-webkit.md),
[`-firefox.md`](../../examples/prototype/results/scroll-viewer-context-firefox.md))
plus a seven-run Firefox rerun as system load settled from 8.7 to 4.9
([`scroll-viewer-context-firefox-rerun.md`](../../examples/prototype/results/scroll-viewer-context-firefox-rerun.md)).
In every browser and job, both builds have 0.0% blank area, commit React the
same number of times (4 at 900 px/s, 24 and 20 at 3600 px/s), publish the same
store updates, and hold the same canvas memory (156, 111, 183, and 127 MiB).
Main thread blocked while scrolling, in ms, after and before:

| Job | Chromium | WebKit | Firefox (5 runs) | Firefox (7 runs) |
|---|---:|---:|---:|---:|
| synthetic-text-1000.pdf, 900 px/s | 8, 9 | 3, 2 | 56, 18 | 54, 66 |
| synthetic-text-1000.pdf, 3600 px/s | 11, 23 | 19, 19 | 19, 19 | 23, 39 |
| bill-hr815.pdf, 900 px/s | 8, 8 | 50, 52 | 37, 22 | 58, 70 |
| bill-hr815.pdf, 3600 px/s | 4, 2 | 19, 24 | 16, 18 | 65, 70 |

Chromium and Firefox drop 0 frames in every job; WebKit drops 0 and 0, 2 and 0,
1 and 1, and 2 and 1 of 289. No timing difference beyond run-to-run variation
is claimed.

`commit-bench.ts` in Chromium 158.0.8127.18 against `main` (`b279827`), three
runs of eleven zoom scenarios on `bill-hr815.pdf` at 820×1000 and
`devicePixelRatio` 2 with load average falling from 4.9 to 3.6
([`commit-viewer-context-chromium.md`](../../examples/prototype/results/commit-viewer-context-chromium.md)):
neither build shows a frame with a blank page or a page down to its base in any
scenario, both complete the same base and detail renders with identical canvas
memory, and median times to sharp stay within 5 ms in both directions.

## Reopen if

- Proxy-tracked snapshots show measurable overhead or break under a future
  React concurrent store contract.
- Defaulting `<PdfDocument>` to own a `Viewer` retains measurable memory in
  document-only trees that never mount a viewport.
