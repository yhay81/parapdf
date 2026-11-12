# Rendering fidelity: Chromium 156.0.8078.4

- Run at: 2026-11-12T14:41:19.603Z
- Engines: pdfjs-hwa (pdfjs-dist 6.5.438), pdfjs-hwa-webgpu (pdfjs-dist 6.5.438)
- Method: the first 1 pages of each file at scale 2.6667, read back from the displayed canvas through a 2D canvas after each render, in a fresh page per engine. Identical means the same size and the same SHA-256 of every pixel. Pages that differ are compared on 256 px wide samples: the largest channel difference, the share of sample pixels off by more than 16, and the box around them as shares of the page (left top right bottom). bench/results/raw/ keeps each such page's samples and a mask of those pixels.
- Reproduce: `pnpm bench:build && BROWSER=chromium FILES=synthetic-mesh-sparse.pdf,synthetic-mesh-dense.pdf PAGES=1 SCALE=2.6667 PAIRS=pdfjs-hwa:pdfjs-hwa-webgpu OUTPUT=mesh- node bench/scripts/fidelity.ts`

| File | Engine | Variant | Identical pages | Differing pages (largest difference, share off, where) |
|---|---|---|---:|---|
| synthetic-mesh-sparse.pdf | pdfjs-hwa | pdfjs-hwa-webgpu (2 WebGPU draws) | 0/1 | p1 (2, 0.00%) |
| synthetic-mesh-dense.pdf | pdfjs-hwa | pdfjs-hwa-webgpu (2 WebGPU draws) | 0/1 | p1 (2, 0.00%) |
