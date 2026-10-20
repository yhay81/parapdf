# pdf.js issue draft: an upward drag into the page above selects all of that page

Status: draft only, not filed. Drafted on 2026-10-20 by a side session of the
ParaPDF work, from the finding recorded in `AGENTS.md` (Runtime prototype,
the item on drag selections over space without text) and in commit a0ef709,
which fixed the same behaviour in ParaPDF (`TextSelectionTracker`,
`packages/parapdf/src/runtime/selection.ts`). The user decides whether to
file it after reading this draft.

Reproduction: `bench/scripts/selection-drag-repro.html` (the page: pdf.js's
viewer components, `pdf_viewer.mjs`, or with `mode=layers` the display API's
`TextLayer` alone) and `bench/scripts/selection-drag-repro.ts` (the
Playwright driver that serves it, drags with the mouse, and also drags in
pdf.js's own viewer, `web/viewer.html`, built locally or on the online demo).
Raw results and screenshots: `bench/results/raw/selection-drag-*.{json,png}`
(not committed).

The task asked for a page that uses only the display API. The display API
has no selection handling: the behaviour reported here belongs to the
viewer's `TextLayerBuilder` and its CSS, so the page uses the viewer
components, which pdfjs-dist publishes for embedding, and keeps a
display-API-only mode as the baseline.

## What the finding said, and what changed

- Confirmed on pdf.js's own test document and on the online demo
  (mozilla.github.io, built from master 33734f1): in WebKit and Firefox, a
  drag that starts in page 2's text and enters page 1 through the blank space
  below its last line selects all of page 1 (4,416 characters on
  `compressed.tracemonkey-pldi-09.pdf`, where the dragged lines hold 134).
  Chromium selects the dragged lines and part of page 1 near the pointer.
  ParaPDF's finding used `synthetic-text-1000.pdf` (3,631 characters against
  202 in Chromium), which is generated and not attachable.
- The display API's `TextLayer` without the viewer's selection handling does
  the same in all three browsers: WebKit and Firefox end a drag over space
  without text at the start of the element under the pointer, here page 1's
  text layer. So the viewer's `.endOfContent` handling, which exists to keep
  such drags from jumping within a page, does not cover a page the drag
  enters from below.
- A fix in the viewer works: during a drag, in WebKit and Firefox, giving the
  text layers above the selection `selecting` and a selectable
  `.endOfContent` makes their blank space select up to their end. As a sketch
  applied to master's built `pdf_viewer.mjs` and `viewer.mjs`, the drag then
  selects only the dragged lines in WebKit and Firefox, and Chromium is
  unchanged. This is the approach ParaPDF ships.
- Not a duplicate: the closest reports are #19526 (a custom text layer
  without the viewer's `.endOfContent` handling, closed without comment) and
  #10516 (Firefox 65 in 2019, several selection problems across pages,
  closed). #17923 fixed flickering within a page.

## Before filing

- Reproduce by hand in release Safari and Firefox on the online demo (and
  say Safari instead of WebKit in the title and the browser field once it is
  confirmed there), and
  record a screen capture: the bug template asks for one, and the headless
  screenshots do not show the selection highlight. The steps in the issue
  text need nothing but the demo.
- Check Chrome before 148 or other Chromium builds only if the report should
  say "Chromium is not affected" more broadly; only Chromium 156 was run.
- The sketch was tested with the one gesture below, on two documents. It was
  not run against pdf.js's integration tests or against downward drags,
  drags within a page, and keyboard selection; ParaPDF's `check:text` covers
  those for its own port, not for this sketch. Run pdf.js's tests before
  offering it as a pull request.
- The sketch detects Chromium by its user agent, as a stand-in: pdf.js
  already tells Firefox apart through `-moz-user-select`, and a real fix
  would pick a detection the maintainers accept, or apply the change in
  every browser if it leaves Chromium's selections the same.
- While testing, `reset()` in `TextLayerBuilder` was found to leave the
  inline `user-select: text` that the WebKit path sets on `.endOfContent`;
  the sketch clears it. Whether that matters by itself was not checked.
- The issue text does not mention ParaPDF.
- The last paragraph (offering a pull request) is optional.

## Issue text

**Title:** [Bug]: Dragging a selection up into the page above selects that whole page in WebKit and Firefox

### Attach (recommended) or Link to PDF file

