# Cold client opens at fit-width

Each sample navigated a fresh browser context to a production build. The previous viewer is revision `7f05380`. The adopted viewer gives spare opening capacity to one neighboring base preview. The direct reference draws one full-resolution page with the same packaged pdf.js loader. The benchmark checks SHA-256 and dimensions of each first page at full resolution and of the two viewers' initial rasters. [Decision 0054](../../../docs/decisions/0054-first-visible-drawing.md) · [Benchmark](../scripts/startup-bench.ts)

First drawing, sharp page 1 and unprompted page 2 are measured from navigation until the completed canvas is exposed in the DOM. The table retains the order of first-drawing samples. Canvas storage counts four bytes per pixel of every attached nonempty canvas, including canvases still drawing. It excludes internal pdf.js, GPU and compositor allocations.

## Chromium 159.0.8154.6 at 820 × 900

2026-11-20, darwin 27.2.0 arm64, Apple M2 Pro, pdf.js 6.5.438, DPR 2, AC power. Load average 8.7 to 8.0. The run recorded 0 waits and repeated 0 jobs for browser overlap. Median idle frame interval 16.7 ms.

| PDF | Draw | First drawing in run order (ms) | Sharp page 1 (ms) | Page 2 drawing (ms) | Sharp page 2 (ms) | Canvas at first draw (MiB, range) | GetPage / GetOperatorList at first draw (range) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| HR 815 | Previous viewer | 147, 147, 164, 151, 147, 146, 148, 164, 147 | 147 | 140 | 140 | 43.51 | 3 / 3 |
| HR 815 | Adopted viewer | 167, 151, 149, 148, 148, 151, 217, 149, 151 | 151 | 142 | 163 | 15.41 | 2 / 2 |
| HR 815 | Direct pdf.js | 128, 128, 126, 125, 127, 126, 111, 126, 110 | 126 | — | — | 14.50 | 1 / 1 |
| 1,000-page text | Previous viewer | 162, 159, 160, 178, 161, 162, 275, 160, 159 | 161 | 163 | 163 | 25.02 | 2 / 2 |
| 1,000-page text | Adopted viewer | 160, 159, 159, 180, 162, 162, 160, 160, 193 | 160 | 162 | 175 | 13.29 | 2 / 2 |
| 1,000-page text | Direct pdf.js | 147, 147, 160, 146, 177, 143, 144, 144, 143 | 146 | — | — | 12.51 | 1 / 1 |
| Scanned patent | Previous viewer | 193, 190, 226, 173, 173, 191, 160, 159, 156 | 173 | 175 | 175 | 28.40 | 2 / 2 |
| Scanned patent | Adopted viewer | 190, 157, 160, 156, 173, 157, 159, 156, 173 | 159 | 161 | 176 | 15.09 | 2 / 2 |
| Scanned patent | Direct pdf.js | 106, 108, 125, 106, 123, 106, 123, 106, 106 | 106 | — | — | 14.20 | 1 / 1 |

## WebKit 27.2 at 820 × 900

2026-11-20, darwin 27.2.0 arm64, Apple M2 Pro, pdf.js 6.5.438, DPR 2, AC power. Load average 5.1 to 9.4. The run recorded 3 waits and repeated 3 jobs for browser overlap. Median idle frame interval 13.9 ms.

| PDF | Draw | First drawing in run order (ms) | Sharp page 1 (ms) | Page 2 drawing (ms) | Sharp page 2 (ms) | Canvas at first draw (MiB, range) | GetPage / GetOperatorList at first draw (range) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| HR 815 | Previous viewer | 158, 159, 158, 143, 158, 184, 171, 157, 185 | 158 | 161 | 161 | 29.00 | 2 / 2 |
| HR 815 | Adopted viewer | 143, 158, 186, 158, 158, 143, 181, 143, 222 | 158 | 160 | 231 | 15.41 | 2 / 2 |
| HR 815 | Direct pdf.js | 130, 172, 130, 131, 114, 157, 130, 116, 130 | 130 | — | — | 14.50 | 1 / 1 |
| 1,000-page text | Previous viewer | 182, 1167, 254, 202, 209, 291, 221, 193, 179 | 209 | 225 | 225 | 25.02 | 2 / 2 |
| 1,000-page text | Adopted viewer | 183, 234, 600, 336, 224, 216, 183, 182, 182 | 216 | 227 | 249 | 13.29 | 2 / 2 |
| 1,000-page text | Direct pdf.js | 155, 156, 212, 234, 445, 193, 167, 154, 154 | 167 | — | — | 12.51 | 1 / 1 |
| Scanned patent | Previous viewer | 233, 204, 203, 206, 190, 290, 207, 192, 189 | 204 | 208 | 208 | 28.40 | 2 / 2 |
| Scanned patent | Adopted viewer | 219, 202, 192, 206, 207, 206, 207, 193, 187 | 206 | 209 | 221 | 15.09 | 2 / 2 |
| Scanned patent | Direct pdf.js | 150, 137, 137, 146, 133, 177, 135, 133, 132 | 137 | — | — | 14.20 | 1 / 1 |

