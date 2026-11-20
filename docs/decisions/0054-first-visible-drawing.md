# 0054. Draw visible pages first and prepare one neighboring preview on open

- Status: adopted
- Date: 2026-11-20

## Decision

Give visible pages the first drawing slots. If a slot is free while they wait
for their first pixels, draw at most one offscreen page at the normal base
resolution, starting with the nearest eligible page. The preview obeys the
renderer’s pixel and concurrency budgets and can fit when a full-size
neighboring drawing would exceed the pixel budget. Finishing it cannot unlock
full-size offscreen drawings while the visible drawing is still pending. Once
a visible page has pixels, normal scheduling resumes and features waiting for
the first paint can start. A full-page detail releases the opening preview’s
canvas backing when it covers the same page. If a visible detail fails, its
base can still be drawn. If the visible page cannot be rendered, neighboring
pages can still make progress.

A vertical or single-page layout without spreads uses three typed arrays per
viewport for page tops, widths and heights. Each page is its own row at
horizontal offset zero. Accordingly, the public `Layout` on
`viewer.state.layout` exposes null `rowFirst`, `rowLast` and `offsets` for
these layouts. Consumers reading these fields directly must handle the
implicit row index and zero offset. Preloads and viewers share the first
page's size read and retry it after a failure. The loader reuses absolute
asset URLs, resolves annotation icon URLs on demand, and starts a packaged
same-origin worker in a static directory alongside the pdf.js module.

## Evidence

The startup benchmark opens the production minimal React viewer from a URL.
The reference starts the same packaged pdf.js loader, uses the same document
preload policy and hardware acceleration, and draws page 1 into one
full-resolution canvas at the same fit-width scale. This supplies a practical
timing reference for the same raster. The renderers need time to download,
parse, decode and draw the PDF, and the browser can present the completed
canvas on a later refresh. [Benchmark](../../examples/prototype/scripts/startup-bench.ts)

The comparison rotates the previous build (`7f05380`), the adopted build and
the reference within each round. Each job uses a fresh context after an idle
page on the same origin calibrated the browser and primed its connection.
SHA-256 and dimensions must match for the full page in all three variants and
for the initial raster between the two viewer builds. The benchmark reads
pixels back after the timed milestones.

### Why keep a preview of the next page?

A four-way comparison in Playwright WebKit 27.2 opened HR 815 and the scanned
patent at 820 × 900, DPR 2. Each round rotated the order of the four builds.
The test clicked the viewer’s Next button as soon as page 1 exposed its first
complete canvas. It measured the time from that click until page 2 occupied
the viewport with any drawing and with sharp detail. Page 1 and the sharp page
2 matched across all four builds. The table gives the medians of five opens
per build and document.

| PDF | Policy | Page 1 from navigation (ms) | Canvas at page 1 (MiB) | Next to drawing (ms) | Next to sharp (ms) | Runs with a sampled blank frame |
| --- | --- | --- | --- | --- | --- | --- |
| HR 815 | Previous viewer | 181 | 29.00 | 3.8 | 3.8 | 0/5 |
| HR 815 | Wait for page 1 | 156 | 14.50 | 62.1 | 62.1 | 0/5 |
| HR 815 | Preload a page proxy | 143 | 14.50 | 63.7 | 63.7 | 0/5 |
| HR 815 | Draw one base preview | 158 | 15.41 | 3.9 | 77.6 | 0/5 |
| Scanned patent | Previous viewer | 234 | 28.40 | 5.2 | 5.2 | 0/5 |
| Scanned patent | Wait for page 1 | 200 | 14.20 | 69.9 | 138.4 | 5/5 |
| Scanned patent | Preload a page proxy | 184 | 14.20 | 56.8 | 140.0 | 5/5 |
| Scanned patent | Draw one base preview | 208 | 15.09 | 4.8 | 18.3 | 0/5 |

Waiting for page 1 alone reached the one-page canvas bound. It also left a
reader who pressed Next immediately waiting about 62 ms for the bill and 70 ms
for the scan. Reading the neighboring page proxy ahead of time still left
57–64 ms of work after Next. Starting one low-resolution drawing restored the
4–5 ms response to Next at a cost below 1 MiB over the one-page canvas bound
for each of these PDFs. The preview still has to be replaced by sharp detail.
A blank can begin and end between frame samples.

### First visible drawing

At 820 × 900 and DPR 2, page 1 filled the viewport and its first drawing was
already sharp in all 81 adopted-viewer opens. The table gives medians of 9
fresh opens per document and build. The last two columns give the observed
range of attached canvas storage when page 1 appeared.

