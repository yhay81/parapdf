import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import type { PdfEngine, PdfEngineDocument, PdfSource } from "../src/engine/types.ts";
import { acquireDocument, sourceKey } from "../src/runtime/documents.ts";

/** An engine that counts opened and destroyed documents; `fail` rejects every open. */
function countingEngine(fail = false) {
  const counts = { opens: 0, destroys: 0 };
  const engine: PdfEngine = {
    name: "counting",
    async open() {
      counts.opens++;
      if (fail) throw new Error("not a PDF");
      return {
        pageCount: 1,
        destroy: async () => {
          counts.destroys++;
        },
      } as unknown as PdfEngineDocument;
    },
  };
  return { engine, counts };
}

/** Lets the promise callbacks queued by a release run. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

describe("acquireDocument", () => {
  beforeEach(() => mock.timers.enable({ apis: ["setTimeout"] }));
  afterEach(() => mock.timers.reset());

  it("shares one document among viewers of the same URL", async () => {
    const { engine, counts } = countingEngine();
    const a = acquireDocument(engine, { url: "/a.pdf" });
    const b = acquireDocument(engine, { url: "/a.pdf" });
    const c = acquireDocument(engine, { url: "/b.pdf" });
    assert.equal(await a.document, await b.document);
    assert.notEqual(await a.document, await c.document);
    assert.equal(counts.opens, 2);
  });

  it("destroys a document a second after its last viewer releases it", async () => {
    const { engine, counts } = countingEngine();
    const a = acquireDocument(engine, { url: "/a.pdf" });
    const b = acquireDocument(engine, { url: "/a.pdf" });
    await a.document;
    a.release();
    b.release();
    b.release(); // A second release of the same lease changes nothing.
    mock.timers.tick(999);
    await settle();
    assert.equal(counts.destroys, 0);
    mock.timers.tick(1);
    await settle();
    assert.equal(counts.destroys, 1);
    // A later viewer opens it again.
    await acquireDocument(engine, { url: "/a.pdf" }).document;
    assert.equal(counts.opens, 2);
  });

  it("keeps the document for a viewer that comes back within the delay", async () => {
    const { engine, counts } = countingEngine();
    // StrictMode mounts, unmounts, and mounts again.
    const first = acquireDocument(engine, { url: "/a.pdf" });
    first.release();
    const second = acquireDocument(engine, { url: "/a.pdf" });
    mock.timers.tick(5000);
    await settle();
    assert.equal(await first.document, await second.document);
    assert.deepEqual(counts, { opens: 1, destroys: 0 });
  });

  it("forgets a failed open, so the next viewer tries again", async () => {
    const { engine, counts } = countingEngine(true);
    await assert.rejects(acquireDocument(engine, { url: "/a.pdf" }).document, /not a PDF/);
    await assert.rejects(acquireDocument(engine, { url: "/a.pdf" }).document, /not a PDF/);
    assert.equal(counts.opens, 2);
  });

  it("shares data sources by the identity of their bytes", async () => {
    const { engine, counts } = countingEngine();
    const bytes = new Uint8Array([37, 80, 68, 70]);
    await acquireDocument(engine, { data: bytes }).document;
    await acquireDocument(engine, { data: bytes }).document;
    await acquireDocument(engine, { data: bytes.slice() }).document;
    assert.equal(counts.opens, 2);
  });
});

describe("sourceKey", () => {
  it("is equal for the same URL in another object", () => {
    const a: PdfSource = { url: "/a.pdf" };
    assert.equal(sourceKey(a), sourceKey({ url: "/a.pdf" }));
    assert.notEqual(sourceKey(a), sourceKey({ url: "/b.pdf" }));
  });

  it("is the bytes themselves for data", () => {
    const data = new ArrayBuffer(8);
    assert.equal(sourceKey({ data }), data);
  });
});
