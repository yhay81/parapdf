# Frame display fidelity: WebKit 27.2

- Run at: 2026-10-27T17:15:48.240Z
- Method: the first 10 pages of each file at scale 2.6667, read back from the displayed canvas through a 2D canvas after each render, in a fresh page per engine. Identical means the same size and the same SHA-256 of every pixel. Pages that differ are compared on 256 px wide samples: the largest channel difference, the share of sample pixels off by more than 16, and the box around them as shares of the page (left top right bottom). bench/results/raw/ keeps each such page's samples and a mask of those pixels.
- Reproduce: `pnpm bench:build && BROWSER=webkit node bench/scripts/fidelity.ts`

| File | Engine | Variant | Identical pages | Differing pages (largest difference, share off, where) |
|---|---|---|---:|---|
| patent-us223898.pdf | pdfjs-hwa | pdfjs-next-hwa | 4/4 | — |
| patent-us223898.pdf | pdfjs | pdfjs-next | 4/4 | — |
| bunka-kokugo-series-019-p4.pdf | pdfjs-hwa | pdfjs-next-hwa | 1/1 | — |
| bunka-kokugo-series-019-p4.pdf | pdfjs | pdfjs-next | 1/1 | — |
| pdfium-jpx-lzw.pdf | pdfjs-hwa | pdfjs-next-hwa | 0/1 | p1 (255, 100.0% in 0 0 1 1) |
| pdfium-jpx-lzw.pdf | pdfjs | pdfjs-next | 0/1 | p1 (255, 100.0% in 0 0 1 1) |
| bill-hr815.pdf | pdfjs-hwa | pdfjs-next-hwa | 10/10 | — |
| bill-hr815.pdf | pdfjs | pdfjs-next | 10/10 | — |