`compressed.tracemonkey-pldi-09.pdf`, the online demo's default document. Any document with blank space below the last line of a page shows it.

### Web browser and its version

Firefox 157.0 and WebKit 27.2 (Playwright 1.64.1 builds, headless); Chromium 156.0.8078.4 is not affected

### Operating system and its version

macOS 27.0.1

### PDF.js version

The online demo (6.5.260, 33734f1), and 6.4.299 (pdfjs-dist) with the viewer components

### Is the bug present in the latest PDF.js version?

Yes

### Is a browser extension

No

### Steps to reproduce the problem

1. Open https://mozilla.github.io/pdf.js/web/viewer.html#zoom=100 in Safari or Firefox.
2. Scroll until the bottom of page 1 and the top of page 2 are both in view.
3. Press at the end of the third line of page 2's left column ("…iterations of the loop."), drag up across the gap between the pages into the blank space below page 1's right column (below "…loop iterations."), and release.

### What is the expected behavior?

The selection holds the lines dragged over: page 2's first three lines, and at most the end of page 1 near the pointer, as in Chromium.

### What went wrong?

The selection jumps to the start of page 1 and holds all of page 1 as well. Non-space characters selected by the drag above, with the pointer released 20 CSS px below page 1's last line (page 2's first three lines hold 134, all of page 1 holds 4,282):

| Viewer | Chromium 156 | WebKit 27.2 | Firefox 157 |
| --- | --- | --- | --- |
| Online demo (6.5.260) | 1,115 | 4,416 | 4,415 |
| Viewer components (`pdf_viewer.mjs`), 6.4.299 | 343 | 4,416 | 4,416 |

Chromium selects up to a point in page 1's second column near the pointer; WebKit and Firefox select from the start of page 1. With a single-column document (`usrguide.pdf`, the LaTeX Project's "LaTeX for authors", page 2's first three lines 92 characters, page 1 1,409), Chromium selects 93 characters and WebKit and Firefox 1,501.

Screen captures: (attach)

### Link to a viewer

Not needed: the online demo shows it.

### Additional context

**Why.** Over space without text, WebKit and Firefox end a drag selection at the start of the element under the pointer, while Chromium picks the nearest text. `TextLayerBuilder` handles this within a page: the pressed text layer gets `selecting`, which stretches its unselectable `.endOfContent` over the page, and in WebKit `.endOfContent` is moved next to the selection's moving end. A text layer the drag only enters later, from below, is not part of the selection yet when the pointer reaches its blank space, so the pointer hits the bare text layer, and the selection extends to its start. The display API's `TextLayer` without `TextLayerBuilder` behaves the same in all three browsers, so it is the viewer's handling that does not cover this case.

**Possible fix.** During a pointer drag, in browsers that end a selection at the start of blank space, give every text layer that ends before the selection's start the `selecting` class and a selectable `.endOfContent`: the blank space of the page above then selects up to that page's end, and once the pointer reaches text, the selection follows it as usual. A sketch against master's `web/text_layer_builder.js` (tested as the same edit to the built `pdf_viewer.mjs` and `viewer.mjs` at 33734f1):

```diff
--- a/web/text_layer_builder.js
+++ b/web/text_layer_builder.js
@@ -… @@ class TextLayerBuilder {
     const reset = (end, textLayer) => {
       if (typeof PDFJSDev === "undefined" || !PDFJSDev.test("MOZCENTRAL")) {
         textLayer.append(end);
         end.style.width = "";
         end.style.height = "";
+        end.style.userSelect = end.style.webkitUserSelect = "";
       }
       textLayer.classList.remove("selecting");
     };
@@ -… @@ class TextLayerBuilder {
     if (typeof PDFJSDev === "undefined" || !PDFJSDev.test("MOZCENTRAL")) {
       // eslint-disable-next-line no-var
       var isFirefoxOrModernChromium, prevRange;
     }
+    // Over blank space, WebKit and Firefox end a drag at the start of the
+    // element under the pointer; Chromium picks the nearest text.
+    const endsAtStartOfBlankSpace = !/Chrome\/\d+/.test(navigator.userAgent);
@@ -… @@ class TextLayerBuilder {
+        let selectionStart = null;
+        if (isPointerDown && endsAtStartOfBlankSpace) {
+          const first = selection.getRangeAt(0);
+          selectionStart = document.createRange();
+          selectionStart.setStart(first.startContainer, first.startOffset);
+        }
         for (const [textLayerDiv, endDiv] of this.#textLayers) {
           if (activeTextLayers.has(textLayerDiv)) {
             textLayerDiv.classList.add("selecting");
+          } else if (
+            selectionStart?.comparePoint(
+              textLayerDiv,
+              textLayerDiv.childNodes.length
+            ) < 0
+          ) {
+            // A text layer above the selection, which a drag may enter from
+            // below: its blank space selects up to its end, not its start.
+            textLayerDiv.classList.add("selecting");
+            endDiv.style.userSelect = endDiv.style.webkitUserSelect = "text";
           } else {
             reset(endDiv, textLayerDiv);
           }
         }
```

