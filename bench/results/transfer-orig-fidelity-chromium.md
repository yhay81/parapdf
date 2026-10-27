# Frame display fidelity: Chromium 156.0.8078.4

- Run at: 2026-10-27T17:15:17.727Z
- Method: the first 10 pages of each file at scale 2.6667, read back from the displayed canvas through a 2D canvas after each render, in a fresh page per engine. Identical means the same size and the same SHA-256 of every pixel. Pages that differ are compared on 256 px wide samples: the largest channel difference, the share of sample pixels off by more than 16, and the box around them as shares of the page (left top right bottom). bench/results/raw/ keeps each such page's samples and a mask of those pixels.
- Reproduce: `pnpm bench:build && BROWSER=chromium node bench/scripts/fidelity.ts`

| File | Engine | Variant | Identical pages | Differing pages (largest difference, share off, where) |
|---|---|---|---:|---|
| patent-us223898.pdf | pdfjs-hwa | pdfjs-next-hwa | 4/4 | — |
| patent-us223898.pdf | pdfjs | pdfjs-next | 0/4 | p1 (23, 0.01% in 0.289 0.117 0.859 0.856), p2 (23, 0.03% in 0.164 0.229 0.855 0.816), p3 (21, 0.03% in 0.125 0.125 0.84 0.62), p4 (22, 0.04% in 0.195 0.136 0.777 0.691) |
| bunka-kokugo-series-019-p4.pdf | pdfjs-hwa | pdfjs-next-hwa | 1/1 | — |
| bunka-kokugo-series-019-p4.pdf | pdfjs | pdfjs-next | 0/1 | p1 (28, 0.19% in 0.121 0.193 0.867 0.892) |
| pdfium-jpx-lzw.pdf | pdfjs-hwa | pdfjs-next-hwa | 0/1 | p1 (255, 100.0% in 0 0 1 1) |
| pdfium-jpx-lzw.pdf | pdfjs | pdfjs-next | 0/1 | p1 (255, 100.0% in 0 0 1 1) |
| bill-hr815.pdf | pdfjs-hwa | pdfjs-next-hwa | 10/10 | — |
| bill-hr815.pdf | pdfjs | pdfjs-next | 10/10 | — |
