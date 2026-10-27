# AGENTS.md

The development context for coding agents.
`CLAUDE.md` only imports this file; update this file instead.

ParaPDF is a React PDF viewer built on pdf.js for maximum performance.
"Para" carries two meanings: flipping quickly through pages (Japanese
"parapara") and parallel, off-main-thread rendering. It is being rebuilt,
on `main`, toward the design in `docs/rebuild/target.md`.

## Read first

What decides, highest first:

1. `docs/rebuild/target.md`: the destination.
2. `docs/decisions/`: what was decided and why, with the evidence. Final
   until new measurements reopen them.
3. The rules in this file.
4. The code.
5. `docs/history/AGENTS-v0.md`: the 0.x development context. Facts and
   reasons for the code being ported, never rules.

When none of them answers a question, stop and ask; do not infer the answer
from the 0.x code or the history. The answer goes into `target.md` before
the code that follows it.

## Status

The rebuild ran milestone by milestone on `main`
(`docs/rebuild/milestones.md`); M0 to M7 are done, and 0.5.0 is its first
release. 0.x was published on npm as `parapdf` 0.1.0 to 0.4.0, from the tags
`v0.1.0` to `v0.4.0`, and is no longer supported. New work follows the same
rules: `target.md` first when the destination changes, and a decision record
when the choice matters for performance or direction.

## Rules

- pdf.js is the only engine (decision 0001). Use its types, caches,
  drawing, and layers directly; keep no engine boundary. Go through its
  core display API; do not use or copy the viewer components of
  `pdfjs-dist/web/`; do not fork or patch pdf.js, and propose upstream
  changes instead. Code ported from pdf.js's viewer keeps its Apache-2.0
  attribution in `NOTICE.md`. The package depends on one exact pdfjs-dist
  and ships its worker and the files it loads on demand, so applications
  configure nothing.
- No compatibility (decision 0002). Change APIs, options, state, and
  behavior whenever that makes ParaPDF faster or simpler; add no
  deprecations, aliases, or shims. The functional checks are the behavioral
  contract: change them in the same change as an API changed on purpose.
- Performance is measured. A change that may affect speed or memory is
  compared with the build before it, in the same run, in the browsers it
  concerns; wins and losses both go into a decision record.
- React stays out of the hot path. Scrolling and zooming never commit React
  state per frame; React commits when the mounted page window or the current
  page changes. Pixels never go through React state.
- Drawing leaves the main thread wherever pdf.js allows it.
- React-first: modules that touch the DOM declare `"use client"`, the viewer
  renders an empty viewport on the server, and nothing suspends before the
  first page draws.
- Domain-neutral: ParaPDF shows PDFs as documents (reading, search,
  selection, links, annotations, forms), and nothing of drawings or other
  domains (no scales, real-world lengths, or measuring tools). A feature
  belongs here if people who never treat a PDF as a drawing need it.

## How to work

- One milestone at a time (decision 0003): a session of its own, on a
  branch `rebuild-m<N>-<topic>` from `main`, in a worktree of its own,
  merged into `main` through a pull request once the milestone's "Done
  when" holds and CI passes. Sessions that change the runtime's core never
  run in parallel.
- A task names its milestone and follows this template:

  ```
  Milestone: M<N> (docs/rebuild/milestones.md)
  Goal: …
  Scope: the files or modules it may change
  Out of scope: …
  Done when: the milestone's criteria, and …
  If target.md does not cover a question: stop and ask.
  ```

- Port the modules `target.md` lists under "Ported unchanged" with their
  tests; read the history for why they are as they are, and do not
  redesign them in passing.
- Do not keep old names working, reintroduce an engine abstraction, update
  the documentation for people per change, or reopen a decision without new
  measurements.
- When the destination has to change, change `target.md` first, as part of
  the milestone that needs it, and record a decision if the choice matters
  for performance or direction.
- Keep this file true of the repository: its layout, commands, and rules.

## Repository layout

`target.md` describes where the runtime's code goes.

