# 0052. Compact search positions and bound per-page work

- Status: adopted
- Date: 2026-11-20

## Decision

- Size the search index’s three unsigned integer columns from their maximum
  possible values. An item ID fits up to the last item number and either
  offset fits up to the longest item’s UTF-16 length. Normalization can
  expand the output without increasing those maxima. The common case uses
  three bytes per normalized code unit and lookup still takes constant time.
  A page publishes all its matches together. Highlight ranges remember the
  group’s starting index when earlier pages arrive, so selecting a different
  match only touches the previous and new pages.
- Once a thumbnail actually starts drawing, hold the page through completion,
  failure, or cancellation. Release the hold the same way as for a page leaving
  a viewport. This allows pdf.js to clean up its operator list once all
  viewers and thumbnail draws have finished using it. A kept thumbnail can
  still be shown immediately. A renderer update that sees a change in physical
  viewport size or display density also enforces the budget for detached page
  canvases. A temporary zoom gesture keeps the same physical viewport.
- Reuse one pdf.js print annotation snapshot across all sheets in a job.
  The snapshot includes pending edits and changes made by WillPrint. Edits
  made while pages render apply to the next job. The cost of taking that
  snapshot now scales with the number of stored annotations.
- Use the shown page's own dimensions to preview zoom in single-page mode.
  Mixed page sizes and fractional gaps require no arrays of target page
  geometry. With a finite canvas budget, compute visible pages' relative
  areas together. With an unlimited budget, skip the sum of all canvas
  pixels. A session replaces its initial page-size estimates as a single
  array once measurement finishes.

## Evidence

On an AC-powered Apple M2 Pro with pdfjs-dist 6.5.438, each pair used fresh
contexts of the same browser, alternating the order between runs. The
baseline for these targeted measurements included the initial optimizations
in [decision 0051](0051-batched-mounting-exact-settle-and-hot-path-tightening.md).
The tests used desktop Playwright builds of Chromium 159, WebKit 27.2, and
Firefox 159. Elapsed times below are medians. The launcher waited for active
browser jobs or repeated overlapping jobs. Some runs excluded unrelated idle
QA browser processes from this check. The [individual measurements](../../examples/prototype/results/page-work-20261120.json)
include the browser versions, fidelity checks and run-to-run variation.

### Document search

pdf.js extracted the same text items before each comparison. Across five
pairs per document per browser, every normalized code unit, source position
and match for the two queries had the same digest. The byte count sums the
backing buffers for the three index columns for one option combination.
Document text, result objects, pdf.js caches and canvases are separate.
The [search index benchmark](../../examples/prototype/scripts/search-index-bench.ts)
prints the backing bytes, build and lookup times, and the digest for each run.
After generating the corpus, run it from the repository root with either
build's source available on disk:

```sh
BEFORE_SRC=/path/to/baseline/packages/parapdf/src BROWSER=chromium RUNS=5 \
  node examples/prototype/scripts/search-index-bench.ts
```

| Source | Matched occurrences | Position bytes before → after | Chromium build ms | WebKit build ms | Firefox build ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| Synthetic text, 1,000 pages | 98,466 | 47,787,396 → 11,946,849 | 151.1 → 144.8 | 103.9 → 100.1 | 201.0 → 197.9 |
| HR 815, 110 pages | 4,333 | 3,590,652 → 945,597 | 17.7 → 17.4 | 11.9 → 11.6 | 19.5 → 18.3 |

A second test measured the running Chromium viewer. Three pairs opened the
1,000-page document, waited for page geometry and layers, called `getText()`,
and searched for an absent phrase. All six contexts returned the same
3,984,281-character text digest and zero matches. After two garbage collections
at each stage, CDP's main-isolate backing storage grew by exactly 47,787,396
bytes before and 11,946,849 bytes after. The median final V8 used heap plus
backing storage fell from **61.57 to 27.39 MiB**. The used JS heap alone was
14.20 MiB in both builds. These counts exclude the worker, GPU and other
browser processes. Functional checks could run concurrently with this byte
count since this test did not measure elapsed time.

### Thumbnails and retained page canvases

In a 980 × 760 context at DPR 2, the main page stayed fixed while the
thumbnail list jumped to pages 51, 81, 111 and 141 of the 1,000-page PDF.
Each browser drew 68 thumbnail-only pages. Their retained pdf.js display
lists went from 68 to zero, releasing 36,108 recorded operators. Returning
to page 51 reused the cached thumbnail every time. Reopening the sidebar
forced a redraw. The full RGBA hash matched on all three visits, within
each browser, in all three pairs.

| Browser | First sidebar visit, ms | Kept return, ms | Redraw after reopening, ms |
| --- | ---: | ---: | ---: |
| Chromium | 317.4 → 316.6 | 33.3 → 33.4 | 317.0 → 316.6 |
| WebKit | 263.6 → 263.8 | 27.4 → 27.4 | 263.8 → 263.8 |
| Firefox | 317.0 → 318.9 | 33.3 → 32.1 | 316.6 → 316.3 |

Separately, after twelve page advances at a fixed scale, shrinking the
viewport to 360 × 400 changed the default detached-canvas budget to
6,912,000 pixels. All three browsers previously kept 19,388,160 pixels.
They now keep 5,816,448 (74.0 → 22.2 MiB at four bytes per pixel), with
zero visible blank area and full measured sharpness. Pages evicted by
the smaller budget will need drawing again on a later visit.

