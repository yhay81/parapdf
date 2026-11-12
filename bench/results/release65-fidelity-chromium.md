# Frame display fidelity: Chromium 156.0.8078.4

- Run at: 2026-11-12T14:10:43.525Z
- Method: the first 2 pages of each file at scale 2.6667, read back from the displayed canvas through a 2D canvas after each render, in a fresh page per engine. Identical means the same size and the same SHA-256 of every pixel. Pages that differ are compared on 256 px wide samples: the largest channel difference, the share of sample pixels off by more than 16, and the box around them as shares of the page (left top right bottom). bench/results/raw/ keeps each such page's samples and a mask of those pixels.
- Reproduce: `pnpm bench:build && BROWSER=chromium node bench/scripts/fidelity.ts`

| File | Engine | Variant | Identical pages | Differing pages (largest difference, share off, where) |
|---|---|---|---:|---|
| pdfium-jpx-lzw.pdf | pdfjs-hwa | pdfjs-hwa-renderer | 1/1 | — |
| patent-us223898.pdf | pdfjs-hwa | pdfjs-hwa-renderer | 2/2 | — |
| bill-hr815.pdf | pdfjs-hwa | pdfjs-hwa-renderer | 2/2 | — |
