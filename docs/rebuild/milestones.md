# Milestones of the rebuild

In order; one at a time (decision 0003). Each milestone runs in a session of
its own, on a branch `rebuild-m<N>-<topic>` from `main` in a worktree of
its own, and merges into `main` through a pull request when every item of
"Done when" holds and CI passes. The session that merges it updates its status here, adds a
`CHANGELOG.md` entry for it, and records any new decision.

Every milestone's "Done when" includes, besides its own items:

- `pnpm check`, `pnpm typecheck`, and `pnpm test` pass.
- Every functional check passes in Chromium with `ENGINE=pdfjs`, as CI runs
  them; checks changed on purpose are changed in the same milestone.
- The benchmarks the milestone names show no regression beyond the runs'
  spread against the build before it, measured in turn in the same run.
- A review of the diff against `target.md` and `docs/decisions/`, by a
  reviewer given those and the diff, found nothing the milestone leaves
  open.
- `AGENTS.md` is true again: layout, commands, and rules.

## M0: foundation

- Goal: one written destination that every session reads first.
- Done when: the repository holds this file, `docs/rebuild/target.md`,
  `docs/decisions/`, the new `AGENTS.md`, and the 0.x `AGENTS.md` as
  `docs/history/AGENTS-v0.md`.
- Status: done (2026-10-24), on the branch `rebuild`, and merged into
  `main` with M1.

## M1: bring in the measured work

- Goal: start the rebuild from the measured state of 0.x.
- Scope: the work measured on the branch `claude/frame-bench`: kept
  canvases (decision 0004), the benchmarks and options that measured them
  (`return-bench.ts`; the engine benchmark's `OUTPUT`, `DIST`, `-frame`,
  and `-record`; `fidelity.ts`, `frame-ops.ts`; the `BEFORE` builds of
  `commit-bench.ts`, `zoom-bench.ts`, and `return-bench.ts`), their results,
  and decision 0008's outcome.
- Out of scope: any change of structure.
- Done when: the items above are on `main`, and `AGENTS.md` lists the new
  commands.
- Status: done (2026-10-24), with M0. Kept canvases are in; decision 0008
  rejected the copied base in the form measured, and its code is in the tag
  `experiment/demote-whole-page-detail`. `document.proxy` replaced
  `document.native` ahead of M2 (decision 0001), and the rebuild moved to
  `main` (decision 0003). M2's benchmarks compare against `main` as M1
  leaves it.

## M2: pdf.js directly, and document sessions

- Goal: no engine boundary (decision 0001), and documents with a lifecycle
  of their own.
- Scope: `pdfjs/` and `document/` as `target.md` describes them; remove
  `PdfEngine`, `PdfEngineDocument`, and the engine-neutral names and types;
  `DocumentSession` with its `AbortController` replaces the generation
  counters and "still the same document" checks; tests stand in for the
  parts of pdf.js they use.
- Out of scope: splitting the viewer, features, rendering, the React API.
- Done when: no `PdfEngine*` type remains; the session registry and the
  lifecycle have unit tests; `check:lifecycle` and `check:document` pass;
  the scroll and return benchmarks show no regression.
- Status: done (2026-10-24). `src/pdfjs/` and `src/document/` replace the
  engine boundary and `runtime/documents.ts`; the session's
  `AbortController` and each viewer's lease of it replace the generation
  counters; unit tests stand in for pdf.js (`test/fake-pdfjs.ts`). The
  return and scroll benchmarks, against a947f02 in turn in Chromium,
  WebKit, and Firefox, three runs (`examples/prototype/results/return-m2-*`,
  `scroll-m2-*`), show no regression beyond the runs' spread. The two cells
  whose medians were higher in every run, WebKit's jump-back and Firefox's
  scroll-back on bill-hr815.pdf, were lower than the build before when
  measured first (`return-m2-swapped-*`): the second job of a pair measured
  slower. Each viewer's store still publishes the document's state
  (status, progress, password request); a store of the session's own, as
  target.md's "State" describes, is left to the React API (M6).

## M3: viewers

- Goal: a `Viewer` per viewport, several per session.
- Scope: `view/` as `target.md` describes it: layout, scrolling, zoom,
  rotation, spreads, scroll modes, gestures, keyboard, the mounted window,
  the current page, navigation; its own `AbortController`; hot and cold
  state apart; the demo shows one document in two viewers side by side.
- Out of scope: moving features out (they may stay in a facade until M4).
- Done when: two viewers of one document scroll, zoom, and close
  independently in a new functional check; the scroll, commit, and zoom
  benchmarks show no regression.
- Status: not started.

## M4: features as modules

- Goal: a small core; every feature a module.
- Scope: search, history, view state, initial view, permissions, forms,
  annotations, print, download, thumbnails, layers, attachments, selection,
  and text, each attaching to a session or a viewer as `target.md`
  describes; the core imports none of them.
- Out of scope: rendering, the React API.
- Done when: nothing in `pdfjs/`, `document/`, `view/`, or `render/`
  imports from `features/`; each feature's logic that needs no DOM has unit
  tests; a demo build without search, forms, annotations, and print carries
  none of their code.
- Status: not started.

## M5: rendering

- Goal: rendering decided by a pure planner, and pages whose DOM the
  renderer owns.
- Scope: `render/` as `target.md` describes it; the 0.x heuristics move
  into the planner unchanged and get unit tests of their invariants; the
  renderer owns each page's canvases and layer containers inside its host,
  and kept canvases move between hosts without copies.
- Out of scope: new rendering strategies, which need decisions of their
  own.
- Done when: the planner's invariants are tested in Node; `check:pinch`,
  `check:scroll`, `check:options`, and `check:features` pass in Chromium,
  WebKit, and Firefox; the commit, return, zoom, and scroll benchmarks show
  no regression.
- Status: not started.

## M6: React API

- Goal: the React API of `target.md`.
- Scope: settle the names in `target.md` first; `PdfDocument`, `PdfViewer`,
  `PdfThumbnails`, `useViewer`, and the hooks; live options; controlled and
  uncontrolled view state; secondary data through `use()`; overlays as
  portals; several viewers per document; the demo and the site's examples
  move to it.
- Done when: the functional checks drive the new API; the scroll
  benchmark's React commits stay those of the mounted window and the
  current page.
- Status: not started.

## M7: finish

- Goal: release the rebuilt ParaPDF.
- Scope: rewrite the package's README, the documentation site, the root
  `README.md`, `CONTRIBUTING.md`, and `SECURITY.md` for it; the full
  functional checks and benchmarks in Chromium, WebKit, and Firefox, with
  their results; the release process in `AGENTS.md`; release.
- Done when: the release is published and its CHANGELOG entry lists every
  break from 0.x.
- Status: not started.
