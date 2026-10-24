# pdf.js issue 22258: TextLayer measures text without /Lang in an unknown language

Status: filed on 2026-10-20 as
https://github.com/mozilla/pdf.js/issues/22258, with a shortened version of
the text under "Issue text" below: the template fields, the result table,
the cause, and the possible fix in one paragraph, without the diff, the
snippet, or the history. Not done before filing: reproducing by hand in
release browsers and attaching screenshots. Drafted on 2026-10-20 by a side session of the
ParaPDF work, from the finding recorded in `docs/history/AGENTS-v0.md` (Runtime prototype,
the `TextLayer` and `lang` item) and worked around in ParaPDF by
`inLayerLanguage()` in `packages/parapdf/src/engine/pdfjs.ts`.

Pull request: https://github.com/mozilla/pdf.js/pull/22261, opened on 2026-10-20.

Reproduction: `bench/scripts/textlayer-lang-repro.html` (the page: pdf.js's
display API only, `getDocument`, `PDFPageProxy.render`, and `TextLayer`,
styled by pdf.js's own `.textLayer` rules) and
`bench/scripts/textlayer-lang-repro.ts` (the Playwright driver that serves it
and runs the configurations below, and also measures pdf.js's own viewer,
`web/viewer.html`). Raw results and screenshots:
`bench/results/raw/textlayer-lang-*.{json,png}` (not committed).

## What the finding said, and what changed

- Confirmed: for a PDF without /Lang, `TextLayer` measures every run on a
  hidden canvas with `lang=""`, while the runs inherit the page's language.
  When the generic families (`sans-serif`, `serif`, `monospace`) resolve to
  other fonts for those two languages, every run of two or more characters
  is scaled by the wrong ratio.
- The numbers hold on pdf.js's own test document too (the finding used
  `bill-hr815.pdf`): with the page in Japanese, runs end 12–15% past their
  glyphs in Chromium and WebKit; with the page in English on this Japanese
  macOS, they end 11–13% short in Firefox (medians). The ranges in
  `docs/history/AGENTS-v0.md`, 12–15% short and 14–18% past, fall within the spread of the
  runs here (10th to 90th percentile).
- The cause is narrower than "pdf.js measures in an unknown language": the
  canvas is a DOM canvas appended to `<body>` precisely so that it inherits
  the page's language (#17476, bug 1869001), and #17770 then set its `lang`
  to the text content's, which is `""` when the PDF has no /Lang. An empty
  `lang` attribute does not inherit: it declares the language unknown. So
  #17770 undid #17476 for every PDF without /Lang. Released in 4.3.136
  (2024-05-28).
- The hosted viewer is not affected: `web/viewer.html` sets `dir` on `<html>`
  but no `lang`, so runs and canvas are both in an unknown language. It is
  affected as soon as its root element has a `lang`, as Firefox's built-in
  viewer gets one from Fluent (the comment in `#getCtx` says so) and as pages
  that embed the viewer components or `TextLayer` usually have.

## Before filing

- Reproduce by hand in release Chrome, Safari, and Firefox. Only Playwright's
  headless builds were measured, on one macOS machine whose system language
  is Japanese. `SERVE=1 node bench/scripts/textlayer-lang-repro.ts` serves the
  page and prints its URLs; with `show=1` it shades every run.
- Check Firefox's built-in viewer: an English Firefox on a Japanese system
  (or the reverse) should show the Firefox numbers below with any PDF without
  /Lang, since its `<html>` carries the UI locale and `lang=""` resolves to
  the system's language. Not checked here.
- Other systems were not measured. On Windows and Linux, the generic families
  of Japanese, Chinese, and Korean also resolve to CJK fonts with wider Latin
  glyphs, so the effect is likely similar, but its size depends on the fonts.
- Attach a screenshot: `bench/results/raw/textlayer-lang-chromium-viewer-compressed.tracemonkey-pldi-09-ja.png`
  (the viewer with `lang="ja"` on its root element, runs shaded) next to the
  same with `-en.png`.
- The issue text does not mention ParaPDF.
- The last paragraph (offering a pull request) is optional.

## Issue text

**Title:** [Bug]: Text layer runs are scaled against the wrong font when the PDF has no /Lang and the page has a lang

### Attach (recommended) or Link to PDF file

`compressed.tracemonkey-pldi-09.pdf`, the viewer's default document (no /Lang). Any PDF without /Lang whose text uses the generic `sans-serif` or `serif` families shows it.

