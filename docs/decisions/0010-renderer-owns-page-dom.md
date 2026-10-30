# 0010. The renderer owns each page's DOM, and kept canvases move

- Status: adopted
- Date: 2026-10-26

## Decision

- The planner (`src/render/planner.ts`) is pure functions of the view, the
  budgets, and what each page shows and draws. Node tests check its
  invariants over generated views: a visible page never stays blank, the
  budgets hold except for visible bases, no base starts under a whole-page
  detail, and a drawing just started is never given back.
- The renderer (`src/render/renderer.ts`) builds each page's canvases
  (base, detail, spare) and its text, structure, annotation, and editor
  containers at the start of the host React places, and takes them out when
  the page unmounts. React renders the host and the application's overlay
  only.
- A page that mounts again gets the same canvas elements it kept (decision
  0004) moved into its new host: no pixel is copied.
- New canvases start at 0 × 0 and hidden, so they count no pixels before
  their first drawing.

## Evidence

Return, scroll, commit, and zoom benchmarks against the build where React
rendered the canvases and kept ones were copied back, in turn, three runs in
each browser, repeats of the cells that differed in both orders
([`return-m5-firefox.md`](../../examples/prototype/results/return-m5-firefox.md),
[`return-m5-repeat-m5-firefox.md`](../../examples/prototype/results/return-m5-repeat-m5-firefox.md),
[`return-m5-repeat-swapped-firefox.md`](../../examples/prototype/results/return-m5-repeat-swapped-firefox.md)):

- Firefox, where copies cost most, came back sharp sooner: flipping back
  over bill-hr815.pdf, 6 against 14 ms and, the other order, 8 against 13.
- Scrolling drew the same layers, committed React as often, and left no
  blank area; zoom commits held about 1 MiB less at their peaks.

## Reopen if

A browser loses a canvas's pixels when it moves between parents, or moving
measures costlier than copying.
