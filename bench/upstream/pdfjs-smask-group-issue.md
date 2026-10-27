# pdf.js paints a soft mask's G that has no /Group

The investigation behind issue #19: why pdf.js draws
`corpus/pdfium-smask-blend.pdf` unlike PDFium and hayro, which of them is
right, and what a pdf.js update has to show. The draft report for pdf.js is
at the end; it has not been filed.

## The fixture

PDFium's `smask_blend.in` (`bench/corpus/README.md`). A 200 × 200 page
paints form `Fm0` under a graphics state whose `/SMask` is an alpha mask
(`/S /Alpha`) with `G` = object 6:

- Object 6 fills `0 0 100 50` white and `0 50 100 100` black, clipped to
  its `/BBox [0 0 100 100]`. It has no `/Group`, and its `/Type` is the bare
  token `XObject` rather than the name `/XObject`.
- `Fm0` sets `/BM /Screen`, `/CA 0.6`, `/ca 0.6`, and paints `Fm1`, which
  fills `0 0 50 100` white and `50 0 100 100` black, clipped to
  `0 0 100 100`.

## The expected drawing

ISO 32000 requires a soft mask's `G` to be a transparency group XObject.
Read as one:

- An alpha mask takes the group's alpha: 1 over the whole of `0 0 100 100`,
  whatever the fills' colors, and 0 outside it. The mask removes nothing
  that `Fm1` paints.
- The page group is composited onto the page as an isolated group, from a
  transparent backdrop, and the result onto the white page. So Screen blends
  against nothing: white at 0.6 shows as white, black at 0.6 as gray 102.

Expected: gray 102 in `50 0 100 100`, white everywhere else. PDFium and hayro
draw exactly this.

## What pdf.js draws

In `pdf.worker.mjs` (pdfjs-dist 6.4.299, `buildFormXObject`), a form without
`/Group` is not a group: its operators are added to the current operator
list, between `paintFormXObjectBegin` and `paintFormXObjectEnd`, and the soft
mask options passed with it are dropped. So the mask is never applied, and
its `G` is painted on the page as content, before `Fm0`. Every variant below
matches that reading pixel for pixel: over the black half of `G`, white at
0.6 shows as 153 and black as 0; over the white half, Screen leaves white.

pdf.js master (`bench/vendor/pdf.js` at 157d30e83, 2026-10-17) draws the same
as 6.4.299.

## Variants

`bench/scripts/smask-variants.ts` writes each variant, with a rebuilt
cross-reference table, into `bench/dist/corpus/`. Values are the page's grays
in its lower left quarter, composited over white, as `x 0–50 / x 50–100` for
`y 50–100` then `y 0–50`.

| Variant | Change | pdf.js | PDFium |
|---|---|---|---|
| (fixture) | — | 153 / 0, 255 / 255 | 255 / 102, 255 / 102 |
| `smask-normal` | no `/BM /Screen` | 153 / 0, 255 / 102 | 255 / 102, 255 / 102 |
| `smask-nomask` | no `/SMask` | 255 / 102, 255 / 102 | 255 / 102, 255 / 102 |
| `smask-normal-nomask` | neither | 255 / 102, 255 / 102 | 255 / 102, 255 / 102 |
| `smask-luminosity` | `/S /Luminosity` | 153 / 0, 255 / 255 | 255 / 255, 255 / 102 |
| `smask-typed` | `/Type /XObject` | 153 / 0, 255 / 255 | 255 / 102, 255 / 102 |
| `smask-group` | `G` gets `/Group << /S /Transparency >>` | 255 / 102, 255 / 102 | 255 / 102, 255 / 102 |
| `smask-group-typed` | both | 255 / 102, 255 / 102 | 255 / 102, 255 / 102 |
| `smask-group-luminosity` | `/Group` and `/S /Luminosity` | 255 / 255, 255 / 102 | 255 / 255, 255 / 102 |

So pdf.js handles the blend mode, the page's backdrop, and both kinds of
soft mask as PDFium does; the one difference is a `G` without `/Group`.
hayro agrees with PDFium except for luminosity masks, where it also draws
over the black half of `G` (`smask-luminosity`, `smask-group-luminosity`):
a hayro defect, which matters only for the benchmark's reference engines.

## The comparison

`bench/results/smask-fidelity-<browser>.{md,json}`, from:

```
pnpm bench:build
node bench/scripts/smask-variants.ts
FILES=pdfium-smask-blend.pdf,smask-normal.pdf,… PAGES=1 OUTPUT=smask- \
  PAIRS=pdfjs:pdfium,pdfjs-next:pdfium,hayro:pdfium \
  BROWSER=<browser> node bench/scripts/fidelity.ts
```

2026-10-27, macOS, Playwright's Chromium, Firefox, and WebKit; pdfjs-dist
6.4.299, pdf.js master 157d30e83, `@embedpdf/pdfium` and hayro at the
versions the bench pins. In all three browsers, every variant where pdf.js
and PDFium agree above differs by at most 17 levels on at most 0.2% of the
sample, all on the fills' edges (anti-aliasing): the tolerance a match is
read with. The fixture differs by 153 levels on 18.8% of the sample in all
three.

Earlier fidelity runs read pages back without compositing them over white,
so pages PDFium and hayro leave transparent (pages with transparency, as
`pdfium.worker.ts` draws them) differed from pdf.js's opaque canvases
wherever nothing was drawn: 87.6% of this fixture. `bench/src/harness.ts`
now composites the readback over white, as the page shows it. pdf.js's
canvases are opaque, so the `-frame` comparisons of decisions 0005 and 0006
read the same pixels as before.

## For a pdf.js update

Rerun the comparison above with the new pdfjs-dist. The fixture differing
from PDFium by more than the edge tolerance means pdf.js still paints the
mask; matching it means pdf.js now treats `G` as a group. The `smask-group*`
variants must keep matching.

## Draft report for pdf.js

**Title:** A soft mask whose G has no /Group is painted as page content

**Describe the bug.** When an `/SMask` dictionary's `G` is a form XObject
without a `/Group` dictionary, pdf.js does not apply the mask: it paints `G`'s
content on the page, then the masked content over it. ISO 32000 requires `G`
to be a transparency group, so the file is not conforming, but PDFium (the
file is its pixel test `smask_blend.in`) and hayro treat `G` as a group and
draw what the file means; pdf.js shows the mask itself.

**Cause.** `PartialEvaluator.buildFormXObject` only builds a group for a form
with `/Group`; otherwise it appends the form's operators to the current list,
and the `smask` options `handleSMask` passed are not used.

**Steps.** Open the attached file (PDFium's `smask_blend.in`, and the same
file with `/Group << /S /Transparency >>` added to object 6). Expected: gray
in the right half of the lower left quarter only, as with the `/Group`. Actual:
a black and gray band across the top half of that quarter.

**Suggestion.** When building a soft mask, treat `G` as a transparency group
even without `/Group` (non-isolated, non-knockout), as PDFium does.
