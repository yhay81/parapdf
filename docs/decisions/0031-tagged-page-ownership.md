# 0031. Each mounted tagged page owns its accessibility targets

- Status: adopted
- Date: 2026-11-13

## Decision

Prefix the DOM ids in a tagged page's marked content and referenced
annotations with the structure builder's unique page prefix. Use the
corresponding ids in its reading order and popup controls. Figures and
formulas read the text of that page directly. Keep pdf.js's original
annotation keys for form values and editing.

## Evidence

In the split demo with two copies of the first page of `f1040.pdf`, 339
of its first viewer's accessibility references resolved to elements in
the same page. All 339 in the second viewer resolved to the first.
`check:viewers` now verifies that every target resolves in its own
page, including both text and form widgets.

The measurements below used the same tagged form with `split=1&forms=1`
on an M2 Pro on AC power. In a fresh headless context at 1000 × 840 CSS
pixels and devicePixelRatio 2, a probe sampled the DOM on animation
frames from the first frame with both page hosts mounted. The first
measure ends when both structure trees contain ownership references and
the second when both annotation layers contain form inputs. Each build
ran three times in each browser, in pairs with alternating order, with
no other Playwright browser running. Times are medians in milliseconds,
before (`7622663`) and after the correction.

| Browser | Both trees, before → after | Both forms, before → after |
|---|---:|---:|
| Chromium 158 | 150 → 153 | 250 → 218 |
| WebKit 27.2 | 268 → 265 | 525 → 554 |
| Firefox 159 | 254 → 264 | 482 → 500 |

These measurements include pdf.js rendering and the viewer's idle
scheduling. The form appeared later in the WebKit and Firefox medians
and sooner in Chromium. The change corrects ownership in all three.

## Reopen if

pdf.js can give each rendered text and annotation layer a DOM id prefix
directly, or profiling identifies binding tagged content as a bottleneck.