With it, the drag above selects page 2's first three lines and nothing of page 1 in WebKit (134 characters on the demo document, 92 on `usrguide.pdf`) and Firefox (133–134 and 92), and Chromium's selections stay the same (1,115 and 93 in the viewer). In Firefox's built-in viewer (`MOZCENTRAL`), `reset()` does not touch `.endOfContent`'s style, so the selectable `.endOfContent` would need a class and a CSS rule there instead of the inline style. The sketch sets `-webkit-user-select` too, because WebKit's mouse selection follows the prefixed property.

I'm happy to turn this into a pull request with an integration test.

## Results recorded for this draft

Runs of 2026-10-20, 16:54–17:07 JST, on macOS 27.0.1 (system language Japanese) on an Apple M2 Pro on AC power,
with Node 24.21.0 and Playwright 1.64.1's Chromium 156.0.8078.4 (headless
shell), WebKit 27.2, and Firefox 157.0, headless, with a 1280×1100 viewport
at device scale factor 2. pdf.js master is 33734f1 (2026-10-19, the latest
commit on 2026-10-20), built with `gulp generic` and `gulp components` in a
scratch checkout and passed as `PDFJS_MASTER`; bench/vendor's build (157d30e),
which other sessions measure with, was left alone. Each job opened the
document in a fresh browser context and took turns with other sessions'
Playwright scripts (`measureInTurn`; each header line says how often it
waited). These are functional measurements, not timings, so the load of the
machine does not move them.

Commands, from the repository root:

```sh
PDFJS_MASTER=/path/to/pdf.js/build SHOTS=1 BROWSER=chromium node bench/scripts/selection-drag-repro.ts
PDFJS_MASTER=/path/to/pdf.js/build SHOTS=1 BROWSER=webkit node bench/scripts/selection-drag-repro.ts
PDFJS_MASTER=/path/to/pdf.js/build SHOTS=1 BROWSER=firefox node bench/scripts/selection-drag-repro.ts
PDFJS_MASTER=/path/to/pdf.js/build TARGETS=online-viewer FILES=compressed.tracemonkey-pldi-09.pdf BROWSER=webkit node bench/scripts/selection-drag-repro.ts
PDFJS_MASTER=/path/to/sketch/build TARGETS=master-components,master-viewer BROWSER=webkit node bench/scripts/selection-drag-repro.ts
```

Every viewer shows the documents at 100% (`ZOOM=1`), with page 1's last line
and page 2's third line in view. Lines are runs on one baseline in the text
layer's order, so on the two-column demo document "page 2's third line" is
the third line of its left column and "page 1's last line" the last line of
its right column. "Over the gap" is the selection with the pointer between
the pages, "before release" with the pointer in page 1's margin.

### Chromium 156

Chromium 156.0.8078.4 (headless), darwin 27.0.0 arm64; waited 0 times (0 min in all) for other Playwright browsers and repeated 0 jobs that another browser overlapped.

