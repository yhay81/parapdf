import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { connectSession, PdfSession } from "../src/document/pdf-session.ts";
import { getText, type TextOptions } from "../src/features/text/index.ts";
import { fakeDocument, fakePdfjs, LETTER, settle } from "./fake-pdfjs.ts";

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
    const session = new PdfSession(
      { url: "/a.pdf" },
      { pdfjs: fakePdfjs(async () => document.proxy).loader },
    );
    close.push(connectSession(session));
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

  it("rejects while no document is open, and with the reason its signal aborts with", async () => {
    await assert.rejects(getText(new PdfSession({ url: "/none.pdf" })), /No document is open/);
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
  });
});
