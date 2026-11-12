# 0027. Ship pdf.js 6.5.438 with opt-in worker drawing

- Status: adopted
- Date: 2026-11-12

## Decision

Upgrade from 6.4.299 to 6.5.438. Keep GPU-backed main-thread drawing as
the default. Applications can enable the matching bundled modern or legacy
drawing worker with `configurePdfjs({ rendererSrc: true })`. The existing
string option takes an application's own URL. A local copy under
`assetBase` includes both workers. pdf.js falls back to main-thread
drawing where worker rendering is unavailable.

## Evidence

The engine benchmark on an M2 Pro (AC power) compared released 6.5.438
with and without its renderer in fresh contexts, three runs, the first two
pages at scale 2.6667. All three browsers used the worker. The five pages
across the scan, bill, and JPX image had identical full-resolution pixel
hashes in both modes in each browser. The packaged-asset checks open the
LZW-wrapped JPEG 2000 fixture under a same-origin worker policy and verify
that its center is red, using the modern and legacy builds.

Median main-thread blocked time in ms, ordinary drawing → worker:

| Document | Chromium 156 | Playwright WebKit 27.2 | Firefox 157 |
|---|---:|---:|---:|
| Scanned patent | 0.1 → 32.2 | 0.2 → 17.8 | 13.7 → 4.9 |
| Bill with text and knockout groups | 15.2 → 0.0 | 0.6 → 0.0 | 30.5 → 4.4 |

The scan's first page appeared 18 ms later in Chromium and 28 ms later
in WebKit. The worker improved Firefox's first page on the scan by 8 ms.
The extra modern worker is 119 KiB (35 KiB gzip) and is fetched only
when enabled. The runtime scroll comparison tracks mounted and kept
canvas bytes. It does not measure the worker process's private memory.

The default runtime on the new and previous releases was also measured
job by job, three runs per file and browser. Both crossed a page with
zero median blank area and the same settled canvas budgets (147 MiB for
the bill and 144 MiB for the scan). First paint and blocked time varied
in both directions. The release fixes the JPX image and makes the worker
available to applications that benefit from it.

[Engine results](../../bench/results/release65-browsers.md).
[Chromium fidelity](../../bench/results/release65-fidelity-chromium.md),
[WebKit fidelity](../../bench/results/release65-fidelity-webkit.md),
[Firefox fidelity](../../bench/results/release65-fidelity-firefox.md).
[Chromium scroll](../../examples/prototype/results/release65-chromium.md),
[WebKit scroll](../../examples/prototype/results/release65-webkit.md),
[Firefox scroll](../../examples/prototype/results/release65-firefox.md).

To repeat, generate the corpus and build the engine benchmark. For each
browser run the following with `BROWSER` set:

```sh
FILES=patent-us223898.pdf,bill-hr815.pdf,pdfium-jpx-lzw.pdf \
  PAGES=2 RUNS=3 ENGINES=pdfjs-hwa,pdfjs-hwa-renderer OUTPUT=release65- pnpm bench
FILES=pdfium-jpx-lzw.pdf,patent-us223898.pdf,bill-hr815.pdf \
  PAGES=2 PAIRS=pdfjs-hwa:pdfjs-hwa-renderer OUTPUT=release65- node bench/scripts/fidelity.ts
```

For the scroll runs, build the prototype from 7d07e1c and this change in
separate directories. Set `BEFORE` and `DIST` to their respective build
directories, `BEFORE_LABEL=6.4.299`, and use the settings in the scroll
reports.

## Reopen if

A release reduces the worker's cost for scanned pages in Chromium and
WebKit, or new measurements change the trade-off on representative devices.
