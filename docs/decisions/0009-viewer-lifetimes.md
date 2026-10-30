# 0009. Each viewport owns its viewer work

- Status: adopted
- Date: 2026-10-25

## Decision

A document is a session that several viewers share; each viewport has its
own view and lifetime, and can cancel its drawing and feature work without
cancelling another viewer's.

- `Viewer`, layout, scrolling, and gestures live in `src/view/`.
- View state is split into hot snapshots (layout, mounted window, current
  page, scale, zoom mode) and cold ones (rotation, spread, scroll mode,
  tool). All affected snapshots are installed before their readers are
  notified; page layout subscribes only to hot state.
- Each viewer's work is linked to its viewport's abort signal and to its
  document lease. Detaching a viewport aborts drawing, searches, printing,
  and background publication, and releases canvases; the viewer keeps its
  lease, view position, and edits, and reattaching restores them. Only the
  last lease closes the session, after a grace period.

`check:viewers` covers independent views, detach and reattach, closing one
viewer while the other works, and last-release cleanup.

## Evidence

Scroll, commit, and zoom benchmarks against the build before the split, in
turn, three runs in each browser and five more in reversed order for the
cells that differed
([`scroll-m3-chromium.md`](../../examples/prototype/results/scroll-m3-chromium.md),
[`commit-m3-swapped-chromium.md`](../../examples/prototype/results/commit-m3-swapped-chromium.md),
[`zoom-m3-swapped-chromium.md`](../../examples/prototype/results/zoom-m3-swapped-chromium.md);
per-run data in [`m3-runs.json`](../../examples/prototype/results/m3-runs.json)):

- Every scroll job had zero blank area; React committed exactly when the
  mounted window or current page changed (4, 24, 4, and 20 times over four
  seconds), identically in both builds and all three browsers.
- Every before/after range overlapped once repeated in both orders. No speed
  change either way is claimed.

## Reopen if

Measurements show a reproducible cost beyond run-to-run variation, or an API
needs a different lifetime contract.