### Web browser and its version

Chromium 156.0.8078.4, WebKit 27.2, and Firefox 157.0 (Playwright 1.64.1 builds, headless)

### Operating system and its version

macOS 27.0.1, system language Japanese

### PDF.js version

6.4.299 (pdfjs-dist), and master at 33734f1

### Is the bug present in the latest PDF.js version?

Yes

### Is a browser extension

No

### Steps to reproduce the problem

1. Render page 1 and its text layer with the display API in a page whose language is Japanese, and compare each text span's width with its text item's width:

   ```html
   <!doctype html>
   <html lang="ja">
     <head>
       <link rel="stylesheet" href="./web/pdf_viewer.css" />
     </head>
     <body>
       <div id="page" style="position: relative; --total-scale-factor: 1.5; --scale-round-x: 1px; --scale-round-y: 1px">
         <div class="textLayer"></div>
       </div>
       <script type="module">
         import * as pdfjsLib from "./build/pdf.mjs";

         pdfjsLib.GlobalWorkerOptions.workerSrc = "./build/pdf.worker.mjs";
         const pdf = await pdfjsLib.getDocument({ url: "compressed.tracemonkey-pldi-09.pdf" }).promise;
         const page = await pdf.getPage(1);
         const viewport = page.getViewport({ scale: 1.5 });
         const textLayer = new pdfjsLib.TextLayer({
           textContentSource: page.streamTextContent(),
           container: document.querySelector(".textLayer"),
           viewport,
         });
         await textLayer.render();

         const { items } = await page.getTextContent();
         const ratios = items
           .map((item, i) => [item, textLayer.textDivs[i]])
           .filter(([item]) => item.str.length > 1)
           .map(([item, span]) => span.getBoundingClientRect().width / (item.width * viewport.scale))
           .sort((a, b) => a - b);
         console.log("median run width / item width:", ratios[ratios.length >> 1]);
       </script>
     </body>
   </html>
   ```

2. Change `lang="ja"` to `lang="en"` and compare.

