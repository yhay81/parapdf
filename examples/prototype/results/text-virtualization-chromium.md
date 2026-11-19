# Text-layer virtualization evaluation (chromium 159.0.8154.6)

- Run at: 2026-11-19T07:07:16.540Z
- Machine: darwin 27.2.0 arm64, Apple M2 Pro (12 logical cores); power: AC; one-minute load average 3.8 → 5; waited 0 times (0 min in all) for other Playwright browsers or a load average above 8 and repeated 0 jobs that another browser overlapped
- Viewport: 1280×900 at devicePixelRatio 2, fit-width zoom, vertical scroll, annotation layers off, maxCanvasPixels 25165824 (24 MP), median of 3 runs.
- Versions: pdfjs-dist 6.5.438.
- Reproduce: `pnpm --filter @parapdf/prototype build && BROWSER=chromium RUNS=3 OUTPUT=text-virtualization-chromium node examples/prototype/scripts/text-virtualization-bench.ts`

## Browser behavior checks

- `hidden="until-found"`: `onbeforematch`=true, computed `display`=`block`, `contentVisibility`=`hidden`, `window.find()` matches hidden=true, `selectAllChildren()` includes hidden=false.
- Line-wrapped phrases: `window.find("parapdfhyphenprobe")` across `<span>parapdf-</span><br><span>hyphenprobe</span>`=false; `window.find("パラPDF検索検証九八四")` across `<span>パラＰＤＦ</span><br><span>検索検証九八四</span>`=false.
- `bill-hr815.pdf` (110 pages): `getText(session)`=85.8 ms (300678 chars); `findText(session, "appropriations")`=60.8 ms (74 matches).
- Cross-window DOM Selection: anchor lost when page 1 unmounts=true; pinning only endpoint pages (1 and 10) silently drops unmounted pages 2–7=true (8694 chars copied vs 24808 chars across 10 pages from `getText(session, { from, to })` in 1.21 ms).

## bill-hr815.pdf

| Strategy | First paint (ms) | Text ready (ms) | Mounted / text layers | `.parapdf-pages` nodes (spans) | AX regions (AX tree nodes / ms) | JS heap (MiB) | Select-all (ms / chars) | Zoom 2× commit (ms) | Scroll blocked / max lag (ms) | Dropped frames | Scroll React commits |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| virtualized | 138.7 | 227 | 3 / 3 | 1314 (572) | 3 (1629 / 23.8) | 4.4 | 0.32 / 7503 | 24.3 | 30.7 / 10.7 | 0 / 123 | 10 |
| bounded-20 | 138.4 | 333.2 | 21 / 21 | 10256 (4542) | 21 (11348 / 154.1) | 5 | 2.65 / 56748 | 27.7 | 36.3 / 11.9 | 0 / 123 | 8 |
| until-found | 156.9 | 333.2 | 3 / 3 | 1528 (572) | 3 (2448 / 34.9) | 5.2 | 0.88 / 7503 | 23.2 | 27.3 / 12.2 | 0 / 122 | 9 |
| all-text | 138.4 | 849.3 | 110 / 110 | 50818 (22102) | 110 (44720 / 672) | 6.2 | 13.38 / 300460 | 57.1 | 67.1 / 12.3 | 0 / 122 | 4 |

## synthetic-text-1000.pdf

| Strategy | First paint (ms) | Text ready (ms) | Mounted / text layers | `.parapdf-pages` nodes (spans) | AX regions (AX tree nodes / ms) | JS heap (MiB) | Select-all (ms / chars) | Zoom 2× commit (ms) | Scroll blocked / max lag (ms) | Dropped frames | Scroll React commits |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| virtualized | 176.8 | 240.4 | 3 / 3 | 500 (159) | 3 (624 / 11.4) | 4.8 | 0.17 / 12192 | 15.4 | 28.5 / 12.3 | 0 / 122 | 11 |
| bounded-20 | 161.5 | 301.1 | 21 / 21 | 3488 (1113) | 21 (2826 / 46.2) | 5.5 | 0.81 / 83456 | 16.2 | 48.4 / 15.5 | 0 / 122 | 8 |
| until-found | 177.4 | 1193.5 | 3 / 3 | 2494 (159) | 3 (1621 / 26.9) | 10.1 | 0.81 / 12192 | 15.9 | 37.6 / 14.4 | 0 / 122 | 11 |
| all-text | 177.3 | 3403.9 | 1000 / 1000 | 166002 (53000) | 1000 (110076 / 2083.6) | 15.1 | 41.95 / 3982283 | 150.9 | 174.2 / 30 | 0 / 123 | 4 |
