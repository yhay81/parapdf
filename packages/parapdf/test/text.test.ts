import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { PdfSessionController } from "../src/document/pdf-session.ts";
import { searchOf } from "../src/features/search/index.ts";
import { pageText } from "../src/features/text/document-text.ts";
import { findText, getText, type TextOptions } from "../src/features/text/index.ts";
import type { PageText } from "../src/pdfjs/text.ts";
import { ViewerController } from "../src/view/viewer.ts";
import {
  type FakeDocumentOptions,
  fakeDocument,
  fakePdfjs,
  LETTER,
  settle,
  show,
} from "./fake-pdfjs.ts";

/** A page of text items; `endsLine` marks the items a line end follows. */
const page = (items: string[], endsLine: boolean[] = items.map(() => false)): PageText => ({
  items,
  endsLine,
  boxes: new Float32Array(items.length * 4),
});

describe("pageText", () => {
  const lines = page(["First ", "line", "Second line", "Third"], [false, true, true, false]);

  it("joins items in order and ends lines with a line break", () => {
    assert.equal(pageText(lines), "First line\nSecond line\nThird");
  });

  it("drops the line break after the page's last item", () => {
    assert.equal(pageText(page(["Only"], [true])), "Only");
  });

  it("joins lines as search does", () => {
    assert.equal(pageText(lines, "join"), "First line Second line Third");
    // A word hyphenated across lines, a dash that stays, and a CJK run.
    assert.equal(
      pageText(
        page(
          ["hyphen-", "ated", "well-", "Known", "日本", "語"],
          [true, true, true, false, true, false],
        ),
        "join",
      ),
      "hyphenated well-Known日本語",
    );
  });

  it("writes no second space where a line already ends with one", () => {
    assert.equal(
      pageText(page(["Ends with space ", "next"], [true, false]), "join"),
      "Ends with space next",
    );
    assert.equal(
      pageText(page(["Line", " starts with one"], [true, false]), "join"),
      "Line starts with one",
    );
  });

  it("reads from and to points on the page", () => {
    // From "line" in item 1 to before "line" in item 2.
    assert.equal(
      pageText(lines, "keep", { item: 1, offset: 0 }, { item: 2, offset: 7 }),
      "line\nSecond ",
    );
    assert.equal(
      pageText(lines, "join", { item: 0, offset: 6 }, { item: 3, offset: 0 }),
      "line Second line",
    );
    assert.equal(pageText(lines, "keep", { item: 3, offset: 2 }), "ird");
    // A point at an item's end excludes the line end after it.
    assert.equal(pageText(lines, "keep", null, { item: 1, offset: 4 }), "First line");
  });

  it("reads from a point up to another, the line end at a point included from it", () => {
    const end = { item: 1, offset: 4 };
    assert.equal(pageText(lines, "keep", end, end), "");
    assert.equal(pageText(lines, "keep", { item: 2, offset: 0 }, end), "");
    assert.equal(pageText(lines, "keep", end), "\nSecond line\nThird");
    assert.equal(pageText(lines, "join", end), "Second line Third");
  });

  it("writes no space for line ends at the start or end of a page", () => {
    const blankLines = page(["", "Text", ""], [true, true, true]);
    assert.equal(pageText(blankLines, "join"), "Text");
    assert.equal(pageText(blankLines), "\nText\n");
  });

  it("reads surrogate pairs whole", () => {
    assert.equal(
      pageText(page(["𝐀𝐁", "c"], [true, false]), "keep", { item: 0, offset: 2 }),
      "𝐁\nc",
    );
  });

  it("keeps a newline in the text itself when reading from a point", () => {
    const text = page(["First\n", "Last\n"], [true, false]);
    assert.equal(pageText(text), "First\n\nLast\n");
    assert.equal(pageText(text, "keep", { item: 0, offset: 0 }), "First\n\nLast\n");
    assert.equal(pageText(text, "keep", { item: 1, offset: 0 }), "Last\n");
    const lastLineEnds = page(["Last\n"], [true]);
    assert.equal(pageText(lastLineEnds, "keep", { item: 0, offset: 0 }), "Last\n");
    assert.equal(pageText(text, "keep", { item: 1, offset: 0 }, { item: 1, offset: 5 }), "Last\n");
  });
});