The attached `textlayer-lang-repro.html` does the same with more options (the page's `lang`, the scale, shading every run with `show=1`) and also applies the workaround described below with `fill=1`.

The viewer shows the same once its `<html>` element has a `lang` before the document loads, as Firefox's built-in viewer has from its UI locale: selecting text there, the selection boxes reach past the end of each line or stop short of it.

### What is the expected behavior?

Each text run ends where its glyphs end, whatever the page's language: its width equals the width of its text item.

### What went wrong?

The runs are scaled against a font other than the one they are drawn in. Median run width against its item's width, page 1, at 1.5 CSS px per point:

| Browser | `<html lang="en">` | `<html lang="ja">` |
| --- | --- | --- |
| Chromium 156 | 0.0% | +12.3% (10th–90th percentile +7.7% to +14.4%) |
| WebKit 27.2 | 0.0% | +15.4% (+10.8% to +17.3%) |
| Firefox 157 on a Japanese system | −11.0% (−12.7% to −7.1%) | 0.0% |

pdf.js's viewer at master gives the same numbers with `lang="ja"` (Chromium, WebKit) or `lang="en"` (Firefox) on its root element, and 0.0% without a `lang`, as it is hosted. With `BILLS-118hr815enr.pdf` (US House bill, no /Lang, `serif` and `sans-serif`), the medians are +14.7% (Chromium), +14.8% (WebKit), and −12.7% (Firefox).

Screenshot: the viewer with `lang="ja"` in Chromium, each run shaded (attached).

### Link to a viewer

Not needed: the display API reproduces it, and the viewer shows it once its root element has a `lang`.

### Additional context

**Where it happens.** `TextLayer` measures each run on a hidden canvas from [`#getCtx(lang)`](https://github.com/mozilla/pdf.js/blob/33734f1fd/src/display/text_layer.js#L459-L486), with `lang` the text content's language ([`this.#lang ??= value.lang`](https://github.com/mozilla/pdf.js/blob/33734f1fd/src/display/text_layer.js#L200)), which is `null` for a PDF without /Lang. `#getCtx` turns that into `""` and sets [`canvas.lang = lang`](https://github.com/mozilla/pdf.js/blob/33734f1fd/src/display/text_layer.js#L476), so the canvas gets `lang=""`. An empty `lang` attribute does not inherit the page's language: it declares the language unknown. The runs themselves have no `lang` and inherit the page's. The generic families resolve by language, so the canvas and the runs can get different fonts:

- Chromium and WebKit resolve an unknown language to their default fonts (Latin ones here), so a page in Japanese draws the runs in Hiragino but measures them in Helvetica and Times. A 100 px `sans-serif` pangram measures 1978.8 px on the `lang=""` canvas and 2239.3 px (WebKit: 2303.8 px) on a canvas that inherits `ja`.
- Firefox resolves an unknown language to the system's, so on a Japanese system a page in English draws the runs in Helvetica but measures them in Hiragino: the same pangram measures 2239.3 px on the `lang=""` canvas and 1978.8 px inheriting `en`.

**History.** #17476 (bug 1869001) moved the measuring canvas from an `OffscreenCanvas` into the document so that it would inherit the page's language, which the comment in `#getCtx` explains. #17770 (for #16843, in 4.3.136) then gave the canvas the PDF's language, which is right when the PDF has one, but for a PDF without /Lang it sets `lang=""` and so undoes #17476.

**Possible fix.** Leave the attribute off when the text content has no language, so the canvas inherits the page's again:

```diff
--- a/src/display/text_layer.js
+++ b/src/display/text_layer.js
@@ -473,7 +473,9 @@ class TextLayer {
       canvas.style.cssText =
         "position:absolute;top:0;left:0;width:0;height:0;display:none;" +
         "letter-spacing:normal;word-spacing:normal";
-      canvas.lang = lang;
+      if (lang) {
+        canvas.lang = lang;
+      }
       document.body.append(canvas);
       ctx = canvas.getContext("2d", {
         alpha: false,
```

With this change applied to master's built `pdf.mjs`, every median above is 0.0% (within 0.1%) in all three browsers, on the display API page under `lang="en"` and `lang="ja"` and in the viewer with and without a `lang`. The canvas inherits from `<body>`, while the runs inherit from the text layer's ancestors, so a text layer inside an element with another `lang` than `<body>` would still mismatch. A more complete fix keys the canvas by the language the text layer's container inherits (the `lang` of `container.closest("[lang]")`) when the text content has none. An application can do that today by passing the text content through a `TransformStream` that fills an empty `lang` before `TextLayer` reads it:

```js
const inherited = container.closest("[lang]")?.lang ?? "";
const textContentSource = page.streamTextContent().pipeThrough(
  new TransformStream({
    transform(chunk, controller) {
      chunk.lang ||= inherited;
      controller.enqueue(chunk);
    },
  })
);
```

which brings every median above to 0.0% in all three browsers.

I'm happy to turn the fix into a pull request.

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
PDFJS_MASTER=/path/to/pdf.js/build SHOTS=1 BROWSER=chromium node bench/scripts/textlayer-lang-repro.ts
PDFJS_MASTER=/path/to/pdf.js/build SHOTS=1 BROWSER=webkit node bench/scripts/textlayer-lang-repro.ts
PDFJS_MASTER=/path/to/pdf.js/build SHOTS=1 BROWSER=firefox node bench/scripts/textlayer-lang-repro.ts
PDFJS_MASTER=/path/to/patched/build BUILDS=master FILL=0 BROWSER=chromium node bench/scripts/textlayer-lang-repro.ts
```

"Repro page" is `textlayer-lang-repro.html` at 1.5 CSS px per point; "pdf.js
viewer" is master's `web/viewer.html` at its default zoom, page 1, with the
root element's `lang` set before the document loads (null: none, as
hosted). The workaround column is `fill=1`. A run's width is its
`getBoundingClientRect()` width, which includes `TextLayer`'s `scaleX`; an
item's is its `width` times the scale.

The issue's snippet, run in the same three browsers from a folder holding
pdfjs-dist 6.4.299's `build/` and `web/` and the PDF, printed medians of
1.121 (`lang="ja"`) and 1.000 (`lang="en"`) in Chromium, 1.154 and 1.000 in
WebKit, and 0.999 and 0.891 in Firefox.

### Chromium 156

Chromium 156.0.8078.4 (headless), darwin 27.0.0 arm64; waited once (0 min in all) for other Playwright browsers and repeated 1 job that another browser overlapped.

Width of each text run of two or more characters against its text item's width: median, and 10th to 90th percentile.

| Where | pdf.js | Document | Page lang | PDF /Lang | Hidden canvas lang | Workaround | Runs | Median | 10th–90th percentile |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| repro page | 6.4.299 (d0991a0d5) | compressed.tracemonkey-pldi-09.pdf | "en" | null | "" | no | 118 | -0.0% | -0.0% to +0.0% |
| repro page | 6.4.299 (d0991a0d5) | compressed.tracemonkey-pldi-09.pdf | "en" | null | "en" | yes | 118 | -0.0% | -0.0% to +0.0% |
| repro page | 6.4.299 (d0991a0d5) | compressed.tracemonkey-pldi-09.pdf | "ja" | null | "" | no | 118 | +12.3% | +7.7% to +14.4% |
| repro page | 6.4.299 (d0991a0d5) | compressed.tracemonkey-pldi-09.pdf | "ja" | null | "ja" | yes | 118 | -0.0% | -0.0% to +0.0% |
| repro page | 6.4.299 (d0991a0d5) | bill-hr815.pdf | "en" | null | "" | no | 82 | +0.0% | -0.7% to +0.1% |
| repro page | 6.4.299 (d0991a0d5) | bill-hr815.pdf | "en" | null | "en" | yes | 82 | +0.0% | -0.7% to +0.1% |
| repro page | 6.4.299 (d0991a0d5) | bill-hr815.pdf | "ja" | null | "" | no | 82 | +14.7% | +7.6% to +18.8% |
| repro page | 6.4.299 (d0991a0d5) | bill-hr815.pdf | "ja" | null | "ja" | yes | 82 | +0.0% | +0.0% to +0.0% |
| repro page | 6.5.260 (33734f1fd) | compressed.tracemonkey-pldi-09.pdf | "en" | null | "" | no | 118 | -0.0% | -0.0% to +0.0% |
| repro page | 6.5.260 (33734f1fd) | compressed.tracemonkey-pldi-09.pdf | "en" | null | "en" | yes | 118 | -0.0% | -0.0% to +0.0% |
| repro page | 6.5.260 (33734f1fd) | compressed.tracemonkey-pldi-09.pdf | "ja" | null | "" | no | 118 | +12.3% | +7.7% to +14.4% |
| repro page | 6.5.260 (33734f1fd) | compressed.tracemonkey-pldi-09.pdf | "ja" | null | "ja" | yes | 118 | -0.0% | -0.0% to +0.0% |
| repro page | 6.5.260 (33734f1fd) | bill-hr815.pdf | "en" | null | "" | no | 82 | +0.0% | -0.7% to +0.1% |
| repro page | 6.5.260 (33734f1fd) | bill-hr815.pdf | "en" | null | "en" | yes | 82 | +0.0% | -0.7% to +0.1% |
| repro page | 6.5.260 (33734f1fd) | bill-hr815.pdf | "ja" | null | "" | no | 82 | +14.7% | +7.6% to +18.8% |
| repro page | 6.5.260 (33734f1fd) | bill-hr815.pdf | "ja" | null | "ja" | yes | 82 | +0.0% | +0.0% to +0.0% |
| pdf.js viewer | 6.5.260 (33734f1fd) | compressed.tracemonkey-pldi-09.pdf | null | null | "" | no | 118 | +0.0% | -0.1% to +0.0% |
| pdf.js viewer | 6.5.260 (33734f1fd) | compressed.tracemonkey-pldi-09.pdf | "en" | null | "" | no | 118 | +0.0% | -0.1% to +0.0% |
| pdf.js viewer | 6.5.260 (33734f1fd) | compressed.tracemonkey-pldi-09.pdf | "ja" | null | "" | no | 118 | +12.3% | +7.7% to +14.4% |

Canvas measureText of a 100px pangram in each generic family, on a canvas with lang="" and on one inheriting the page's language:

- page lang "en": sans-serif 1978.8 against 1978.8 px, serif 1827.3 against 1827.3 px, monospace 2580.4 against 2580.4 px
- page lang "ja": sans-serif 1978.8 against 2239.3 px, serif 1827.3 against 2149.7 px, monospace 2580.4 against 2150 px

### WebKit 27.2

WebKit 27.2 (headless), darwin 27.0.0 arm64; waited 2 times (1 min in all) for other Playwright browsers and repeated 2 jobs that another browser overlapped.

Width of each text run of two or more characters against its text item's width: median, and 10th to 90th percentile.

| Where | pdf.js | Document | Page lang | PDF /Lang | Hidden canvas lang | Workaround | Runs | Median | 10th–90th percentile |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| repro page | 6.4.299 (d0991a0d5) | compressed.tracemonkey-pldi-09.pdf | "en" | null | "" | no | 118 | +0.0% | +0.0% to +0.0% |
| repro page | 6.4.299 (d0991a0d5) | compressed.tracemonkey-pldi-09.pdf | "en" | null | "en" | yes | 118 | +0.0% | +0.0% to +0.0% |
| repro page | 6.4.299 (d0991a0d5) | compressed.tracemonkey-pldi-09.pdf | "ja" | null | "" | no | 118 | +15.4% | +10.8% to +17.3% |
| repro page | 6.4.299 (d0991a0d5) | compressed.tracemonkey-pldi-09.pdf | "ja" | null | "ja" | yes | 118 | +0.0% | +0.0% to +0.0% |
| repro page | 6.4.299 (d0991a0d5) | bill-hr815.pdf | "en" | null | "" | no | 82 | +0.0% | +0.0% to +0.1% |
| repro page | 6.4.299 (d0991a0d5) | bill-hr815.pdf | "en" | null | "en" | yes | 82 | +0.0% | +0.0% to +0.1% |
| repro page | 6.4.299 (d0991a0d5) | bill-hr815.pdf | "ja" | null | "" | no | 82 | +14.8% | +8.0% to +18.9% |
| repro page | 6.4.299 (d0991a0d5) | bill-hr815.pdf | "ja" | null | "ja" | yes | 82 | +0.0% | +0.0% to +0.0% |
| repro page | 6.5.260 (33734f1fd) | compressed.tracemonkey-pldi-09.pdf | "en" | null | "" | no | 118 | +0.0% | +0.0% to +0.0% |
| repro page | 6.5.260 (33734f1fd) | compressed.tracemonkey-pldi-09.pdf | "en" | null | "en" | yes | 118 | +0.0% | +0.0% to +0.0% |
| repro page | 6.5.260 (33734f1fd) | compressed.tracemonkey-pldi-09.pdf | "ja" | null | "" | no | 118 | +15.4% | +10.8% to +17.3% |
| repro page | 6.5.260 (33734f1fd) | compressed.tracemonkey-pldi-09.pdf | "ja" | null | "ja" | yes | 118 | +0.0% | +0.0% to +0.0% |
| repro page | 6.5.260 (33734f1fd) | bill-hr815.pdf | "en" | null | "" | no | 82 | +0.0% | +0.0% to +0.1% |
| repro page | 6.5.260 (33734f1fd) | bill-hr815.pdf | "en" | null | "en" | yes | 82 | +0.0% | +0.0% to +0.1% |
| repro page | 6.5.260 (33734f1fd) | bill-hr815.pdf | "ja" | null | "" | no | 82 | +14.8% | +8.0% to +18.9% |
| repro page | 6.5.260 (33734f1fd) | bill-hr815.pdf | "ja" | null | "ja" | yes | 82 | +0.0% | +0.0% to +0.0% |
| pdf.js viewer | 6.5.260 (33734f1fd) | compressed.tracemonkey-pldi-09.pdf | null | null | "" | no | 118 | +0.0% | +0.0% to +0.0% |
| pdf.js viewer | 6.5.260 (33734f1fd) | compressed.tracemonkey-pldi-09.pdf | "en" | null | "" | no | 118 | +0.0% | +0.0% to +0.0% |
| pdf.js viewer | 6.5.260 (33734f1fd) | compressed.tracemonkey-pldi-09.pdf | "ja" | null | "" | no | 118 | +15.4% | +10.8% to +17.3% |

Canvas measureText of a 100px pangram in each generic family, on a canvas with lang="" and on one inheriting the page's language:

- page lang "en": sans-serif 1978.8 against 1978.8 px, serif 1827.3 against 1827.3 px, monospace 2580.4 against 2588.8 px
- page lang "ja": sans-serif 1978.8 against 2303.8 px, serif 1827.3 against 2149.7 px, monospace 2580.4 against 2588.8 px

### Firefox 157

Firefox 157.0 (headless), darwin 27.0.0 arm64; waited once (0 min in all) for other Playwright browsers and repeated 1 job that another browser overlapped.

Width of each text run of two or more characters against its text item's width: median, and 10th to 90th percentile.

| Where | pdf.js | Document | Page lang | PDF /Lang | Hidden canvas lang | Workaround | Runs | Median | 10th–90th percentile |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| repro page | 6.4.299 (d0991a0d5) | compressed.tracemonkey-pldi-09.pdf | "en" | null | "" | no | 118 | -11.0% | -12.7% to -7.1% |
| repro page | 6.4.299 (d0991a0d5) | compressed.tracemonkey-pldi-09.pdf | "en" | null | "en" | yes | 118 | -0.0% | -0.1% to -0.0% |
| repro page | 6.4.299 (d0991a0d5) | compressed.tracemonkey-pldi-09.pdf | "ja" | null | "" | no | 118 | -0.0% | -0.1% to -0.0% |
| repro page | 6.4.299 (d0991a0d5) | compressed.tracemonkey-pldi-09.pdf | "ja" | null | "ja" | yes | 118 | -0.0% | -0.1% to -0.0% |
| repro page | 6.4.299 (d0991a0d5) | bill-hr815.pdf | "en" | null | "" | no | 82 | -12.7% | -15.8% to -7.0% |
| repro page | 6.4.299 (d0991a0d5) | bill-hr815.pdf | "en" | null | "en" | yes | 82 | -0.0% | -0.0% to +0.0% |
| repro page | 6.4.299 (d0991a0d5) | bill-hr815.pdf | "ja" | null | "" | no | 82 | -0.0% | -0.1% to +0.0% |
| repro page | 6.4.299 (d0991a0d5) | bill-hr815.pdf | "ja" | null | "ja" | yes | 82 | -0.0% | -0.1% to +0.0% |
| repro page | 6.5.260 (33734f1fd) | compressed.tracemonkey-pldi-09.pdf | "en" | null | "" | no | 118 | -11.0% | -12.7% to -7.1% |
| repro page | 6.5.260 (33734f1fd) | compressed.tracemonkey-pldi-09.pdf | "en" | null | "en" | yes | 118 | -0.0% | -0.1% to -0.0% |
| repro page | 6.5.260 (33734f1fd) | compressed.tracemonkey-pldi-09.pdf | "ja" | null | "" | no | 118 | -0.0% | -0.1% to -0.0% |
| repro page | 6.5.260 (33734f1fd) | compressed.tracemonkey-pldi-09.pdf | "ja" | null | "ja" | yes | 118 | -0.0% | -0.1% to -0.0% |
| repro page | 6.5.260 (33734f1fd) | bill-hr815.pdf | "en" | null | "" | no | 82 | -12.7% | -15.8% to -7.0% |
| repro page | 6.5.260 (33734f1fd) | bill-hr815.pdf | "en" | null | "en" | yes | 82 | -0.0% | -0.0% to +0.0% |
| repro page | 6.5.260 (33734f1fd) | bill-hr815.pdf | "ja" | null | "" | no | 82 | -0.0% | -0.1% to +0.0% |
| repro page | 6.5.260 (33734f1fd) | bill-hr815.pdf | "ja" | null | "ja" | yes | 82 | -0.0% | -0.1% to +0.0% |
| pdf.js viewer | 6.5.260 (33734f1fd) | compressed.tracemonkey-pldi-09.pdf | null | null | "" | no | 118 | +0.0% | -0.0% to +0.1% |
| pdf.js viewer | 6.5.260 (33734f1fd) | compressed.tracemonkey-pldi-09.pdf | "en" | null | "" | no | 118 | -11.0% | -12.6% to -7.1% |
| pdf.js viewer | 6.5.260 (33734f1fd) | compressed.tracemonkey-pldi-09.pdf | "ja" | null | "" | no | 118 | +0.0% | -0.0% to +0.1% |

Canvas measureText of a 100px pangram in each generic family, on a canvas with lang="" and on one inheriting the page's language:

- page lang "en": sans-serif 2239.3 against 1978.8 px, serif 2149.7 against 1827.3 px, monospace 2150 against 2588.6 px
- page lang "ja": sans-serif 2239.3 against 2239.3 px, serif 2149.7 against 2149.7 px, monospace 2150 against 2150 px

### The fix, applied to master's built `pdf.mjs`

`PDFJS_MASTER` set to a copy of the master build with `canvas.lang = lang` changed to `if (lang) { canvas.lang = lang; }`; `BUILDS=master FILL=0`. The hidden canvas has no `lang` attribute (null).

Chromium 156:

| Where | pdf.js | Document | Page lang | PDF /Lang | Hidden canvas lang | Workaround | Runs | Median | 10th–90th percentile |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| repro page | 6.5.260 (33734f1fd) | compressed.tracemonkey-pldi-09.pdf | "en" | null | null | no | 118 | -0.0% | -0.0% to +0.0% |
| repro page | 6.5.260 (33734f1fd) | compressed.tracemonkey-pldi-09.pdf | "ja" | null | null | no | 118 | -0.0% | -0.0% to +0.0% |
| repro page | 6.5.260 (33734f1fd) | bill-hr815.pdf | "en" | null | null | no | 82 | +0.0% | -0.7% to +0.1% |
| repro page | 6.5.260 (33734f1fd) | bill-hr815.pdf | "ja" | null | null | no | 82 | +0.0% | +0.0% to +0.0% |
| pdf.js viewer | 6.5.260 (33734f1fd) | compressed.tracemonkey-pldi-09.pdf | null | null | null | no | 118 | +0.0% | -0.1% to +0.0% |
| pdf.js viewer | 6.5.260 (33734f1fd) | compressed.tracemonkey-pldi-09.pdf | "en" | null | null | no | 118 | +0.0% | -0.1% to +0.0% |
| pdf.js viewer | 6.5.260 (33734f1fd) | compressed.tracemonkey-pldi-09.pdf | "ja" | null | null | no | 118 | +0.0% | -0.0% to +0.0% |

WebKit 27.2:

| Where | pdf.js | Document | Page lang | PDF /Lang | Hidden canvas lang | Workaround | Runs | Median | 10th–90th percentile |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| repro page | 6.5.260 (33734f1fd) | compressed.tracemonkey-pldi-09.pdf | "en" | null | null | no | 118 | +0.0% | +0.0% to +0.0% |
| repro page | 6.5.260 (33734f1fd) | compressed.tracemonkey-pldi-09.pdf | "ja" | null | null | no | 118 | +0.0% | +0.0% to +0.0% |
| repro page | 6.5.260 (33734f1fd) | bill-hr815.pdf | "en" | null | null | no | 82 | +0.0% | +0.0% to +0.1% |
| repro page | 6.5.260 (33734f1fd) | bill-hr815.pdf | "ja" | null | null | no | 82 | +0.0% | +0.0% to +0.0% |
| pdf.js viewer | 6.5.260 (33734f1fd) | compressed.tracemonkey-pldi-09.pdf | null | null | null | no | 118 | +0.0% | +0.0% to +0.0% |
| pdf.js viewer | 6.5.260 (33734f1fd) | compressed.tracemonkey-pldi-09.pdf | "en" | null | null | no | 118 | +0.0% | +0.0% to +0.0% |
| pdf.js viewer | 6.5.260 (33734f1fd) | compressed.tracemonkey-pldi-09.pdf | "ja" | null | null | no | 118 | +0.0% | +0.0% to +0.0% |

Firefox 157:

| Where | pdf.js | Document | Page lang | PDF /Lang | Hidden canvas lang | Workaround | Runs | Median | 10th–90th percentile |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| repro page | 6.5.260 (33734f1fd) | compressed.tracemonkey-pldi-09.pdf | "en" | null | null | no | 118 | -0.0% | -0.1% to -0.0% |
| repro page | 6.5.260 (33734f1fd) | compressed.tracemonkey-pldi-09.pdf | "ja" | null | null | no | 118 | -0.0% | -0.1% to -0.0% |
| repro page | 6.5.260 (33734f1fd) | bill-hr815.pdf | "en" | null | null | no | 82 | -0.0% | -0.0% to +0.0% |
| repro page | 6.5.260 (33734f1fd) | bill-hr815.pdf | "ja" | null | null | no | 82 | -0.0% | -0.1% to +0.0% |
| pdf.js viewer | 6.5.260 (33734f1fd) | compressed.tracemonkey-pldi-09.pdf | null | null | null | no | 118 | +0.0% | -0.0% to +0.1% |
| pdf.js viewer | 6.5.260 (33734f1fd) | compressed.tracemonkey-pldi-09.pdf | "en" | null | null | no | 118 | -0.0% | -0.0% to +0.1% |
| pdf.js viewer | 6.5.260 (33734f1fd) | compressed.tracemonkey-pldi-09.pdf | "ja" | null | null | no | 118 | +0.0% | -0.0% to +0.1% |
