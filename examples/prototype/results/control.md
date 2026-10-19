# ParaPDF runtime prototype: scroll control

- Run at: 2026-10-19T07:23:04.586Z
- Machine: darwin 27.0.0 arm64, Apple M2 Pro; Playwright's headless browsers.
- Method: bill-hr815.pdf with pdf.js master's renderer worker on a GPU-backed canvas, 1280×900 at devicePixelRatio 2. After page 2's text layer exists and 3 more seconds pass, a 4 ms timer runs for 1 second idle (the baseline) and then for 4 seconds while the page stays still or scrolls back and forth over 600 px at 900 CSS px per second inside the mounted pages. Nothing renders and React does not commit in either mode. Blocked counts lateness beyond 2 ms or the idle 95th percentile, whichever is larger, as in the scroll benchmark. Fresh context per run, 5 runs.
- Reproduce: `pnpm --filter @parapdf/prototype build && node examples/prototype/scripts/scroll-control.ts`

| Browser | Mode | Blocked, median (range), ms | Longest stall, median (range), ms | Renders |
|---|---|---:|---:|---:|
| Chromium 156.0.8078.4 | still | 0 (0–0) | 0.6 (0.6–0.7) | 0 |
| Chromium 156.0.8078.4 | scroll | 0 (0–0) | 1.5 (1.5–1.5) | 0 |
| WebKit 27.2 | still | 4 (1–8) | 5.0 (5.0–5.3) | 0 |
| WebKit 27.2 | scroll | 5 (4–18) | 5.7 (5.0–7.2) | 0 |
| Firefox 157.0 | still | 6 (0–113) | 4.8 (1.8–26.2) | 0 |
| Firefox 157.0 | scroll | 46 (4–112) | 9.3 (5.8–26.0) | 0 |

