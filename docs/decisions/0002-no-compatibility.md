# 0002. No compatibility to keep before 1.0

- Status: adopted (until 1.0, when decision 0015 takes over)
- Date: 2026-10-24

## Decision

Before 1.0, ParaPDF changes APIs, options, published state, file layout,
and behavior whenever that makes it faster or simpler. It adds no
deprecations, aliases, shims, or compatibility layers. Every break is
listed in the release's `CHANGELOG.md` entry.

The functional checks (`check:*`) are the behavioral contract: a change
that alters an API on purpose changes the checks in the same change; a check
that fails for any other reason is a bug.

## Evidence

None measured: a direction the maintainer set while few applications
depend on ParaPDF.

## Reopen if

Applications come to depend on a 0.x API in a way that makes free breaks
costlier than they are worth, or 1.0 ships.