## Firefox 159.0 at 820 × 900

2026-11-20, darwin 27.2.0 arm64, Apple M2 Pro, pdf.js 6.5.438, DPR 2, AC power. Load average 8.4 to 9.1. The run recorded 0 waits and repeated 0 jobs for browser overlap. Median idle frame interval 16.7 ms.

| PDF | Draw | First drawing in run order (ms) | Sharp page 1 (ms) | Page 2 drawing (ms) | Sharp page 2 (ms) | Canvas at first draw (MiB, range) | GetPage / GetOperatorList at first draw (range) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| HR 815 | Previous viewer | 213, 192, 198, 213, 218, 214, 194, 214, 217 | 213 | 202 | 202 | 29.00–43.51 | 2–3 / 2–3 |
| HR 815 | Adopted viewer | 216, 217, 213, 215, 229, 217, 200, 191, 218 | 216 | 203 | 226 | 15.41 | 2 / 2 |
| HR 815 | Direct pdf.js | 161, 178, 158, 171, 176, 178, 176, 163, 158 | 171 | — | — | 14.50 | 1 / 1 |
| 1,000-page text | Previous viewer | 240, 274, 237, 258, 260, 257, 260, 255, 260 | 258 | 265 | 265 | 25.02 | 2 / 2 |
| 1,000-page text | Adopted viewer | 258, 273, 259, 259, 268, 260, 250, 257, 259 | 259 | 266 | 275 | 13.29 | 2 / 2 |
| 1,000-page text | Direct pdf.js | 208, 225, 227, 210, 207, 207, 221, 219, 210 | 210 | — | — | 12.51 | 1 / 1 |
| Scanned patent | Previous viewer | 240, 377, 243, 237, 254, 275, 258, 239, 243 | 243 | 256 | 256 | 28.40 | 2 / 2 |
| Scanned patent | Adopted viewer | 241, 242, 258, 257, 257, 240, 258, 226, 240 | 242 | 258 | 271 | 15.09 | 2 / 2 |
| Scanned patent | Direct pdf.js | 168, 170, 157, 176, 174, 174, 174, 175, 186 | 174 | — | — | 14.20 | 1 / 1 |

## Chromium 159.0.8154.6 at 1280 × 900

2026-11-20, darwin 27.2.0 arm64, Apple M2 Pro, pdf.js 6.5.438, DPR 2, AC power. Load average 8.0 to 8.2. The run recorded 0 waits and repeated 0 jobs for browser overlap. Median idle frame interval 16.7 ms.

| PDF | Draw | First drawing in run order (ms) | Sharp page 1 (ms) | Page 2 drawing (ms) | Sharp page 2 (ms) | Canvas at first draw (MiB, range) | GetPage / GetOperatorList at first draw (range) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| HR 815 | Previous viewer | 139, 137, 138, 152, 140 | 168 | 140 | 140 | 38.36–74.47 | 2–3 / 2–3 |
| HR 815 | Adopted viewer | 138, 138, 138, 137, 139 | 171 | 140 | 163 | 4.51 | 2 / 2 |
| HR 815 | Direct pdf.js | 163, 144, 195, 129, 129 | 144 | — | — | 36.11 | 1 / 1 |

## WebKit 27.2 at 1280 × 900

2026-11-20, darwin 27.2.0 arm64, Apple M2 Pro, pdf.js 6.5.438, DPR 2, AC power. Load average 9.4 to 9.6. The run recorded 0 waits and repeated 0 jobs for browser overlap. Median idle frame interval 13.9 ms.

| PDF | Draw | First drawing in run order (ms) | Sharp page 1 (ms) | Page 2 drawing (ms) | Sharp page 2 (ms) | Canvas at first draw (MiB, range) | GetPage / GetOperatorList at first draw (range) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| HR 815 | Previous viewer | 152, 195, 153, 172, 142 | 215 | 155 | 155 | 38.36 | 2 / 2 |
| HR 815 | Adopted viewer | 238, 144, 284, 169, 172 | 221 | 181 | 233 | 4.51 | 2 / 2 |
| HR 815 | Direct pdf.js | 116, 129, 156, 129, 115 | 129 | — | — | 36.11 | 1 / 1 |