| Browser | PDF | Page 1 before → adopted (ms) | Direct (ms) | Canvas before → adopted (MiB) | Direct canvas (MiB) |
| --- | --- | --- | --- | --- | --- |
| Chromium | HR 815 | 147.3 → 150.8 | 125.6 | 43.51 → 15.41 | 14.50 |
| Chromium | 1,000-page text | 161.1 → 160.0 | 146.1 | 25.02 → 13.29 | 12.51 |
| Chromium | Scanned patent | 173.5 → 158.9 | 106.3 | 28.40 → 15.09 | 14.20 |
| WebKit | HR 815 | 158.0 → 157.8 | 130.2 | 29.00 → 15.41 | 14.50 |
| WebKit | 1,000-page text | 208.6 → 215.6 | 166.5 | 25.02 → 13.29 | 12.51 |
| WebKit | Scanned patent | 204.5 → 205.9 | 136.8 | 28.40 → 15.09 | 14.20 |
| Firefox | HR 815 | 213.3 → 216.1 | 171.0 | 29.00–43.51 → 15.41 | 14.50 |
| Firefox | 1,000-page text | 257.8 → 259.3 | 210.1 | 25.02 → 13.29 | 12.51 |
| Firefox | Scanned patent | 242.8 → 242.0 | 173.8 | 28.40 → 15.09 | 14.20 |

With a single visible page at this zoom, the median attached canvas storage
was about 6.25% above the one-page RGBA bound. For page 1, the largest
improvement over the previous build was 15 ms and the largest increase was 7
ms. Within-round time differences between the adopted and previous builds had
medians from -2.8 to 3.6 ms. First-drawing times vary with machine load and
display frame scheduling. The adopted viewer’s page 1 median differed from the
direct reference by 13.9–69.2 ms across the browser and PDF combinations.
Comparing the two within each round, the median difference before the worker's
first `GetDocRequest` ranged from 15.2 to 39.5 ms. From that request to page 1
the differences ranged from 0.5 to 39.8 ms. Each interval has its own median.
Adding those medians can give a different value from the difference between
overall medians. The prototype uses React's production profiling renderer. The
viewer also overlaps the neighboring preview with the visible page. A normal
React build, a host that already has React loaded, or server-rendered HTML can
have a different startup cost. [Individual runs and request counts](../../examples/prototype/results/startup-first-display.md)

### Turning the page immediately

