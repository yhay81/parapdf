import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";
import { closeSession, DocumentSession } from "../src/document/session.ts";
import { fakeDocument, fakeLayers, fakePdfjs, LETTER, openSession, settle } from "./fake-pdfjs.ts";

const A4 = { width: 595, height: 842 };

describe("DocumentSession", () => {
  afterEach(() => mock.timers.reset());

  it("loads each of its pages from pdf.js once", async () => {
    const { session, requested } = await openSession({ pages: [LETTER, A4] });
    assert.equal(session.pageCount, 2);
    assert.equal(session.page(1), session.page(1));
    assert.deepEqual(await session.pageSize(1), A4);
    assert.deepEqual(requested, [1]);
  });

  it("retries failed text reads and shares the recovered text", async () => {
    const document = fakeDocument({ texts: [[{ str: "Recovered" }]] });
    const page = await document.proxy.getPage(1);
    let attempts = 0;
    const { session } = await openSession({
      proxy: {
        getPage: async () => ({
          ...page,
          async getTextContent() {
            if (++attempts === 1) throw new Error("text unavailable");
            return page.getTextContent();
          },
        }),
      },
    });
    await assert.rejects(session.text(0), /text unavailable/);
    const recovered = session.text(0);
    assert.equal(session.text(0), recovered);
    assert.deepEqual((await recovered).items, ["Recovered"]);
    assert.equal(attempts, 2);
  });

  it("gives every page the first one's size until the background pass learns the others", async () => {
    const { session, requested } = await openSession({ pages: [LETTER, A4, LETTER] });
    assert.deepEqual(await session.pageSizes(), [LETTER, LETTER, LETTER]);
    const measuring = session.measurePages();
    assert.equal(session.measurePages(), measuring, "once, for every viewer");
    assert.deepEqual(await measuring, [LETTER, A4, LETTER]);
    assert.deepEqual(await session.pageSizes(), [LETTER, A4, LETTER]);
    assert.deepEqual(requested, [0, 1, 2]);
  });

  it("stops measuring pages once it closes", async () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    const pages = Array.from({ length: 130 }, () => LETTER);
    const { session, requested } = await openSession({ pages });
    const measuring = session.measurePages();
    // The first page and the first batch of 64, which then waits for a timer.
    await settle();
    assert.equal(requested.length, 65);
    void closeSession(session);
    mock.timers.tick(0);
    await assert.rejects(measuring, { name: "AbortError" });
    assert.equal(requested.length, 65, "no other batch is asked for");
  });

  it("reads each page's text once, with its items' boxes", async () => {
    const { session } = await openSession({
      texts: [[{ str: "Hello", hasEOL: true, x: 72, y: 700, width: 30, height: 12 }, { str: "" }]],
    });
    const text = session.text(0);
    assert.equal(session.text(0), text);
    const { items, endsLine, boxes } = await text;
    assert.deepEqual(items, ["Hello", ""]);
    assert.deepEqual(endsLine, [true, false]);
    // From the page's top-left corner: the baseline at 792 - 700 = 92, the box above it.
    assert.deepEqual([...boxes.slice(0, 4)], [72, 80, 30, 12]);
  });

  it("keeps a page's parsing results while another viewer shows it", async () => {
    const { session, cleaned } = await openSession();
    await session.page(0);
    // Two viewers of the session mount the page; one unmounts it.
    session.holdPage(0);
    session.holdPage(0);
    session.releasePage(0);
    await settle();
    assert.deepEqual(cleaned, []);
    session.releasePage(0);
    await settle();
    assert.deepEqual(cleaned, [0]);
  });

  it("keeps a page parsed when a viewer shows it again before its cleanup", async () => {
    const { session, cleaned } = await openSession();
    await session.page(0);
    // React mounts a page again in the same commit, as StrictMode does.
    session.holdPage(0);
    session.releasePage(0);
    session.holdPage(0);
    await settle();
    assert.deepEqual(cleaned, []);
    session.releasePage(0);
    await settle();
    assert.deepEqual(cleaned, [0]);
  });

  it("reads again what failed to read, and keeps what it read", async () => {
    let outlines = 0;
    const { session } = await openSession({
      proxy: {
        async getOutline() {
          outlines++;
          if (outlines === 1) throw new Error("the outline did not load");
          return [];
        },
      },
    });
    await assert.rejects(session.outline(), /did not load/);
    assert.deepEqual(await session.outline(), []);
    assert.deepEqual(await session.outline(), []);
    assert.equal(outlines, 2);
  });

  it("releases pdf.js's parsing results of the pages it loaded, and asks for no other", async () => {
    const { session, requested, cleaned } = await openSession({ pages: [LETTER, LETTER] });
    await session.page(0);
    session.releasePage(0);
    session.releasePage(1);
    await settle();
    assert.deepEqual(cleaned, [0]);
    assert.deepEqual(requested, [0]);
  });

  it("reads what the document permits, everything when it is not encrypted", async () => {
    const open = await openSession();
    assert.deepEqual(await open.session.permissions(), {
      restricted: false,
      print: true,
      printHighQuality: true,
      modify: true,
      copy: true,
      copyForAccessibility: true,
      annotate: true,
      fillForms: true,
      assemble: true,
    });
    // Printing and filling forms only (PermissionFlag.PRINT and FILL_INTERACTIVE_FORMS).
    const { session } = await openSession({
      proxy: { getPermissions: async () => new Set([0x04, 0x100]) },
    });
    const permissions = await session.permissions();
    assert.equal(permissions.restricted, true);
    assert.equal(permissions.print, true);
    assert.equal(permissions.fillForms, true);
    assert.equal(permissions.copy, false);
    assert.equal(permissions.annotate, false);
  });

  it("reads how the document asks to be shown, and only the layouts and modes there are", async () => {
    const { session } = await openSession({
      pages: [LETTER, LETTER],
      proxy: {
        getOpenAction: async () => new Map([["dest", [1, { name: "XYZ" }, 72, 720, 2]]]),
        getPageLayout: async () => "TwoColumnLeft",
        getPageMode: async () => "UseOutlines",
      },
    });
    assert.deepEqual(await session.initialView(), {
      destination: { pageIndex: 1, x: 72, y: 72, view: { fit: "zoom", zoom: 2 } },
      pageLayout: "TwoColumnLeft",
      pageMode: "UseOutlines",
    });
    const other = await openSession({ proxy: { getPageLayout: async () => "Other" } });
    assert.deepEqual(await other.session.initialView(), {
      destination: null,
      pageLayout: null,
      pageMode: null,
    });
  });

  it("reads the page order the document asks for", async () => {
    const order = async (preferences: unknown) =>
      (
        await openSession({ proxy: { getViewerPreferences: async () => preferences } })
      ).session.direction();
    assert.equal(await order(new Map([["Direction", "R2L"]])), "rtl");
    assert.equal(await order(new Map([["Direction", "L2R"]])), "ltr");
    assert.equal(await order(new Map([["HideToolbar", true]])), null);
    assert.equal(await order(null), null);
  });

  it("reads the outline, page labels, metadata, and attachments", async () => {
    const { session } = await openSession({
      pages: [LETTER, LETTER],
      proxy: {
        getOutline: async () => [
          { title: "One", dest: "one", url: null, bold: true, italic: false, items: [] },
        ],
        getPageLabels: async () => ["i", "ii"],
        fingerprints: ["f00d", null],
        getMetadata: async () => ({
          info: { Title: " Report ", Author: "", PDFFormatVersion: "1.7", IsLinearized: true },
          metadata: { get: (name: string) => (name === "dc:creator" ? "Someone" : null) },
          contentDispositionFilename: "report.pdf",
          contentLength: 1234,
        }),
        getAttachments: async () => new Map([["a", { filename: "", description: " Data " }]]),
      },
    });
    assert.deepEqual(await session.outline(), [
      { title: "One", dest: "one", url: null, bold: true, italic: false, items: [] },
    ]);
    assert.deepEqual(await session.pageLabels(), ["i", "ii"]);
    const metadata = await session.metadata();
    assert.equal(metadata.title, "Report");
    assert.equal(metadata.author, "Someone", "XMP metadata wins");
    assert.equal(metadata.pdfVersion, "1.7");
    assert.equal(metadata.subject, null);
    assert.equal(metadata.filename, "report.pdf");
    assert.equal(metadata.length, 1234);
    assert.equal(metadata.linearized, true);
    assert.equal(metadata.fingerprint, "f00d");
    assert.deepEqual(await session.attachments(), [
      { id: "a", filename: "unnamed", description: "Data" },
    ]);
    // pdf.js returns labels only for documents that define them, one per page.
    const unlabelled = await openSession({
      pages: [LETTER, LETTER],
      proxy: { getPageLabels: async () => ["i"] },
    });
    assert.equal(await unlabelled.session.pageLabels(), null);
  });

  it("reads the downloaded length when metadata has no length", async () => {
    for (const contentLength of [null, 0]) {
      const { session } = await openSession({
        proxy: {
          getMetadata: async () => ({ info: {}, metadata: null, contentLength }),
          getDownloadInfo: async () => ({ length: 1234 }),
        },
      });
      assert.equal((await session.metadata()).length, 1234);
    }
    const { session } = await openSession({
      proxy: {
        getDownloadInfo: async () => {
          throw new Error("unavailable");
        },
      },
    });
    assert.equal((await session.metadata()).length, null);
  });

  it("shares one layer state, whose changes reach every viewer until its signal aborts", async () => {
    const display = fakeLayers({ a: { name: "A", visible: true } });
    const print = fakeLayers({ a: { name: "A", visible: true } });
    const { session } = await openSession({
      proxy: {
        getOptionalContentConfig: async ({ intent }: { intent: string }) =>
          intent === "print" ? print : display,
      },
    });
    const layers = await session.layers();
    assert.equal(await session.layers(), layers);
    const heard: string[] = [];
    const first = new AbortController();
    layers.subscribe(() => heard.push("first"), first.signal);
    layers.subscribe(() => heard.push("second"), new AbortController().signal);
    layers.setVisible("a", false);
    assert.deepEqual(heard, ["first", "second"]);
    assert.deepEqual(layers.layers(), [{ id: "a", name: "A", visible: false, children: [] }]);
    first.abort();
    layers.apply({ state: ["ON", "a"] });
    assert.deepEqual(heard, ["first", "second", "second"]);
    // Printing gets the same changes on a configuration of its own.
    assert.equal(await layers.forPrint(), print);
    assert.equal(print.getGroup("a")?.visible, true);
    layers.setVisible("a", false);
    await layers.forPrint();
    assert.equal(print.getGroup("a")?.visible, false);
  });

  it("saves the document's own bytes until something was typed or drawn into it", async () => {
    const storage = { size: 0, print: {} };
    const { session } = await openSession({ proxy: { annotationStorage: storage } });
    assert.deepEqual(await session.save(), new Uint8Array([1]));
    storage.size = 1;
    assert.deepEqual(await session.save(), new Uint8Array([2]));
  });

  it("saves the pages chosen through pdf.js's extractPages(), its own from its saved bytes once edited", async () => {
    const storage = { size: 0, print: {} };
    const { session } = await openSession({ proxy: { annotationStorage: storage } });
    const pages = [
      { includePages: [[0, 1]] },
      { document: new Uint8Array([9]), includePages: [0] },
    ];
    assert.deepEqual(await session.save(pages), new Uint8Array([3, 0, 9]));
    storage.size = 1;
    // saveDocument() gives [2]: the document with what was typed into it.
    assert.deepEqual(await session.save(pages), new Uint8Array([3, 2, 9]));
  });

  it("aborts its signal and destroys the document when it closes", async () => {
    const { session, calls } = await openSession();
    const stopped: string[] = [];
    session.signal.addEventListener("abort", () => stopped.push("work"));
    await closeSession(session);
    assert.equal(session.signal.aborted, true);
    assert.deepEqual(stopped, ["work"]);
    assert.equal(calls.destroys, 1);
  });

  it("stops a load that is aborted before pdf.js has loaded the document", async () => {
    let finish = (_proxy: unknown) => {};
    const { loader, calls } = fakePdfjs(
      () => new Promise((resolve) => (finish = resolve as (proxy: unknown) => void)),
    );
    const controller = new AbortController();
    const opening = DocumentSession.open(loader, { url: "/a.pdf" }, controller);
    await settle();
    controller.abort();
    assert.equal(calls.destroys, 1, "pdf.js's loading task is destroyed");
    finish(fakeDocument().proxy);
    await assert.rejects(opening, /destroyed/);
    // Already aborted: pdf.js is never asked.
    const aborted = new AbortController();
    aborted.abort();
    await assert.rejects(DocumentSession.open(loader, { url: "/b.pdf" }, aborted), {
      name: "AbortError",
    });
    assert.equal(calls.opens, 1);
  });

  it("explains a worker that did not load", async () => {
    const { loader } = fakePdfjs(async () => {
      throw new Error('Setting up fake worker failed: "Failed to fetch".');
    });
    await assert.rejects(
      DocumentSession.open(loader, { url: "/a.pdf" }, new AbortController()),
      /pdf\.js's worker did not load from \/pdf\.worker\.js/,
    );
  });
});
