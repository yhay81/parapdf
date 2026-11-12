# 0029. WebGPU drawing of mesh shadings is opt-in

- Status: adopted
- Date: 2026-11-12

## Decision

Keep pdf.js's default CPU rasterization for mesh shadings. Applications
that open documents with mesh gradients can set
`configurePdfjs({ documentOptions: { enableWebGPU: true } })`. The option
reaches pdf.js 6.5.438 directly. ParaPDF declares it in TypeScript because
this release reads it in `getDocument()` but omits it from the public types.

## Evidence

None of the 11 bundled PDFs had a mesh shading. For this comparison the
generator makes two Letter pages with the same RGB gradient, one with
128 triangles and one with 8,192. In fresh contexts on an M2 Pro on AC
power, five runs per file and setting compared the shipped GPU-backed
canvas with the same canvas and `enableWebGPU` enabled at scale 2.6667.

| Browser | Blocked ms, 128 triangles (off → on) | Blocked ms, 8,192 triangles | First visible ms, 8,192 triangles |
|---|---:|---:|---:|
| Chromium 156 | 20.3 → 0.0 | 22.5 → 0.0 | 49.7 → 50.1 |
| Playwright WebKit 27.2 | 14.0 → 1.1 | 20.0 → 2.6 | 69.4 → 55.5 |
| Firefox 157 | 28.2 → 31.5 | 34.8 → 31.8 | 67.7 → 66.6 |

The fidelity run counts `GPURenderPassEncoder.draw()` separately from
the timings. Chromium and WebKit each issued two GPU draws per fixture,
one for the first render and one for the warm repeat. Their full-page
pixel hashes differed from CPU rasterization. On the 256 px wide samples,
the largest RGB channel difference was 2/255 on both pages in both
browsers. Firefox used the CPU fallback and gave identical full-page
hashes. Its timings do not measure GPU rasterization.

With the option enabled, pdf.js requests a GPU adapter and device when
opening the first document, including documents without meshes. The
two controls (the bill and the scanned patent) had first-page presentation
times within 1 ms of the baseline in every browser. In Chromium median
document-open time rose from 3.0 to 6.4 ms on the bill and from 3.1 to
4.1 ms on the scan. Applications with mesh-heavy files can take the
measured reduction in main-thread stalls without imposing that startup
work on other readers.

[Mesh timings](../../bench/results/mesh-browsers.md).
[Control timings](../../bench/results/mesh-controls-browsers.md).
[Chromium fidelity](../../bench/results/mesh-fidelity-chromium.md),
[WebKit fidelity](../../bench/results/mesh-fidelity-webkit.md),
[Firefox fidelity](../../bench/results/mesh-fidelity-firefox.md).

Generate the corpus with `pnpm --filter @parapdf/bench corpus` and build
with `pnpm bench:build`. For each browser, set `BROWSER` and run:

```sh
FILES=synthetic-mesh-sparse.pdf,synthetic-mesh-dense.pdf PAGES=1 RUNS=5 \
  ENGINES=pdfjs-hwa,pdfjs-hwa-webgpu OUTPUT=mesh- pnpm bench
FILES=synthetic-mesh-sparse.pdf,synthetic-mesh-dense.pdf PAGES=1 \
  PAIRS=pdfjs-hwa:pdfjs-hwa-webgpu OUTPUT=mesh- node bench/scripts/fidelity.ts
FILES=bill-hr815.pdf,patent-us223898.pdf PAGES=2 RUNS=5 \
  ENGINES=pdfjs-hwa,pdfjs-hwa-webgpu OUTPUT=mesh-controls- pnpm bench
```

## Reopen if

pdf.js initializes WebGPU only when a mesh is present, or measurements on
real mesh-heavy documents and additional devices support enabling it by default.
