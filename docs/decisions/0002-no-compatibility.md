# 0002. No compatibility to keep

- Status: adopted
- Date: 2026-10-24

## Context

`parapdf` 0.x is published on npm (0.1.0 to 0.4.0, 2026-10-20), but nobody
depends on it.

## Decision

The rebuild changes APIs, options, published state, file layout, and
behavior whenever that makes ParaPDF faster or simpler. It adds no
deprecations, aliases, shims, or compatibility layers, and does not ask
whether a break is acceptable.

Documentation for people follows the result, not each change: the
package's README, the documentation site (`site/`), the root `README.md`,
`CONTRIBUTING.md`, and `SECURITY.md` keep describing 0.x until M7 rewrites
them. `CHANGELOG.md` gets one entry per merged milestone.

## Consequences

- The functional checks (`check:*`) are the behavioral contract. A
  milestone that changes an API on purpose changes the checks in the same
  change; a check that fails for any other reason is a bug.
- Nothing is released before M7.

## Reopen if

ParaPDF gets users who depend on a 0.x API.
