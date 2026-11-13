import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { connectSession, openDocumentOf, PdfSession } from "../src/document/pdf-session.ts";
import type { PdfSource } from "../src/document/session.ts";
import { download, save } from "../src/features/download.ts";
import { fakeDocument, fakePdfjs, settle } from "./fake-pdfjs.ts";

describe("save and download", () => {
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

  function mockDom(t: { after: (fn: () => void) => void; mock: typeof mock }) {
    const downloaded: string[] = [];
    const link = {
      style: {},
      download: "",
      href: "",
      click() {
        downloaded.push(this.download);
      },
      remove() {},
    };
    const previous = Object.getOwnPropertyDescriptor(globalThis, "document");
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: { body: { append() {} }, createElement: () => link },
    });
    t.after(() => {
      if (previous) Object.defineProperty(globalThis, "document", previous);
      else Reflect.deleteProperty(globalThis, "document");
    });
    t.mock.method(URL, "createObjectURL", () => "blob:test");
    t.mock.method(URL, "revokeObjectURL", () => {});
    return downloaded;
  }

  async function openSession(source: PdfSource, proxy: Record<string, unknown> = {}) {
    const doc = fakeDocument({ proxy });
    const session = new PdfSession(source, {
      pdfjs: fakePdfjs(async () => doc.proxy).loader,
    });
    const release = connectSession(session);
    close.push(release);
    await settle();
    return { session, release };
  }

  it("returns null before a session opens or after its provider releases it", async () => {
    const unopened = new PdfSession({ url: "/unopened.pdf" });
    assert.equal(await save(unopened), null);

    const { session, release } = await openSession({ url: "/open.pdf" });
    assert.deepEqual(await save(session), new Uint8Array([1]));
    release();
    assert.equal(await save(session), null);
  });

  it("saves and downloads the pages chosen without a Viewer, under the name given", async (t) => {
    const downloaded = mockDom(t);
    const asked: unknown[] = [];
    const { session } = await openSession(
      { url: "/a.pdf" },
      {
        extractPages: async (pages: unknown) => {
          asked.push(pages);
          return new Uint8Array([9]);
        },
      },
    );
    const pages = [{ includePages: [[0, 2] as [number, number]] }];
    assert.deepEqual(await save(session, { pages }), new Uint8Array([9]));
    await download(session, { filename: "part.pdf", pages });
    assert.equal(asked.length, 2);
    assert.equal(downloaded[0], "part.pdf");
  });

  it("saves after the scripts ran WillSave, and sends DidSave once saved", async () => {
    const steps: string[] = [];
    const { session } = await openSession(
      { url: "/scripted.pdf" },
      {
        getData: async () => {
          steps.push("save");
          return new Uint8Array([7]);
        },
      },
    );
    const doc = openDocumentOf(session);
    assert.ok(doc);
    const stop = new AbortController();
    doc.onCommit(() => {
      steps.push("commit");
    }, stop.signal);
    doc.onOutput(async (event) => {
      await Promise.resolve();
      steps.push(event);
    }, stop.signal);
    assert.deepEqual(await save(session), new Uint8Array([7]));
    assert.deepEqual(steps, ["commit", "WillSave", "save", "DidSave"]);
    stop.abort();
  });

  it("takes an empty filename as none given: the server's name, the URL's, or document.pdf", async (t) => {
    const downloaded = mockDom(t);
    const { session: served } = await openSession(
      { url: "/a.pdf" },
      {
        getMetadata: async () => ({
          info: {},
          metadata: null,
          contentDispositionFilename: "served.pdf",
        }),
      },
    );
    await download(served, { filename: "" });

    const { session: fromUrl } = await openSession({ url: "/folder/a.pdf#page=2" });
    await download(fromUrl, { filename: "" });

    const { session: fromBytes } = await openSession({ data: new Uint8Array([1, 2, 3]) });
    await download(fromBytes, { filename: "" });

    assert.deepEqual(downloaded, ["served.pdf", "a.pdf", "document.pdf"]);
  });
});
