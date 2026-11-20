# Reading performance in ParaPDF 0.10.0

The prototype was built from the [v0.10.0 release](https://github.com/yhay81/parapdf/tree/v0.10.0) (`5221750`). Both ParaPDF and react-pdf 11.1.0 used pdfjs-dist 6.5.438. The comparison used react-window 2.5.3 and the React 19.3.1 production profiling renderer.

All runs used an Apple M2 Pro with 12 logical cores and 32 GiB of memory on macOS 27.2, on AC power with Low Power Mode off. Playwright 1.65.1 ran headless Chromium 159.0.8154.6, WebKit 27.2 and Firefox 159.0. The viewers opened local PDFs at fit-width and a device pixel ratio of 2. Timings and storage figures on the site are medians within each browser and condition. Lists below retain trial order. [PDF sources and synthetic fixtures](../../../bench/corpus/README.md)

## Opening a document

Each cold open used a fresh browser context. An idle page primed the connection before navigation to the minimal viewer or a reference that drew only page 1 with the same pdf.js loader and scale. After one warmup per renderer, nine rounds rotated the order. Full-resolution page 1 matched the reference in dimensions and SHA-256 of the RGBA pixels on every trial. At 820 × 900 the first drawing was already sharp. Canvas storage counts four bytes per pixel in every attached canvas at that instant, including work in progress. [Startup benchmark](../scripts/startup-bench.ts) · [Direct reference](../scripts/startup-reference.ts)

| Browser | PDF | Renderer | Median (ms) | Full-resolution page 1 in run order (ms) | Canvas at first draw (MiB, range) |
| --- | --- | --- | ---: | ---: | ---: |
| Chromium | 110-page bill | ParaPDF | 164.5 | 146.7, 147.1, 153.9, 187.5, 183.0, 201.8, 243.8, 164.5, 149.2 | 15.41 |
| Chromium | 110-page bill | Direct pdf.js | 124.6 | 107.2, 107.1, 124.3, 146.4, 164.2, 129.6, 147.3, 124.6, 124.4 | 14.50 |
| Chromium | 1,000-page text | ParaPDF | 175.3 | 159.7, 175.3, 198.5, 246.5, 194.6, 177.5, 158.4, 158.2, 160.6 | 13.29 |
| Chromium | 1,000-page text | Direct pdf.js | 147.8 | 161.2, 147.8, 160.9, 177.9, 162.4, 144.5, 146.1, 144.6, 143.3 | 12.51 |
| Chromium | Scanned patent | ParaPDF | 156.3 | 156.3, 156.3, 155.2, 156.6, 156.8, 156.4, 156.7, 155.8, 143.8 | 15.09 |
| Chromium | Scanned patent | Direct pdf.js | 106.6 | 106.3, 108.3, 107.0, 106.6, 106.4, 109.1, 106.2, 106.5, 106.7 | 14.20 |
| WebKit | 110-page bill | ParaPDF | 143.1 | 143.1, 142.2, 143.2, 131.1, 142.8, 143.3, 156.9, 143.1, 143.3 | 15.41 |
| WebKit | 110-page bill | Direct pdf.js | 115.6 | 115.2, 128.4, 115.6, 116.6, 115.6, 115.6, 115.5, 116.2, 115.8 | 14.50 |
| WebKit | 1,000-page text | ParaPDF | 169.3 | 167.7, 254.0, 169.8, 167.5, 167.4, 181.9, 168.4, 180.6, 169.3 | 13.29 |
| WebKit | 1,000-page text | Direct pdf.js | 154.9 | 154.5, 182.7, 154.7, 155.5, 154.5, 155.1, 154.2, 154.9, 154.9 | 12.51 |
| WebKit | Scanned patent | ParaPDF | 192.9 | 178.4, 192.9, 191.8, 205.1, 179.5, 194.5, 208.0, 192.9, 193.1 | 15.09 |
| WebKit | Scanned patent | Direct pdf.js | 133.2 | 137.0, 133.2, 135.8, 123.3, 137.4, 123.3, 136.5, 123.6, 123.1 | 14.20 |
| Firefox | 110-page bill | ParaPDF | 209.7 | 218.7, 201.9, 202.3, 217.3, 218.8, 218.4, 209.7, 201.4, 192.3 | 15.41 |
| Firefox | 110-page bill | Direct pdf.js | 160.0 | 159.7, 158.2, 160.0, 161.0, 161.1, 159.3, 160.0, 159.6, 161.0 | 14.50 |
| Firefox | 1,000-page text | ParaPDF | 258.2 | 239.6, 278.4, 253.4, 259.2, 240.2, 321.3, 255.2, 258.2, 339.2 | 13.29 |
| Firefox | 1,000-page text | Direct pdf.js | 213.6 | 209.4, 241.2, 207.6, 208.1, 226.4, 213.6, 238.8, 232.3, 209.4 | 12.51 |
| Firefox | Scanned patent | ParaPDF | 237.1 | 245.0, 237.1, 234.2, 235.5, 238.5, 237.6, 241.8, 224.4, 236.3 | 15.09 |
| Firefox | Scanned patent | Direct pdf.js | 169.9 | 170.3, 168.4, 169.6, 169.9, 173.2, 170.7, 171.9, 157.2, 158.0 | 14.20 |

## Turning to page 2

The minimal viewer opened at 820 × 900. The test clicked Next when the first drawing of page 1 appeared, or 100 ms later. Times run from the click until a completed page 2 canvas occupied the viewport, then until it reached full resolution. The sharp page 2 matched across trials and delays within each browser and document. The last three columns count trials. A frame already in progress at the click is counted separately. [Page-turn benchmark](../scripts/startup-flip-bench.ts)

| Browser | PDF | Click delay (ms) | Click to first drawing (ms) | Click to sharp (ms) | Sharp before click | Blank in a subsequent frame | Blank in partial click frame |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Chromium | 110-page bill | 0 | 0.9, 0.9, 0.9, 1.1, 0.9 | 13.5, 13.1, 12.9, 13.2, 13.3 | 0/5 | 0/5 | 0/5 |
| Chromium | 110-page bill | 100 | 1.2, 1.0, 1.0, 1.2, 1.0 | 1.2, 1.0, 1.0, 1.2, 1.0 | 5/5 | 0/5 | 0/5 |
| Chromium | Scanned patent | 0 | 2.9, 2.9, 2.9, 4.5, 2.8 | 17.3, 16.5, 17.0, 15.1, 17.0 | 0/5 | 0/5 | 0/5 |
| Chromium | Scanned patent | 100 | 0.9, 1.0, 1.0, 0.9, 0.9 | 0.9, 1.0, 1.0, 0.9, 0.9 | 5/5 | 0/5 | 0/5 |
| WebKit | 110-page bill | 0 | 3.8, 3.7, 3.7, 3.7, 3.5 | 71.0, 74.8, 76.0, 72.9, 69.5 | 0/5 | 0/5 | 0/5 |
| WebKit | 110-page bill | 100 | 2.4, 2.4, 2.6, 2.4, 2.2 | 2.4, 2.4, 2.6, 2.4, 2.2 | 5/5 | 0/5 | 0/5 |
| WebKit | Scanned patent | 0 | 4.5, 4.0, 4.2, 3.9, 3.9 | 14.5, 15.6, 18.4, 14.9, 15.0 | 0/5 | 0/5 | 0/5 |
| WebKit | Scanned patent | 100 | 1.8, 1.7, 2.2, 1.8, 1.9 | 1.8, 1.7, 2.2, 1.8, 1.9 | 5/5 | 0/5 | 0/5 |
| Firefox | 110-page bill | 0 | 0.8, 0.8, 0.8, 0.8, 0.8 | 11.7, 11.5, 11.8, 12.6, 11.4 | 0/5 | 0/5 | 0/5 |
| Firefox | 110-page bill | 100 | 1.0, 1.0, 0.9, 1.0, 0.8 | 1.0, 1.0, 0.9, 1.0, 0.8 | 5/5 | 0/5 | 0/5 |
| Firefox | Scanned patent | 0 | 15.6, 15.7, 16.3, 15.8, 15.8 | 29.0, 28.5, 29.3, 28.8, 29.2 | 0/5 | 0/5 | 0/5 |
| Firefox | Scanned patent | 100 | 0.9, 0.8, 0.9, 0.9, 0.8 | 0.9, 0.8, 0.9, 0.9, 0.8 | 5/5 | 0/5 | 0/5 |

## Returning to page 1 and zooming

The full viewer opened the bill at 820 × 1000. For each return, the test waited for page 13 to settle and then jumped back to page 1. The default cache and `maxKeptPixels: 0` ran consecutively in each of five rounds. A sharp viewport had at least 99% of the target resolution, weighted by visible area, from that sample onward. [Return benchmark](../scripts/return-bench.ts)

| Browser | Canvas cache | Jump to sharp (ms) | Blank frames | Cached layers restored |
| --- | --- | ---: | ---: | ---: |
| Chromium | Disabled | 21.5, 20.3, 19.8, 20.8, 19.0 | 1, 1, 1, 1, 1 | 0, 0, 0, 0, 0 |
| Chromium | Default | 2.9, 3.0, 3.1, 2.8, 2.6 | 0, 0, 0, 0, 0 | 3, 3, 3, 3, 3 |
| WebKit | Disabled | 37.0, 37.0, 36.9, 21.0, 37.4 | 1, 1, 1, 1, 1 | 0, 0, 0, 0, 0 |
| WebKit | Default | 6.8, 7.1, 7.2, 7.1, 7.0 | 0, 0, 0, 0, 0 | 3, 3, 3, 3, 3 |
| Firefox | Disabled | 151.4, 152.7, 149.1, 151.5, 148.4 | 2, 2, 2, 2, 2 | 0, 0, 0, 0, 0 |
| Firefox | Default | 10.6, 10.1, 10.7, 9.4, 9.8 | 0, 0, 0, 0, 0 | 3, 3, 3, 3, 3 |

The zoom test enlarged page 3 to 1.75 times its fit-width scale. Each trial first checked the visible pixels for blank frames and loss of detail. A second pass timed the zoom commit until the view stayed sharp, with pixel readback disabled. [Zoom commit benchmark](../scripts/commit-bench.ts)

| Browser | Commit to sharp (ms) | Blank frames across all runs | Frames that fell back to the base drawing |
| --- | ---: | ---: | ---: |
| Chromium | 6.3, 6.8, 9.0, 10.1, 6.4 | 0 | 0 |
| WebKit | 8.7, 6.2, 6.5, 10.7, 6.3 | 0 | 0 |
| Firefox | 51.3, 55.6, 52.3, 49.5, 50.4 | 0 | 0 |

## Scrolling

Both viewers opened at 1280 × 900 with selectable text and links enabled. ParaPDF used its default GPU-backed canvases. react-pdf used react-window's default overscan and sized its rows from the first page. The driver waited 600 ms after first pixels, then scrolled for four seconds from the beginning of the PDF. Each of five rounds ran ParaPDF followed by react-pdf for the same document and speed. All three browsers ran the 1,000-page comparison. Chromium and WebKit also ran the bill. [Scroll benchmark](../scripts/scroll-bench.ts) · [ParaPDF driver](../src/BenchDriver.tsx) · [react-pdf driver](../src/compare.tsx)

- **Blocked time** sums the lateness of a 4 ms main-thread timer beyond the larger of 2 ms and the idle page's 95th percentile. The interval ends when scrolling stops.
- **Canvas storage** counts attached and cached canvas pixels at four bytes each, sampled after visible gaps fill. Detail rendering and text layers can still be pending.
- **Blank frames** are sampled frames where visible pages with no drawing cover more than 1% of the viewport. First pixels can be a preview.

| Browser | PDF | CSS px/s | Viewer | Pages crossed | React commits | Blocked (ms) | Canvas (MiB) | Runs with a blank frame |
| --- | --- | ---: | --- | ---: | ---: | ---: | ---: | ---: |
| Chromium | 1,000-page text | 900 | ParaPDF | 2 | 2 | 10.4 | 155.9 | 0/5 |
| Chromium | 1,000-page text | 900 | react-pdf | 2 | 10 | 8.6 | 187.0 | 0/5 |
| Chromium | 1,000-page text | 3,600 | ParaPDF | 9 | 11 | 6.9 | 111.1 | 0/5 |
| Chromium | 1,000-page text | 3,600 | react-pdf | 9 | 44 | 18.8 | 249.3 | 0/5 |
| Chromium | 110-page bill | 900 | ParaPDF | 2 | 2 | 6.3 | 183.0 | 0/5 |
| Chromium | 110-page bill | 900 | react-pdf | 2 | 10 | 3.8 | 216.8 | 0/5 |
| Chromium | 110-page bill | 3,600 | ParaPDF | 7 | 9 | 2.5 | 126.5 | 0/5 |
| Chromium | 110-page bill | 3,600 | react-pdf | 7 | 46 | 21.6 | 289.0 | 0/5 |
| WebKit | 1,000-page text | 900 | ParaPDF | 2 | 2 | 1.5 | 155.9 | 0/5 |
| WebKit | 1,000-page text | 900 | react-pdf | 2 | 10 | 3.2 | 187.0 | 0/5 |
| WebKit | 1,000-page text | 3,600 | ParaPDF | 9 | 11 | 18.6 | 111.1 | 0/5 |
| WebKit | 1,000-page text | 3,600 | react-pdf | 9 | 43 | 18.0 | 249.3 | 0/5 |
| WebKit | 110-page bill | 900 | ParaPDF | 2 | 2 | 13.6 | 183.0 | 0/5 |
| WebKit | 110-page bill | 900 | react-pdf | 2 | 10 | 7.7 | 216.8 | 0/5 |
| WebKit | 110-page bill | 3,600 | ParaPDF | 7 | 9 | 6.1 | 126.5 | 0/5 |
| WebKit | 110-page bill | 3,600 | react-pdf | 7 | 46 | 92.5 | 289.0 | 0/5 |
| Firefox | 1,000-page text | 900 | ParaPDF | 2 | 2 | 22.4 | 155.9 | 0/5 |
| Firefox | 1,000-page text | 900 | react-pdf | 2 | 10 | 15.5 | 187.0 | 0/5 |
| Firefox | 1,000-page text | 3,600 | ParaPDF | 9 | 11 | 31.1 | 111.1 | 0/5 |
| Firefox | 1,000-page text | 3,600 | react-pdf | 9 | 43 | 133.6 | 249.3 | 0/5 |

<details>
<summary>Individual scrolling trials</summary>

| Browser | PDF | CSS px/s | Viewer | First pixels from navigation (ms) | React commits | Blocked (ms) | Canvas (MiB) |
| --- | --- | ---: | --- | ---: | ---: | ---: | ---: |
| Chromium | 1,000-page text | 900 | ParaPDF | 196.3, 176.8, 179.6, 176.8, 196.4 | 2, 2, 2, 2, 2 | 10.9, 10.1, 15.1, 7.7, 10.4 | 155.9, 155.9, 155.9, 155.9, 155.9 |
| Chromium | 1,000-page text | 900 | react-pdf | 215.7, 195.0, 192.9, 177.9, 197.6 | 10, 10, 10, 10, 10 | 8.6, 7.3, 6.4, 11.8, 11.0 | 187.0, 187.0, 187.0, 187.0, 187.0 |
| Chromium | 1,000-page text | 3,600 | ParaPDF | 197.6, 177.8, 177.5, 210.7, 177.7 | 11, 11, 11, 11, 11 | 6.9, 44.3, 44.7, 3.6, 6.5 | 111.1, 111.1, 111.1, 111.1, 111.1 |
| Chromium | 1,000-page text | 3,600 | react-pdf | 194.5, 195.5, 198.4, 177.3, 194.1 | 43, 44, 43, 44, 44 | 37.9, 26.9, 14.5, 18.8, 8.3 | 249.3, 249.3, 249.3, 249.3, 249.3 |
| Chromium | 110-page bill | 900 | ParaPDF | 149.3, 146.1, 140.0, 147.7, 162.2 | 2, 2, 2, 2, 2 | 9.7, 6.6, 5.2, 4.9, 6.3 | 183.0, 183.0, 183.0, 183.0, 183.0 |
| Chromium | 110-page bill | 900 | react-pdf | 189.6, 189.6, 158.2, 157.4, 173.7 | 10, 10, 10, 10, 10 | 4.3, 3.1, 3.8, 4.2, 0.9 | 216.8, 216.8, 216.8, 216.8, 216.8 |
| Chromium | 110-page bill | 3,600 | ParaPDF | 137.9, 137.5, 145.4, 165.3, 161.7 | 9, 9, 9, 9, 9 | 3.1, 2.5, 3.8, 2.5, 2.3 | 126.5, 126.5, 126.5, 126.5, 126.5 |
| Chromium | 110-page bill | 3,600 | react-pdf | 200.1, 174.0, 201.3, 155.5, 189.0 | 46, 46, 42, 42, 46 | 23.4, 28.0, 21.6, 20.1, 21.2 | 289.0, 289.0, 252.9, 252.9, 289.0 |
| WebKit | 1,000-page text | 900 | ParaPDF | 195.4, 184.8, 211.9, 196.7, 189.5 | 2, 2, 2, 2, 2 | 2.5, 1.2, 1.5, 3.0, 0.8 | 155.9, 155.9, 155.9, 155.9, 155.9 |
| WebKit | 1,000-page text | 900 | react-pdf | 195.4, 225.2, 186.8, 200.6, 184.5 | 10, 10, 10, 10, 10 | 1.6, 7.9, 2.3, 3.4, 3.2 | 187.0, 187.0, 187.0, 187.0, 187.0 |
| WebKit | 1,000-page text | 3,600 | ParaPDF | 192.7, 204.6, 207.2, 184.4, 181.1 | 11, 11, 11, 11, 11 | 5.2, 7.0, 18.6, 23.4, 34.9 | 111.1, 111.1, 111.1, 111.1, 111.1 |
| WebKit | 1,000-page text | 3,600 | react-pdf | 182.7, 194.5, 206.8, 195.0, 194.8 | 43, 44, 44, 43, 43 | 20.4, 18.0, 11.0, 41.8, 15.6 | 249.3, 249.3, 249.3, 249.3, 249.3 |
| WebKit | 110-page bill | 900 | ParaPDF | 158.0, 157.3, 168.1, 157.1, 157.1 | 2, 2, 2, 2, 2 | 13.6, 8.1, 22.5, 17.9, 12.3 | 183.0, 183.0, 183.0, 183.0, 183.0 |
| WebKit | 110-page bill | 900 | react-pdf | 226.6, 243.0, 227.8, 236.5, 255.3 | 10, 10, 10, 10, 10 | 7.7, 7.2, 10.3, 6.5, 14.6 | 216.8, 216.8, 216.8, 216.8, 216.8 |
| WebKit | 110-page bill | 3,600 | ParaPDF | 157.9, 156.9, 157.7, 157.0, 170.8 | 9, 9, 9, 9, 9 | 17.1, 17.5, 6.1, 5.3, 1.7 | 126.5, 126.5, 126.5, 126.5, 126.5 |
| WebKit | 110-page bill | 3,600 | react-pdf | 237.3, 229.4, 234.7, 251.8, 257.1 | 46, 46, 46, 46, 46 | 113.6, 97.4, 92.5, 79.0, 71.4 | 289.0, 289.0, 289.0, 289.0, 289.0 |
| Firefox | 1,000-page text | 900 | ParaPDF | 263.1, 272.8, 279.1, 260.3, 263.2 | 2, 2, 2, 2, 2 | 181.4, 11.0, 76.4, 20.0, 22.4 | 155.9, 155.9, 155.9, 155.9, 155.9 |
| Firefox | 1,000-page text | 900 | react-pdf | 274.6, 300.0, 279.9, 292.4, 292.4 | 10, 10, 10, 10, 10 | 29.9, 15.5, 15.4, 15.5, 12.4 | 187.0, 187.0, 187.0, 187.0, 187.0 |
| Firefox | 1,000-page text | 3,600 | ParaPDF | 278.6, 279.6, 274.8, 318.5, 264.0 | 11, 11, 11, 11, 11 | 31.1, 16.7, 29.3, 31.2, 37.0 | 111.1, 111.1, 111.1, 111.1, 111.1 |
| Firefox | 1,000-page text | 3,600 | react-pdf | 312.3, 281.7, 530.3, 311.3, 312.0 | 43, 43, 43, 44, 44 | 133.6, 71.9, 65.0, 167.3, 195.9 | 249.3, 249.3, 249.3, 249.3, 249.3 |

</details>

## Searching extracted text

pdf.js first extracted all pages. The index build and the two queries were then timed separately. The queries were “lorem” and “dolor” on the 1,000-page text PDF, and “the” and “section” on the bill. Each trial checked the normalized text, source positions and match ranges against v0.9.1 using SHA-256. The table gives the 0.10.0 samples. An independent Node run confirmed the digests, match counts and position-buffer sizes on both PDFs. Position buffers are the three arrays mapping normalized characters back to the source. Extracted text and results occupy additional memory. [Search benchmark](../scripts/search-index-bench.ts)

| Browser | PDF | Index build (ms) | Two indexed queries (ms) | Position buffers (bytes) | Matches across both queries |
| --- | --- | ---: | ---: | ---: | ---: |
| Chromium | 110-page bill | 16.2, 16.0, 16.0, 16.1, 16.6 | 1.2, 1.3, 1.3, 1.3, 1.2 | 945,597 | 4,333 |
| Chromium | 1,000-page text | 138.1, 139.1, 139.5, 140.8, 140.5 | 12.3, 12.7, 13.0, 12.6, 12.5 | 11,946,849 | 98,466 |
| WebKit | 110-page bill | 11.4, 10.6, 10.9, 11.4, 12.2 | 0.9, 0.8, 0.8, 1.0, 1.0 | 945,597 | 4,333 |
| WebKit | 1,000-page text | 96.8, 98.1, 97.4, 97.9, 97.1 | 6.5, 6.1, 6.6, 6.5, 6.2 | 11,946,849 | 98,466 |
| Firefox | 110-page bill | 17.8, 17.8, 17.9, 18.3, 18.3 | 1.3, 1.2, 0.9, 1.3, 1.4 | 945,597 | 4,333 |
| Firefox | 1,000-page text | 196.2, 217.2, 598.8, 195.1, 195.6 | 11.3, 15.4, 27.9, 11.0, 10.8 | 11,946,849 | 98,466 |

Firefox’s five index builds on the 1,000-page PDF spanned 195.1–598.8 ms, with a median of 196.2 ms.

## Reproduce

From the v0.10.0 checkout, build the measured prototype and prepare the earlier search implementation for the correctness check.

```sh
pnpm install --frozen-lockfile
pnpm --filter @parapdf/bench exec playwright install chromium webkit firefox
pnpm --filter @parapdf/bench corpus
bench_dir=$(mktemp -d)
export DIST="$bench_dir/dist"
pnpm --filter @parapdf/prototype exec vite build --outDir "$DIST"
mkdir -p "$bench_dir/before/features/search"
git show v0.9.1:packages/parapdf/src/features/search/text-search.ts > "$bench_dir/before/features/search/text-search.ts"
```

Run the commands below with `BROWSER` set to each of `chromium`, `webkit` and `firefox` in turn. To reproduce the separate Firefox scrolling series, pass one PDF at a time in `FILES`.

```sh
export BROWSER=chromium MAX_LOAD=20
scroll_limit=20
if [ "$BROWSER" = chromium ]; then
  scroll_limit=8
fi
scripts=examples/prototype/scripts
MAX_LOAD=8 FILES=bill-hr815.pdf,synthetic-text-1000.pdf,patent-us223898.pdf RUNS=9 \
  OUTPUT="$bench_dir/open-$BROWSER.json" node "$scripts/startup-bench.ts"
MAX_LOAD=8 FILES=bill-hr815.pdf,patent-us223898.pdf RUNS=5 \
  OUTPUT="$bench_dir/next-$BROWSER.json" node "$scripts/startup-flip-bench.ts"
MAX_LOAD="$scroll_limit" VARIANTS=pdfjs-hwa,react-pdf-window TEXT=1 LINKS=1 SCROLL=vertical SCALE=fit-width \
  FILES=synthetic-text-1000.pdf,bill-hr815.pdf SPEEDS=900,3600 DURATION=4000 RUNS=5 \
  OUTPUT="repro-scroll-$BROWSER" node "$scripts/scroll-bench.ts"
ENGINE=pdfjs SCENARIOS=scale-up RUNS=5 LABEL=v0.10.0 \
  OUTPUT="repro-zoom-$BROWSER" node "$scripts/commit-bench.ts"
ENGINE=pdfjs FILES=bill-hr815.pdf SCENARIOS=jump-back VARIANTS=none,kept RUNS=5 \
  OUTPUT="repro-return-$BROWSER" node "$scripts/return-bench.ts"
BEFORE_SRC="$bench_dir/before" RUNS=5 node "$scripts/search-index-bench.ts"
```

<details>
<summary>Machine load and browser overlap</summary>

The launcher waited for competing Playwright browsers before each job and retried overlapping jobs. Cold opens, page turns and Chromium scrolling used a one-minute load ceiling of 8. [Shared browser launcher](../../../bench/scripts/browsers.ts)

The initial WebKit scroll attempts at ceilings of 8 and 12 each stopped before their first condition had five complete pairs. Five additional idle contexts at a load of 18.5–18.6 gave a median timer p95 of 4.9 ms and a median frame interval of 13.88 ms. The corresponding cold-open baselines were 4.9 and 13.88 ms.

A separate five-round repeat of the bill cold open at load 18.6–19.6 also matched the original full-resolution raster. The table shows the medians at both loads.

| WebKit renderer | Original nine runs (ms) | Five-run control (ms) | Individual control runs (ms) |
| --- | ---: | ---: | ---: |
| ParaPDF | 143.1 | 143.3 | 142.7, 143.7, 143.3, 143.7, 142.9 |
| Direct pdf.js | 115.6 | 115.7 | 115.7, 115.7, 115.7, 115.3, 116.6 |

The remaining scroll, zoom, return and search series used a load ceiling of 20. Every reported scrolling condition includes all five paired rounds. Firefox completed all 20 jobs on the 1,000-page PDF. Those results were saved while the launcher was waiting for the machine between trials on the separate bill workload. The incomplete Firefox bill trials were excluded. The first table shows medians of idle calibrations for the reported jobs. The second table uses the environment summaries written by completed benchmark processes.

| Browser | Idle timer p95 (ms) | Idle frame interval (ms) |
| --- | ---: | ---: |
| Chromium 159.0.8154.6 | 1.2 | 16.7 |
| WebKit 27.2 | 4.9 | 13.9 |
| Firefox 159.0 | 0.1 | 16.7 |

| Browser | Experiment | Load at start | Load at end | Waits | Overlap retries |
| --- | --- | ---: | ---: | ---: | ---: |
| Chromium | Cold open | 3.2 | 6.4 | 0 | 0 |
| Chromium | Next | 4.9 | 4.4 | 0 | 0 |
| Chromium | Scroll | 5.4 | 5.9 | 0 | 0 |
| Chromium | Zoom | 25.7 | 16.3 | 1 | 0 |
| Chromium | Return | 11.7 | 10.6 | 0 | 0 |
| WebKit | Cold open | 6.4 | 3.9 | 0 | 0 |
| WebKit | Next | 4.4 | 5.9 | 1 | 0 |
| WebKit | Scroll | 19.0 | 20.1 | 3 | 1 |
| WebKit | Zoom | 16.3 | 13.4 | 0 | 0 |
| WebKit | Return | 11.0 | 10.6 | 0 | 0 |
| Firefox | Cold open | 3.9 | 3.9 | 0 | 0 |
| Firefox | Next | 5.9 | 4.6 | 0 | 0 |
| Firefox | Zoom | 13.4 | 11.7 | 0 | 0 |
| Firefox | Return | 14.7 | 13.8 | 0 | 0 |

</details>
