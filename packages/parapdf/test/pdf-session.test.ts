import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import type { PDFDataRangeTransport } from "pdfjs-dist";
import { PdfSessionController } from "../src/document/pdf-session.ts";
import { OPENING, type PdfjsLoader } from "../src/document/registry.ts";
import type { PdfSource } from "../src/document/session.ts";
import { initialFormFields } from "../src/features/forms/index.ts";
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

const readPageLabels = (session: PdfSessionController) =>
  session.read("pageLabels", (doc) => doc.pageLabels(), null);
const readOutline = (session: PdfSessionController) =>
  session.read("outline", (doc) => doc.outline(), []);
const readMetadata = (session: PdfSessionController) =>
  session.read("metadata", (doc) => doc.metadata(), null);
const readInitialView = (session: PdfSessionController) =>
  session.read("initialView", (doc) => doc.initialView(), null);

/**
 * pdf.js whose labelled document opens with the password "secret" alone;
 * `reads` counts the reads of its page labels.
 */
const lockedPdfjs = () => {
  const reads = { labels: 0, fields: 0 };
  const proxy = fakeDocument({
    proxy: {
      getFieldObjects: async () => {
        reads.fields++;
        return null;
      },
      getPageLabels: async () => {
        reads.labels++;
        return ["i"];
      },
    },
  }).proxy;
  const pdfjs = fakePdfjs(async (task, { password: given }) => {
    let password = given;
    while (password !== "secret") {
      const answer = await askPassword(task, password === undefined ? "required" : "incorrect");
      if (answer === null) throw new PasswordException("No password given", 1);
      password = answer;
    }
    return proxy;
  });
  return { ...pdfjs, reads };
};

