# 0053. Give mounted page sections and display preloading explicit owners

- Status: adopted
- Date: 2026-11-20

## Decision

The viewer computes the mounted page window. Its `PageHosts` applies that
window to the viewport, in page order, before the renderer plans the next
drawings. It owns each section, its accessible label, and notifications for
overlays that follow the page. The viewer handles focus transitions, and the
renderer owns the PDF layers and canvases inside a section. Geometry and
selection tests use the sections created by attaching the viewport.

The registry starts a session's layout reads when the document opens and
waits for permissions before publishing the ready state. `DocumentSession`
owns the list of speculative reads. Cold viewer startup and explicit
preloading can also request display layers while the first layout proceeds.
An explicit preload warms page labels, initial view, and requested destinations.

## Evidence

The first extraction checked the mounted range inside `PageHosts.sync()` on
every frame. In five paired runs, WebKit's median blocked time over two
seconds moved from 32 to 39 ms. One idle Chromium process from a separate
project was excluded from the runner's overlap check. A seven-run repeat
with the build order reversed under concurrent load moved from 34 to 41 ms.
The final viewer checks its existing window before calling `sync()`, so the
page host manager only receives a frame update when the window or layout
changes.

The final comparison used `be14a63` and that commit plus this refactor,
seven runs per build and browser on AC power. The focused viewport scrolled
`bill-hr815.pdf` at 3,600 CSS px/s for two seconds. Each run of the changed
build was followed by a run of the baseline. Other browser workloads on the machine
prevented exclusive measurement, so this run used `ALLOW_PARALLEL=1`.
The reports include individual first-paint timings and load averages.

| Browser | First paint, before → after (ms) | Main thread blocked, before → after (ms) | Canvas memory, before → after (MiB) |
| --- | ---: | ---: | ---: |
| [Chromium](../../examples/prototype/results/scroll-page-hosts-chromium.md) | 165 → 175 | 6 → 14 | 118 → 118 |
| [WebKit](../../examples/prototype/results/scroll-page-hosts-webkit.md) | 199 → 187 | 39 → 30 | 226 → 226 |
| [Firefox](../../examples/prototype/results/scroll-page-hosts-firefox.md) | 289 → 257 | 27 → 44 | 118 → 118 |

Both builds showed zero measured blank area in every browser. The variation
under concurrent load limits timing conclusions. The ownership change is
adopted for its single page lifecycle and smaller controller.

Browser checks exercised overlays, warm opens, and React StrictMode, as well
as detaching one of two viewers sharing a document. Unit tests also cover
layer reads that remain pending after the first layout.

## Reopen if

Repeated measurements tie a scroll or first-paint regression to the page
window update or to the order in which document data is requested.