describe("getText", () => {
  const close: (() => void)[] = [];

  beforeEach(() => {
    mock.timers.enable({ apis: ["setTimeout"] });
  });

  afterEach(async () => {
    for (const release of close.splice(0)) release();
    mock.timers.tick(1000);
    await settle();
    mock.timers.reset();
  });

  /** A session of a document whose pages hold `lines`, an item each; texts read once `ready` resolves. */
  async function open(lines: string[][], ready?: Promise<unknown>) {
    const document = fakeDocument({
      pages: lines.map(() => LETTER),
      texts: lines.map((page) => page.map((str) => ({ str, hasEOL: true }))),
      ...(ready ? { textsReady: ready } : {}),
    });
    const session = new PdfSessionController(
      { url: "/a.pdf" },
      { pdfjs: fakePdfjs(async () => document.proxy).loader },
    );
    close.push(session.connect());
    await settle();
    return { session, textsRead: document.textsRead };
  }

  /** A promise and the function that resolves it. */
  function gate() {
    let release!: () => void;
    const ready = new Promise<void>((resolve) => {
      release = resolve;
    });
    return { ready, release };
  }

  it("joins the pages' texts with an empty line without mounting a Viewer", async () => {
    const { session } = await open([["One", "two"], [], ["Three"]]);
    const { text, pages } = await getText(session);
    assert.equal(text, "One\ntwo\n\n\n\nThree");
    assert.deepEqual(pages, [
      { pageIndex: 0, text: "One\ntwo", offset: 0 },
      { pageIndex: 1, text: "", offset: 9 },
      { pageIndex: 2, text: "Three", offset: 11 },
    ]);
  });

  it("reads from and to pages and points, page indexes clamped to the document's", async () => {
    const { session } = await open([["One", "two"], ["Three", "four"], ["Five"]]);
    const read = async (options: TextOptions) => (await getText(session, options)).text;
    assert.equal(await read({ from: 1 }), "Three\nfour\n\nFive");
    assert.equal(await read({ to: 0 }), "One\ntwo");
    assert.equal(await read({ from: -3, to: 99 }), "One\ntwo\n\nThree\nfour\n\nFive");
    assert.equal(await read({ from: 2, to: 1 }), "");
    // From "two" on the first page to before "four" on the second.
    const from = { pageIndex: 0, item: 1, offset: 0 };
    const to = { pageIndex: 1, item: 1, offset: 0 };
    assert.equal(await read({ from, to }), "two\n\nThree\n");
    assert.equal(
      await read({ from: { pageIndex: 1, item: 0, offset: 2 }, to: 1, lineBreaks: "join" }),
      "ree four",
    );
  });

  it("asks pdf.js for a few pages ahead, none past the end, and parses each once", async () => {
    const { ready, release } = gate();
    const { session, textsRead } = await open([["1"], ["2"], ["3"], ["4"], ["5"], ["6"]], ready);
    const reading = getText(session, { to: 4 });
    await settle();
    assert.deepEqual(textsRead, [0, 1, 2, 3]);
    release();
    assert.equal((await reading).text, "1\n\n2\n\n3\n\n4\n\n5");
    assert.deepEqual(textsRead, [0, 1, 2, 3, 4]);
    await getText(session);
    assert.deepEqual(textsRead, [0, 1, 2, 3, 4, 5]);
  });

  it("rejects while no document is open, when closed mid-read, or with the reason its signal aborts with", async () => {
    await assert.rejects(
      getText(new PdfSessionController({ url: "/none.pdf" })),
      /No document is open/,
    );
    const { ready, release } = gate();
    const { session } = await open([["One"], ["Two"]], ready);
    const reason = new Error("stopped");
    await assert.rejects(
      getText(session, { signal: AbortSignal.abort(reason) }),
      (error) => error === reason,
    );
    const abort = new AbortController();
    const reading = getText(session, { signal: abort.signal });
    await settle();
    abort.abort(reason);
    release();
    await assert.rejects(reading, (error) => error === reason);

    const closingGate = gate();
    const closingDoc = fakeDocument({
      pages: [LETTER],
      texts: [[{ str: "One" }]],
      textsReady: closingGate.ready,
    });
    const sessionToClose = new PdfSessionController(
      { url: "/closing-read.pdf" },
      { pdfjs: fakePdfjs(async () => closingDoc.proxy).loader },
    );
    const disconnect = sessionToClose.connect();
    await settle();
    const closingRead = getText(sessionToClose);
    await settle();
    disconnect();
    closingGate.release();
    await assert.rejects(closingRead, /The document was closed/);
  });
});