Non-space characters selected by an upward drag from the end of page 2's third line, over the gap, into the blank space 20 CSS px below page 1's last line (lines in the text layer's order). Expected: page 2's first three lines, plus at most page 1's last line.

| Viewer | pdf.js | Document | Over the gap | Before release | After release | Expected | Page 1 holds | Page 1's first run selected |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| pdf_viewer.mjs components | 6.4.299 (d0991a0d5) | compressed.tracemonkey-pldi-09.pdf | 134 | 343 | 343 | 134–188 | 4282 | no |
| pdf_viewer.mjs components | 6.4.299 (d0991a0d5) | usrguide.pdf | 92 | 93 | 93 | 92–93 | 1409 | no |
| display API TextLayer only | 6.4.299 (d0991a0d5) | compressed.tracemonkey-pldi-09.pdf | 134 | 596 | 596 | 134–188 | 4295 | no |
| display API TextLayer only | 6.4.299 (d0991a0d5) | usrguide.pdf | 92 | 93 | 93 | 92–93 | 1409 | no |
| pdf_viewer.mjs components | 6.5.260 (33734f1fd) | compressed.tracemonkey-pldi-09.pdf | 134 | 343 | 343 | 134–188 | 4282 | no |
| pdf_viewer.mjs components | 6.5.260 (33734f1fd) | usrguide.pdf | 92 | 93 | 93 | 92–93 | 1409 | no |
| web/viewer.html | 6.5.260 (33734f1fd) | compressed.tracemonkey-pldi-09.pdf | 134 | 1115 | 1115 | 134–188 | 4282 | no |
| web/viewer.html | 6.5.260 (33734f1fd) | usrguide.pdf | 92 | 93 | 93 | 92–93 | 1409 | no |

### WebKit 27.2

WebKit 27.2 (headless), darwin 27.0.0 arm64; waited 2 times (1 min in all) for other Playwright browsers and repeated 2 jobs that another browser overlapped.

Non-space characters selected by an upward drag from the end of page 2's third line, over the gap, into the blank space 20 CSS px below page 1's last line (lines in the text layer's order). Expected: page 2's first three lines, plus at most page 1's last line.

| Viewer | pdf.js | Document | Over the gap | Before release | After release | Expected | Page 1 holds | Page 1's first run selected |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| pdf_viewer.mjs components | 6.4.299 (d0991a0d5) | compressed.tracemonkey-pldi-09.pdf | 134 | 4416 | 4416 | 134–188 | 4282 | yes |
| pdf_viewer.mjs components | 6.4.299 (d0991a0d5) | usrguide.pdf | 92 | 1501 | 1501 | 92–93 | 1409 | yes |
| display API TextLayer only | 6.4.299 (d0991a0d5) | compressed.tracemonkey-pldi-09.pdf | 134 | 4429 | 4429 | 134–188 | 4295 | yes |
| display API TextLayer only | 6.4.299 (d0991a0d5) | usrguide.pdf | 92 | 1501 | 1501 | 92–93 | 1409 | yes |
| pdf_viewer.mjs components | 6.5.260 (33734f1fd) | compressed.tracemonkey-pldi-09.pdf | 134 | 4416 | 4416 | 134–188 | 4282 | yes |
| pdf_viewer.mjs components | 6.5.260 (33734f1fd) | usrguide.pdf | 92 | 1501 | 1501 | 92–93 | 1409 | yes |
| web/viewer.html | 6.5.260 (33734f1fd) | compressed.tracemonkey-pldi-09.pdf | 134 | 4416 | 4416 | 134–188 | 4282 | yes |
| web/viewer.html | 6.5.260 (33734f1fd) | usrguide.pdf | 92 | 1501 | 1501 | 92–93 | 1409 | yes |

### Firefox 157

Firefox 157.0 (headless), darwin 27.0.0 arm64; waited 0 times (0 min in all) for other Playwright browsers and repeated 0 jobs that another browser overlapped.

Non-space characters selected by an upward drag from the end of page 2's third line, over the gap, into the blank space 20 CSS px below page 1's last line (lines in the text layer's order). Expected: page 2's first three lines, plus at most page 1's last line.

| Viewer | pdf.js | Document | Over the gap | Before release | After release | Expected | Page 1 holds | Page 1's first run selected |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| pdf_viewer.mjs components | 6.4.299 (d0991a0d5) | compressed.tracemonkey-pldi-09.pdf | 134 | 4416 | 4416 | 134–188 | 4282 | yes |
| pdf_viewer.mjs components | 6.4.299 (d0991a0d5) | usrguide.pdf | 92 | 1501 | 1501 | 92–93 | 1409 | yes |
| display API TextLayer only | 6.4.299 (d0991a0d5) | compressed.tracemonkey-pldi-09.pdf | 134 | 4429 | 4429 | 134–188 | 4295 | yes |
| display API TextLayer only | 6.4.299 (d0991a0d5) | usrguide.pdf | 92 | 1501 | 1501 | 92–93 | 1409 | yes |
| pdf_viewer.mjs components | 6.5.260 (33734f1fd) | compressed.tracemonkey-pldi-09.pdf | 134 | 4416 | 4416 | 134–188 | 4282 | yes |
| pdf_viewer.mjs components | 6.5.260 (33734f1fd) | usrguide.pdf | 92 | 1501 | 1501 | 92–93 | 1409 | yes |
| web/viewer.html | 6.5.260 (33734f1fd) | compressed.tracemonkey-pldi-09.pdf | 133 | 4415 | 4415 | 134–188 | 4282 | yes |
| web/viewer.html | 6.5.260 (33734f1fd) | usrguide.pdf | 92 | 1501 | 1501 | 92–93 | 1409 | yes |

### The online demo

`TARGETS=online-viewer FILES=compressed.tracemonkey-pldi-09.pdf`, https://mozilla.github.io/pdf.js/web/viewer.html#zoom=100, which reported pdf.js 6.5.260 (33734f1fd).

| Viewer | pdf.js | Document | Over the gap | Before release | After release | Expected | Page 1 holds | Page 1's first run selected |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Chromium 156: online demo (mozilla.github.io) | 6.5.260 (33734f1fd) | compressed.tracemonkey-pldi-09.pdf | 134 | 1115 | 1115 | 134–188 | 4282 | no |
| WebKit 27.2: online demo (mozilla.github.io) | 6.5.260 (33734f1fd) | compressed.tracemonkey-pldi-09.pdf | 134 | 4416 | 4416 | 134–188 | 4282 | yes |
| Firefox 157: online demo (mozilla.github.io) | 6.5.260 (33734f1fd) | compressed.tracemonkey-pldi-09.pdf | 133 | 4415 | 4415 | 134–188 | 4282 | yes |

### The fix sketch, applied to master's built `pdf_viewer.mjs` and `viewer.mjs`

`PDFJS_MASTER` set to a copy of the master build with the sketch applied; `TARGETS=master-components,master-viewer`.

WebKit 27.2:

| Viewer | pdf.js | Document | Over the gap | Before release | After release | Expected | Page 1 holds | Page 1's first run selected |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| pdf_viewer.mjs components | 6.5.260 (33734f1fd) | compressed.tracemonkey-pldi-09.pdf | 134 | 134 | 134 | 134–188 | 4282 | no |
| pdf_viewer.mjs components | 6.5.260 (33734f1fd) | usrguide.pdf | 92 | 92 | 92 | 92–93 | 1409 | no |
| web/viewer.html | 6.5.260 (33734f1fd) | compressed.tracemonkey-pldi-09.pdf | 134 | 134 | 134 | 134–188 | 4282 | no |
| web/viewer.html | 6.5.260 (33734f1fd) | usrguide.pdf | 92 | 92 | 92 | 92–93 | 1409 | no |

Firefox 157:

| Viewer | pdf.js | Document | Over the gap | Before release | After release | Expected | Page 1 holds | Page 1's first run selected |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| pdf_viewer.mjs components | 6.5.260 (33734f1fd) | compressed.tracemonkey-pldi-09.pdf | 134 | 134 | 134 | 134–188 | 4282 | no |
| pdf_viewer.mjs components | 6.5.260 (33734f1fd) | usrguide.pdf | 92 | 92 | 92 | 92–93 | 1409 | no |
| web/viewer.html | 6.5.260 (33734f1fd) | compressed.tracemonkey-pldi-09.pdf | 133 | 133 | 133 | 134–188 | 4282 | no |
| web/viewer.html | 6.5.260 (33734f1fd) | usrguide.pdf | 92 | 92 | 92 | 92–93 | 1409 | no |

Chromium 156:

| Viewer | pdf.js | Document | Over the gap | Before release | After release | Expected | Page 1 holds | Page 1's first run selected |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| pdf_viewer.mjs components | 6.5.260 (33734f1fd) | compressed.tracemonkey-pldi-09.pdf | 134 | 343 | 343 | 134–188 | 4282 | no |
| pdf_viewer.mjs components | 6.5.260 (33734f1fd) | usrguide.pdf | 92 | 93 | 93 | 92–93 | 1409 | no |
| web/viewer.html | 6.5.260 (33734f1fd) | compressed.tracemonkey-pldi-09.pdf | 134 | 1115 | 1115 | 134–188 | 4282 | no |
| web/viewer.html | 6.5.260 (33734f1fd) | usrguide.pdf | 92 | 93 | 93 | 92–93 | 1409 | no |
