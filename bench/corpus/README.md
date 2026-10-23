# Benchmark corpus

Every bundled document has a redistributable license. The files were copied
unchanged from the pylopdf real-world corpus, which documents the same sources.
Generated stress documents live in `generated/`, are recreated with
`pnpm --filter @parapdf/bench corpus`, and are not committed.

## Bundled files

| File | Source | License | Coverage |
|---|---|---|---|
| `f1040.pdf` | [irs.gov](https://www.irs.gov/pub/irs-pdf/f1040.pdf) | US government work, public domain | AcroForm, tagged PDF, object streams |
| `usrguide.pdf` | [latex-project.org](https://www.latex-project.org/help/documentation/usrguide.pdf) | LPPL, freely redistributable | pdfTeX output, subset Type 1 fonts, formulas |
| `bill-hr815.pdf` | [govinfo.gov](https://www.govinfo.gov/content/pkg/BILLS-118hr815enr/pdf/BILLS-118hr815enr.pdf), H.R. 815, 118th Congress | US government work, public domain | Long GPO-typeset text document |
| `mhlw-doc.pdf` | [mhlw.go.jp](https://www.mhlw.go.jp/content/11201250/001526113.pdf), Study Group on “Workers” under the Labor Standards Act, material 2-1 | [Government Standard Terms of Use 2.0](https://www.digital.go.jp/resources/open_data/), CC BY 4.0 compatible | Embedded CJK CID fonts, mixed vertical and horizontal layout |
| `bunka-kokugo-series-019-p4.pdf` | [Agency for Cultural Affairs](https://www.bunka.go.jp/kokugo_nihongo/sisaku/joho/joho/series/19/19.html), *Kokugo Series No. 19*, source PDF page 4 | [Government Standard Terms of Use 2.0](https://www.digital.go.jp/resources/open_data/), CC BY 4.0 compatible | 3311×4681 image-only Japanese scan |
| `patent-us223898.pdf` | [Google Patents](https://patents.google.com/patent/US223898A), Edison's 1880 light-bulb patent | Public-domain US patent | CCITTFaxDecode scan with an OCR text layer |
| `wdl6812-manuscript.pdf` | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Illuminated_Panel_and_Qur%27anic_Chapter_WDL6812.pdf) | Public domain | Color scan using DCTDecode and JBIG2Decode |
| `nics-background-checks-2015-11.pdf` | FBI NICS monthly report via the [pdfplumber test corpus](https://github.com/jsvine/pdfplumber/blob/stable/tests/pdfs/nics-background-checks-2015-11.pdf) | US government work, public domain | Dense vector table, rotated page |
| `pdfium-type3.pdf` | [PDFium `type3.in`](https://github.com/chromium/pdfium/blob/a84323421e94f484faca52dd9d027934eba42ab8/testing/resources/pixel/type3.in) | PDFium BSD 3-Clause; see [`LICENSES/PDFium-BSD-3-Clause.txt`](LICENSES/PDFium-BSD-3-Clause.txt) | Type 3 glyph programs |
| `pdfium-smask-blend.pdf` | [PDFium `smask_blend.in`](https://github.com/chromium/pdfium/blob/a84323421e94f484faca52dd9d027934eba42ab8/testing/resources/pixel/smask_blend.in) | PDFium BSD 3-Clause | Transparency groups, soft masks, blend modes |
| `pdfium-jpx-lzw.pdf` | [PDFium `jpx_lzw.pdf`](https://github.com/chromium/pdfium/blob/a84323421e94f484faca52dd9d027934eba42ab8/testing/resources/jpx_lzw.pdf) | PDFium BSD 3-Clause | JPEG 2000 nested behind LZW |

## Generated files

`bench/scripts/gen-synthetic.ts` writes deterministic stress documents:

- `synthetic-text-1000.pdf` — 1,000 pages of Helvetica text, for long-document
  behavior.
- `synthetic-vector-200k.pdf` — one A3 page with 200,000 stroked segments, for
  operator-heavy drawings such as maps and plans.
- `synthetic-cjk-nonembedded.pdf` — Japanese text in a non-embedded
  Adobe-Japan1 CID font, the common case for older Word-generated documents.
- `synthetic-mixed-sizes.pdf` — eight pages of different sizes and
  orientations (A4, A3 landscape, Letter, A5, and an A4 page shown landscape
  by /Rotate 90), for page placement and fitting the page width.
- `synthetic-features.pdf` — six pages with page labels (i, ii, 1–4), an
  embedded file, two layers (optional content) of which one starts hidden, a
  comment with a popup, form fields of every common kind, metadata, and text
  for search options.
- `synthetic-encrypted.pdf` — three pages encrypted with the user password
  `parapdf` (standard security handler, revision 2), for password prompts.
- `synthetic-restricted.pdf` — two pages with text and a text field,
  encrypted without a user password and with permissions (/P -64) that
  refuse printing, changing, copying, and annotating, for viewers that
  follow permissions.
- `synthetic-navigation.pdf` — four pages that ask how they are shown
  (/OpenAction to page 3 at 200%, /PageLayout /TwoColumnLeft, /PageMode
  /UseOutlines), with links on page 1 to a destination of every kind (XYZ
  with and without a zoom, Fit, FitH, FitV, FitR) and an outline.