## Firefox 159.0 at 1280 × 900

2026-11-20, darwin 27.2.0 arm64, Apple M2 Pro, pdf.js 6.5.438, DPR 2, AC power. Load average 9.1 to 10.6. The run recorded 0 waits and repeated 0 jobs for browser overlap. Median idle frame interval 16.7 ms.

| PDF | Draw | First drawing in run order (ms) | Sharp page 1 (ms) | Page 2 drawing (ms) | Sharp page 2 (ms) | Canvas at first draw (MiB, range) | GetPage / GetOperatorList at first draw (range) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| HR 815 | Previous viewer | 208, 348, 234, 233, 199 | 283 | 245 | 245 | 38.36 | 2 / 2 |
| HR 815 | Adopted viewer | 208, 320, 249, 211, 209 | 277 | 204 | 275 | 4.51 | 2 / 2 |
| HR 815 | Direct pdf.js | 180, 186, 411, 188, 173 | 186 | — | — | 36.11 | 1 / 1 |

## Chromium 159.0.8154.6 at 820 × 900, 60 ms added latency at 20 Mbit/s

2026-11-20, darwin 27.2.0 arm64, Apple M2 Pro, pdf.js 6.5.438, DPR 2, AC power. Load average 8.1 to 7.7. The run recorded 0 waits and repeated 0 jobs for browser overlap. Median idle frame interval 16.7 ms.

| PDF | Draw | First drawing in run order (ms) | Sharp page 1 (ms) | Page 2 drawing (ms) | Sharp page 2 (ms) | Canvas at first draw (MiB, range) | GetPage / GetOperatorList at first draw (range) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| HR 815 | Previous viewer | 746, 749, 748, 747, 745 | 747 | 740 | 740 | 43.51 | 3 / 3 |
| HR 815 | Adopted viewer | 747, 747, 751, 731, 746 | 747 | 739 | 760 | 15.41 | 2 / 2 |
| HR 815 | Direct pdf.js | 638, 639, 660, 655, 691 | 655 | — | — | 14.50 | 1 / 1 |

## Next immediately after opening

The first completed page 1 drawing triggered the toolbar’s Next action, immediately or after a 100 ms timer. Times below start at the click and end when page 2 occupies the reading area with a completed drawing or a full-resolution drawing. A separate sample after each animation frame recorded a blank if the page was in position and still had no pixels. The click can fall inside a frame, so a zero count does not exclude a shorter blank. Each interval is the median of five fresh opens. The full page 2 raster matched across builds in every document and browser. [Navigation benchmark](../scripts/startup-flip-bench.ts)

| Browser | PDF | Next delay (ms) | Click to drawing before → adopted (ms) | Click to sharp before → adopted (ms) | Runs with a sampled blank frame before → adopted (of 5) |
| --- | --- | --- | --- | --- | --- |
| Chromium | HR 815 | 0 | 0.9 → 1.0 | 0.9 → 13.5 | 0 → 0 |
| Chromium | HR 815 | 100 | 1.1 → 1.1 | 1.1 → 1.1 | 0 → 0 |
| Chromium | Scanned patent | 0 | 2.8 → 3.0 | 2.8 → 16.9 | 0 → 0 |
| Chromium | Scanned patent | 100 | 0.9 → 0.9 | 0.9 → 0.9 | 0 → 0 |
| WebKit | HR 815 | 0 | 3.8 → 3.8 | 3.8 → 72.5 | 0 → 0 |
| WebKit | HR 815 | 100 | 2.4 → 2.3 | 2.4 → 2.3 | 0 → 0 |
| WebKit | Scanned patent | 0 | 4.2 → 4.6 | 4.2 → 16.8 | 0 → 0 |
| WebKit | Scanned patent | 100 | 1.8 → 1.7 | 1.8 → 1.7 | 0 → 0 |
| Firefox | HR 815 | 0 | 0.8 → 0.9 | 0.8 → 14.1 | 0 → 0 |
| Firefox | HR 815 | 100 | 1.0 → 1.0 | 1.0 → 1.0 | 0 → 0 |
| Firefox | Scanned patent | 0 | 14.7 → 16.1 | 14.7 → 29.5 | 0 → 0 |
| Firefox | Scanned patent | 100 | 0.9 → 1.0 | 0.9 → 1.0 | 0 → 0 |
