import assert from "node:assert/strict";
import { it } from "node:test";
import { download } from "../src/features/download.ts";
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
    session: { commit() {}, save: async () => new Uint8Array([1]), metadata: () => metadata },
  };
  const pending = download(viewer as unknown as Viewer);
  await Promise.resolve();
  viewer.sourceName = "second.pdf";
  resolveMetadata({ filename: null });
  await pending;
  assert.equal(downloaded, "first.pdf");
});