describe("a PdfSession's source and fragment", () => {
  it("is the source given when it has no fragment to take out", () => {
    const url: PdfSource = { url: "/a.pdf", withCredentials: true };
    const data: PdfSource = { data: new Uint8Array(4) };
    const range = new FakeRangeTransport(4, null) as unknown as PDFDataRangeTransport;
    const ranged: PdfSource = { range, password: "x" };
    for (const source of [url, data, ranged]) {
      const session = new PdfSessionController(source);
      assert.equal(session.source, source);
      assert.equal(session.fragment.get().fragment, "");
    }
  });

  it("keeps everything after the URL's first # as its fragment, and the rest of the source", () => {
    const session = new PdfSessionController({ url: "/a.pdf?v=1#nameddest=a#b", password: "x" });
    assert.deepEqual(session.source, { url: "/a.pdf?v=1", password: "x" });
    assert.equal(session.fragment.get().fragment, "nameddest=a#b");
  });

  it("tells the fragment's readers of a new fragment only", () => {
    const session = new PdfSessionController({ url: "/a.pdf#page=2" });
    const heard: string[] = [];
    session.fragment.subscribe(() => heard.push(session.fragment.get().fragment));
    session.setFragment("page=2");
    session.setFragment("page=3");
    session.setFragment("page=3");
    session.setFragment("");
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
    const session = new PdfSessionController(source, { passwordPrompt, pdfjs: loader });
    close.push(session.connect());
    return session;
  };

  it("shows the document opening before a provider holds it, and reads it once held", async () => {
    const { loader } = fakePdfjs(async () => labelled());
    const session = new PdfSessionController({ url: "/a.pdf" }, { pdfjs: loader });
    assert.deepEqual(session.state, OPENING);
    assert.equal(session.proxy, null);
    assert.equal(session.signal.aborted, false);
    session.submitPassword("secret"); // Nothing asks yet.
    const labels = readPageLabels(session);
    const loaded = session.document();
    close.push(session.connect());
    assert.deepEqual(await labels, ["i"]);
    assert.equal((await loaded).proxy, session.proxy);
    assert.ok(session.proxy);
  });

  it("stops what was started for it when let go, once, and gives the next hold a new signal", async () => {
    const { loader } = lockedPdfjs();
    const session = new PdfSessionController({ url: "/locked.pdf" }, { pdfjs: loader });
    const release = session.connect();
    const first = session.signal;
    await settle();
    release();
    assert.equal(first.aborted, true);
    session.submitPassword("secret"); // Let go: it answers nothing.
    await settle();
    assert.equal(session.state.status, "password");
    close.push(session.connect());
    const second = session.signal;
    assert.notEqual(second, first);
    release(); // A second call of the first release changes nothing.
    assert.equal(second.aborted, false);
    let heard = 0;
    session.stateStore.subscribe(() => heard++);
    session.submitPassword("secret");
    await settle();
    assert.equal(session.state.status, "ready");
    assert.ok(heard > 0, "the new hold still hears the session");
  });

  it("takes no password from a provider that let the document go, while another still may", async () => {
    const { loader } = lockedPdfjs();
    const gone = new PdfSessionController({ url: "/locked.pdf" }, { pdfjs: loader });
    const release = gone.connect();
    const staying = provide({ url: "/locked.pdf" }, loader);
    await settle();
    release();
    gone.submitPassword("secret");
    await settle();
    assert.equal(staying.state.status, "password");
    staying.submitPassword("secret");
    await settle();
    assert.equal(staying.state.status, "ready");
  });

  it("accepts the password from a mounted child before its provider's effect", async () => {
    const { loader } = lockedPdfjs();
    const session = new PdfSessionController({ url: "/locked.pdf" }, { pdfjs: loader });
    session.start();
    assert.equal(await readPageLabels(session), null, "the Suspense boundary now commits");
    assert.equal(session.state.status, "password");
    session.submitPassword("secret");
    close.push(session.connect());
    await settle();
    assert.equal(session.state.status, "ready");
    assert.deepEqual(await readPageLabels(session), ["i"]);
  });

  it("only applies a child's early answer to the request the child saw", async () => {
    const { loader } = lockedPdfjs();
    const first = provide({ url: "/locked.pdf" }, loader);
    await settle();
    const later = new PdfSessionController(first.source, { pdfjs: loader });
    later.start();
    later.submitPassword("secret");
    first.submitPassword("wrong");
    await settle();
    close.push(later.connect());
    await settle();
    assert.equal(later.state.passwordReason, "incorrect");
    later.submitPassword("secret");
    await settle();
    assert.equal(later.state.status, "ready");
  });

  it("ignores a password typed after the provider let go, even once it holds again", async () => {
    const { loader } = lockedPdfjs();
    const session = new PdfSessionController({ url: "/locked.pdf" }, { pdfjs: loader });
    const release = session.connect();
    await settle();
    release();
    session.submitPassword("secret");
    close.push(session.connect());
    await settle();
    assert.equal(session.state.status, "password");
  });

  it("gives a new provider of a ready document its proxy on the first render", async () => {
    const { loader } = fakePdfjs(async () => labelled());
    const first = provide({ url: "/a.pdf" }, loader);
    await settle();
    assert.ok(first.proxy);
    const second = new PdfSessionController({ url: "/a.pdf" }, { pdfjs: loader });
    second.start();
    assert.equal(second.state.status, "ready");
    assert.equal(second.proxy, first.proxy);
  });

  it("retries failed data reads for a fresh provider and keeps the promise stable through Suspense", async (context) => {
    context.mock.method(console, "error", () => {});
    let attempts = 0;
    const { loader } = fakePdfjs(
      async () =>
        fakeDocument({
          proxy: {
            getPageLabels: async () => {
              if (++attempts === 1) throw new Error("interrupted transfer");
              return ["i"];
            },
          },
        }).proxy,
    );
    const first = provide({ url: "/a.pdf" }, loader);
    const labels = readPageLabels(first);
    assert.equal(await labels, null);
    const outline = readOutline(first);
    await outline;
    const render = () => {
      const session = new PdfSessionController(first.source, { pdfjs: loader });
      session.start();
      return session;
    };
    const next = render();
    const retry = readPageLabels(next);
    assert.equal(readPageLabels(render()), retry, "a suspended render finds the same promise");
    const failedReads = next.reads;
    const published: (object | null)[] = [];
    const unsubscribe = next.stateStore.subscribe(() => published.push(next.reads));
    close.push(next.connect());
    unsubscribe();
    assert.notEqual(next.reads, failedReads, "React must read the document again");
    assert.deepEqual(published, [next.reads], "mounted data hooks hear about the retry");
    assert.deepEqual(await readPageLabels(next), ["i"], "a new provider can recover");
    assert.equal(readOutline(next), outline, "successful reads are still shared");
    assert.equal(attempts, 2);
  });

  it("opens the document again when held after it failed to open", async () => {
    let fail = true;
    const { loader, calls } = fakePdfjs(async () => {
      if (fail) throw new Error("not a PDF");
      return labelled();
    });
    const session = new PdfSessionController({ url: "/a.pdf" }, { pdfjs: loader });
    const release = session.connect();
    await settle();
    assert.equal(session.state.status, "error");
    assert.equal(await readPageLabels(session), null);
    await assert.rejects(session.document(), /not a PDF/);
    release();
    fail = false;
    close.push(session.connect());
    assert.equal(session.state.status, "loading");
    await settle();
    assert.equal(session.state.status, "ready");
    assert.deepEqual(await readPageLabels(session), ["i"], "read from the document opened again");
    assert.equal((await session.document()).proxy, session.proxy);
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
    assert.equal(await readPageLabels(ready), null);
    assert.equal(errors.mock.callCount(), 1);
    assert.equal(errors.mock.calls[0]?.arguments[0], "loading pageLabels failed");
    const failed = provide(
      { url: "/broken.pdf" },
      fakePdfjs(async () => {
        throw new Error("not a PDF");
      }).loader,
    );
    assert.equal(await readPageLabels(failed), null);
    assert.equal(await readInitialView(failed), null);
    assert.equal(errors.mock.callCount(), 1, "the document's state says it failed");
  });

  it("keeps one snapshot of a request shown as an error, and of any other state", async () => {
    const { loader } = lockedPdfjs();
    const prompted = provide({ url: "/locked.pdf" }, loader);
    const session = provide({ url: "/locked.pdf" }, loader, false);
    await settle();
    const shown = session.state;
    assert.equal(shown.status, "error");
    assert.equal(session.state, shown);
    let heard = 0;
    session.stateStore.subscribe(() => heard++);
    session.setPasswordPrompt(false);
    assert.equal(heard, 0, "the prompt did not change");
    session.setPasswordPrompt(true);
    assert.equal(heard, 1);
    assert.equal(session.state, prompted.state);
    session.setPasswordPrompt(false);
    assert.equal(session.state.status, "error");
    prompted.submitPassword("secret");
    await settle();
    assert.equal(session.state.status, "ready");
    assert.equal(session.state, prompted.state, "what is no request shows as it is");
  });

  it("settles what is read while the document waits for a password, and reads it anew once answered", async () => {
    const { loader, reads } = lockedPdfjs();
    const session = provide({ url: "/locked.pdf" }, loader);
    // A render that reads it would wait above the prompt it is to show.
    const early = readPageLabels(session);
    await settle();
    assert.equal(session.state.status, "password");
    assert.equal(await early, null, "settled by the request");
    assert.equal(readPageLabels(session), early, "one promise while it waits");
    assert.equal(await readMetadata(session), null);
    session.submitPassword("wrong");
    await settle();
    assert.equal(session.state.passwordReason, "incorrect");
    const waiting = session.reads;
    const settled = readPageLabels(session);
    assert.equal(await settled, null, "and by the next request");
    assert.equal(reads.labels, 0);
    session.submitPassword("secret");
    assert.notEqual(session.reads, waiting, "its readers are to read again");
    const again = readPageLabels(session);
    assert.notEqual(again, settled);
    assert.equal(readPageLabels(session), again, "one read until it settles");
    await settle();
    assert.equal(session.state.status, "ready");
    assert.deepEqual(await again, ["i"]);
    assert.notEqual(await readInitialView(session), null, "first read once it opened");
    assert.equal(reads.labels, 1, "the document read once");
  });

  it("opens the document as a render starts it, and gives every session of the source one read", async () => {
    const { loader, calls } = fakePdfjs(async () => labelled());
    const first = new PdfSessionController({ url: "/a.pdf" }, { pdfjs: loader });
    first.start();
    assert.equal(first.state.status, "loading");
    const labels = readPageLabels(first);
    // React renders a tree that suspended as it mounted from nothing: with another session.
    const second = new PdfSessionController({ url: "/a.pdf#page=2" }, { pdfjs: loader });
    second.start();
    assert.equal(readPageLabels(second), labels, "the promise the first render waits for");
    assert.equal(second.reads, first.reads);
    await settle();
    assert.deepEqual(await labels, ["i"]);
    assert.equal(second.state.status, "ready");
    assert.ok(second.proxy);
    close.push(second.connect());
    assert.equal(readPageLabels(second), labels, "held, it reads what its render read");
    assert.equal((await second.document()).proxy, second.proxy);
    assert.equal(calls.opens, 1);
  });

  it("leaves a document no provider came to hold closed, until one holds it", async () => {
    const { loader, calls } = fakePdfjs(async () => labelled());
    const session = new PdfSessionController({ url: "/a.pdf" }, { pdfjs: loader });
    session.start();
    const labels = readPageLabels(session);
    await settle();
    assert.deepEqual(await labels, ["i"]);
    assert.ok(session.proxy);
    mock.timers.tick(10_000);
    await settle();
    assert.equal(session.proxy, null, "the registry closed it");
    assert.equal(calls.destroys, 1);
    // Its provider renders again, still not mounted: a render opens nothing twice.
    session.start();
    assert.equal(readPageLabels(session), labels);
    assert.deepEqual(await readOutline(session), [], "nothing more is read from it");
    assert.equal(calls.opens, 1);
    const closed = session.reads;
    const loaded = session.document();
    close.push(session.connect());
    assert.equal(session.state.status, "loading");
    assert.notEqual(session.reads, closed, "its readers read the document opened again");
    await settle();
    assert.equal((await loaded).proxy, session.proxy);
    assert.deepEqual(await readPageLabels(session), ["i"]);
    assert.equal(calls.opens, 2);
  });

  it("hears the document's state only while its own state has listeners", async () => {
    const { loader } = fakePdfjs(async () => labelled());
    // A provider React rendered and never mounted: nothing holds what it started.
    const rendered = new PdfSessionController({ url: "/a.pdf" }, { pdfjs: loader });
    rendered.start();
    const mounted = provide({ url: "/a.pdf" }, loader);
    let heard = 0;
    const unsubscribe = mounted.stateStore.subscribe(() => heard++);
    await settle();
    assert.equal(heard, 1, "ready");
    assert.equal(rendered.state.status, "ready", "read without listening");
    unsubscribe();
    unsubscribe();
    assert.equal(mounted.state.status, "ready");
  });

  it("settles form fields on a password error and reads them once after unlocking", async () => {
    const { loader, reads } = lockedPdfjs();
    const session = provide({ url: "/locked.pdf" }, loader, false);
    const initial = initialFormFields(session);
    assert.deepEqual(await initial, []);
    assert.equal(initialFormFields(session), initial);
    assert.equal(reads.fields, 0);
    session.submitPassword("secret");
    await settle();
    const unlocked = initialFormFields(session);
    assert.notEqual(unlocked, initial);
    assert.deepEqual(await unlocked, []);
    assert.equal(reads.fields, 1);
    assert.equal(initialFormFields(session), unlocked);
  });

  it("keeps what settled empty when its prompt shows again, until the request is answered", async () => {
    const { loader, reads } = lockedPdfjs();
    const session = provide({ url: "/locked.pdf" }, loader, false);
    await settle();
    const settled = readPageLabels(session);
    assert.equal(await settled, null);
    session.setPasswordPrompt(true);
    assert.equal(session.state.status, "password");
    // The prompt changes what the session shows of the request, not what it read.
    assert.equal(readPageLabels(session), settled);
    session.submitPassword("secret");
    const again = readPageLabels(session);
    assert.notEqual(again, settled);
    await settle();
    assert.deepEqual(await again, ["i"]);
    assert.equal(reads.labels, 1, "the document read once");
  });

  it("reads anew what settled empty while the request showed as an error, once another provider answers it", async () => {
    const { loader } = lockedPdfjs();
    const prompted = provide({ url: "/locked.pdf" }, loader);
    const session = provide({ url: "/locked.pdf" }, loader, false);
    await settle();
    assert.equal(await readPageLabels(session), null);
    prompted.submitPassword("secret");
    await settle();
    assert.deepEqual(await readPageLabels(session), ["i"]);
  });

  it("reads the document another provider unlocked while it showed the request as an error", async () => {
    const { loader } = lockedPdfjs();
    const prompted = provide({ url: "/locked.pdf" }, loader);
    const session = provide({ url: "/locked.pdf" }, loader, false);
    await settle();
    assert.equal(await readMetadata(session), null, "settled while the request shows as an error");
    prompted.submitPassword("secret");
    await settle();
    assert.equal(session.state.status, "ready");
    assert.deepEqual(await readPageLabels(session), ["i"]);
  });
});
