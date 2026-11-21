# Reading the same PDFs with ParaPDF and react-pdf

The readers used released ParaPDF 0.10.0, react-pdf 11.1.0, react-window 2.5.3, React 19.3.1 and pdfjs-dist 6.5.438. The prototype was built from v0.10.0. Playwright 1.65.1 ran headless Chromium 159.0.8154.6, WebKit 27.2 and Firefox 159.0 on an Apple M2 Pro running macOS 27.2. Each reader used its default virtual window, fit-width, selectable text and PDF annotations. [Release](https://github.com/yhay81/parapdf/tree/v0.10.0) · [Reader built with react-pdf](../src/compare.tsx)

## Reading and rendering

Three rounds per browser opened each reader in a fresh context at DPR 2, alternating their order. On page 1 of the two-page link fixture, a real mouse double-click selected “Read”. Pressing Enter on the file's own link activated the original target, `https://example.com/from-the-file`. The fixture also printed three addresses with no PDF link annotation. ParaPDF's optional `autoLinks` recognized the HTTPS address, the www address and the email address. The react-pdf reader exposed only the PDF's own link. [Fixture generator](../../../bench/scripts/gen-synthetic.ts) · [Browser comparison](../scripts/compare-readers.ts)

At a viewport width of 636 CSS pixels, the letter page fit at 612 × 792 CSS pixels. After the full-resolution drawing became visible, all 1,224 × 1,584 RGBA pixels were read back and hashed. Both readers produced the same digest in every pair.

| Browser | Identical rasters | SHA-256 |
| --- | ---: | --- |
| Chromium | 3/3 | `8889a27f04ca4e80f97bbbf3235edaaf6fbaa6347adc2d2a75a6b0f46fa07c03` |
| WebKit | 3/3 | `1d8d51fc7e91b93caa41377948f70a2e8c0b955380330422520c9602710fd049` |
| Firefox | 3/3 | `8889a27f04ca4e80f97bbbf3235edaaf6fbaa6347adc2d2a75a6b0f46fa07c03` |

## Pages and memory

Each 1,280 × 900 viewport jumped from page 1 to the same offset on page 10 of the 1,000-page text PDF. We waited for page 10's drawing and for the text of every mounted page. Counts include the page hosts and their descendants. The comparison reader's react-window row wrappers sit outside those hosts. All nine trials per reader returned the same counts.

| After the jump | ParaPDF | react-pdf + react-window |
| --- | ---: | ---: |
| Mounted page numbers | 8–12 | 7–13 |
| Page hosts and descendants | 570 | 770 |
| Canvas elements | 20 | 7 |

Counting canvases includes zero-sized elements. The separate fast-scroll benchmark counted four bytes per backing pixel, including ParaPDF's cached drawings, after four seconds at 3,600 px/s. Median storage on the same text PDF was 111.1 MiB and 249.3 MiB respectively in every browser. For each viewer, none of 15 trials sampled a frame with over 1% of the viewport lacking a drawing. [Individual scrolling trials, both speeds and PDFs](performance-0.10.0.md#scrolling)

## Install and download

Two fresh npm production installs included React and React DOM 19.3.1. The react-pdf install also included react-window 2.5.3. Installed size sums regular files under node_modules, including platform-specific optional dependencies, and excludes symlinks and npm's hidden lockfile. On macOS arm64 with npm 12.2.2, the installs occupied 83,809,678 and 80,346,930 bytes respectively.

Both installs then built a minimal Vite 8.3.8 production reader. Each opened the same one-page Japanese document, at a page width of 612 CSS pixels and DPR 2. The local server recorded the successful script and stylesheet requests, including worker requests, through the first visible drawing and selectable text. Each unique response body was compressed separately at Node's default gzip level. The reader, React and pdf.js are included. PDF data, fonts, character maps, HTML and HTTP headers fall outside this code-size metric. [Consumer applications and measurement](../scripts/reader-footprint.ts) · [Japanese PDF source](../../../bench/corpus/README.md)

| Bytes | ParaPDF | react-pdf + react-window |
| --- | ---: | ---: |
| App and pdf.js scripts, gzip | 253,904 | 267,373 |
| Separate stylesheet, gzip | 0 | 2,278 |
| PDF worker, gzip | 381,163 | 380,093 |
| Total code for the first page, gzip | 635,067 | 649,744 |
| Production install on disk | 83,809,678 | 80,346,930 |

ParaPDF's own package occupied 8.30 MiB, including 5.55 MiB of workers, fonts, decoders, character maps and other pdf.js assets. Its static directory also supports serving those files from an application-selected URL. The same pdfjs-dist dependency occupied 35.87 MiB in both installations. SHA-256 identified 214 files in ParaPDF’s asset directory that also occur byte for byte in pdfjs-dist. They total 3,215,507 bytes, short of the 3,462,748-byte installation gap even if all were shared. The modern and legacy workers also include ParaPDF’s asset-loading prelude. [Worker and asset setup](../../../site/src/content/docs/setup/bundlers.md)

## Integration options

ParaPDF supplies the viewport, document search, form controls and automatic worker setup. Its overlays add content in PDF page coordinates. React-pdf supplies individual pages, form fields, text and annotation layers, and lets an application replace the page renderer or customize individual text runs. The measured react-pdf application supplies the virtual list. Full-document search and automatic links in unannotated text require additional application code with react-pdf. [ParaPDF guides](../../../site/src/content/docs/guides) · [react-pdf 11.1.0 API](https://github.com/wojtekmaj/react-pdf/blob/aa36493db1568f1330f974b0acf27621d79d0cca/packages/react-pdf/README.md)

## Follow-up on the slower cases

The first follow-up removed idle work on completed layers. The next measured five canvas elements on page 10, checked reading quality during motion, and repeated the twelve scrolling conditions. A separate packaging change reduced the installed size. [Completed layers](../../../docs/decisions/0055-finished-dom-layers.md) · [Scroll and reading results](../../../docs/decisions/0057-reading-speed-scrolls.md) · [Install and download sizes](../../../docs/decisions/0056-share-installed-pdfjs-assets.md)

## Reproduce

Run the comparison scripts from this checkout against a prototype built from v0.10.0. Generate the synthetic corpus and install the Playwright browsers as in the [performance benchmark instructions](performance-0.10.0.md#reproduce).

```sh
export DIST=/absolute/path/to/the/v0.10.0/prototype/dist
for browser in chromium webkit firefox; do
  BROWSER=$browser RUNS=3 OUTPUT="/tmp/readers-$browser.json" \
    node examples/prototype/scripts/compare-readers.ts
done
PARAPDF_VERSION=0.10.0 BROWSER=chromium OUTPUT=/tmp/reader-footprint.json \
  node examples/prototype/scripts/reader-footprint.ts
```
