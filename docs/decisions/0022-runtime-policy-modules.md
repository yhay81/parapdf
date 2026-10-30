# 0022. Keep runtime policies in the modules that own them

- Status: adopted
- Date: 2026-10-29

## Decision

Pure rules live apart from the code that applies them, each with unit
tests:

- Kept canvases in `render/kept-canvases.ts`: the cache counts pixels,
  checks content and rotation, evicts, and releases them, with decision
  0004's budget and deferred eviction. A cache within its limit does no
  iteration and allocates no iterator. The renderer still decides which
  canvases a page keeps and mounts them again.
- Flip targets in `view/navigation.ts` and requested zoom in `view/zoom.ts`.
  DOM writes stay in the viewer, in the same order of layout, geometry
  reads, scrolling, and state publication.
- Shared helpers (`clamp`, rotation normalization, the PDF-to-CSS scale)
  instead of copies.
- The editor's types and labels apart from its pdf.js integration, so that
  importing the types loads no editor code.
- `useViewer` in `react/viewer.ts`, `useStore` with the other store
  bindings.

## Evidence

`scroll-bench.ts` with `FOCUS=1` against the build before, three runs per
cell
([`cohesion-follow-chromium.md`](../../examples/prototype/results/cohesion-follow-chromium.md),
[`-webkit`](../../examples/prototype/results/cohesion-follow-webkit.md),
[`-firefox`](../../examples/prototype/results/cohesion-follow-firefox.md)):
zero blank area, the same React commits and canvas memory in every pair, and
median blocked time from 25 ms less to 21 ms more over four seconds, within
the runs' noise. Accepted for policies that are testable on their own.

## Reopen if

Measurements show a repeatable cost from these module boundaries or shared
helpers, or a policy no longer belongs to the module that holds it.
