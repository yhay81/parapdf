import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import type { PDFDataRangeTransport } from "pdfjs-dist";
import {
  connectSession,
  documentOf,
  fragmentOf,
  PdfSession,
  setFragment,
  setPasswordPrompt,
} from "../src/document/pdf-session.ts";
import { OPENING, type PdfjsLoader } from "../src/document/registry.ts";
import type { PdfSource } from "../src/document/session.ts";
import {
  askPassword,
  FakeRangeTransport,
  fakeDocument,
  fakePdfjs,
  PasswordException,
  settle,
} from "./fake-pdfjs.ts";

/** A document whose one page is labelled "i", which tells a read from its empty value. */
const labelled = () => fakeDocument({ proxy: { getPageLabels: async () => ["i"] } }).proxy;

/** pdf.js whose labelled document opens with the password "secret" alone. */
const lockedPdfjs = () =>
  fakePdfjs(async (task, { password: given }) => {
    let password = given;
    while (password !== "secret") {
      const answer = await askPassword(task, password === undefined ? "required" : "incorrect");
      if (answer === null) throw new PasswordException("No password given", 1);
      password = answer;
    }
    return labelled();
  });

describe("a PdfSession's source and fragment", () => {
  it("is the source given when it has no fragment to take out", () => {
    const url: PdfSource = { url: "/a.pdf", withCredentials: true };
    const data: PdfSource = { data: new Uint8Array(4) };
    const range = new FakeRangeTransport(4, null) as unknown as PDFDataRangeTransport;
    const ranged: PdfSource = { range, password: "x" };
    for (const source of [url, data, ranged]) {
      const session = new PdfSession(source);
      assert.equal(session.source, source);
      assert.equal(fragmentOf(session).get().fragment, "");
    }
  });

  it("keeps everything after the URL's first # as its fragment, and the rest of the source", () => {
    const session = new PdfSession({ url: "/a.pdf?v=1#nameddest=a#b", password: "x" });
    assert.deepEqual(session.source, { url: "/a.pdf?v=1", password: "x" });
    assert.equal(fragmentOf(session).get().fragment, "nameddest=a#b");
  });

  it("tells the fragment's readers of a new fragment only", () => {
    const session = new PdfSession({ url: "/a.pdf#page=2" });
    const heard: string[] = [];
    fragmentOf(session).subscribe(() => heard.push(fragmentOf(session).get().fragment));
    setFragment(session, "page=2");
    setFragment(session, "page=3");
    setFragment(session, "page=3");
    setFragment(session, "");
    assert.deepEqual(heard, ["page=3", ""]);
  });
});

