import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { acquireSession, type SessionLease, sourceKey } from "../src/document/registry.ts";
import type { PdfSource } from "../src/document/session.ts";
import {
  askPassword,
  type FakeLoadingTask,
  fakeDocument,
  fakePdfjs,
  PasswordException,
  settle,
} from "./fake-pdfjs.ts";

/** pdf.js whose every document fails to open. */
const failingPdfjs = () =>
  fakePdfjs(async () => {
    throw new Error("not a PDF");
  });

describe("acquireSession", () => {
  beforeEach(() => mock.timers.enable({ apis: ["setTimeout"] }));
  afterEach(() => mock.timers.reset());

  it("shares one session among viewers of the same URL", async () => {
    const { loader, calls } = fakePdfjs();
    const a = acquireSession(loader, { url: "/a.pdf" });
    const b = acquireSession(loader, { url: "/a.pdf" });
    const c = acquireSession(loader, { url: "/b.pdf" });
    assert.equal(await a.session, await b.session);
    assert.notEqual(await a.session, await c.session);
    assert.equal(calls.opens, 2);
  });

  it("gives an owner a session of its own, which it shares with no other viewer", async () => {
    const { loader, calls } = fakePdfjs();
    const editor = {};
    const shared = acquireSession(loader, { url: "/a.pdf" });
    const own = acquireSession(loader, { url: "/a.pdf" }, {}, editor);
    // The owner's second mount, as StrictMode makes, reuses its own.
    own.release();
    const again = acquireSession(loader, { url: "/a.pdf" }, {}, editor);
    assert.notEqual(await shared.session, await own.session);
    assert.equal(await own.session, await again.session);
    assert.equal(calls.opens, 2);
  });

  it("closes a session a second after its last viewer releases it", async () => {
    const { loader, calls } = fakePdfjs();
    const a = acquireSession(loader, { url: "/a.pdf" });
    const b = acquireSession(loader, { url: "/a.pdf" });
    const session = await a.session;
    a.release();
    b.release();
    b.release(); // A second release of the same lease changes nothing.
    mock.timers.tick(999);
    await settle();
    assert.equal(calls.destroys, 0);
    assert.equal(session.signal.aborted, false);
    mock.timers.tick(1);
    await settle();
    assert.equal(calls.destroys, 1);
    assert.equal(session.signal.aborted, true, "closing aborts what was started for it");
    // A later viewer opens it again.
    await acquireSession(loader, { url: "/a.pdf" }).session;
    assert.equal(calls.opens, 2);
  });

  it("keeps the session for a viewer that comes back within the delay", async () => {
    const { loader, calls } = fakePdfjs();
    // StrictMode mounts, unmounts, and mounts again.
    const first = acquireSession(loader, { url: "/a.pdf" });
    first.release();
    const second = acquireSession(loader, { url: "/a.pdf" });
    mock.timers.tick(5000);
    await settle();
    assert.equal(await first.session, await second.session);
    assert.deepEqual([calls.opens, calls.destroys], [1, 0]);
  });

  it("aborts a lease's signal when it is released, and the session's only when it closes", async () => {
    const { loader } = fakePdfjs();
    const a = acquireSession(loader, { url: "/a.pdf" });
    const b = acquireSession(loader, { url: "/a.pdf" });
    const session = await a.session;
    a.release();
    assert.equal(a.signal.aborted, true, "the released viewer's work stops");
    assert.equal(b.signal.aborted, false, "the other viewer's goes on");
    assert.equal(session.signal.aborted, false);
    b.release();
    mock.timers.tick(1000);
    await settle();
    assert.equal(session.signal.aborted, true);
  });

  it("forgets a failed open, so the next viewer tries again", async () => {
    const { loader, calls } = failingPdfjs();
    await assert.rejects(acquireSession(loader, { url: "/a.pdf" }).session, /not a PDF/);
    await assert.rejects(acquireSession(loader, { url: "/a.pdf" }).session, /not a PDF/);
    assert.equal(calls.opens, 2);
  });

  it("shares data sources by the identity of their bytes, and gives pdf.js a copy", async () => {
    const { loader, calls } = fakePdfjs();
    const bytes = new Uint8Array([37, 80, 68, 70]);
    await acquireSession(loader, { data: bytes }).session;
    await acquireSession(loader, { data: bytes }).session;
    await acquireSession(loader, { data: bytes.slice() }).session;
    assert.equal(calls.opens, 2);
    // pdf.js transfers the bytes it gets to its worker, which detaches them.
    assert.notEqual(calls.parameters[0]?.data, bytes);
    assert.deepEqual(calls.parameters[0]?.data, bytes);
  });

  it("opens a URL with its request's headers and credentials mode, and pdf.js's worker", async () => {
    const { loader, loaded, calls } = fakePdfjs();
    await acquireSession(loader, {
      url: "/a.pdf",
      httpHeaders: { authorization: "token" },
      withCredentials: true,
    }).session;
    assert.deepEqual(calls.parameters[0], {
      enableHWA: true,
      url: "/a.pdf",
      httpHeaders: { authorization: "token" },
      withCredentials: true,
      worker: loaded.worker,
    });
  });
});

/**
 * pdf.js whose documents need the password "secret": each reports progress,
 * then asks until it gets the password, and fails when it gets none.
 */
function lockedPdfjs(beforePassword: Promise<void> = Promise.resolve()) {
  const asked: string[] = [];
  const fake = fakePdfjs(async (task: FakeLoadingTask, { password: given }) => {
    task.onProgress?.({ loaded: 10, total: 100 });
    await beforePassword;
    let password = given;
    for (;;) {
      if (password === "secret") break;
      const reason = password === undefined ? "required" : "incorrect";
      asked.push(reason);
      const answer = await askPassword(task, reason);
      if (answer === null) throw new PasswordException("No password given", 1);
      password = answer;
    }
    task.onProgress?.({ loaded: 100, total: 100 });
    return fakeDocument().proxy;
  });
  return { ...fake, asked };
}

