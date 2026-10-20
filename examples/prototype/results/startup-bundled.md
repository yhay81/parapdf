# ParaPDF runtime prototype: first paint with pdf.js in the package

- Run at: 2026-10-20
- Machine: darwin 27.0.0 arm64, Apple M2 Pro (12 logical cores); Chromium 156.0.8078.4 (Playwright build, headless); power: AC.
- Method: `scripts/scroll-bench.ts` with `VARIANTS=pdfjs-hwa`, `SPEEDS=900`, `DURATION=500`, `RUNS=1`, and `MAX_LOAD=10`, run once per setup in turn, five times over, so that changes in the machine's load hit every setup of a run alike. First paint is the time from navigation start until page 1 shows pixels; the tables give the median of the five and their range. Compare setups within a run: 0.2.0 with a preload showed 824 and 766 ms in run A and 846 and 777 ms in run B.
- Throttled: `LATENCY=100 BANDWIDTH=20`, 100 ms added to every request and 20 Mbit/s, through the DevTools protocol. The preview server compresses nothing, so the worker is 1.26 MB on the wire, where a server with brotli sends 308 KB.
- ParaPDF: this branch's demo, which configures nothing: the first `PdfDocument` loads pdf.js, starts the shipped worker, and preloads the PDF; pdf.js (110 KB with brotli) stays out of the bundle that renders the page.
- 0.2.0: the 0.2.0 demo changed for this measurement to set ParaPDF up as 0.2.0's README did: pdf.js imported statically, in the main bundle, and the engine, which starts the worker, created when the module runs. The demo itself loads the engine lazily and waits for it in a Suspense boundary, which held page 1 back on localhost: 428 instead of 157 ms on bill-hr815, probably React's throttling of Suspense reveals.
- 0.2.0 with a preload: the same, and the PDF preloaded with React's `preload()`, as the 0.2.0 demo did; 0.2.0's README did not ask applications for it.

## Throttled network, run A

A run of all three setups, ParaPDF with its list of shipped files in a chunk of its own, imported with pdf.js, so that the worker started a round trip later.

| Setup | bill-hr815.pdf (ms) | bunka-kokugo-series-019-p4.pdf (ms) |
|---|---:|---:|
| ParaPDF, file list in its own chunk | 835 (812–846) | 782 (749–789) |
| 0.2.0 with a preload | 824 (812–844) | 766 (763–771) |
| 0.2.0 | 964 (914–983) | 903 (867–920) |

One-minute load average at the start of the jobs: 1.9–2.4.

## Throttled network, run B

ParaPDF as it ships, with the file list in its main module so that the worker starts at once, against 0.2.0 with a preload.

| Setup | bill-hr815.pdf (ms) | bunka-kokugo-series-019-p4.pdf (ms) |
|---|---:|---:|
| ParaPDF | 849 (815–850) | 783 (778–787) |
| 0.2.0 with a preload | 846 (831–851) | 777 (767–802) |

One-minute load average at the start of the jobs: 2.2–5.3.

## Localhost

Run A's setups without throttling.

| Setup | bill-hr815.pdf (ms) | bunka-kokugo-series-019-p4.pdf (ms) |
|---|---:|---:|
| ParaPDF, file list in its own chunk | 172 (137–174) | 176 (174–211) |
| 0.2.0 with a preload | 157 (156–159) | 195 (195–196) |
| 0.2.0 | 158 (154–175) | 194 (194–196) |

One-minute load average at the start of the jobs: 1.6–2.3.
