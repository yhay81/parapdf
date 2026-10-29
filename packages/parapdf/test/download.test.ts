import assert from "node:assert/strict";
import { it } from "node:test";
import { download, save } from "../src/features/download.ts";
import type { Viewer } from "../src/view/viewer.ts";

it("keeps the original URL's name if the viewer changes while metadata loads", async (t) => {
  let resolveMetadata!: (value: { filename: null }) => void;
  const metadata = new Promise<{ filename: null }>((resolve) => {
    resolveMetadata = resolve;
  });
  let downloaded = "";
  const link = {
    style: {},
    download: "",
    href: "",
    click() {
      downloaded = this.download;
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
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const viewer = {
    sourceName: "first.pdf",
    session: {
      commit() {},
      output: async () => {},
      save: async () => new Uint8Array([1]),
      metadata: () => metadata,
    },
  };
  const pending = download(viewer as unknown as Viewer);
  await Promise.resolve();
  viewer.sourceName = "second.pdf";
  resolveMetadata({ filename: null });
  await pending;
  assert.equal(downloaded, "first.pdf");
});

it("saves and downloads the pages chosen, under the name given", async (t) => {
  const asked: unknown[] = [];
  let downloaded = "";
  const link = {
    style: {},
    download: "",
    href: "",
    click() {
      downloaded = this.download;
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
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const viewer = {
    sourceName: "a.pdf",
    session: {
      commit() {},
      output: async () => {},
      async save(pages?: unknown) {
        asked.push(pages);
        return new Uint8Array([1]);
      },
    },
  };
  const pages = [{ includePages: [[0, 2]] }];
  assert.deepEqual(await save(viewer as unknown as Viewer, { pages }), new Uint8Array([1]));
  await download(viewer as unknown as Viewer, { filename: "part.pdf", pages });
  assert.deepEqual(asked, [pages, pages]);
  assert.equal(downloaded, "part.pdf");
});

it("saves after the scripts ran WillSave, and sends DidSave once saved", async () => {
  const steps: string[] = [];
  const pages = [{ includePages: [0] }];
  const viewer = {
    session: {
      commit: () => steps.push("commit"),
      async output(event: string) {
        await Promise.resolve();
        steps.push(event);
      },
      async save(selection?: unknown) {
        assert.deepEqual(selection, pages);
        steps.push("save");
        return new Uint8Array([1]);
      },
    },
  };
  assert.deepEqual(await save(viewer as unknown as Viewer, { pages }), new Uint8Array([1]));
  assert.deepEqual(steps, ["commit", "WillSave", "save", "DidSave"]);
});

it("takes an empty filename as none given: the server's name, the URL's, or document.pdf", async (t) => {
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
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let served: string | null = "served.pdf";
  const viewer = {
    sourceName: "a.pdf" as string | null,
    session: {
      commit() {},
      output: async () => {},
      save: async () => new Uint8Array([1]),
      metadata: async () => ({ filename: served }),
    },
  };
  await download(viewer as unknown as Viewer, { filename: "" });
  served = null;
  await download(viewer as unknown as Viewer, { filename: "" });
  viewer.sourceName = null;
  await download(viewer as unknown as Viewer, { filename: "" });
  assert.deepEqual(downloaded, ["served.pdf", "a.pdf", "document.pdf"]);
});
