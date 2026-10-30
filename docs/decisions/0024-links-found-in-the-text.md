# 0024. Links found in the text are a feature off by default

- Status: adopted
- Date: 2026-10-29

## Decision

`<PdfViewer autoLinks>` (default off) turns URLs and e-mail addresses
written in a page's text into links, as pdf.js's viewer does
(`web/autolinker.js`), where the file has no link annotation.

- It loads `features/auto-links.ts` lazily; turning it off removes the links
  it added. The first layout does not wait for it.
- It ports pdf.js's regular expression and checks, and its rule that drops a
  found link a file link covers by more than half, over the text the search
  feature normalizes (`NOTICE.md` attributes the port).
- It runs once a page's text and annotation layers are both built, through
  the `annotationLayer` extension hook, and adds the links with pdf.js's
  `AnnotationLayer.addLinkAnnotations()`, so they behave as the file's links.
  Found links are cached per session and page.

## Evidence

`scroll-bench.ts`, three runs, synthetic-addresses.pdf (every line with a
URL and an e-mail address) at 900 CSS px/s, median blocked time, off → on
([`autolinks-on-chromium.md`](../../examples/prototype/results/autolinks-on-chromium.md),
[`-webkit`](../../examples/prototype/results/autolinks-on-webkit.md),
[`-firefox`](../../examples/prototype/results/autolinks-on-firefox.md)):
Chromium 0 → 0 ms, WebKit 2 → 4, Firefox 34 → 41. Blank area, dropped
frames, React commits, and canvas memory were the same; at 3600 CSS px/s
text layers are not built and the feature does no work. The feature is a
lazy chunk of 3.6 kB (1.8 kB gzip), which `check:modules` keeps out of
`minimal.html`.

## Reopen if

pdf.js moves link finding into its worker or text layer, readers expect it
on by default, or measurements show a repeatable cost on documents with many
addresses.
