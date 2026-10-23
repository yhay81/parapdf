import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import type { PdfEngine, PdfEngineDocument } from "../src/engine/types.ts";
import { PdfViewerRuntime } from "../src/runtime/viewer.ts";

const settle = () => new Promise((resolve) => setImmediate(resolve));

/** Keeps asking until the viewers close it, without needing a DOM or a PDF parser. */
function lockedEngine(): PdfEngine {
  return {
    name: "locked",
    async open(_source, options) {
      await Promise.resolve();
      let reason: "required" | "incorrect" = "required";
      for (;;) {
        if ((await options?.password?.(reason)) === null) throw new Error("PasswordException");
        reason = "incorrect";
      }
    },
  };
}

describe("the viewer's pending password request", () => {
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

  it("preserves a password request replayed to a second viewer", async () => {
    const engine = lockedEngine();
    const first = new PdfViewerRuntime(engine);
    close.push(first.open({ url: "/locked.pdf" }));
    await settle();
    assert.equal(first.store.get().status, "password");
    first.submitPassword("wrong");
    await settle();

    const second = new PdfViewerRuntime(engine);
    close.push(second.open({ url: "/locked.pdf" }));
    assert.equal(second.store.get().status, "password");
    assert.equal(second.store.get().passwordReason, "incorrect");
    // A replayed prompt must remain usable, not only visible.
    second.submitPassword(null);
    await settle();
    assert.equal(first.store.get().status, "error");
    assert.equal(second.store.get().status, "error");
  });

  it("preserves the prompt when a waiting viewer remounts within the release delay", async () => {
    const viewer = new PdfViewerRuntime(lockedEngine());
    const release = viewer.open({ url: "/locked.pdf" });
    await settle();
    release();
    close.push(viewer.open({ url: "/locked.pdf" }));
    assert.equal(viewer.store.get().status, "password");
    assert.equal(viewer.store.get().passwordReason, "required");
  });

  it("preserves the replayed error when the second viewer has no password prompt", async () => {
    const engine = lockedEngine();
    const first = new PdfViewerRuntime(engine);
    close.push(first.open({ url: "/locked.pdf" }));
    await settle();
    const second = new PdfViewerRuntime(engine, { passwordPrompt: false });
    close.push(second.open({ url: "/locked.pdf" }));
    assert.equal(second.store.get().status, "error");
    assert.equal(second.store.get().error, "PasswordException: No password given");
  });

  it("opens with a changed source password without replaying the old error when prompting is disabled", async () => {
    let opens = 0;
    const engine: PdfEngine = {
      name: "unlockable",
      async open(source, options) {
        opens++;
        let password = source.password;
        while (password !== "secret") {
          const answer = await options?.password?.(
            password === undefined ? "required" : "incorrect",
          );
          if (answer == null) throw new Error("PasswordException");
          password = answer;
        }
        return {
          pageCount: 1,
          pageSize: async () => ({ width: 612, height: 792 }),
          getOutline: async () => [],
          getPageLabels: async () => null,
          getMetadata: async () => null,
          getAttachments: async () => [],
          createLayerState: async () => ({ layers: () => [] }),
          getPermissions: async () => ({ restricted: false }),
          getInitialView: async () => ({ destination: null, pageLayout: null, pageMode: null }),
          destroy: async () => {},
        } as unknown as PdfEngineDocument;
      },
    };
    const viewer = new PdfViewerRuntime(engine, { passwordPrompt: false });
    const release = viewer.open({ url: "/locked.pdf", password: "wrong" });
    await settle();
    assert.equal(viewer.store.get().status, "error");
    release();
    const statuses: string[] = [];
    const unsubscribe = viewer.store.subscribe(() => statuses.push(viewer.store.get().status));
    close.push(viewer.open({ url: "/locked.pdf", password: "secret" }));
    await settle();
    unsubscribe();
    assert.equal(viewer.store.get().status, "ready");
    assert.equal(viewer.store.get().error, null);
    assert.equal(opens, 1);
    assert.equal(statuses.includes("error"), false);
  });
});