describe("findText", () => {
  const cancelFrame = Object.getOwnPropertyDescriptor(globalThis, "cancelAnimationFrame");
  const close: (() => void)[] = [];

  beforeEach(() => {
    mock.timers.enable({ apis: ["setTimeout"] });
    Object.defineProperty(globalThis, "cancelAnimationFrame", {
      configurable: true,
      value: () => {},
    });
  });

  afterEach(async () => {
    for (const release of close.splice(0)) release();
    mock.timers.tick(1000);
    await settle();
    mock.timers.reset();
    if (cancelFrame) Object.defineProperty(globalThis, "cancelAnimationFrame", cancelFrame);
    else Reflect.deleteProperty(globalThis, "cancelAnimationFrame");
  });

  async function openDoc(options: FakeDocumentOptions, url = "/find.pdf") {
    const document = fakeDocument(options);
    const { loader } = fakePdfjs(async () => document.proxy);
    const session = new PdfSessionController({ url }, { pdfjs: loader });
    close.push(session.connect());
    await settle();
    return { session, loader, textsRead: document.textsRead };
  }

  function gate() {
    let release!: () => void;
    const ready = new Promise<void>((resolve) => {
      release = resolve;
    });
    return { ready, release };
  }

  it("locates matches across page ranges without mounting a Viewer, and handles bounds and limit", async () => {
    const { session, textsRead } = await openDoc({
      pages: [LETTER, LETTER, LETTER, LETTER],
      texts: [
        [{ str: "Alpha beta", x: 72, y: 700, width: 100, height: 12, hasEOL: true }],
        [{ str: "Beta gamma", x: 72, y: 700, width: 100, height: 12, hasEOL: true }],
        [{ str: "Delta beta", x: 72, y: 700, width: 100, height: 12, hasEOL: true }],
        [{ str: "Omega", x: 72, y: 700, width: 50, height: 12, hasEOL: true }],
      ],
    });
    // Single-page lookup parses only that page.
    const single = await findText(session, "beta", { from: 1, to: 1 });
    assert.deepEqual(textsRead, [1]);
    assert.equal(single.length, 1);
    assert.equal(single[0]?.pageIndex, 1);
    assert.deepEqual(single[0]?.rects, [{ x: 72, y: 80, width: 40, height: 12 }]);
    assert.deepEqual(single[0]?.bounds, { x: 72, y: 80, width: 40, height: 12 });

    // Out-of-bounds, inverted, empty, or zero-limit queries touch no extra pages.
    assert.deepEqual(await findText(session, "beta", { from: 4, to: 4 }), []);
    assert.deepEqual(await findText(session, "beta", { from: -2, to: -1 }), []);
    assert.deepEqual(await findText(session, "beta", { from: 2, to: 1 }), []);
    assert.deepEqual(await findText(session, "beta", { from: Number.NaN }), []);
    assert.deepEqual(await findText(session, "beta", { limit: 0 }), []);
    assert.deepEqual(await findText(session, "   "), []);
    assert.deepEqual(textsRead, [1]);

    // `limit: 1` stops once page 0 satisfies it without reading page 2 or 3.
    const firstMatch = await findText(session, "beta", { limit: 1 });
    assert.equal(firstMatch.length, 1);
    assert.equal(firstMatch[0]?.pageIndex, 0);
    assert.deepEqual(firstMatch[0]?.rects, [{ x: 132, y: 80, width: 40, height: 12 }]);
    assert.deepEqual(textsRead, [1, 0]);

    // Full range reuses pages 0 and 1 and reads the rest once.
    const all = await findText(session, "beta", { from: -5, to: 99 });
    assert.deepEqual(
      all.map((m) => m.pageIndex),
      [0, 1, 2],
    );
    assert.deepEqual(textsRead, [1, 0, 2, 3]);
  });

  it("shares cached PageText and PageIndex with useSearch() without disturbing its state", async () => {
    const document = fakeDocument({
      pages: [LETTER, LETTER],
      texts: [
        [{ str: "Rose and tulip", x: 72, y: 700, width: 140, height: 12 }],
        [{ str: "Another Rose", x: 72, y: 700, width: 120, height: 12 }],
      ],
    });
    const { loader } = fakePdfjs(async () => document.proxy);
    const viewer = new ViewerController();
    const shown = show(viewer, { url: "/shared.pdf" }, loader);
    close.push(shown.close);
    await settle();

    const search = searchOf(viewer);
    search.get().search("tulip");
    for (let step = 0; step < 4; step++) {
      await settle();
      mock.timers.tick(0);
    }
    await settle();
    const beforeState = search.get();
    assert.equal(beforeState.status, "done");
    assert.equal(beforeState.query, "tulip");
    assert.equal(beforeState.matches.length, 1);
    assert.deepEqual(document.textsRead, [0, 1]);

    // Case-insensitive findText reuses both PageText and PageIndex; case-sensitive reuses PageText.
    const ci = await findText(shown.session, "rose");
    const cs = await findText(shown.session, "Rose", { caseSensitive: true, entireWord: true });
    assert.equal(ci.length, 2);
    assert.equal(cs.length, 2);
    assert.deepEqual(document.textsRead, [0, 1], "no page text was parsed again");
    assert.strictEqual(search.get(), beforeState, "viewer search state stayed untouched");
  });

  it("slices substrings, coalesces same-line runs, and splits multi-line CJK, hyphenated, and table matches", async () => {
    const { session } = await openDoc(
      {
        pages: [LETTER, LETTER, LETTER],
        texts: [
          // Page 0: multi-item kerning on line 1, plus a wide table gap on line 2, plus surrogate & combining marks.
          [
            { str: "Making ", x: 72, y: 720, width: 42, height: 12 },
            { str: "emer", x: 114, y: 720, width: 24, height: 12 },
            { str: "gency ", x: 138, y: 720, width: 36, height: 12 },
            { str: "appropriations", x: 174, y: 720, width: 84, height: 12, hasEOL: true },
            { str: "Total", x: 72, y: 690, width: 30, height: 12 },
            { str: " ", x: 102, y: 690, width: 300, height: 12 },
            { str: "$1,250", x: 402, y: 690, width: 42, height: 12, hasEOL: true },
            { str: "𠮷野家 cafe\u0301", x: 72, y: 660, width: 110, height: 12, hasEOL: true },
          ],
          // Page 1: Japanese word and English hyphenated word each broken across two lines, plus mixed CJK + ASCII.
          [
            { str: "通知：厚生", x: 420, y: 720, width: 80, height: 16, hasEOL: true },
            { str: "労働省の指針", x: 72, y: 696, width: 96, height: 16, hasEOL: true },
            { str: "two divi-", x: 450, y: 660, width: 54, height: 12, hasEOL: true },
            { str: "sions here", x: 72, y: 644, width: 60, height: 12, hasEOL: true },
            { str: "日本語 CMap 文書", x: 72, y: 610, width: 160, height: 16, hasEOL: true },
          ],
          // Page 2: half-width katakana.
          [{ str: "ﾃﾞｰﾀ処理", x: 72, y: 700, width: 70, height: 14, hasEOL: true }],
        ],
      },
      "/geometry.pdf",
    );

    // Multi-item single-line phrase coalesces into one tight PdfRect.
    const [coalesced] = await findText(session, "emergency appropriations", { from: 0, to: 0 });
    assert.ok(coalesced);
    assert.deepEqual(coalesced.rects, [{ x: 114, y: 60, width: 144, height: 12 }]);
    assert.deepEqual(coalesced.bounds, { x: 114, y: 60, width: 144, height: 12 });

    // Wide table gap (> 1.5 * height) keeps two separate column rects while bounds spans both.
    const [table] = await findText(session, "Total $1,250", { from: 0, to: 0 });
    assert.ok(table);
    assert.deepEqual(table.rects, [
      { x: 72, y: 90, width: 30, height: 12 },
      { x: 402, y: 90, width: 42, height: 12 },
    ]);
    assert.deepEqual(table.bounds, { x: 72, y: 90, width: 372, height: 12 });

    // Surrogate pair ("𠮷" weight 2 of total weight 6+1+4 = 11) and combining accent ("cafe\u0301" weight 4 of 11).
    const [surrogate] = await findText(session, "𠮷", { from: 0, to: 0 });
    const [accented] = await findText(session, "café", { from: 0, to: 0, matchDiacritics: true });
    assert.ok(surrogate && accented);
    assert.equal(surrogate.rects[0]?.x, 72);
    assert.ok(Math.abs((surrogate.rects[0]?.width ?? 0) - 20) < 0.01);
    assert.ok(Math.abs((accented.rects[0]?.x ?? 0) - 142) < 0.01);
    assert.ok(Math.abs((accented.rects[0]?.width ?? 0) - 40) < 0.01);

    // Multi-line Japanese word ("厚生労働") splits cleanly across line 1's end and line 2's start.
    const [kosei] = await findText(session, "厚生労働", { from: 1, to: 1 });
    assert.ok(kosei);
    assert.deepEqual(kosei.rects, [
      { x: 468, y: 56, width: 32, height: 16 },
      { x: 72, y: 80, width: 32, height: 16 },
    ]);
    assert.deepEqual(kosei.bounds, { x: 72, y: 56, width: 428, height: 40 });
    const readBack = await getText(session, {
      from: { pageIndex: kosei.pageIndex, ...kosei.start },
      to: { pageIndex: kosei.pageIndex, ...kosei.end },
      lineBreaks: "join",
    });
    assert.equal(readBack.text, "厚生労働");

    // Hyphenated English word ("divisions") splits across lines 3 and 4.
    const [divisions] = await findText(session, "divisions", { from: 1, to: 1 });
    assert.ok(divisions);
    assert.deepEqual(divisions.rects, [
      { x: 474, y: 120, width: 30, height: 12 },
      { x: 72, y: 136, width: 30, height: 12 },
    ]);

    // Full-width query matches ASCII "CMap" with East Asian width weighting (6+1 = 7 before, 4 match, 16 total).
    const [cmap] = await findText(session, "ＣＭａｐ", { from: 1, to: 1 });
    assert.ok(cmap);
    assert.deepEqual(cmap.rects, [{ x: 142, y: 166, width: 40, height: 16 }]);

    // Half-width katakana with a spacing voiced mark ("ﾃﾞｰﾀ" = 4 half-width cells, "処理" = 2 full-width cells = 4: 4/8 of 70 = 35).
    const [katakana] = await findText(session, "データ", { from: 2, to: 2 });
    assert.ok(katakana);
    assert.deepEqual(katakana.rects, [{ x: 72, y: 78, width: 35, height: 14 }]);
  });

  it("computes PdfPageRect-aligned boxes across /Rotate 90, 180, 270, /UserUnit, rotated CTM, RTL, and vertical CJK", async () => {
    const { session } = await openDoc(
      {
        pages: [
          { width: 300, height: 400 }, // Page 0: /Rotate 90, /UserUnit 2 (600x400 turned -> 800x600 physical points)
          { width: 600, height: 800 }, // Page 1: /Rotate 180
          { width: 600, height: 800 }, // Page 2: /Rotate 270
          { width: 600, height: 800 }, // Page 3: /Rotate 0 with RTL and vertical CJK
        ],
        rotations: [90, 180, 270, 0],
        userUnits: [2, 1, 1, 1],
        texts: [
          [
            // Unrotated CTM on /Rotate 90 + /UserUnit 2: advances downward (+y).
            { str: "ABCD", x: 50, y: 300, width: 80, height: 10 },
            // Counter-rotated CTM [0, 10, -10, 0, 100, 60]: advances rightward (+x) on /Rotate 90.
            { str: "WXYZ", transform: [0, 10, -10, 0, 100, 60], width: 80, height: 10 },
          ],
          [
            // Unrotated CTM on /Rotate 180: advances leftward (-x).
            { str: "ABCD", x: 100, y: 200, width: 80, height: 12 },
            // Counter-rotated CTM [-12, 0, 0, -12, 500, 100]: advances rightward (+x) on /Rotate 180.
            { str: "WXYZ", transform: [-12, 0, 0, -12, 500, 100], width: 80, height: 12 },
          ],
          [
            // Unrotated CTM on /Rotate 270: advances upward (-y).
            { str: "ABCD", x: 100, y: 200, width: 80, height: 12 },
            // Counter-rotated CTM [0, -12, 12, 0, 480, 700]: advances rightward (+x) on /Rotate 270.
            { str: "WXYZ", transform: [0, -12, 12, 0, 480, 700], width: 80, height: 12 },
          ],
          [
            // RTL run: logical start "AB" sits at the right half of [100, 180].
            { str: "ABCD", x: 100, y: 700, width: 80, height: 12, dir: "rtl" },
            // Vertical CJK column at (500, 600), width 18, height 80: advances downward (+y).
            {
              str: "縦書き字",
              x: 500,
              y: 600,
              width: 18,
              height: 80,
              transform: [18, 0, 0, 18, 500, 600],
              vertical: true,
            },
          ],
        ],
      },
      "/rotated.pdf",
    );

    // Page 0 (/Rotate 90, /UserUnit 2): "CD" is second half along +y; "YZ" is second half along +x.
    const [r90Down] = await findText(session, "CD", { from: 0, to: 0 });
    const [r90Right] = await findText(session, "YZ", { from: 0, to: 0 });
    assert.deepEqual(r90Down?.rects, [{ x: 600, y: 180, width: 20, height: 80 }]);
    assert.deepEqual(r90Right?.rects, [{ x: 200, y: 180, width: 80, height: 20 }]);

    // Page 1 (/Rotate 180): "CD" is left half [420, 460] along -x; "YZ" is right half [140, 180] along +x.
    const [r180Left] = await findText(session, "CD", { from: 1, to: 1 });
    const [r180Right] = await findText(session, "YZ", { from: 1, to: 1 });
    assert.deepEqual(r180Left?.rects, [{ x: 420, y: 200, width: 40, height: 12 }]);
    assert.deepEqual(r180Right?.rects, [{ x: 140, y: 88, width: 40, height: 12 }]);

    // Page 2 (/Rotate 270): "CD" is upper half [420, 460] along -y; "YZ" is right half [140, 180] along +x.
    const [r270Up] = await findText(session, "CD", { from: 2, to: 2 });
    const [r270Right] = await findText(session, "YZ", { from: 2, to: 2 });
    assert.deepEqual(r270Up?.rects, [{ x: 588, y: 420, width: 12, height: 40 }]);
    assert.deepEqual(r270Right?.rects, [{ x: 140, y: 108, width: 40, height: 12 }]);

    // Page 3: RTL "AB" sits at [140, 180]; vertical CJK "き字" sits at lower half [240, 280].
    const [rtl] = await findText(session, "AB", { from: 3, to: 3 });
    const [vertical] = await findText(session, "き字", { from: 3, to: 3 });
    assert.deepEqual(rtl?.rects, [{ x: 140, y: 88, width: 40, height: 12 }]);
    assert.deepEqual(vertical?.rects, [{ x: 491, y: 240, width: 18, height: 40 }]);
  });

  it("rejects while no document is open, when closed mid-search, or with the signal's abort reason", async () => {
    await assert.rejects(
      findText(new PdfSessionController({ url: "/none.pdf" }), "one"),
      /No document is open/,
    );
    const { ready, release } = gate();
    const { session } = await openDoc(
      {
        pages: [LETTER, LETTER],
        texts: [[{ str: "One" }], [{ str: "Two" }]],
        textsReady: ready,
      },
      "/abort.pdf",
    );
    const reason = new Error("cancelled");
    await assert.rejects(
      findText(session, "one", { signal: AbortSignal.abort(reason) }),
      (error) => error === reason,
    );
    const abort = new AbortController();
    const pending = findText(session, "two", { signal: abort.signal });
    await settle();
    abort.abort(reason);
    release();
    await assert.rejects(pending, (error) => error === reason);

    // Closing the session while searching rejects cleanly.
    const secondGate = gate();
    const document = fakeDocument({
      pages: [LETTER],
      texts: [[{ str: "One" }]],
      textsReady: secondGate.ready,
    });
    const sessionToClose = new PdfSessionController(
      { url: "/closing.pdf" },
      { pdfjs: fakePdfjs(async () => document.proxy).loader },
    );
    const disconnect = sessionToClose.connect();
    await settle();
    const closingSearch = findText(sessionToClose, "one");
    await settle();
    disconnect();
    secondGate.release();
    await assert.rejects(closingSearch, /The document was closed/);
  });
});
