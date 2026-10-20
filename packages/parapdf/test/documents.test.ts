import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import type { OpenOptions, PdfEngine, PdfEngineDocument, PdfSource } from "../src/engine/types.ts";
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

/**
 * An engine whose documents need the password "secret": it reports progress,
 * then asks until it gets the password, and fails when it gets null.
 */
function lockedEngine() {
  const calls = { opens: 0, asked: [] as string[], aborted: 0 };
  const engine: PdfEngine = {
    name: "locked",
    async open(_source, options: OpenOptions = {}) {
      calls.opens++;
      options.signal?.addEventListener("abort", () => calls.aborted++);
      options.onProgress?.(10, 100);
      let reason: "required" | "incorrect" = "required";
      for (;;) {
        calls.asked.push(reason);
        const password = (await options.password?.(reason)) ?? null;
        if (password === null) throw new Error("PasswordException");
        if (password === "secret") break;
        reason = "incorrect";
      }
      options.onProgress?.(100, 100);
      return { pageCount: 1, destroy: async () => {} } as unknown as PdfEngineDocument;
    },
  };
  return { engine, calls };
}

describe("acquireDocument with passwords and progress", () => {
  beforeEach(() => mock.timers.enable({ apis: ["setTimeout"] }));
  afterEach(() => mock.timers.reset());

  it("asks every viewer of the document, and any of them may answer", async () => {
    const { engine, calls } = lockedEngine();
    const heard: string[] = [];
    const a = acquireDocument(
      engine,
      { url: "/locked.pdf" },
      {
        onPassword: (reason) => heard.push(`a:${reason}`),
      },
    );
    await settle();
    // A viewer that joins while the request is pending hears it too.
    const b = acquireDocument(
      engine,
      { url: "/locked.pdf" },
      {
        onPassword: (reason) => heard.push(`b:${reason}`),
      },
    );
    assert.deepEqual(heard, ["a:required", "b:required"]);
    a.submitPassword("wrong");
    await settle();
    assert.deepEqual(heard, ["a:required", "b:required", "a:incorrect", "b:incorrect"]);
    b.submitPassword("secret");
    assert.equal(await a.document, await b.document);
    assert.deepEqual(calls.asked, ["required", "incorrect"]);
    assert.equal(calls.opens, 1);
  });

  it("fails to open when a viewer gives up", async () => {
    const { engine } = lockedEngine();
    const lease = acquireDocument(engine, { url: "/locked.pdf" });
    await settle();
    lease.submitPassword(null);
    await assert.rejects(lease.document, /PasswordException/);
  });

  it("reports progress, also to viewers that join late", async () => {
    const { engine } = lockedEngine();
    const early: (number | null)[][] = [];
    const late: (number | null)[][] = [];
    const a = acquireDocument(
      engine,
      { url: "/locked.pdf" },
      {
        onProgress: (loaded, total) => early.push([loaded, total]),
      },
    );
    await settle();
    acquireDocument(
      engine,
      { url: "/locked.pdf" },
      {
        onProgress: (loaded, total) => late.push([loaded, total]),
      },
    );
    a.submitPassword("secret");
    await a.document;
    assert.deepEqual(early, [
      [10, 100],
      [100, 100],
    ]);
    assert.deepEqual(late, [
      [10, 100],
      [100, 100],
    ]);
  });

  it("stops loading once the last viewer leaves while it waits for a password", async () => {
    const { engine, calls } = lockedEngine();
    const lease = acquireDocument(engine, { url: "/locked.pdf" });
    await settle();
    lease.release();
    mock.timers.tick(1000);
    await settle();
    assert.equal(calls.aborted, 1);
    await assert.rejects(lease.document, /PasswordException/);
    // The next viewer opens it again.
    acquireDocument(engine, { url: "/locked.pdf" });
    assert.equal(calls.opens, 2);
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

  it("tells requests with other headers or credentials apart", () => {
    const key = sourceKey({ url: "/a.pdf", httpHeaders: { b: "2", a: "1" } });
    assert.equal(key, sourceKey({ url: "/a.pdf", httpHeaders: { a: "1", b: "2" } }));
    assert.notEqual(key, sourceKey({ url: "/a.pdf" }));
    assert.notEqual(
      sourceKey({ url: "/a.pdf", withCredentials: true }),
      sourceKey({ url: "/a.pdf" }),
    );
    // The password is not part of the key: viewers share the unlocked document.
    assert.equal(sourceKey({ url: "/a.pdf", password: "x" }), sourceKey({ url: "/a.pdf" }));
  });
});