During a 1× → 4× → 1× temporary zoom in the same physical viewport, using
the transformed visible area for the budget prematurely discarded 90% of
the kept pixels (19,388,160 → 1,938,816). Using the physical scroller size
kept all 19,388,160 and restored the previous page immediately, with zero
detail redraws instead of three. A real resize still freed the same pixels.
All results matched in three pairs per browser; this check measured counts.

### Printing

Three pairs printed the six-page feature fixture at 36 dpi with a filled form
field and 1,000 additional storage values. Each sheet’s decoded RGBA digest
matched between builds in each browser. Every print job took one snapshot,
down from six. Lower resolution isolates the overhead on this small fixture.

| Browser | Snapshot time, ms | Total print preparation, ms |
| --- | ---: | ---: |
| Chromium | 7.4 → 1.6 | 31.4 → 25.4 |
| WebKit | 9.3 → 2.4 | 56.4 → 34.3 |
| Firefox | 9.4 → 1.9 | 35.4 → 20.1 |

### Page planning, zoom and search navigation

Five pairs per browser exercised the pure planner with the same mounted slots
and viewport. With no total pixel limit, planning no longer reads the current
canvas sizes (18 reads for six mounted pages and 510 for 170 before the
change). With 32 visible pages and a finite budget, visible area is computed
once per page for the plan. Zoom previews used a 1,000-page mixed-size
document in single-page mode and checked the scroll target against a full
layout. The search navigation probe made 200 alternating moves on the 110-page
bill with 27,312 matches and checked selected DOM ranges, including wrapping
from the first to the last page.

| Work per sample | Chromium | WebKit | Firefox |
| --- | ---: | ---: | ---: |
| Plan, six mounted pages, µs | 0.596 → 0.262 | 0.612 → 0.345 | 0.728 → 0.445 |
| Plan, 32 visible pages, finite budget, µs | 59.8 → 14.8 | 62.2 → 10.4 | 76.4 → 9.1 |
| 400 single-page zoom previews, ms | 6.21 → 0.21 | 6.28 → 0.30 | 4.70 → 0.32 |
| 200 next/previous match selections, ms | 1.30 → 0.44 | 77.12 → 76.24 | 17.34 → 16.40 |

The initial working build predated the one-pass insertion of page hosts
subsequently included in decision 0051. With 170 pages of overscan,
jumping between the two ends of the document
replaced 171–172 page hosts. Searching for their insertion points took
342–344 map lookups, down from 14,707–14,879, and preserved DOM order in
both directions. The full synchronous jump took 4.37 → 4.23 ms in Chromium,
10.14 → 10.01 ms in WebKit and 7.30 → 7.47 ms in Firefox. The reduction in lookups had only a small
effect on total elapsed time.

### Integrated scroll

Three pairs compared the v0.9.1 demo with the combined changes, including
the physical viewport correction. The 1,000-page text fixture scrolled nine
pages in four seconds at 3,600 CSS pixels/s. The median React commits fell
from 25 to 11 in each browser. Median blank frames stayed at zero and page
canvases at 111.1 MiB. Other browser workloads on the host prevented an
isolated three-browser run. This supplementary comparison used
`ALLOW_PARALLEL=1`; its timing differences are observations under that load.

| Browser | First paint, ms | Blocked time, ms | Dropped frames |
| --- | ---: | ---: | ---: |
| [Chromium](../../examples/prototype/results/scroll-integrated-page-work-chromium.md) | 176 → 177 | 12.6 → 13.5 | 0 → 0 |
| [WebKit](../../examples/prototype/results/scroll-integrated-page-work-webkit.md) | 238 → 267 | 8.8 → 3.6 | 0 → 0 |
| [Firefox](../../examples/prototype/results/scroll-integrated-page-work-firefox.md) | 396 → 407 | 212.3 → 144.3 | 4 → 1 |

An [isolated Chromium comparison](../../examples/prototype/results/scroll-page-work-chromium.md)
started with the work-in-progress 0051 build and ended before the physical
viewport correction. Both builds had 11 commits, 111.1 MiB of canvases and
zero blank or dropped frames. Median first paint was 176 → 193 ms across
three pairs. These runs establish no consistent first-paint improvement.

## Where the bounds apply

At 1280 × 900 and DPR 2 a single full-viewport RGBA buffer contains 17.6 MiB
of samples. The viewer also holds page margins, overscan, recently visited
pages and sometimes both resolutions during zoom. Those pixels buy instant
returns and prevent blank frames. A smaller cache can release them earlier at
the cost of drawing pages again. The two documents and 4-second scrolls in
decision 0051 had zero median blank frames, zero or one dropped frame per
scroll, and 111–183 MiB of page canvases. First paint still includes loading
pdf.js, opening the document, rasterizing a page and waiting for a display
frame. No general lower bound for that elapsed time follows from these runs.

The displayed page window is bounded by the viewport and overscan. Exact
geometry for mixed-size documents still takes O(page count) space and work
with the current pdf.js API. A first full-document search must read all the
text and ParaPDF keeps the index for later searches. Single-page zoom previews
and active-range selection now take constant work with respect to document
length. The three search columns trade direct access for space. Encoding
runs of consecutive offsets could store fewer bytes but would add decoding
or an additional lookup structure. Neither canvas pixel counts nor index
byte counts measure total resident or GPU memory.

## Reopen if

- Large scanned documents show frequent expensive redraws after thumbnail
  eviction, or real iOS devices exceed their canvas budget during these workloads.
- A different index representation reduces retained memory on dense documents
  with comparable index construction and source-position lookup costs.
