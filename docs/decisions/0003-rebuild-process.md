# 0003. How the rebuild is run

- Status: adopted
- Date: 2026-10-24

## Context

Coding agents asked to rebuild ParaPDF mixed the new direction with the
0.x `AGENTS.md`, which every session loads through `CLAUDE.md` and which
describes the 0.x design and processes as rules, while the new design lived
only in conversations. Each session inferred the destination again, mostly
from the existing code, so it moved from session to session. Sessions also
saw different rules: a change of principles made in one uncommitted
worktree did not reach the others.

## Decision

- The rebuild happens on the long-lived branch `rebuild`, merged into `main`
  at M7. Its `AGENTS.md` states the rules, `docs/rebuild/target.md` the
  destination, `docs/rebuild/milestones.md` the order and what done means,
  and `docs/decisions/` what was decided, with the evidence. The 0.x
  `AGENTS.md` is `docs/history/AGENTS-v0.md`: facts and reasons, not rules.
- Authority, highest first: `docs/rebuild/target.md`, `docs/decisions/`,
  the rules in `AGENTS.md`, the code, `docs/history/`. A question none of
  them answers is asked, not inferred from the old code or the history, and
  the answer goes into `target.md`.
- One milestone at a time. Each runs in a session of its own, on a branch
  from `rebuild` in a worktree of its own (`rebuild-m<N>-<topic>`), and is
  merged back once its done criteria hold. One session keeps the plan and
  reviews; sessions that change the runtime's core never run in parallel.
- A milestone ends with a review of its diff against `target.md` and the
  decisions, by a reviewer given those and the diff, not the history.
- Changes that land on `main` meanwhile, such as pdfjs-dist security
  updates, are merged into `rebuild`.

## Consequences

- `target.md` is edited when the destination changes, before the code that
  follows it, and the edit is part of the milestone that needs it.
- A session's task names its milestone and follows the template in
  `AGENTS.md`.

## Reopen if

The process keeps a milestone from finishing, or the maintainer changes it.
