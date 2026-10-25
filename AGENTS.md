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

The rebuild runs milestone by milestone on `main`
(`docs/rebuild/milestones.md`); M0 to M2 are done; M3 is in progress (#38).
0.x was
published on npm as `parapdf` 0.1.0 to 0.4.0, from the tags `v0.1.0` to
`v0.4.0`. The package's README, the documentation site, the root
`README.md`, `CONTRIBUTING.md`, and `SECURITY.md` describe 0.x until M7
rewrites them (decision 0002).

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

As of M3; `target.md` describes where the runtime's code goes.

- `packages/parapdf/` — the runtime, published as `parapdf`: the loader
  that starts pdf.js with the package's worker and files, and how ParaPDF
  draws pages and builds layers with it (`src/pdfjs/`); document sessions,
  one per open document, shared by its viewers through a registry
  (`src/document/`); one `Viewer` per viewport, its layout, scrolling,
  gestures, and hot/cold state (`src/view/`); the scheduler and feature helpers (`src/runtime/`),
  with feature methods still on `Viewer` until M4; React bindings
  (`src/react/`,
  `"use client"`); unit tests of the modules that need no DOM, which stand
  in for pdf.js with `test/fake-pdfjs.ts` (`test/`).
  `scripts/pdfjs-files.ts`, run by `pnpm install` and `build`, copies
  pdf.js's worker behind ParaPDF's prelude (`scripts/worker-prelude.js`) and
  the files it loads on demand into `pdfjs/` (not committed), and writes
  `src/pdfjs/files.ts` (committed). The workspace consumes the TypeScript
  source; `build` emits `dist/`, and packing (with pnpm, for
  `publishConfig`) ships `dist/`, `src/`, `pdfjs/`, the README, and the
  license and notices.
- `examples/prototype/` — the Vite demo the functional checks and the
  runtime benchmarks drive (`scripts/check-*.ts`, `scripts/*-bench.ts`,
  results in `results/`). Its query parameters are read in `src/App.tsx`.
- `bench/` — the engine benchmark (research, decision 0001): an adapter per
  engine (`src/engines/`), the corpus (`corpus/`, sources and licenses in
  its README), the synthetic corpus generator, the Playwright runner,
  reports, and `bench/scripts/browsers.ts`, the launcher every Playwright
  script shares. Results in `results/`.
- `site/` — the documentation site (Astro with Starlight), deployed by
  `.github/workflows/site.yml` to https://parapdf.yhay81.com. Describes 0.x
  until M7.
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
  `viewers`, and `bundle`. `check:viewers` opens two viewers of one session
  and checks independent view state, closing one while the other works,
  viewport-only detach/reattach, and StrictMode. The prototype shows it with
  `?split=1`; separate `PdfDocument` providers share the session until M6
  introduces the new React API. Each feature has one primary home among
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

Nothing is released before M7, which writes the release process for the
rebuilt package here. A pdfjs-dist security fix is released promptly for
0.x, as `SECURITY.md` promises, from a branch cut from the tag `v0.4.0`
(`docs/history/AGENTS-v0.md`, "Releasing"), and `main` moves to the same
pdfjs-dist.
