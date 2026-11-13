import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import type { PDFDataRangeTransport } from "pdfjs-dist";
import {
  acquireSession,
  type SessionLease,
  type SharedSession,
  sharedSession,
  sourceKey,
  splitFragment,
} from "../src/document/registry.ts";
import type { PdfSource } from "../src/document/session.ts";
import {
  askPassword,
  type FakeLoadingTask,
  FakeRangeTransport,
  fakeDocument,
  fakePdfjs,
  LETTER,
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

  it("keeps URLs containing serialized request options separate from credentialed requests", async () => {
    const { loader } = fakePdfjs();
    const plain = acquireSession(loader, { url: "/report.pdf [null,true]" });
    const credentialed = acquireSession(loader, { url: "/report.pdf", withCredentials: true });
    assert.notEqual(await plain.session, await credentialed.session);
    plain.release();
    credentialed.release();
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

  it("does not close a replacement session when the failed session's lease expires", async () => {
    let attempts = 0;
    const { loader, calls } = fakePdfjs(async () => {
      if (++attempts === 1) throw new Error("first open failed");
      return fakeDocument().proxy;
    });
    const first = acquireSession(loader, { url: "/a.pdf" });
    await assert.rejects(first.session, /first open failed/);
    const second = acquireSession(loader, { url: "/a.pdf" });
    const session = await second.session;
    first.release();
    mock.timers.tick(1000);
    await settle();
    const third = acquireSession(loader, { url: "/a.pdf" });
    assert.equal(await third.session, session);
    assert.equal(session.signal.aborted, false);
    assert.equal(calls.opens, 2);
    assert.equal(calls.destroys, 1, "only the failed open's loading task");
    second.release();
    third.release();
    mock.timers.tick(1000);
    await settle();
    assert.equal(calls.destroys, 2);
  });

  it("waits for permissions before publishing ready and does not publish after closing", async () => {
    let resolvePermissions!: (value: null) => void;
    const permissions = new Promise<null>((resolve) => {
      resolvePermissions = resolve;
    });
    const { loader, calls } = fakePdfjs(
      async () => fakeDocument({ proxy: { getPermissions: () => permissions } }).proxy,
    );
    const lease = acquireSession(loader, { url: "/a.pdf" });
    await lease.session;
    await settle();
    assert.equal(lease.state.get().status, "loading");
    lease.release();
    mock.timers.tick(1000);
    await settle();
    resolvePermissions(null);
    await settle();
    assert.notEqual(lease.state.get().status, "ready");
    assert.equal(calls.destroys, 1);
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

  it("opens a source that turns credentials off apart from one that takes pdf.js's options'", async () => {
    const { loader, loaded, calls } = fakePdfjs();
    // configurePdfjs's documentOptions turn credentials on for every document.
    Object.assign(loaded.documentParameters, { withCredentials: true });
    const httpHeaders = { authorization: "token" };
    const a = acquireSession(loader, { url: "/a.pdf", httpHeaders });
    const b = acquireSession(loader, { url: "/a.pdf", httpHeaders, withCredentials: false });
    assert.notEqual(await a.session, await b.session);
    assert.deepEqual(
      calls.parameters.map((parameters) => parameters.withCredentials),
      [true, false],
    );
  });

  it("opens empty headers apart from inherited headers with explicit credentials", async () => {
    const { loader, loaded, calls } = fakePdfjs();
    Object.assign(loaded.documentParameters, { httpHeaders: { authorization: "token" } });
    const inherited = acquireSession(loader, { url: "/a.pdf", withCredentials: false });
    const empty = acquireSession(loader, {
      url: "/a.pdf",
      withCredentials: false,
      httpHeaders: {},
    });
    assert.notEqual(await inherited.session, await empty.session);
    assert.deepEqual(
      calls.parameters.map((parameters) => parameters.httpHeaders),
      [{ authorization: "token" }, {}],
    );
  });

  it("keeps the sessions of each pdf.js loader apart", async () => {
    const first = fakePdfjs();
    const second = fakePdfjs();
    const a = acquireSession(first.loader, { url: "/a.pdf" });
    const b = acquireSession(second.loader, { url: "/a.pdf" });
    assert.notEqual(await a.session, await b.session);
    assert.notEqual(a.state, b.state);
    assert.deepEqual([first.calls.opens, second.calls.opens], [1, 1]);
  });

  it("waits a full second after the last viewer leaves, however often viewers came and went", async () => {
    const { loader, calls } = fakePdfjs();
    const first = acquireSession(loader, { url: "/a.pdf" });
    const session = await first.session;
    first.release();
    mock.timers.tick(900);
    const second = acquireSession(loader, { url: "/a.pdf" });
    mock.timers.tick(50);
    second.release();
    mock.timers.tick(999);
    await settle();
    assert.equal(session.signal.aborted, false);
    mock.timers.tick(1);
    await settle();
    assert.equal(session.signal.aborted, true);
    assert.deepEqual([calls.opens, calls.destroys], [1, 1]);
  });

  it("never asks pdf.js for a document whose viewers all left while pdf.js loaded", async () => {
    const { loaded, calls } = fakePdfjs();
    let ready = () => {};
    const loader = () =>
      new Promise<typeof loaded>((resolve) => {
        ready = () => resolve(loaded);
      });
    const lease = acquireSession(loader, { url: "/a.pdf" });
    lease.release();
    mock.timers.tick(1000);
    ready();
    await assert.rejects(lease.session, { name: "AbortError" });
    assert.equal(calls.opens, 0);
  });

  it("publishes no error for an open that stopped because its viewers all left", async () => {
    const { loaded } = fakePdfjs();
    let ready = () => {};
    const loader = () =>
      new Promise<typeof loaded>((resolve) => {
        ready = () => resolve(loaded);
      });
    const lease = acquireSession(loader, { url: "/a.pdf" });
    lease.release();
    mock.timers.tick(1000);
    ready();
    await assert.rejects(lease.session, { name: "AbortError" });
    await settle();
    assert.equal(lease.state.get().status, "loading");
    assert.equal(lease.state.get().error, null);
  });

  it("publishes a failed open, and starts the next viewer's attempt from loading", async () => {
    const { loader } = failingPdfjs();
    const first = acquireSession(loader, { url: "/a.pdf" });
    await assert.rejects(first.session);
    await settle();
    assert.equal(first.state.get().status, "error");
    assert.equal(first.state.get().error, "Error: not a PDF");
    const second = acquireSession(loader, { url: "/a.pdf" });
    assert.notEqual(second.state, first.state);
    assert.equal(second.state.get().status, "loading");
    assert.equal(second.state.get().error, null);
    await assert.rejects(second.session);
    first.release();
    second.release();
  });

  it("is ready without permissions when reading them fails", async (context) => {
    context.mock.method(console, "error", () => {});
    const { loader } = fakePdfjs(
      async () =>
        fakeDocument({
          pages: [LETTER, LETTER],
          proxy: {
            getPermissions: async () => {
              throw new Error("unreadable");
            },
          },
        }).proxy,
    );
    const lease = acquireSession(loader, { url: "/a.pdf" });
    await lease.session;
    await settle();
    assert.deepEqual(lease.state.get(), {
      status: "ready",
      error: null,
      passwordReason: null,
      progress: null,
      pageCount: 2,
      permissions: null,
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

  it("fails to open when a viewer gives up, and lets go of the locked file", async () => {
    const { loader, calls } = lockedPdfjs();
    const lease = acquireSession(loader, { url: "/locked.pdf" });
    await settle();
    lease.submitPassword(null);
    await assert.rejects(lease.session, /No password/);
    await settle();
    assert.equal(lease.state.get().status, "error");
    assert.equal(lease.state.get().passwordReason, null);
    assert.equal(calls.destroys, 1, "pdf.js's worker drops the file it read");
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

  it("coalesces progress in the shared state and ignores late progress after closing", async () => {
    let report!: NonNullable<FakeLoadingTask["onProgress"]>;
    const { loader } = fakePdfjs(async (task) => {
      report = task.onProgress as NonNullable<FakeLoadingTask["onProgress"]>;
      return fakeDocument().proxy;
    });
    const lease = acquireSession(loader, { url: "/progress.pdf" });
    await lease.session;
    await settle();
    const seen: (number | null)[] = [];
    const unsubscribe = lease.state.subscribe(() =>
      seen.push(lease.state.get().progress?.loaded ?? null),
    );
    report({ loaded: 10, total: 100 });
    report({ loaded: 20, total: 100 });
    report({ loaded: 30, total: 100 });
    assert.deepEqual(seen, []);
    mock.timers.tick(16);
    assert.deepEqual(seen, [30]);
    assert.deepEqual(lease.state.get().progress, { loaded: 30, total: 100 });
    lease.release();
    mock.timers.tick(1000);
    await settle();
    report({ loaded: 40, total: 100 });
    mock.timers.tick(16);
    assert.deepEqual(seen, [30]);
    unsubscribe();
  });

  it("publishes each request for a password with its reason, and none once ready", async () => {
    const { loader } = lockedPdfjs();
    const lease = acquireSession(loader, { url: "/locked.pdf" });
    const seen: string[] = [];
    lease.state.subscribe(() => {
      const { status, passwordReason } = lease.state.get();
      seen.push(passwordReason ? `${status}:${passwordReason}` : status);
    });
    await settle();
    lease.submitPassword("wrong");
    await settle();
    lease.submitPassword("secret");
    await lease.session;
    await settle();
    assert.deepEqual(seen, [
      "password:required",
      "loading",
      "password:incorrect",
      "loading",
      "ready",
    ]);
    // Answered, a request takes no other answer.
    lease.submitPassword("again");
    lease.submitPassword(null);
    await settle();
    assert.equal(lease.state.get().status, "ready");
  });

  it("takes no answer from a viewer that left, while the others may still answer", async () => {
    const { loader, asked } = lockedPdfjs();
    const leaving = acquireSession(loader, { url: "/locked.pdf" });
    const staying = acquireSession(loader, { url: "/locked.pdf" });
    await settle();
    leaving.release();
    leaving.submitPassword(null);
    await settle();
    assert.equal(staying.state.get().status, "password");
    assert.deepEqual(asked, ["required"]);
    staying.submitPassword("secret");
    await staying.session;
    staying.release();
  });

  it("keeps a document that opened, whatever password a later viewer brings", async () => {
    const { loader, calls, asked } = lockedPdfjs();
    const first = acquireSession(loader, { url: "/locked.pdf", password: "secret" });
    const session = await first.session;
    const second = acquireSession(loader, { url: "/locked.pdf", password: "other" });
    assert.equal(await second.session, session);
    await settle();
    assert.equal(second.state.get().status, "ready");
    assert.deepEqual(asked, []);
    assert.equal(calls.opens, 1);
  });

  it("publishes no progress whose frame comes after the session closed", async () => {
    let report!: NonNullable<FakeLoadingTask["onProgress"]>;
    const { loader } = fakePdfjs(async (task) => {
      report = task.onProgress as NonNullable<FakeLoadingTask["onProgress"]>;
      return fakeDocument().proxy;
    });
    const heard: number[] = [];
    const lease = acquireSession(
      loader,
      { url: "/a.pdf" },
      { onProgress: (loaded) => heard.push(loaded) },
    );
    await lease.session;
    await settle();
    lease.release();
    mock.timers.tick(990);
    report({ loaded: 10, total: 100 });
    mock.timers.tick(10);
    await settle();
    mock.timers.tick(16);
    assert.equal(lease.state.get().progress, null);
    assert.deepEqual(heard, [], "nor to a viewer that left");
  });

  it("stops loading once the last viewer leaves while it waits for a password", async () => {
    const { loader, calls } = lockedPdfjs();
    const lease = acquireSession(loader, { url: "/locked.pdf" });
    await settle();
    lease.release();
    mock.timers.tick(1000);
    await settle();
    assert.equal(calls.destroys, 1, "pdf.js's loading task is destroyed");
    await assert.rejects(lease.session, /destroyed/);
    // The next viewer opens it again.
    acquireSession(loader, { url: "/locked.pdf" });
    await settle();
    assert.equal(calls.opens, 2);
  });
});

describe("sharedSession", () => {
  beforeEach(() => mock.timers.enable({ apis: ["setTimeout"] }));
  afterEach(() => mock.timers.reset());

  const A: PdfSource = { url: "/a.pdf" };

  it("opens a session for a render, and closes one no lease came to hold ten seconds on", async () => {
    const { loader, calls } = fakePdfjs();
    const shared = sharedSession(loader, A);
    assert.equal(shared.state.get().status, "loading");
    assert.equal(sharedSession(loader, { url: "/a.pdf#page=2" }), shared, "one for the source");
    await settle();
    assert.equal(shared.state.get().status, "ready");
    mock.timers.tick(9_999);
    await settle();
    assert.equal(shared.signal.aborted, false);
    mock.timers.tick(1);
    await settle();
    assert.equal(shared.signal.aborted, true);
    assert.equal(calls.destroys, 1);
    assert.notEqual(sharedSession(loader, A), shared, "the next render opens it again");
    await settle();
    assert.equal(calls.opens, 2);
  });

  it("stays open while the document loads and while it is read, however long that takes", async () => {
    let open = (): void => {};
    const opened = new Promise<void>((resolve) => {
      open = resolve;
    });
    let give = (): void => {};
    const given = new Promise<void>((resolve) => {
      give = resolve;
    });
    const { loader } = fakePdfjs(async () => {
      await opened;
      const getOutline = async () => {
        await given;
        return null;
      };
      return fakeDocument({ proxy: { getOutline } }).proxy;
    });
    const shared = sharedSession(loader, A);
    const outline = shared.read("outline", (session) => session.outline(), []);
    mock.timers.tick(60_000);
    await settle();
    assert.equal(shared.signal.aborted, false, "while it loads");
    open();
    await settle();
    assert.equal(shared.state.get().status, "ready");
    mock.timers.tick(60_000);
    await settle();
    assert.equal(shared.signal.aborted, false, "while a render may wait for what is read");
    give();
    assert.deepEqual(await outline, []);
    await settle();
    mock.timers.tick(9_999);
    await settle();
    assert.equal(shared.signal.aborted, false);
    mock.timers.tick(1);
    await settle();
    assert.equal(shared.signal.aborted, true);
  });

  it("rests only after a read started on an already idle document settles", async () => {
    const { loader } = fakePdfjs();
    const shared = sharedSession(loader, A);
    await settle();
    mock.timers.tick(9_000);
    let finish!: (value: string) => void;
    const late = new Promise<string>((resolve) => {
      finish = resolve;
    });
    const reading = shared.read("late", () => late, "fallback");
    mock.timers.tick(10_000);
    await settle();
    assert.equal(shared.signal.aborted, false, "the read outlives the original deadline");
    finish("result");
    assert.equal(await reading, "result");
    mock.timers.tick(9_999);
    assert.equal(shared.signal.aborted, false, "the full grace period starts after the read");
    mock.timers.tick(1);
    assert.equal(shared.signal.aborted, true);
  });

  it("closes a released document even if a remaining reader starts a slow read", async () => {
    const { loader } = fakePdfjs();
    const lease = acquireSession(loader, A);
    await settle();
    lease.release();
    const reading = lease.shared.read("late", () => new Promise<string>(() => {}), "fallback");
    mock.timers.tick(1000);
    assert.equal(await reading, "fallback");
    assert.equal(lease.shared.signal.aborted, true);
  });

  it("gives each render that asks its own time, and stays while a lease holds it", async () => {
    const { loader, calls } = fakePdfjs();
    const shared = sharedSession(loader, A);
    await settle();
    mock.timers.tick(9_000);
    assert.equal(sharedSession(loader, A), shared);
    mock.timers.tick(9_000);
    await settle();
    assert.equal(shared.signal.aborted, false, "asked for again before it closed");
    const lease = acquireSession(loader, A);
    assert.equal(lease.shared, shared);
    assert.equal(await lease.session, await shared.session);
    mock.timers.tick(60_000);
    await settle();
    assert.equal(shared.signal.aborted, false, "held");
    lease.release();
    // The render of a tree about to mount again finds it within the second a release leaves.
    mock.timers.tick(999);
    assert.equal(sharedSession(loader, A), shared);
    mock.timers.tick(9_999);
    await settle();
    assert.equal(shared.signal.aborted, false);
    mock.timers.tick(1);
    await settle();
    assert.equal(shared.signal.aborted, true);
    assert.equal(calls.opens, 1);
  });

  it("reads each thing once, with one promise for every reader of the source", async () => {
    let outlines = 0;
    const { loader } = fakePdfjs(async () => {
      const getOutline = async () => {
        outlines++;
        return null;
      };
      return fakeDocument({ proxy: { getOutline } }).proxy;
    });
    const read = (from: SharedSession) => from.read("outline", (session) => session.outline(), []);
    const shared = sharedSession(loader, A);
    const outline = read(shared);
    assert.equal(read(shared), outline, "what a render reads with use(), however often it renders");
    const lease = acquireSession(loader, A);
    assert.equal(read(lease.shared), outline, "and what its provider reads once mounted");
    assert.deepEqual(await outline, []);
    assert.equal(outlines, 1);
    lease.release();
  });

  it("settles with the fallback what is read from a session that closed", async () => {
    const { loader } = fakePdfjs();
    const shared = sharedSession(loader, A);
    const outline = shared.read("outline", (session) => session.outline(), []);
    await settle();
    mock.timers.tick(10_000);
    await settle();
    assert.equal(shared.signal.aborted, true);
    assert.equal(
      shared.read("outline", (session) => session.outline(), []),
      outline,
    );
    const labels = shared.read("pageLabels", (session) => session.pageLabels(), null);
    assert.equal(await labels, null);
    assert.equal(
      shared.read("pageLabels", (session) => session.pageLabels(), null),
      labels,
    );
  });

  it("keeps a failure no lease holds for the render that opened it, and forgets it once held", async (context) => {
    const errors = context.mock.method(console, "error", () => {});
    const { loader, calls } = failingPdfjs();
    const shared = sharedSession(loader, A);
    const outline = shared.read("outline", (session) => session.outline(), []);
    await settle();
    assert.equal(shared.state.get().status, "error");
    assert.deepEqual(await outline, [], "what a render waits for settles");
    // A tree React renders from nothing after each failure opens nothing again.
    assert.equal(sharedSession(loader, A), shared);
    assert.equal(calls.opens, 1);
    const lease = acquireSession(loader, A);
    assert.equal(lease.shared, shared, "the provider that mounts shows the failure");
    const retry = acquireSession(loader, A);
    assert.notEqual(retry.shared, shared, "and the next viewer tries again");
    await settle();
    assert.equal(calls.opens, 2);
    assert.equal(errors.mock.callCount(), 0, "the document's state says it failed");
    lease.release();
    retry.release();
  });

  it("forgets a failure no lease came to hold, ten seconds on", async () => {
    const { loader, calls } = failingPdfjs();
    const shared = sharedSession(loader, A);
    await settle();
    mock.timers.tick(10_000);
    await settle();
    assert.equal(shared.signal.aborted, true);
    assert.notEqual(sharedSession(loader, A), shared);
    await settle();
    assert.equal(calls.opens, 2);
  });

  it("settles what is read while it waits for a password, and closes when no lease comes to answer", async () => {
    const { loader, calls } = lockedPdfjs();
    const shared = sharedSession(loader, { url: "/locked.pdf" });
    const outline = shared.read("outline", (session) => session.outline(), []);
    await settle();
    assert.equal(shared.state.get().status, "password");
    assert.deepEqual(await outline, [], "the render that waited shows the request");
    mock.timers.tick(9_999);
    await settle();
    assert.equal(shared.signal.aborted, false);
    mock.timers.tick(1);
    await settle();
    assert.equal(shared.signal.aborted, true);
    assert.equal(calls.destroys, 1, "pdf.js's loading task is destroyed");
  });

  it("reads anew what settled while it waited for a password, once a lease answers", async () => {
    const { loader } = lockedPdfjs();
    const shared = sharedSession(loader, { url: "/locked.pdf" });
    const read = () => shared.read("pageCount", async (session) => session.pageCount, 0);
    const waiting = read();
    await settle();
    assert.equal(await waiting, 0);
    const { reads } = shared;
    const lease = acquireSession(loader, { url: "/locked.pdf" });
    assert.equal(shared.reads, reads, "a lease alone changes nothing");
    lease.submitPassword("wrong");
    assert.notEqual(shared.reads, reads);
    await settle();
    assert.equal(shared.state.get().passwordReason, "incorrect");
    assert.equal(await read(), 0);
    lease.submitPassword("secret");
    const unlocked = read();
    assert.notEqual(unlocked, waiting);
    await settle();
    assert.equal(await unlocked, 1);
    assert.equal(read(), unlocked);
    lease.release();
  });
});

describe("sourceKey", () => {
  it("is equal for the same URL in another object", () => {
    const a: PdfSource = { url: "/a.pdf" };
    assert.equal(sourceKey(a), sourceKey({ url: "/a.pdf" }));
    assert.notEqual(sourceKey(a), sourceKey({ url: "/b.pdf" }));
  });

  it("leaves out the URL's fragment, which says where to open", () => {
    assert.equal(sourceKey({ url: "/a.pdf#page=3" }), sourceKey({ url: "/a.pdf" }));
    assert.equal(
      sourceKey({ url: "/a.pdf#zoom=200", withCredentials: true }),
      sourceKey({ url: "/a.pdf", withCredentials: true }),
    );
    assert.notEqual(sourceKey({ url: "/a.pdf?v=2#page=3" }), sourceKey({ url: "/a.pdf" }));
  });

  it("is the bytes themselves for data", () => {
    const data = new ArrayBuffer(8);
    assert.equal(sourceKey({ data }), data);
  });

  it("is the transport itself for a range transport", () => {
    const range = new FakeRangeTransport(8, null) as unknown as PDFDataRangeTransport;
    assert.equal(sourceKey({ range }), range);
    assert.equal(sourceKey({ range, password: "a" }), range);
    assert.notEqual(
      sourceKey({ range: new FakeRangeTransport(8, null) as unknown as PDFDataRangeTransport }),
      range,
    );
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

  it("tells a header's value, or a header named by another, apart", () => {
    const key = (httpHeaders: Record<string, string>) => sourceKey({ url: "/a.pdf", httpHeaders });
    assert.notEqual(key({ a: "1" }), key({ a: "2" }));
    assert.notEqual(key({ a: "1" }), key({ b: "1" }));
    assert.notEqual(key({ a: "1 b" }), key({ a: "1", b: "" }));
  });
});

describe("splitFragment", () => {
  it("splits at the first #, leaving the URL whole without one", () => {
    assert.deepEqual(splitFragment("/a.pdf"), ["/a.pdf", ""]);
    assert.deepEqual(splitFragment("/a.pdf#"), ["/a.pdf", ""]);
    assert.deepEqual(splitFragment("#page=2"), ["", "page=2"]);
    assert.deepEqual(splitFragment("/a.pdf?q=#x#page=2"), ["/a.pdf?q=", "x#page=2"]);
    assert.deepEqual(splitFragment("blob:https://a.test/1#page=2"), [
      "blob:https://a.test/1",
      "page=2",
    ]);
  });
});