The Next action ran in the task that first exposed page 1. The table shows
five-run medians. The final column counts runs with at least one subsequent
animation-frame sample in which page 2 was positioned and blank. The benchmark
also repeated the action 100 ms after the first drawing. [Navigation benchmark](../../examples/prototype/scripts/startup-flip-bench.ts) · [Results at both delays](../../examples/prototype/results/startup-first-display.md#next-immediately-after-opening)

| Browser | PDF | Click to drawing before → adopted (ms) | Click to sharp before → adopted (ms) | Runs with a sampled blank before → adopted (of 5) |
| --- | --- | --- | --- | --- |
| Chromium | HR 815 | 0.9 → 1.0 | 0.9 → 13.5 | 0 → 0 |
| Chromium | Scanned patent | 2.8 → 3.0 | 2.8 → 16.9 | 0 → 0 |
| WebKit | HR 815 | 3.8 → 3.8 | 3.8 → 72.5 | 0 → 0 |
| WebKit | Scanned patent | 4.2 → 4.6 | 4.2 → 16.8 | 0 → 0 |
| Firefox | HR 815 | 0.8 → 0.9 | 0.8 → 14.1 | 0 → 0 |
| Firefox | Scanned patent | 14.7 → 16.1 | 14.7 → 29.5 | 0 → 0 |

At the 100 ms click, page 2 was already sharp in all 60 trials across both
builds. Immediate ink could still precede sharp detail by tens of
milliseconds. In the most pronounced case, WebKit HR 815, sharp detail took
72.5 ms after Next. A sample from the frame already in progress when the click
arrived saw page 2 blank in 1 of 30 immediate trials with the adopted viewer.
Its visibility on the physical display is unknown.

### Larger viewport and delayed network

At 1280 × 900 and DPR 2, HR 815 crosses the threshold for a low-resolution
first drawing in both viewer builds. Drawing the whole page directly at full
resolution uses 36.11 MiB in the direct reference. The table gives medians of
five opens per build and the range of attached canvas storage when page 1’s
preview appeared.

| Browser | Page 1 preview before → adopted (ms) | Sharp page 1 before → adopted (ms) | Direct sharp page 1 (ms) | Canvas at preview before → adopted (MiB) | Median canvas at sharp page 1 before → adopted (MiB) |
| --- | --- | --- | --- | --- | --- |
| Chromium | 139 → 138 | 168 → 171 | 144 | 38.36–74.47 → 4.51 | 110.58 → 110.58 |
| WebKit | 153 → 172 | 215 → 221 | 129 | 38.36 → 4.51 | 110.75 → 76.90 |
| Firefox | 233 → 211 | 283 → 277 | 186 | 38.36 → 4.51 | 110.58 → 110.58 |

By the time page 1 was sharp, the renderer could already be drawing
neighboring pages. Canvas storage at the first preview and at full resolution
describes those two instants. The benchmark samples neither the process-wide
peak nor GPU-resident surfaces. A final refinement remembers the opening
neighbor's page index across unmounts. Two additional 1280 × 900 runs per
variant and browser reproduced the preview and sharp raster digests and
dimensions. The final viewer used 4.51 MiB at the first preview in each run.

At 820 × 900 in Chromium with 60 ms of added latency and a 20 Mbit/s link, HR
815's sharp first page took 747.5 → 746.6 ms, compared with 655.1 ms for the
single-page reference. Canvas storage at the first drawing was 43.51 → 15.41
MiB. In the paired comparison with the reference, the adopted viewer's median
extra time before the first document request was 89 ms. Its median difference
from that request to the first drawing was 2 ms. These are 5 opens per variant
on one emulated network.

### Static worker directory

With `assetBase: "/pdfjs/"`, an independent test delayed the response headers
for the pdf.js module and its same-origin worker by 80 ms each. It opened HR
815 from the same PDF bytes and drew page 1 at 800 CSS pixels wide and DPR 2.
Each loader made exactly one request for each script. All seven pairs per
browser produced the same 1600 × 2400 raster within that browser.

| Browser | Concurrent wait for script headers before → after (ms) | Loader call to sharp page before → after (ms) |
| --- | ---: | ---: |
| Chromium | 0 → 78 | 283 → 184 |
| WebKit | 0 → 80 | 264 → 188 |
| Firefox | 0 → 76 | 331 → 201 |

The change overlapped the two requests and finished earlier in every pair.
These medians apply to a static copy with the stated delay. The bundled worker
already starts in parallel. Explicit worker URLs and cross-origin static
directories follow pdf.js's own startup path.

A separate loader probe counted native URL constructions with an already
resolved asset manifest and a stub pdf.js module. Loading the default build
constructed 187 URL objects, down from 396. The first annotation icon lookup
then constructed 11. Bundlers that emit relative URL objects still need the
document base to resolve them. Concurrent preload and viewer requests also
share one first-page viewport read, including when a failed read is retried.

### Memory after the initial viewport settles

The full Chromium prototype opened at 820 × 900 and DPR 2 with hardware
acceleration. It waited for the exact document geometry, the drawings on all
three mounted pages, and their text and annotation layers. The measurements
are medians of three pairs. CDP collected garbage twice in the main and
dedicated worker isolates before reading their heap and backing-store
counters.

| PDF | Main used heap before → adopted (MiB) | Main backing before → adopted (bytes) | Worker used heap before → adopted (MiB) | Worker backing before → adopted (bytes) | Attached canvases before → adopted (MiB) |
| --- | --- | --- | --- | --- | --- |
| HR 815 | 4.23 → 4.23 | 1,008,060 → 1,006,281 | 3.45 → 3.45 | 1,837,124 → 1,837,124 | 43.68 → 43.68 |
| 1,000-page text | 4.63 → 4.63 | 1,016,717 → 1,004,259 | 8.56 → 8.56 | 3,652,439 → 3,652,439 | 37.70 → 37.70 |

In default vertical layout the geometric backing arrays fell from 36 to 24
bytes per page in all three browsers. At 1,000 pages this saves 12,000 bytes
per viewer. The remaining layout construction and exact background measurement
still scale with page count. Repeated layouts of 1,000 identical estimates
took 9–11 µs after the change in the three browsers. A formula-only layout for
the estimates could save the remaining 24 KB, but would require a second
geometry representation across hit testing, navigation and overlays. These
counts exclude GPU surfaces, compositor copies and native engine allocations.

### Scope of the bound

The one-canvas reference is a lower bound on full-page RGBA sample storage at
the chosen resolution. HR 815 at 820 × 900 uses 1,592 × 2,388 pixels, or 14.50
MiB. Clipping to the 1,696 device-pixel rows initially visible below the
toolbar and page gap would use 10.30 MiB. Scrolling would then require another
drawing to expose the rest of that page. Smaller previews trade sharpness for
an earlier first drawing. The renderer already makes that trade on larger
pages. Worker start, PDF transfer, parsing, decoding, rasterization and frame
scheduling still contribute to elapsed time. The viewer also honors the
requested opening page, permissions and reading direction before drawing.
Text, annotation DOM and exact sizes for the rest of the document follow the
first drawing. A byte-array source needs a copy so pdf.js can transfer its
bytes to the worker while the application keeps its original buffer.
Applications that know the document before mounting can shift work earlier
with `preloadDocument()`. Opens at a named destination and spreads showing
multiple pages have different prerequisites and pixel counts.

The 50,000-stroke synthetic fixture is excluded from timing comparisons. In a
separate Chromium fidelity investigation of the one-canvas prototype, four
cold captures per variant produced three distinct digests. Both digests
observed with that prototype also occurred when drawing directly with pdf.js.
Every alpha value and the set of non-white pixels matched across all 66 pairs,
while up to 0.39% of pixels differed in RGB. The reported WebKit measurements
come from Playwright on macOS. Real iOS canvas limits remain an open question.
[Decision 0015](0015-toward-1.0.md)

## Reopen if

Revisit the opening plan if other navigation patterns spend longer without
pixels, or if pdf.js can prepare the next page with less drawing work. A
change to initial clipping or resolution needs matched fidelity,
first-drawing, full-resolution and immediate-navigation measurements.