describe("a PdfSession", () => {
  const close: (() => void)[] = [];

  beforeEach(() => mock.timers.enable({ apis: ["setTimeout"] }));

  afterEach(async () => {
    for (const release of close.splice(0)) release();
    mock.timers.tick(1000);
    await settle();
    mock.timers.reset();
  });

  /** A provider of `source`, as `<PdfDocument>` holds one. */
  const provide = (source: PdfSource, loader: PdfjsLoader, passwordPrompt = true) => {
    const session = new PdfSession(source, { passwordPrompt });
    close.push(connectSession(session, loader));
    return session;
  };

  it("shows the document opening before a provider holds it, and reads it once held", async () => {
    const { loader } = fakePdfjs(async () => labelled());
    const session = new PdfSession({ url: "/a.pdf" });
    assert.deepEqual(session.state.get(), OPENING);
    assert.equal(session.proxy, null);
    assert.equal(session.signal.aborted, false);
    session.submitPassword("secret"); // Nothing asks yet.
    const labels = session.pageLabels();
    const loaded = documentOf(session);
    close.push(connectSession(session, loader));
    assert.deepEqual(await labels, ["i"]);
    assert.equal((await loaded).proxy, session.proxy);
    assert.ok(session.proxy);
  });

  it("stops what was started for it when let go, once, and gives the next hold a new signal", async () => {
    const { loader } = lockedPdfjs();
    const session = new PdfSession({ url: "/locked.pdf" });
    const release = connectSession(session, loader);
    const first = session.signal;
    await settle();
    release();
    assert.equal(first.aborted, true);
    session.submitPassword("secret"); // Let go: it answers nothing.
    await settle();
    assert.equal(session.state.get().status, "password");
    close.push(connectSession(session, loader));
    const second = session.signal;
    assert.notEqual(second, first);
    release(); // A second call of the first release changes nothing.
    assert.equal(second.aborted, false);
    let heard = 0;
    session.state.subscribe(() => heard++);
    session.submitPassword("secret");
    await settle();
    assert.equal(session.state.get().status, "ready");
    assert.ok(heard > 0, "the new hold still hears the session");
  });

  it("takes no password from a provider that let the document go, while another still may", async () => {
    const { loader } = lockedPdfjs();
    const gone = new PdfSession({ url: "/locked.pdf" });
    const release = connectSession(gone, loader);
    const staying = provide({ url: "/locked.pdf" }, loader);
    await settle();
    release();
    gone.submitPassword("secret");
    await settle();
    assert.equal(staying.state.get().status, "password");
    staying.submitPassword("secret");
    await settle();
    assert.equal(staying.state.get().status, "ready");
  });

  it("opens the document again when held after it failed to open", async () => {
    let fail = true;
    const { loader, calls } = fakePdfjs(async () => {
      if (fail) throw new Error("not a PDF");
      return labelled();
    });
    const session = new PdfSession({ url: "/a.pdf" });
    const release = connectSession(session, loader);
    await settle();
    assert.equal(session.state.get().status, "error");
    assert.equal(await session.pageLabels(), null);
    await assert.rejects(documentOf(session), /not a PDF/);
    release();
    fail = false;
    close.push(connectSession(session, loader));
    assert.equal(session.state.get().status, "loading");
    await settle();
    assert.equal(session.state.get().status, "ready");
    assert.deepEqual(await session.pageLabels(), ["i"], "read from the document opened again");
    assert.equal((await documentOf(session)).proxy, session.proxy);
    assert.equal(calls.opens, 2);
  });

  it("reports a read that fails on a ready document, and nothing for one that failed", async (context) => {
    const errors = context.mock.method(console, "error", () => {});
    const { loader } = fakePdfjs(
      async () =>
        fakeDocument({
          proxy: {
            getPageLabels: async () => {
              throw new Error("broken labels");
            },
          },
        }).proxy,
    );
    const ready = provide({ url: "/a.pdf" }, loader);
    assert.equal(await ready.pageLabels(), null);
    assert.equal(errors.mock.callCount(), 1);
    assert.equal(errors.mock.calls[0]?.arguments[0], "loading pageLabels failed");
    const failed = provide(
      { url: "/broken.pdf" },
      fakePdfjs(async () => {
        throw new Error("not a PDF");
      }).loader,
    );
    assert.equal(await failed.pageLabels(), null);
    assert.equal(await failed.initialView(), null);
    assert.equal(errors.mock.callCount(), 1, "the document's state says it failed");
  });

  it("keeps one snapshot of a request shown as an error, and of any other state", async () => {
    const { loader } = lockedPdfjs();
    const prompted = provide({ url: "/locked.pdf" }, loader);
    const session = provide({ url: "/locked.pdf" }, loader, false);
    await settle();
    const shown = session.state.get();
    assert.equal(shown.status, "error");
    assert.equal(session.state.get(), shown);
    let heard = 0;
    session.state.subscribe(() => heard++);
    setPasswordPrompt(session, false);
    assert.equal(heard, 0, "the prompt did not change");
    setPasswordPrompt(session, true);
    assert.equal(heard, 1);
    assert.equal(session.state.get(), prompted.state.get());
    setPasswordPrompt(session, false);
    assert.equal(session.state.get().status, "error");
    prompted.submitPassword("secret");
    await settle();
    assert.equal(session.state.get().status, "ready");
    assert.equal(session.state.get(), prompted.state.get(), "what is no request shows as it is");
  });

  it("reads the document that opens once its prompt shows again", async () => {
    const { loader } = lockedPdfjs();
    const session = provide({ url: "/locked.pdf" }, loader, false);
    await settle();
    assert.equal(session.state.get().status, "error");
    assert.equal(await session.metadata(), null, "settled while the request shows as an error");
    setPasswordPrompt(session, true);
    assert.equal(session.state.get().status, "password");
    const labels = session.pageLabels();
    session.submitPassword("secret");
    await settle();
    assert.equal(session.state.get().status, "ready");
    assert.deepEqual(await labels, ["i"], "read while the request showed as such");
    assert.notEqual(await session.initialView(), null, "first read once it opened");
  });

  it("reads the document another provider unlocked while it showed the request as an error", async () => {
    const { loader } = lockedPdfjs();
    const prompted = provide({ url: "/locked.pdf" }, loader);
    const session = provide({ url: "/locked.pdf" }, loader, false);
    await settle();
    assert.equal(await session.metadata(), null, "settled while the request shows as an error");
    prompted.submitPassword("secret");
    await settle();
    assert.equal(session.state.get().status, "ready");
    assert.deepEqual(await session.pageLabels(), ["i"]);
  });
});