- `packages/parapdf/` — the runtime, published as `parapdf`: the loader
  that starts pdf.js with the package's worker and files, and how ParaPDF
  draws pages and builds layers with it (`src/pdfjs/`); document sessions,
  one per open document, shared by its viewers through a registry that
  publishes each session's document state, and the `PdfSession` a
  `PdfDocument` holds of it, which applications see (`src/document/`); one
  `Viewer` per viewport, its options (`options.ts`), layout, scrolling,
  gestures, keys and the hand tool (`input.ts`), hot/cold state
  (`state.ts`), the pure rules of its zoom (`zoom.ts`) and navigation
  (`navigation.ts`), which the viewer asks outside the frame and gesture
  paths, the measures the checks and benchmarks read (`metrics.ts`), the
  hooks features extend it with (`viewer.extend()`, `extensions.ts`), and
  handing bytes to the browser as a download (`files.ts`) (`src/view/`); rendering: the planner, a pure
  function that decides what each page draws (`planner.ts`), and the
  renderer, which builds each page's canvases and layer containers inside
  the host React places, carries out the plans, keeps the canvases of pages
  that unmount, and builds the DOM layers; with them, the text selection
  tracker the viewer keeps drags in text layers with
  (`src/render/`); the features, each attaching to a
  viewer or a session and imported by nothing in the core (`src/features/`);
  React bindings: `PdfDocument`, `PdfViewer`, which sets its viewer's live
  options and loads the features they ask for, `PdfThumbnails`,
  `useViewer()`, and the hooks (`src/react/`, `"use client"`); unit tests in Node, which stand in for pdf.js with
  `test/fake-pdfjs.ts` and for the elements of a page the renderer builds
  with `test/fake-dom.ts` (`test/`).
  `scripts/pdfjs-files.ts`, run by `pnpm install` and `build`, copies
  pdf.js's worker behind ParaPDF's prelude (`scripts/worker-prelude.js`) and
  the files it loads on demand into `pdfjs/` (not committed), and writes
  `src/pdfjs/files.ts` (committed). The workspace consumes the TypeScript
  source; `build` emits `dist/`, and packing (with pnpm, for
  `publishConfig`) ships `dist/`, `src/`, `pdfjs/`, the README, and the
  license and notices.
- `examples/prototype/` — the Vite demo the functional checks and the
  runtime benchmarks drive (`scripts/check-*.ts`, `scripts/*-bench.ts`,
  results in `results/`). Its query parameters are read in `src/App.tsx`,
  which exposes the viewer, its session, and its features to the checks
  (`window.__viewer`, `__session`, `__parapdf`, `__search`, `__history`,
  `__annotations`), lets them change `PdfViewer`'s props
  (`__setViewerProps`), and, through `src/internals.ts`, show a document a
  pdf.js of their own opens (`__showWith`). `minimal.html` is the demo
  without search, forms, annotation editing, and print.
- `bench/` — the engine benchmark (research, decision 0001): an adapter per
  engine (`src/engines/`), the corpus (`corpus/`, sources and licenses in
  its README), the synthetic corpus generator, the Playwright runner,
  reports, and `bench/scripts/browsers.ts`, the launcher every Playwright
  script shares. Results in `results/`.
- `site/` — the documentation site (Astro with Starlight), deployed by
  `.github/workflows/site.yml` to https://parapdf.yhay81.com from release
  tags.
- `docs/` — `rebuild/` (target and milestones), `decisions/`, and
  `history/`.
- `.github/` — CI, issue forms, the pull request template, and Dependabot.

## Commands

- `pnpm install`, then `pnpm --filter @parapdf/bench exec playwright install
  chromium webkit firefox` for every Playwright script.
- `pnpm test` (unit tests), `pnpm typecheck`, `pnpm check` (Biome; `pnpm
  format` fixes).
- `pnpm --filter parapdf build`, `pack`, and `check:package` (the packed
  tarball as an application installs it).
- `pnpm --filter @parapdf/bench corpus` writes the synthetic stress PDFs
  that several checks and benchmarks need.
- `pnpm --filter @parapdf/prototype dev` runs the demo;
  `pnpm --filter @parapdf/prototype build` builds it for the checks and the
  benchmarks, which serve `examples/prototype/dist/` or, with `DIST`, a
  build in a directory of its own (`pnpm --filter @parapdf/prototype exec
  vite build --outDir <dir>`), so that a session never replaces the build
  another one measures.
- Functional checks, `pnpm --filter @parapdf/prototype check:<name>`, with
  `BROWSER` and `ENGINE`: `text`, `links`, `lifecycle`, `rotation`,
  `options`, `pinch`, `features`, `scroll`, `annotations`, `document`,
  `viewers`, and `bundle`. `check:viewers` opens two viewers under one
  `PdfDocument` and checks independent view state, closing one while the
  other works, viewport-only detach/reattach, the provider releasing the
  session, StrictMode, and two viewers editing annotations in one session;
  the prototype shows it with `?split=1`. `check:options` covers
  `PdfViewer`'s live options and controlled view state. `check:modules` builds the demo with source maps and
  checks which features' modules each page loads: `minimal.html` none of
  search, forms, annotation editing, and print. Each feature has one primary home among
  them; extend that check
  instead of duplicating it. They default to `ENGINE=pdfjs-next`, which
  needs `bench/scripts/build-pdfjs-next.sh`; CI runs them with
  `ENGINE=pdfjs` in Chromium. What each covers is listed in
  `docs/history/AGENTS-v0.md`, "Commands".
