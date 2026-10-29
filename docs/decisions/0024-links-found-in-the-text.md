# 0024. Links found in the text are a feature off by default

- Status: adopted
- Date: 2026-10-29

## Context

pdf.js's viewer turns URLs and e-mail addresses written in a page's text
into links (`Autolinker`, `web/autolinker.js`), even where the file has no
link annotation (#87). Decision 0019 follows that viewer where readers
expect it. Finding the addresses reads the page's whole text and builds
annotation elements on the main thread, so it must stay off the frame path
and out of applications that do not want it.

## Decision

- `<PdfViewer autoLinks>` (default off) loads `features/auto-links.ts`
  lazily and attaches it to the viewer; turning it off removes the links
  it added. The first layout does not wait for it, since pages are drawn
  alike with or without it.
- The feature ports pdf.js's regular expression and its checks (an
  e-mail's host, a numeric top-level domain, `www.` addresses) and its
  rule that drops a found link a file link covers by more than half. It
  matches the text the search feature normalizes, with pdf.js's
  `ignoreDashEOL`: a hyphen at a line's end stays, as in the viewer.
  `NOTICE.md` attributes the port.
- It runs once a page's text layer and annotation layer are both built,
  through the new `annotationLayer` extension hook, and adds the links
  with pdf.js's `AnnotationLayer.addLinkAnnotations()`, so they behave as
  the file's links (the link service, `externalLinks`). Found links are
  cached per document session and page.

## Evidence

The runtime with the feature was compared with `main` (9608022's
runtime) in the same run, job by job: `scroll-bench.ts`, `pdfjs-hwa`,
three runs, `synthetic-addresses.pdf` (300 pages of 30 lines, each with a
URL and an e-mail address, generated) and `bill-hr815.pdf`, at 900 and
3600 CSS px/s, with `QUERY=autoLinks=1` in the new build; AC power, Apple
M2 Pro, macOS 27.0.0. Results are in
`examples/prototype/results/autolinks-*`.

Main-thread blocked time over 4 s on `synthetic-addresses.pdf` at
900 CSS px/s, where text layers are built, main → feature on:

| Browser | Blocked time | First paint |
| --- | --- | --- |
| Chromium 156 | 0 → 0 ms | 125 → 149 ms |
| WebKit 27.2 | 2 → 4 ms | 175 → 178 ms |
| Firefox 157 | 34 → 41 ms | 216 → 206 ms |

- Blank area, dropped frames, React commits, and canvas memory are the
  same in every job of both builds. At 3600 CSS px/s text layers are not
  built, and the feature does no work.
- On `bill-hr815.pdf`, which has few addresses, blocked time moved by
  2 to 3 ms either way, within the variation the same build shows between
  runs (`autolinks-off-chromium`: the feature off against `main`, 0 to
  6 ms apart).
- `main-thread-bench.ts` in Chromium, slow scroll through
  `synthetic-addresses.pdf`, five runs alternating `autoLinks=0` and
  `autoLinks=1` in one build: task time 112 → 118 ms, script time
  48 → 47 ms; the feature's module does not appear among the functions
  with the most self time.
- FIREFOX_RERUN
- Bundle: the `PdfViewer` chunk grows from 121.78 to 122.69 kB (gzip
  37.25 → 37.47 kB) for the option and the hook; the feature is a lazy
  chunk of 3.6 kB (1.8 kB gzip). `check:modules` checks that
  `minimal.html` and the full demo's static chunks load none of it.
- The one-minute load average ran from 3.6 to 12.9 during the runs,
  raised by unrelated processes; Chromium waited once (1 min) for another
  Playwright browser and repeated one overlapped job.
- `check:features` checks the links found (URL, `www.`, e-mail), none
  where the file links already, a page turned by `/Rotate`, 60 links on a
  dense page, removal when the option turns off, and inert links under
  `externalLinks="disabled"`, in Chromium, WebKit, and Firefox.

## Consequences

The feature costs a few milliseconds of main-thread time per page with
many addresses, while the text layer is built, and nothing otherwise.
Applications that want pdf.js's viewer behavior turn it on.

## Reopen if

pdf.js moves link finding into its worker or text layer, readers expect
it on by default, or measurements show a repeatable cost on documents
with many addresses beyond the variation recorded here.