describe("acquireSession with passwords and progress", () => {
  beforeEach(() => mock.timers.enable({ apis: ["setTimeout"] }));
  afterEach(() => mock.timers.reset());

  it("asks every viewer of the document, and any of them may answer", async () => {
    const { loader, calls, asked } = lockedPdfjs();
    const heard: string[] = [];
    const a = acquireSession(
      loader,
      { url: "/locked.pdf" },
      {
        onPassword: (reason) => heard.push(`a:${reason}`),
      },
    );
    await settle();
    // A viewer that joins while the request is pending hears it too.
    const b = acquireSession(
      loader,
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
    assert.equal(await a.session, await b.session);
    assert.deepEqual(asked, ["required", "incorrect"]);
    assert.equal(calls.opens, 1);
  });

  it("fails to open when a viewer gives up", async () => {
    const { loader } = lockedPdfjs();
    const lease = acquireSession(loader, { url: "/locked.pdf" });
    await settle();
    lease.submitPassword(null);
    await assert.rejects(lease.session, /No password/);
  });

  it("tries a changed source password on a pending shared document before replaying its prompt", async () => {
    const { loader, calls, asked } = lockedPdfjs();
    const first = acquireSession(loader, { url: "/locked.pdf", password: "wrong" });
    await settle();
    first.release();
    const heard: string[] = [];
    const second = acquireSession(
      loader,
      { url: "/locked.pdf", password: "secret" },
      { onPassword: (reason) => heard.push(reason) },
    );
    await settle();
    assert.deepEqual(heard, []);
    assert.equal(await first.session, await second.session);
    assert.equal(calls.opens, 1);
    assert.deepEqual(asked, ["incorrect"]);
  });

  it("keeps a changed source password until pdf.js asks for it", async () => {
    let start = () => {};
    const { loader, calls } = lockedPdfjs(new Promise((resolve) => (start = resolve)));
    const first = acquireSession(loader, { url: "/locked.pdf", password: "wrong" });
    first.release();
    const heard: string[] = [];
    const second = acquireSession(
      loader,
      { url: "/locked.pdf", password: "secret" },
      { onPassword: (reason) => heard.push(reason) },
    );
    start();
    await settle();
    assert.deepEqual(heard, []);
    assert.equal(await first.session, await second.session);
    assert.equal(calls.opens, 1);
  });

  it("tries each new source password once, including an empty one, without retrying failed values on remount", async () => {
    const { loader, calls, asked } = lockedPdfjs();
    const first = acquireSession(loader, { url: "/locked.pdf", password: "wrong" });
    await settle();
    first.release();
    const same = acquireSession(loader, { url: "/locked.pdf", password: "wrong" });
    await settle();
    assert.deepEqual(asked, ["incorrect"]);
    same.release();
    const empty = acquireSession(loader, { url: "/locked.pdf", password: "" });
    await settle();
    assert.deepEqual(asked, ["incorrect", "incorrect"]);
    empty.release();
    const again = acquireSession(loader, { url: "/locked.pdf", password: "" });
    await settle();
    assert.deepEqual(asked, ["incorrect", "incorrect"]);
    again.submitPassword("secret");
    await again.session;
    assert.equal(calls.opens, 1);
  });

  it("lets a second viewer's source password unlock the document for both viewers", async () => {
    const { loader, calls } = lockedPdfjs();
    const first = acquireSession(loader, { url: "/locked.pdf" });
    await settle();
    const second = acquireSession(loader, { url: "/locked.pdf", password: "secret" });
    await settle();
    assert.equal(await first.session, await second.session);
    assert.equal(calls.opens, 1);
  });

  it("does not send an answered password request to a viewer acquired during notification", async () => {
    const { loader, calls } = lockedPdfjs();
    const heard: string[] = [];
    let second: SessionLease | undefined;
    const first = acquireSession(
      loader,
      { url: "/locked.pdf", password: "wrong" },
      {
        onPassword(reason) {
          heard.push(`first:${reason}`);
          second = acquireSession(
            loader,
            { url: "/locked.pdf", password: "secret" },
            { onPassword: (retryReason) => heard.push(`second:${retryReason}`) },
          );
        },
      },
    );
    await settle();
    assert.deepEqual(heard, ["first:incorrect"]);
    assert.ok(second);
    assert.equal(await first.session, await second.session);
    assert.equal(calls.opens, 1);
  });

  it("reports progress, also to viewers that join late", async () => {
    const { loader } = lockedPdfjs();
    const early: (number | null)[][] = [];
    const late: (number | null)[][] = [];
    const a = acquireSession(
      loader,
      { url: "/locked.pdf" },
      {
        onProgress: (loaded, total) => early.push([loaded, total]),
      },
    );
    await settle();
    acquireSession(
      loader,
      { url: "/locked.pdf" },
      {
        onProgress: (loaded, total) => late.push([loaded, total]),
      },
    );
    a.submitPassword("secret");
    await a.session;
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
    const { loader, calls } = lockedPdfjs();
    const lease = acquireSession(loader, { url: "/locked.pdf" });
    await settle();
    lease.release();
    mock.timers.tick(1000);
    await settle();
    assert.equal(calls.destroys, 1, "pdf.js's loading task is destroyed");
    await assert.rejects(lease.session, PasswordException);
    // The next viewer opens it again.
    acquireSession(loader, { url: "/locked.pdf" });
    await settle();
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
