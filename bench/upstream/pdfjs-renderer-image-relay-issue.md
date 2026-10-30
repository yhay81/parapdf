# pdf.js's renderer worker clones image bitmaps on the main thread

The investigation behind issue #17: why scanned PDFs stall the main thread
in Chromium and WebKit with pdf.js master's renderer worker, when released
pdf.js, drawing on the main thread, hardly blocks it. The draft report for
pdf.js is at the end; it has not been filed.

ParaPDF ships pdfjs-dist 6.4.299, which has no renderer worker, so its
users do not meet this today. It matters for the open question in
`docs/architecture.md` on moving to the renderer worker once it is released.

## Reproduction

`pnpm bench` with `ENGINES=pdfjs,pdfjs-hwa,pdfjs-next,pdfjs-next-hwa` on
patent-us223898.pdf (four pages of scanned images) and
bunka-kokugo-series-019-p4.pdf (one scanned page), first 10 pages at
scale 2.67, 3 runs, 2026-10-28, macOS on an Apple M2 Pro, Playwright's
Chromium 156, WebKit 27.2, and Firefox 157; pdfjs-dist 6.4.299 and pdf.js
master 157d30e83 (`bench/results/scans-*.md`). Main thread blocked, ms:

| File | Browser | pdfjs | pdfjs-hwa | pdfjs-next | pdfjs-next-hwa |
|---|---|---:|---:|---:|---:|
| patent-us223898 | Chromium | 4 | 1 | 109 | 74 |
| bunka-kokugo | Chromium | 10 | 0 | 81 | 73 |
| patent-us223898 | WebKit | 1 | 0 | 45 | 40 |
| bunka-kokugo | WebKit | 43 | 0 | 81 | 79 |
| patent-us223898 | Firefox | 76 | 94 | 53 | 34 |
| bunka-kokugo | Firefox | 32 | 26 | 17 | 19 |

The longest event-loop stall with the renderer worker is 26 to 78 ms in
Chromium and 34 to 87 ms in WebKit.

## Where the time goes

`bench/scripts/trace-main-thread.ts` runs a benchmark job in Chromium under
a performance trace and sums the self time of the events inside the main
thread's tasks longer than 8 ms (raw traces in `bench/results/raw/traces`,
not committed). With `pdfjs-next-hwa`:

| File | Long tasks | Serializing (`SerializedScriptValueFactory::create`) | GPU wait (`WaitForGetOffset`) | Readback (`ReadbackImagePixels`) |
|---|---|---:|---:|---:|
| patent-us223898 | 4, 69 ms | 32.6 ms | 24.6 ms | 11.2 ms |
| bunka-kokugo | 1, 47 ms | 17.4 ms | 22.3 ms | 7.0 ms |

`pdfjs-hwa` has one long task of 10 to 12 ms per document, the canvas's
GPU set-up. Almost no script runs in the long tasks: the main thread is
serializing a message, and reading pixels back from the GPU to do so.

The message is the decoded image. The parsing worker draws each image into
an `OffscreenCanvas` and sends the `ImageBitmap` to the main thread
(transferred). In `api.js`, the main thread's `"obj"` handler stores it
(`objectHandler.resolveObject`) and passes the same data on to the
renderer worker (`rendererWorker.sendObj`), which posts it without a
transfer list. Posting an `ImageBitmap` without transferring it clones it;
Chromium and WebKit clone a GPU-backed bitmap by reading its pixels back
and copying them into the message, on the main thread, for every image.

## Confirming it

A copy of pdf.js master's `build/generic/build/pdf.mjs`, changed in one
line so that `RendererWorkerProxy`'s `#sendObj` passes the bitmap in the
transfer list (`send(action, data, data[3]?.bitmap ? [data[3].bitmap] :
undefined)`), was built into the benchmark next to the unchanged one and
both were measured in turn, twice, in each browser
(`bench/results/transfer-{orig,transfer}-r{1,2}-*.md`). Main thread
blocked, ms, unchanged → transfer, the two rounds:

| File | Browser | pdfjs-next | pdfjs-next-hwa | pdfjs-hwa (control) |
|---|---|---|---|---|
| patent-us223898 | Chromium | 143, 106 → 7, 6 | 120, 111 → 0, 0 | 1, 0 → 0, 0 |
| bunka-kokugo | Chromium | 124, 81 → 4, 2 | 141, 72 → 0, 0 | 0, 0 → 0, 0 |
| patent-us223898 | WebKit | 70, 47 → 6, 18 | 79, 63 → 0, 2 | 0, 2 → 1, 1 |
| bunka-kokugo | WebKit | 68, 96 → 0, 0 | 77, 73 → 1, 0 | 0, 1 → 0, 1 |
| patent-us223898 | Firefox | 22, 30 → 39, 4 | 32, 18 → 4, 6 | 32, 44 → 59, 39 |
| bunka-kokugo | Firefox | 10, 12 → 1, 1 | 10, 12 → 1, 3 | 39, 25 → 26, 23 |

- The longest stall with `pdfjs-next-hwa` falls from 54 to 143 ms to 1.3
  to 2.2 ms in Chromium and from 37 to 82 ms to 4.7 to 5.9 ms in WebKit.
- The first page shows sooner: `pdfjs-next-hwa` on bunka-kokugo 333 and
  233 → 150 and 117 ms in Chromium, 350 and 367 → 198 and 249 ms in
  WebKit.
- Firefox, which blocked less to begin with, drops to a few ms too.
- What is drawn does not change: `bench/scripts/fidelity.ts` comparing
  `pdfjs-hwa` with `pdfjs-next-hwa`, and `pdfjs` with `pdfjs-next`, on
  both scans, bill-hr815.pdf, and pdfium-jpx-lzw.pdf gives the same rows
  with either build in Chromium and WebKit
  (`bench/results/transfer-*-fidelity-*.md`; pdfium-jpx-lzw.pdf differs
  between the engines in both, independently of the change).

Transferring detaches the main thread's copy. That is safe only where the
main thread never draws the image itself; a fix upstream has to decide
that (or keep no main-thread copy, or route images from the parsing worker
to the renderer worker directly), which is why this is a report rather
than a patch.

## What ParaPDF does

Nothing in its code: ParaPDF does not patch pdf.js (decision 0001), and
the shipped pdf.js has no renderer worker. When the renderer worker ships,
this is the first thing to measure (`docs/architecture.md`, open questions), and the
check that the report's fix landed: rerun the scans with
`ENGINES=pdfjs-hwa,pdfjs-next-hwa` and see `pdfjs-next-hwa`'s blocked time
near `pdfjs-hwa`'s.

## Draft report for pdf.js (not filed)

> **Renderer worker: image bitmaps are cloned on the main thread when relayed**
>
> With the renderer worker (master 157d30e83), scanned PDFs block the main
> thread for 40 to 140 ms per document in Chromium and WebKit, against
> 0 to 2 ms when the same pages are drawn on the main thread with
> `enableHWA`. A Chromium trace attributes the long tasks to
> `SerializedScriptValueFactory::create`, `ReadbackImagePixels`, and GPU
> waits, not to script.
>
> In `src/display/api.js`, the `"obj"` handler stores the image the worker
> sent and forwards it with `this.rendererWorker?.sendObj(...)`, and
> `RendererWorkerProxy.#sendObj` posts it without a transfer list, so the
> `ImageBitmap` is structured-cloned; Chromium and WebKit read a
> GPU-backed bitmap back to clone it.
>
> Passing the bitmap as a transferable in `#sendObj` removes the blocking
> (Chromium 72 to 141 ms → 0 ms, WebKit 63 to 79 ms → 0 to 2 ms, first
> page up to twice as fast) with identical rendering in our tests, but it
> detaches the main thread's copy. If the main thread never needs the
> image once a renderer worker exists, it could transfer it and keep
> none; otherwise the parsing worker could send images to the renderer
> worker directly over a `MessageChannel`.
>
> Steps: open a scanned PDF (e.g. any page-sized JPEG) with the renderer
> worker, record a performance trace in Chrome, and look at the main
> thread's long tasks while pages render.