- Runtime benchmarks in `examples/prototype/scripts/`: `scroll-bench.ts`
  (also `pnpm --filter @parapdf/prototype bench`), `commit-bench.ts` (zoom
  commits), `zoom-bench.ts`, `return-bench.ts` (pages the reader comes back
  to after they unmounted), `main-thread-bench.ts`, and `hwa-bench.ts`,
  each documented in its header comment. `scroll-bench.ts`,
  `commit-bench.ts`, `zoom-bench.ts`, and `return-bench.ts` measure the
  build in `DIST` against the one in `BEFORE` (built from the commit before
  the change, in a directory of its own) in the same run, job by job.
- `pnpm bench:build` and `pnpm bench` run the engine benchmark (`BROWSER`,
  `ENGINES`, `FILES`, `RUNS`, `PAGES`, `SCALE`; `OUTPUT`, a prefix that
  keeps an experiment's result files apart from the committed ones; `DIST`).
  `ENGINES` also takes the pdf.js engines' `-frame` and `-record` variants
  (decisions 0005 and 0006); `bench/scripts/fidelity.ts` compares what the
  `-frame` variants draw, and `bench/scripts/frame-ops.ts` times the canvas
  and bitmap operations behind them.
- `pnpm --filter @parapdf/site dev`, `build`, and `preview` for the site.

## Benchmark methodology

- Every job runs in a fresh browser context of Playwright's headless
  Chromium, WebKit, or Firefox, launched by `bench/scripts/browsers.ts`.
  Playwright's WebKit is not Safari: never present its numbers as Safari's.
- The launcher passes Chromium `--use-angle=metal` on macOS, pins Firefox to
  60 Hz with a reused home folder, and `restoreScaleFactor()` keeps
  Firefox's devicePixelRatio; scripts reject jobs whose devicePixelRatio is
  wrong. Servers bind 127.0.0.1 on ports 4179 to 4189, which WebKit accepts.
- Measure on AC power; the scripts stop on battery or in Low Power Mode
  (`ALLOW_BATTERY=1` overrides and flags the report).
- Scripts take turns with other Playwright browsers on the machine
  (`measureInTurn()`), and rerun a job another browser overlapped; with
  `MAX_LOAD` they also wait for the one-minute load average.
  `ALLOW_PARALLEL=1` and `IGNORE_PIDS` exist for when that cannot work.
  Reports say how often a run waited.
- Each job first measures the idle page: blocked time counts a 4 ms timer's
  lateness beyond 2 ms or the idle 95th percentile, whichever is larger, and
  a dropped frame is longer than 1.5 idle frame intervals. Compare blocked
  time within a browser, and browsers by their longest stalls.
- Compare a change with the build before it in the same run, variants
  following each other job by job, never with results from another day.
  Background load moves the numbers: check it, and rerun when in doubt.
- Before trusting a speed win, check fidelity: an engine or a change that
  skips content is fast for the wrong reason.

## Conventions

- Write code, comments, documentation, and commit messages in English.
  Japanese is allowed in localized documentation and in CJK test data.
- Node 24+ runs TypeScript scripts directly through type stripping. Avoid
  TypeScript-only runtime syntax (enums, namespaces, parameter properties)
  in scripts, and keep `erasableSyntaxOnly` enabled.
- Pin exact versions of every engine under test (`pdfjs-dist`,
  `@embedpdf/pdfium`, hayro) so results are reproducible, and record the
  versions in each result file.
- Corpus additions need a redistributable license, a documented source, and
  coverage that is not already represented. Generated stress documents are
  recreated by `bench/scripts/gen-synthetic.ts` and are never committed.

## Releasing

1. On a branch, set `version` in `packages/parapdf/package.json` and turn
   the changes since the last release in `CHANGELOG.md` into the release's
   entry, which lists every break.
2. Run `pnpm check`, `pnpm typecheck`, `pnpm test`, `pnpm --filter parapdf
   check:package`, and every functional check in Chromium, WebKit, and
   Firefox with `ENGINE=pdfjs`; merge the pull request once CI passes.
3. Tag the merge commit on `main` `vX.Y.Z` and push the tag, which deploys
   the documentation site (`.github/workflows/site.yml`).
4. Run `pnpm --filter parapdf publish` from that commit, in a checkout with
   no uncommitted or untracked files (pnpm refuses otherwise). pnpm applies
   `publishConfig` and runs `prepack`, which builds and copies the license
   and notices in. npm asks the maintainer to approve the login and the
   publish in the browser.
5. Create the GitHub release for the tag from its `CHANGELOG.md` entry.

When pdfjs-dist publishes a security fix, release on it soon, and say so in
the release's entry: `SECURITY.md` promises it, because the package ships
pdf.js's worker and applications cannot move to another pdf.js themselves.
