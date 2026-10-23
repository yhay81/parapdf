/** A PDF of the benchmark corpus that the site serves under `/samples/`. */
export interface Sample {
  file: string;
  title: string;
  about: string;
  /** Where the file comes from; bench/corpus/README.md has its license. */
  source: string;
  sourceUrl: string;
  /** Written by bench/scripts/gen-synthetic.ts instead of committed. */
  generated?: boolean;
}

const generator = "https://github.com/yhay81/parapdf/blob/main/bench/scripts/gen-synthetic.ts";

export const samples: readonly Sample[] = [
  {
    file: "usrguide.pdf",
    title: "LaTeX2e for authors",
    about: "Links, an outline, and formulas",
    source: "The LaTeX Project",
    sourceUrl: "https://www.latex-project.org/help/documentation/usrguide.pdf",
  },
  {
    file: "bill-hr815.pdf",
    title: "H.R. 815, 118th Congress",
    about: "A long bill typeset by the GPO",
    source: "govinfo.gov",
    sourceUrl: "https://www.govinfo.gov/content/pkg/BILLS-118hr815enr/pdf/BILLS-118hr815enr.pdf",
  },
  {
    file: "synthetic-text-1000.pdf",
    title: "1,000 pages",
    about: "A thousand pages of text",
    source: "Generated",
    sourceUrl: generator,
    generated: true,
  },
  {
    file: "f1040.pdf",
    title: "Form 1040",
    about: "A fillable, tagged tax form",
    source: "Internal Revenue Service",
    sourceUrl: "https://www.irs.gov/pub/irs-pdf/f1040.pdf",
  },
  {
    file: "mhlw-doc.pdf",
    title: "“Workers” under the Labor Standards Act",
    about: "Japanese text, vertical and horizontal",
    source: "Ministry of Health, Labour and Welfare",
    sourceUrl: "https://www.mhlw.go.jp/content/11201250/001526113.pdf",
  },
  {
    file: "bunka-kokugo-series-019-p4.pdf",
    title: "Kokugo Series No. 19, page 4",
    about: "A Japanese page scanned at 3311 × 4681",
    source: "Agency for Cultural Affairs",
    sourceUrl: "https://www.bunka.go.jp/kokugo_nihongo/sisaku/joho/joho/series/19/19.html",
  },
  {
    file: "patent-us223898.pdf",
    title: "Edison's electric lamp patent",
    about: "An 1880 scan with an OCR text layer",
    source: "Google Patents",
    sourceUrl: "https://patents.google.com/patent/US223898A",
  },
  {
    file: "wdl6812-manuscript.pdf",
    title: "Illuminated panel and Qur'anic chapter",
    about: "A color manuscript scan",
    source: "Wikimedia Commons",
    sourceUrl:
      "https://commons.wikimedia.org/wiki/File:Illuminated_Panel_and_Qur%27anic_Chapter_WDL6812.pdf",
  },
  {
    file: "nics-background-checks-2015-11.pdf",
    title: "NICS background checks, November 2015",
    about: "A dense table on a rotated page",
    source: "FBI, via the pdfplumber test corpus",
    sourceUrl:
      "https://github.com/jsvine/pdfplumber/blob/stable/tests/pdfs/nics-background-checks-2015-11.pdf",
  },
  {
    file: "synthetic-vector-200k.pdf",
    title: "200,000 segments",
    about: "One A3 page of vector drawing",
    source: "Generated",
    sourceUrl: generator,
    generated: true,
  },
  {
    file: "synthetic-mixed-sizes.pdf",
    title: "Mixed page sizes",
    about: "A4, A3 landscape, Letter, A5, and a turned page",
    source: "Generated",
    sourceUrl: generator,
    generated: true,
  },
  {
    file: "synthetic-features.pdf",
    title: "Document features",
    about: "Page labels, layers, an attachment, a comment, and form fields",
    source: "Generated",
    sourceUrl: generator,
    generated: true,
  },
  {
    file: "synthetic-encrypted.pdf",
    title: "Encrypted",
    about: "Its password is “parapdf”",
    source: "Generated",
    sourceUrl: generator,
    generated: true,
  },
];

export const sampleUrl = (file: string) => `/samples/${file}`;

/** Sources and licenses of every sample. */
export const corpusReadme = "https://github.com/yhay81/parapdf/blob/main/bench/corpus/README.md";
